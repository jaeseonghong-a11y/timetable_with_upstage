"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { AcademicDocumentKind, AcademicProfile } from "@/lib/academic-profile";
import {
  getClipboardImageFiles,
  validateAcademicDocumentFile,
} from "@/lib/academic-document-file";
import {
  confirmAcademicProfile,
  getAcademicDocumentApiError,
  getAcademicDocumentApiErrorCode,
  getReviewChecklist,
  isAcademicProfileConfirmed,
  markAcademicProfileDraft,
  parseAcademicProfileResponse,
} from "@/lib/academic-profile-client";
import { mergeGraduationRequirementProfiles } from "@/lib/academic-profile-merge";
import { track } from "@/lib/analytics";
import {
  ACADEMIC_ANALYSIS_STORAGE_KEY,
  readStoredAcademicAnalysis,
  writeStoredAcademicAnalysis,
} from "@/lib/browser-planning-storage";
import { useLocalStorageItem } from "@/lib/use-local-storage-item";

import { AcademicCourseEditor } from "./AcademicCourseEditor";
import { AcademicRequirementEditor } from "./AcademicRequirementEditor";
import styles from "./AcademicDocumentManager.module.css";

interface DocumentPreview {
  maxWidth: string;
  aspectRatio: string;
}

const KIND_DETAILS: Record<
  AcademicDocumentKind,
  {
    label: string;
    heading: string;
    description: readonly string[];
    attachGuide: string;
    guidePdf: string;
    examplePdf: string;
    guidePreview: DocumentPreview;
    examplePreview: DocumentPreview;
  }
> = {
  course_history: {
    label: "수강/취득과목",
    heading: "수강/취득 과목 첨부하기",
    description: [
      "문서 분석을 통해 기수강 과목을 한눈에 확인하세요.",
      "기수강 과목은 앞으로 담을 과목 후보와 AI 추천에서 제외됩니다.",
      "재수강 예정인 과목은 분석 후 수동으로 변경 가능해요.",
    ],
    attachGuide:
      "성균관대학교 GLS → 학적/개인영역 → 졸업자가진단 → 졸업요건충족현황조회 → 수강/취득 과목 출력 → PDF 저장 → 업로드",
    guidePdf: "/step2-guides/course-history-guide.pdf",
    examplePdf: "/step2-guides/course-history-example.pdf",
    guidePreview: { maxWidth: "100%", aspectRatio: "1700.79 / 310.123" },
    examplePreview: { maxWidth: "320px", aspectRatio: "595.276 / 841.89" },
  },
  graduation_requirements: {
    label: "졸업요건충족현황",
    heading: "졸업요건 충족현황 첨부하기",
    description: [
      "문서 분석으로 남은 졸업요건을 확인하세요.",
      "AI가 남은 졸업요건을 기준으로 추천합니다.",
    ],
    attachGuide:
      "성균관대학교 GLS → 학적/개인영역 → 졸업자가진단 → 졸업요건충족현황조회 → 영역별 학점취득/수강현황 + 이수구분별 학점취득/수강현황 부분이 모두 보이도록 스크린샷 → 붙여넣기, 혹은 저장 후 업로드",
    guidePdf: "/step2-guides/graduation-requirements-guide.pdf",
    examplePdf: "/step2-guides/graduation-requirements-example.pdf",
    guidePreview: { maxWidth: "640px", aspectRatio: "1700.79 / 1180.52" },
    examplePreview: { maxWidth: "520px", aspectRatio: "1137 / 609" },
  },
};

type ProfilesByKind = Partial<Record<AcademicDocumentKind, AcademicProfile>>;
type AcknowledgementsByKind = Partial<Record<AcademicDocumentKind, string[]>>;
type FileInputMethod = "picker" | "clipboard";
interface SelectedAcademicDocument {
  file: File;
  inputMethod: FileInputMethod;
}

type DocumentInfoPanelKind = "privacy" | "guide" | "example";

interface DocumentInfoPanelProps {
  id: string;
  title: string;
  summary: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  action?: ReactNode;
}

function DocumentInfoPanel({
  id,
  title,
  summary,
  isOpen,
  onToggle,
  children,
  action,
}: DocumentInfoPanelProps) {
  return (
    <section className={styles.documentInfoPanel}>
      <div
        className={styles.documentInfoHeader}
        data-has-action={Boolean(action)}
        data-open={isOpen}
      >
        <button
          aria-controls={id}
          aria-expanded={isOpen}
          className={styles.documentInfoToggle}
          type="button"
          onClick={onToggle}
        >
          <span>
            <strong>{title}</strong>
            {summary ? <small>{summary}</small> : null}
          </span>
        </button>
        {action ? <div className={styles.documentInfoAction}>{action}</div> : null}
        <button
          aria-controls={id}
          aria-expanded={isOpen}
          aria-label={`${title} ${isOpen ? "접기" : "펼치기"}`}
          className={styles.documentInfoExpandButton}
          type="button"
          onClick={onToggle}
        >
          <span aria-hidden="true" className={styles.documentInfoChevron}>
            {isOpen ? "−" : "+"}
          </span>
        </button>
      </div>
      {isOpen ? (
        <div className={styles.documentInfoContent} id={id}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function getDocumentPreviewStyle(preview: DocumentPreview): CSSProperties {
  return {
    "--document-preview-max-width": preview.maxWidth,
    "--document-preview-aspect-ratio": preview.aspectRatio,
  } as CSSProperties;
}

/**
 * Purely cosmetic stage labels shown while analyzeDocument()'s request sequence is in flight —
 * the server does not stream real progress, so this is a timed guess at what's likely happening,
 * not a measured percentage. Stops advancing at the last label rather than looping, so a slow
 * request never looks like it silently restarted.
 *
 * 수강/취득과목과 졸업요건충족현황은 실제 서버 처리 과정이 다르다(전자는 과목별 표 파싱 +
 * 누락 과목 재시도, 후자는 영역별 충족 판정 + 복합 학점 표기 보존) — 문서 종류에 맞는 문구를
 * 보여줘야 해서 kind별로 따로 둔다.
 */
const ANALYSIS_STAGES: Record<AcademicDocumentKind, readonly string[]> = {
  course_history: [
    "파일을 업로드하는 중…",
    "Document Parse로 문서 구조를 읽는 중…",
    "표와 글자를 줄 맞춰 정리하는 중…",
    "Solar가 과목·학점을 하나씩 짚어보는 중…",
    "헷갈리는 항목은 다시 확인하는 중…",
    "결과를 정리하는 중…",
  ],
  graduation_requirements: [
    "파일을 업로드하는 중…",
    "Document Parse로 문서 구조를 읽는 중…",
    "영역별 이수 현황을 줄 맞춰 정리하는 중…",
    "Solar가 충족·미충족 영역을 하나씩 짚어보는 중…",
    "복합 학점 표기는 원문 그대로 남겨두는 중…",
    "결과를 정리하는 중…",
  ],
};
const ANALYSIS_STAGE_INTERVAL_MS = 2400;

/**
 * Once the real stages above run out but the request still hasn't resolved (a long PDF, a busy
 * moment), looping back through ANALYSIS_STAGES would misleadingly imply it restarted — so this
 * separate, clearly-atmospheric pool takes over instead. Purely for company during the wait, not
 * a progress claim.
 */
const ANALYSIS_LONG_WAIT_FLAVORS: Record<AcademicDocumentKind, readonly string[]> = {
  course_history: [
    "생각보다 꼼꼼하게 보는 중이에요…",
    "글자 하나, 학점 하나까지 놓치지 않으려는 중…",
    "졸업까지 얼마나 남았는지도 같이 챙기는 중…",
    "거의 다 됐어요, 조금만 더 기다려 주세요…",
  ],
  graduation_requirements: [
    "생각보다 꼼꼼하게 보는 중이에요…",
    "영역별로 겹치는 학점은 없는지 다시 보는 중…",
    "졸업까지 얼마나 남았는지도 같이 챙기는 중…",
    "거의 다 됐어요, 조금만 더 기다려 주세요…",
  ],
};
const ANALYSIS_LONG_WAIT_INTERVAL_MS = 3000;
// The server has its own Upstage/Vercel limits, but an unbounded browser fetch leaves a student
// looking at an endless spinner when an upstream connection never settles. Keep this below the
// server's 300-second ceiling so the UI can always recover with a retry/manual-entry option.
const ANALYSIS_REQUEST_TIMEOUT_MS = 180_000;

async function postAcademicDocument(formData: FormData): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ANALYSIS_REQUEST_TIMEOUT_MS);
  try {
    return await fetch("/api/parse-academic-document", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "분석이 3분을 넘어 중단되었습니다. 잠시 후 다시 시도하거나 서류 없이 직접 입력해 주세요.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

interface Props {
  profileDetails?: AcademicProfile["profile"];
  /** When set by the wizard, locks the visible document kind and hides the kind tabs. */
  activeKind?: AcademicDocumentKind;
  onWorkingProfileChange?: (
    kind: AcademicDocumentKind,
    profile: AcademicProfile | undefined,
  ) => void;
  onConfirmedProfileChange?: (
    kind: AcademicDocumentKind,
    profile: AcademicProfile | undefined,
  ) => void;
  /** Lets the wizard gate the Next button until document analysis finishes. */
  onAnalysisStateChange?: (state: {
    isAnalyzing: boolean;
    hasAnalyzedDocument: boolean;
  }) => void;
  /** Shows the same Step-2 skip action near the document heading for a clearly optional flow. */
  onSkip?: () => void;
}

export function AcademicDocumentManager({
  profileDetails,
  activeKind,
  onWorkingProfileChange,
  onConfirmedProfileChange,
  onAnalysisStateChange,
  onSkip,
}: Props = {}) {
  const [internalKind, setInternalKind] = useState<AcademicDocumentKind>("course_history");
  // 문서 종류(kind)별로 따로 기억한다. 졸업요건 표는 한 화면에 모두 담기 어려워 여러 장의
  // 스크린샷을 순서대로 합쳐야 하므로, 선택 파일과 입력 경로도 배열로 보존한다.
  const [filesByKind, setFilesByKind] = useState<
    Partial<Record<AcademicDocumentKind, SelectedAcademicDocument[]>>
  >({});
  const [hasConsented, setHasConsented] = useState(false);
  const [openDocumentInfoPanel, setOpenDocumentInfoPanel] = useState<DocumentInfoPanelKind | null>(
    null,
  );
  const [profiles, setProfiles] = useState<ProfilesByKind>({});
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementsByKind>({});
  const [collapsedResults, setCollapsedResults] = useState<Partial<Record<AcademicDocumentKind, boolean>>>({});
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStageIndex, setAnalysisStageIndex] = useState(0);
  const [analysisFlavorIndex, setAnalysisFlavorIndex] = useState(-1);
  const [analysisFileIndex, setAnalysisFileIndex] = useState(0);
  const storedAcademicAnalysisRaw = useLocalStorageItem(ACADEMIC_ANALYSIS_STORAGE_KEY);
  const storedAcademicAnalysis = useMemo(
    () => readStoredAcademicAnalysis(storedAcademicAnalysisRaw),
    [storedAcademicAnalysisRaw],
  );
  const restoredStoredAnalysis = useRef(false);
  const [keepAnalysisInBrowser, setKeepAnalysisInBrowser] = useState(false);

  const kind = activeKind ?? internalKind;
  const kindControlled = activeKind !== undefined;
  const selectedFiles = filesByKind[kind] ?? [];
  const supportsMultipleFiles = kind === "graduation_requirements";
  const [previousActiveKind, setPreviousActiveKind] = useState(activeKind);
  if (previousActiveKind !== activeKind) {
    setPreviousActiveKind(activeKind);
    if (activeKind !== undefined) {
      setError("");
      setOpenDocumentInfoPanel(null);
    }
  }

  const profile = profiles[kind];
  const reviewChecklist = profile ? getReviewChecklist(profile) : [];
  const acknowledgedIds = acknowledgements[kind] ?? [];
  const detail = KIND_DETAILS[kind];
  const allDocumentReviews = (Object.keys(KIND_DETAILS) as AcademicDocumentKind[]).map(
    (documentKind) => ({
      kind: documentKind,
      items: profiles[documentKind] ? getReviewChecklist(profiles[documentKind]) : [],
    }),
  );
  const allDocumentReviewCount = allDocumentReviews.reduce(
    (count, document) => count + document.items.length,
    0,
  );
  const allDocumentPendingReviewCount = allDocumentReviews.reduce(
    (count, document) => {
      const checkedIds = acknowledgements[document.kind] ?? [];
      return count + document.items.filter(({ id }) => !checkedIds.includes(id)).length;
    },
    0,
  );

  useEffect(() => {
    if (!storedAcademicAnalysis || restoredStoredAnalysis.current) {
      return;
    }
    restoredStoredAnalysis.current = true;
    setProfiles(storedAcademicAnalysis.profiles);
    setAcknowledgements({});
    setCollapsedResults({});
    setKeepAnalysisInBrowser(true);
    for (const documentKind of Object.keys(storedAcademicAnalysis.profiles) as AcademicDocumentKind[]) {
      const restoredProfile = storedAcademicAnalysis.profiles[documentKind];
      if (!restoredProfile) {
        continue;
      }
      onWorkingProfileChange?.(documentKind, restoredProfile);
      onConfirmedProfileChange?.(
        documentKind,
        isAcademicProfileConfirmed(restoredProfile) ? restoredProfile : undefined,
      );
    }
  }, [onConfirmedProfileChange, onWorkingProfileChange, storedAcademicAnalysis]);

  useEffect(() => {
    if (!keepAnalysisInBrowser) {
      return;
    }
    writeStoredAcademicAnalysis(window.localStorage, profiles);
  }, [keepAnalysisInBrowser, profiles]);

  function changeKind(nextKind: AcademicDocumentKind): void {
    if (kindControlled) {
      return;
    }
    setInternalKind(nextKind);
    setError("");
    setOpenDocumentInfoPanel(null);
  }

  function toggleAnalysisStorage(shouldKeep: boolean): void {
    setKeepAnalysisInBrowser(shouldKeep);
    if (!shouldKeep) {
      window.localStorage.removeItem(ACADEMIC_ANALYSIS_STORAGE_KEY);
    }
  }

  function clearStoredAnalysis(): void {
    window.localStorage.removeItem(ACADEMIC_ANALYSIS_STORAGE_KEY);
    setKeepAnalysisInBrowser(false);
    setProfiles({});
    setAcknowledgements({});
    setCollapsedResults({});
    setError("");
    for (const documentKind of Object.keys(KIND_DETAILS) as AcademicDocumentKind[]) {
      onWorkingProfileChange?.(documentKind, undefined);
      onConfirmedProfileChange?.(documentKind, undefined);
    }
  }

  function toggleDocumentInfoPanel(nextPanel: DocumentInfoPanelKind): void {
    setOpenDocumentInfoPanel((currentPanel) =>
      currentPanel === nextPanel ? null : nextPanel,
    );
  }

  const selectFiles = useCallback((
    nextFiles: readonly File[],
    inputMethod: FileInputMethod = "picker",
  ): void => {
    setError("");
    if (nextFiles.length === 0) {
      return;
    }
    const validationError = nextFiles
      .map(validateAcademicDocumentFile)
      .find((message): message is string => message !== null);
    if (validationError) {
      setError(validationError);
      return;
    }
    setFilesByKind((current) => {
      const existingFiles = supportsMultipleFiles ? current[kind] ?? [] : [];
      const additions = nextFiles
        .filter((nextFile) => !existingFiles.some(({ file }) => isSameFile(file, nextFile)))
        .map((file) => ({ file, inputMethod }));
      return {
        ...current,
        [kind]: [...existingFiles, ...additions],
      };
    });
  }, [kind, supportsMultipleFiles]);

  function removeSelectedFile(index: number): void {
    setFilesByKind((current) => ({
      ...current,
      [kind]: (current[kind] ?? []).filter((_, currentIndex) => currentIndex !== index),
    }));
  }

  useEffect(() => {
    if (kind !== "graduation_requirements") {
      return;
    }
    function pasteClipboardImage(event: ClipboardEvent): void {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) {
        return;
      }
      const pastedImages = getClipboardImageFiles(event.clipboardData?.items);
      if (pastedImages.length === 0) {
        return;
      }
      event.preventDefault();
      selectFiles(pastedImages, "clipboard");
    }
    window.addEventListener("paste", pasteClipboardImage);
    return () => window.removeEventListener("paste", pasteClipboardImage);
  }, [kind, selectFiles]);

  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }
    const stages = ANALYSIS_STAGES[kind];
    const timer = window.setInterval(() => {
      setAnalysisStageIndex((current) => (current < stages.length - 1 ? current + 1 : current));
    }, ANALYSIS_STAGE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isAnalyzing, kind]);

  useEffect(() => {
    if (!isAnalyzing || analysisStageIndex < ANALYSIS_STAGES[kind].length - 1) {
      return;
    }
    const flavors = ANALYSIS_LONG_WAIT_FLAVORS[kind];
    const timer = window.setInterval(() => {
      setAnalysisFlavorIndex((current) => (current + 1) % flavors.length);
    }, ANALYSIS_LONG_WAIT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isAnalyzing, analysisStageIndex, kind]);

  useEffect(() => {
    onAnalysisStateChange?.({
      isAnalyzing,
      hasAnalyzedDocument: Object.keys(profiles).length > 0,
    });
  }, [isAnalyzing, onAnalysisStateChange, profiles]);

  async function analyzeDocument(): Promise<void> {
    if (selectedFiles.length === 0 || !hasConsented) {
      return;
    }
    setAnalysisStageIndex(0);
    setAnalysisFlavorIndex(-1);
    setAnalysisFileIndex(1);
    setIsAnalyzing(true);
    setError("");
    track("document_upload_start", { doc_type: kind });
    const startedAt = performance.now();
    let failureTracked = false;
    const trackFailure = (errorType: string): void => {
      failureTracked = true;
      track("document_parse_fail", {
        doc_type: kind,
        duration_ms: Math.round(performance.now() - startedAt),
        error_type: errorType,
      });
    };
    try {
      const parsedProfiles: AcademicProfile[] = [];
      for (const [index, { file }] of selectedFiles.entries()) {
        setAnalysisFileIndex(index + 1);
        const formData = new FormData();
        formData.set("kind", kind);
        formData.set("document", file);
        const response = await postAcademicDocument(formData);
        const payload: unknown = await response.json();
        if (!response.ok) {
          trackFailure(getAcademicDocumentApiErrorCode(payload));
          throw new Error(`${index + 1}번째 파일: ${getAcademicDocumentApiError(payload)}`);
        }
        const parsedProfile = parseAcademicProfileResponse(payload);
        if (!parsedProfile.sourceDocuments.some((document) => document.kind === kind)) {
          trackFailure("kind_mismatch");
          throw new Error(`${index + 1}번째 파일의 문서 종류가 다릅니다. 다시 확인해 주세요.`);
        }
        parsedProfiles.push(parsedProfile);
      }
      const nextProfile = kind === "graduation_requirements" && parsedProfiles.length > 1
        ? mergeGraduationRequirementProfiles(parsedProfiles)
        : parsedProfiles[0]!;
      setProfiles((current) => ({ ...current, [kind]: nextProfile }));
      onWorkingProfileChange?.(kind, nextProfile);
      onConfirmedProfileChange?.(kind, undefined);
      setAcknowledgements((current) => ({ ...current, [kind]: [] }));
      setCollapsedResults((current) => ({ ...current, [kind]: false }));
      // Keep the browser-memory-only selection after success, so "다시 분석하기" can rerun the
      // exact same file set without a re-upload. The API never persists originals.
      track("document_parse_success", {
        doc_type: kind,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (caughtError) {
      if (!failureTracked) {
        trackFailure("network_error");
      }
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "학사문서 분석을 완료하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsAnalyzing(false);
      setAnalysisFileIndex(0);
    }
  }

  // 문서를 분석하지 않고도 졸업요건을 직접 입력할 수 있게 하는 진입점 — analyzeDocument()가
  // 만드는 것과 똑같은 모양의 빈 초안을 만들어 준다. 이 초안이 일단 profiles[kind]에 들어가면,
  // 이후 흐름(요건 카드 추가/편집/확정, 확정된 값이 STEP5 AI 추천에 반영되는 것)은
  // AcademicRequirementEditor의 기존 "+ 요건 수동 추가" 버튼과 confirmProfile을 그대로
  // 탄다 — 문서에서 왔는지 직접 입력했는지 이후 코드는 구분하지 않는다. sourceDocuments에
  // id가 있어야 addRequirement()가 새 행을 만들 수 있어서(비어 있으면 조용히 무시됨) 빈
  // 배열이 아니라 draft 상태의 항목 하나를 반드시 넣는다. 업로드가 없으니 Upstage로 아무것도
  // 보내지 않고, 따라서 개인정보 수집 동의 체크와도 무관하다.
  function startManualEntry(): void {
    const manualProfile: AcademicProfile = {
      schemaVersion: "1.0",
      profile: { departmentCode: null, majorCodes: [], admissionYear: null, currentGrade: null, primaryCampus: null },
      sourceDocuments: [{ id: crypto.randomUUID(), kind, status: "draft" }],
      completedCourses: [],
      requirements: [],
      reviewIssues: [],
    };
    setError("");
    setProfiles((current) => ({ ...current, [kind]: manualProfile }));
    onWorkingProfileChange?.(kind, manualProfile);
    onConfirmedProfileChange?.(kind, undefined);
    setAcknowledgements((current) => ({ ...current, [kind]: [] }));
    setCollapsedResults((current) => ({ ...current, [kind]: false }));
  }

  function updateProfile(nextProfile: AcademicProfile): void {
    const draftProfile = markAcademicProfileDraft(nextProfile);
    setProfiles((current) => ({ ...current, [kind]: draftProfile }));
    onWorkingProfileChange?.(kind, draftProfile);
    onConfirmedProfileChange?.(kind, undefined);
    setAcknowledgements((current) => ({ ...current, [kind]: [] }));
    setError("");
  }

  function toggleAcknowledgement(id: string): void {
    setAcknowledgements((current) => {
      const currentIds = current[kind] ?? [];
      return {
        ...current,
        [kind]: currentIds.includes(id)
          ? currentIds.filter((currentId) => currentId !== id)
          : [...currentIds, id],
      };
    });
  }

  function toggleAllAcknowledgements(): void {
    const allReviewIds = reviewChecklist.map(({ id }) => id);
    setAcknowledgements((current) => ({
      ...current,
      [kind]: pendingReviewCount === 0 ? [] : allReviewIds,
    }));
  }

  function toggleAllDocumentAcknowledgements(): void {
    setAcknowledgements((current) => {
      const next = { ...current };
      for (const document of allDocumentReviews) {
        if (document.items.length > 0) {
          next[document.kind] = allDocumentPendingReviewCount === 0
            ? []
            : document.items.map(({ id }) => id);
        }
      }
      return next;
    });
  }

  function confirmProfile(): void {
    if (!profile) {
      return;
    }
    try {
      const confirmed = confirmAcademicProfile(
        profileDetails ? { ...profile, profile: profileDetails } : profile,
        new Set(acknowledgedIds),
      );
      setProfiles((current) => ({ ...current, [kind]: confirmed }));
      onWorkingProfileChange?.(kind, confirmed);
      onConfirmedProfileChange?.(kind, confirmed);
      setCollapsedResults((current) => ({ ...current, [kind]: true }));
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "확정 전 입력값을 확인해 주세요.");
    }
  }

  const isConfirmed = profile ? isAcademicProfileConfirmed(profile) : false;
  const pendingReviewCount = reviewChecklist.filter(
    ({ id }) => !acknowledgedIds.includes(id),
  ).length;
  const isResultCollapsed = collapsedResults[kind] ?? false;
  const resultSummary = profile
    ? kind === "graduation_requirements"
      ? `졸업요건 ${profile.requirements.length}개`
      : `기수강 과목 ${profile.completedCourses.length}개`
    : "";

  return (
    <section className={styles.panel} aria-labelledby="academic-document-heading">
      <div className={styles.intro}>
        <div className={styles.heading}>
          <h2 id="academic-document-heading">
            STEP 2 · 내 기록 적용하기
          </h2>
          {onSkip ? (
            <button className={styles.skipButton} type="button" onClick={onSkip}>
              Skip 하기
            </button>
          ) : null}
        </div>
        <p className={styles.upstageBadge}>with Upstage Document Parse + Solar</p>
      </div>

      <div className={styles.kindLead}>
        <h3>{detail.heading}</h3>
        <p>
          {detail.description.map((sentence) => (
            <span key={sentence}>{sentence}</span>
          ))}
        </p>
      </div>

      <div className={styles.browserStorageControl}>
        <label>
          <input
            checked={keepAnalysisInBrowser}
            type="checkbox"
            onChange={(event) => toggleAnalysisStorage(event.target.checked)}
          />
          <span>이 브라우저에 분석 결과 보관하기</span>
        </label>
        <p>원본 파일은 보관하지 않으며, 저장한 결과는 이 브라우저에서만 볼 수 있어요.</p>
        {keepAnalysisInBrowser ? (
          <button type="button" onClick={clearStoredAnalysis}>
            보관한 분석 결과 삭제
          </button>
        ) : null}
      </div>

      <DocumentInfoPanel
        id="academic-document-privacy-notice"
        isOpen={openDocumentInfoPanel === "privacy"}
        summary=""
        title="개인정보 수집 및 이용 동의"
        onToggle={() => toggleDocumentInfoPanel("privacy")}
        action={
          <label className={styles.privacyConsent}>
            <input
              checked={hasConsented}
              type="checkbox"
              onChange={(event) => setHasConsented(event.target.checked)}
            />
            <span>동의합니다.</span>
          </label>
        }
      >
        <div className={styles.privacyNotice}>
          <dl className={styles.privacyNoticeDetails}>
            <div>
              <dt>수집 및 이용 목적</dt>
              <dd>
                업로드한 학사문서를 분석해 이수/미이수 과목과 졸업요건을 확인하고, 이를 바탕으로
                시간표를 추천하기 위해 이용합니다.
              </dd>
            </div>
            <div>
              <dt>수집 항목</dt>
              <dd>
                업로드한 파일 원본(이름·학번·정확한 성적 등 개인정보가 포함될 수 있음)을 분석을
                위해 <strong>외부 API(Upstage)</strong>로 전송합니다. 분석이 끝나면 원본 파일과
                전체 분석 결과는 <strong>우리 서버에 저장하지 않으며</strong>, 이름·학번·정확한
                성적 같은 개인 식별 정보는 남기지 않고 과목명·학점·이수구분 등 구조화된 데이터만
                이 브라우저 화면에 남습니다.
              </dd>
            </div>
            <div>
              <dt>보유 및 이용 기간</dt>
              <dd>
                분석 결과는 서버에 저장되지 않으며, 기본적으로 새로고침하면 사라집니다. 사용자가
                &quot;이 브라우저에 분석 결과 보관하기&quot;를 선택한 경우에만 구조화된 결과를 이 기기에
                저장하고, 원본 파일은 저장하지 않습니다. 업로드한 파일이 외부 API(Upstage)에서
                처리되는 동안의 보관은 Upstage의 개인정보처리방침을 따릅니다.
              </dd>
            </div>
            <div>
              <dt>동의 거부 권리 및 불이익</dt>
              <dd>
                동의를 거부할 권리가 있습니다. 다만 동의하지 않으면 학사문서를 분석해 과목·졸업요건을
                자동으로 반영하는 이 기능은 이용할 수 없으며, 시간표 짜기 등 다른 기능은 계속
                이용하실 수 있습니다.
              </dd>
            </div>
          </dl>
        </div>
      </DocumentInfoPanel>

      {kindControlled ? null : (
        <div className={styles.kindTabs} role="tablist" aria-label="학사문서 종류">
          {(Object.keys(KIND_DETAILS) as AcademicDocumentKind[]).map((documentKind) => (
            <button
              aria-selected={kind === documentKind}
              className={kind === documentKind ? styles.activeTab : undefined}
              key={documentKind}
              role="tab"
              type="button"
              onClick={() => changeKind(documentKind)}
            >
              {KIND_DETAILS[documentKind].label}
              {profiles[documentKind] ? (
                <small>
                  {isAcademicProfileConfirmed(profiles[documentKind]!) ? "확정됨" : "초안"}
                </small>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {/* 위저드(kindControlled)에서는 한 번에 한 문서만 보여주므로, 여러 문서를 합친 "전체 동의"
          배너는 지금 화면과 무관한 다른 문서(예: 졸업요건 화면에 뜨는 수강/취득과목)의 검토까지
          끌어와 혼란을 준다. 각 문서 화면에는 편집기 안에 자기 문서용 "검토내용 전체 동의"가 이미
          있으므로, 위저드에서는 이 통합 배너를 감춘다. */}
      {!kindControlled && allDocumentReviewCount > 0 ? (
        <div className={styles.allReviewConsent}>
          <div>
            <strong>불러온 문서의 검토내용 전체 동의</strong>
            <span>
              전체 {allDocumentReviewCount}개 · 미동의 {allDocumentPendingReviewCount}개
            </span>
          </div>
          <button type="button" onClick={toggleAllDocumentAcknowledgements}>
            {allDocumentPendingReviewCount === 0 ? "전체 동의 해제" : "모든 검토내용 전체 동의"}
          </button>
        </div>
      ) : null}

      <div className={styles.documentInfoList}>
        <DocumentInfoPanel
          id={`academic-document-guide-${kind}`}
          isOpen={openDocumentInfoPanel === "guide"}
          summary="GLS 발급 경로와 안내 보기"
          title="어디서 받나요?"
          onToggle={() => toggleDocumentInfoPanel("guide")}
        >
          <p className={styles.attachGuide}>
            {detail.attachGuide}
            <br />
            성균관대학교 GLS 링크:{" "}
            <a
              href="https://kingoinfo.skku.edu/gaia/nxui/index.html"
              rel="noreferrer"
              target="_blank"
            >
              GLS 열기
            </a>
          </p>
          <div className={styles.pdfPreview} style={getDocumentPreviewStyle(detail.guidePreview)}>
            <iframe
              loading="lazy"
              src={`${detail.guidePdf}#page=1&view=Fit`}
              title={`${detail.label} 발급 안내 PDF 미리보기`}
            />
          </div>
          <a
            className={styles.pdfPreviewLink}
            href={detail.guidePdf}
            rel="noreferrer"
            target="_blank"
          >
            안내 PDF 크게 보기
          </a>
        </DocumentInfoPanel>

        <DocumentInfoPanel
          id={`academic-document-example-${kind}`}
          isOpen={openDocumentInfoPanel === "example"}
          summary="업로드할 파일 모양 미리 보기"
          title="예시 이미지 보기"
          onToggle={() => toggleDocumentInfoPanel("example")}
        >
          <p className={styles.exampleDescription}>
            아래처럼 필요한 표가 모두 보이는 PDF 또는 캡처 이미지를 첨부해 주세요.
          </p>
          <div className={styles.pdfPreview} style={getDocumentPreviewStyle(detail.examplePreview)}>
            <iframe
              loading="lazy"
              src={`${detail.examplePdf}#page=1&view=Fit`}
              title={`${detail.label} 예시 PDF 미리보기`}
            />
          </div>
          <a
            className={styles.pdfPreviewLink}
            href={detail.examplePdf}
            rel="noreferrer"
            target="_blank"
          >
            예시 PDF 크게 보기
          </a>
        </DocumentInfoPanel>
      </div>

      <div
        className={`${styles.uploadRow} ${
          kind === "graduation_requirements" ? styles.uploadRowWithPaste : ""
        }`}
      >
        <label className={styles.filePicker}>
          <span>
            {selectedFiles.length > 0
              ? `${selectedFiles.length}개 파일 첨부됨`
              : `${detail.label} 첨부하기`}
          </span>
          <input
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            multiple={supportsMultipleFiles}
            type="file"
            onChange={(event) => {
              selectFiles(Array.from(event.target.files ?? []), "picker");
              event.target.value = "";
            }}
          />
        </label>
        {kind === "graduation_requirements" ? (
          <button className={styles.pasteZone} type="button">
            <span>캡처 붙여넣기 <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
            <small>여러 장 첨부 가능</small>
          </button>
        ) : null}
        <button
          className={styles.analysisButton}
          disabled={selectedFiles.length === 0 || isAnalyzing || !hasConsented}
          type="button"
          onClick={() => void analyzeDocument()}
        >
          {isAnalyzing ? "Parse + Solar 분석 중…" : profile ? "다시 분석하기" : "문서 분석하기"}
        </button>
      </div>
      {selectedFiles.length > 0 ? (
        <ul className={styles.selectedFileList} aria-label="첨부한 파일">
          {selectedFiles.map(({ file, inputMethod }, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
              <span>
                {inputMethod === "clipboard" ? `붙여넣은 캡처 ${index + 1}` : file.name}
              </span>
              {profile && index === 0 ? (
                <div className={styles.documentStatusActions}>
                  <span className={isConfirmed ? styles.confirmedBadge : styles.draftBadge}>
                    {isConfirmed ? "확정된 데이터" : "확인 중인 초안"}
                  </span>
                  <button
                    className={styles.resultToggleButton}
                    type="button"
                    onClick={() =>
                      setCollapsedResults((current) => ({
                        ...current,
                        [kind]: !isResultCollapsed,
                      }))
                    }
                  >
                    {isResultCollapsed ? "내용 펼치기" : "내용 접기"}
                  </button>
                </div>
              ) : null}
              <button
                aria-label={`${inputMethod === "clipboard" ? `붙여넣은 캡처 ${index + 1}` : file.name} 삭제`}
                disabled={isAnalyzing}
                type="button"
                onClick={() => removeSelectedFile(index)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {isAnalyzing ? (
        <div className={styles.analysisProgress} role="status" aria-live="polite">
          <div className={styles.analysisProgressBar} />
          <span>
            {analysisFlavorIndex >= 0
              ? ANALYSIS_LONG_WAIT_FLAVORS[kind][analysisFlavorIndex]
              : ANALYSIS_STAGES[kind][analysisStageIndex]}
          </span>
          {selectedFiles.length > 1 ? (
            <small className={styles.analysisFileCounter}>
              {analysisFileIndex || 1} / {selectedFiles.length}번째 파일을 분석하고 있어요.
            </small>
          ) : null}
          {/* 복수전공처럼 과목이 많은 문서는 실제로 몇 분 걸릴 수 있다 — 진행 중인데 멈춘 것으로
              오해해 재시도/이탈하지 않도록 처음부터 넉넉한 기대치를 알려준다. */}
          <small className={styles.analysisWaitHint}>
            과목이 많거나 복수전공이면 최대 몇 분까지 걸릴 수 있어요. 창을 닫지 말고 기다려 주세요.
          </small>
        </div>
      ) : null}
      {selectedFiles.length > 0 && !hasConsented ? (
        <p className={styles.consentHint}>
          외부 전송 동의에 체크해야 분석을 시작할 수 있습니다.
        </p>
      ) : null}
      {kind === "graduation_requirements" && !profile ? (
        <button className={styles.manualEntryButton} type="button" onClick={startManualEntry}>
          서류 없이 직접 입력하기
        </button>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {profile && isResultCollapsed ? (
        <button
          className={styles.collapsedResult}
          type="button"
          onClick={() =>
            setCollapsedResults((current) => ({ ...current, [kind]: false }))
          }
        >
          <strong>{resultSummary}</strong>
          <span>{isConfirmed ? "확정 완료" : "확인 중인 초안"} · 눌러서 펼치기</span>
        </button>
      ) : null}

      {profile && !isResultCollapsed ? (
        <div className={styles.editor} aria-live="polite">
          {kind === "course_history" ? (
            <AcademicCourseEditor profile={profile} onChange={updateProfile} />
          ) : (
            <AcademicRequirementEditor
              key={profile.sourceDocuments[0]?.id}
              profile={profile}
              onChange={updateProfile}
            />
          )}

          {reviewChecklist.length > 0 ? (
          <div className={styles.reviewPanel}>
            <div className={styles.reviewHeading}>
              <div>
                <p>자동 추출 검토</p>
                <h3>{reviewChecklist.length}개 확인 필요</h3>
              </div>
              <div className={styles.reviewActions}>
                <span>미확인 {pendingReviewCount}개</span>
                <button type="button" onClick={toggleAllAcknowledgements}>
                  {pendingReviewCount === 0 ? "전체 동의 해제" : "검토내용 전체 동의"}
                </button>
              </div>
            </div>
            <ul className={styles.reviewList}>
              {reviewChecklist.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      checked={acknowledgedIds.includes(item.id)}
                      type="checkbox"
                      onChange={() => toggleAcknowledgement(item.id)}
                    />
                    <span>{item.message}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          ) : null}

          <div className={styles.confirmRow}>
            <p>
              {isConfirmed
                ? "이 문서의 데이터는 확정됐습니다. 수정하면 다시 초안으로 바뀌니다."
                : "확정한 데이터만 후속 추천 단계에서 사용합니다."}
            </p>
            <button disabled={isConfirmed} type="button" onClick={confirmProfile}>
              {isConfirmed ? "확정 완료" : "검토한 내용 확정하기"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null)
  );
}

function isSameFile(left: File, right: File): boolean {
  return left.name === right.name &&
    left.size === right.size &&
    left.lastModified === right.lastModified &&
    left.type === right.type;
}
