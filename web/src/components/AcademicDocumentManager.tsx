"use client";

import { useCallback, useEffect, useState } from "react";

import type { AcademicDocumentKind, AcademicProfile } from "@/lib/academic-profile";
import {
  getClipboardImageFile,
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
import { track } from "@/lib/analytics";
import { MAX_DOCUMENT_SIZE_LABEL } from "@/lib/document-limits";

import { AcademicCourseEditor } from "./AcademicCourseEditor";
import { AcademicRequirementEditor } from "./AcademicRequirementEditor";
import styles from "./AcademicDocumentManager.module.css";

const KIND_DETAILS: Record<
  AcademicDocumentKind,
  { label: string; heading: string; description: string; attachGuide: string }
> = {
  course_history: {
    label: "수강/취득과목",
    heading: "수강/취득 과목 첨부하기",
    description:
      "이미 이수한 과목을 확인해 주세요. 확인된 과목은 이후 과목 후보에서 제외됩니다. 재수강이 필요하면 과목 검색 후 재수강을 체크해 주세요.\n해당 과목만 다시 후보에 포함됩니다.",
    attachGuide:
      "성균관대학교 GLS → 학적/개인영역 → 졸업자가진단 → 졸업요건충족현황조회 → 수강/취득 과목 출력 → PDF 저장 → 업로드",
  },
  graduation_requirements: {
    label: "졸업요건충족현황",
    heading: "졸업요건 충족현황 첨부하기",
    description:
      "문서 분석으로 남은 졸업요건을 확인하세요. 미충족 교양 요건은 교양 과목 추천에 반영됩니다.",
    attachGuide:
      "성균관대학교 GLS → 학적/개인영역 → 졸업자가진단 → 졸업요건충족현황조회 → 영역별 학점취득/수강현황 + 이수구분별 학점취득/수강현황 부분 스크린샷(복수전공이면 전공별 총학점 구분에 필요) → 붙여넣기, 혹은 저장 후 업로드",
  },
};

type ProfilesByKind = Partial<Record<AcademicDocumentKind, AcademicProfile>>;
type AcknowledgementsByKind = Partial<Record<AcademicDocumentKind, string[]>>;
type FileInputMethod = "picker" | "clipboard";

/**
 * Purely cosmetic stage labels shown while analyzeDocument()'s single fetch is in flight — the
 * server does not stream real progress, so this is a timed guess at what's likely happening, not
 * a measured percentage. Stops advancing at the last label rather than looping, so a slow request
 * never looks like it silently restarted.
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
}

export function AcademicDocumentManager({
  profileDetails,
  activeKind,
  onWorkingProfileChange,
  onConfirmedProfileChange,
  onAnalysisStateChange,
}: Props = {}) {
  const [internalKind, setInternalKind] = useState<AcademicDocumentKind>("course_history");
  // 문서 종류(kind)별로 따로 기억한다 — "다시 분석하기"가 재업로드 없이 그대로 재분석할 수
  // 있어야 하는데, 단일 file 상태였다면 2-1↔2-2를 오가며 kind가 바뀔 때마다 파일이 초기화돼
  // 이미 분석해 둔 문서로 돌아와도 다시 올려야 했다.
  const [filesByKind, setFilesByKind] = useState<Partial<Record<AcademicDocumentKind, File>>>({});
  const [fileInputMethodsByKind, setFileInputMethodsByKind] = useState<
    Partial<Record<AcademicDocumentKind, FileInputMethod>>
  >({});
  const [hasConsented, setHasConsented] = useState(false);
  const [profiles, setProfiles] = useState<ProfilesByKind>({});
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementsByKind>({});
  const [collapsedResults, setCollapsedResults] = useState<Partial<Record<AcademicDocumentKind, boolean>>>({});
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStageIndex, setAnalysisStageIndex] = useState(0);
  const [analysisFlavorIndex, setAnalysisFlavorIndex] = useState(-1);

  const kind = activeKind ?? internalKind;
  const kindControlled = activeKind !== undefined;
  const file = filesByKind[kind];
  const fileInputMethod = fileInputMethodsByKind[kind];
  const [previousActiveKind, setPreviousActiveKind] = useState(activeKind);
  if (previousActiveKind !== activeKind) {
    setPreviousActiveKind(activeKind);
    if (activeKind !== undefined) {
      setError("");
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

  function changeKind(nextKind: AcademicDocumentKind): void {
    if (kindControlled) {
      return;
    }
    setInternalKind(nextKind);
    setError("");
  }

  const selectFile = useCallback((
    nextFile: File | undefined,
    inputMethod: FileInputMethod = "picker",
  ): void => {
    setError("");
    if (!nextFile) {
      setFilesByKind((current) => ({ ...current, [kind]: undefined }));
      setFileInputMethodsByKind((current) => ({ ...current, [kind]: undefined }));
      return;
    }
    const validationError = validateAcademicDocumentFile(nextFile);
    if (validationError) {
      setFilesByKind((current) => ({ ...current, [kind]: undefined }));
      setFileInputMethodsByKind((current) => ({ ...current, [kind]: undefined }));
      setError(validationError);
      return;
    }
    setFilesByKind((current) => ({ ...current, [kind]: nextFile }));
    setFileInputMethodsByKind((current) => ({ ...current, [kind]: inputMethod }));
  }, [kind]);

  useEffect(() => {
    if (kind !== "graduation_requirements") {
      return;
    }
    function pasteClipboardImage(event: ClipboardEvent): void {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) {
        return;
      }
      const pastedImage = getClipboardImageFile(event.clipboardData?.items);
      if (!pastedImage) {
        return;
      }
      event.preventDefault();
      selectFile(pastedImage, "clipboard");
    }
    window.addEventListener("paste", pasteClipboardImage);
    return () => window.removeEventListener("paste", pasteClipboardImage);
  }, [kind, selectFile]);

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
    if (!file || !hasConsented) {
      return;
    }
    setAnalysisStageIndex(0);
    setAnalysisFlavorIndex(-1);
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
      const formData = new FormData();
      formData.set("kind", kind);
      formData.set("document", file);
      const response = await fetch("/api/parse-academic-document", {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        trackFailure(getAcademicDocumentApiErrorCode(payload));
        throw new Error(getAcademicDocumentApiError(payload));
      }
      const nextProfile = parseAcademicProfileResponse(payload);
      if (!nextProfile.sourceDocuments.some((document) => document.kind === kind)) {
        trackFailure("kind_mismatch");
        throw new Error("선택한 문서 종류와 분석 결과가 다릅니다. 다시 시도해 주세요.");
      }
      setProfiles((current) => ({ ...current, [kind]: nextProfile }));
      onWorkingProfileChange?.(kind, nextProfile);
      onConfirmedProfileChange?.(kind, undefined);
      setAcknowledgements((current) => ({ ...current, [kind]: [] }));
      setCollapsedResults((current) => ({ ...current, [kind]: false }));
      // Deliberately keep `file`/`fileInputMethod` set (not cleared) after a successful analysis:
      // this is what lets "다시 분석하기" re-run the exact same file without forcing a re-upload.
      // Picking a different file still works the same as always via the file input's own onChange.
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
    }
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
          <h2 id="academic-document-heading">STEP 2 · 내 기록 적용하기</h2>
        </div>
        <p className={styles.upstageBadge}>with Upstage Document Parse + Solar</p>
      </div>

      <div className={styles.kindLead}>
        <h3>{detail.heading}</h3>
        <p>{detail.description}</p>
      </div>

      <div className={styles.privacyNotice}>
        <p>
          업로드한 파일은 분석을 위해 <strong>외부 API(Upstage)</strong>로 전송됩니다.
          분석이 끝나면 원본 파일과 전체 분석 결과는 <strong>우리 서버에 저장하지
          않으며</strong>, 구조화된 데이터만 이 브라우저 화면에 남습니다(새로고침하면
          사라집니다).
        </p>
        <label>
          <input
            checked={hasConsented}
            type="checkbox"
            onChange={(event) => setHasConsented(event.target.checked)}
          />
          <span>위 내용을 확인했으며, 파일을 외부 API로 전송하는 데 동의합니다.</span>
        </label>
      </div>

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

      {profile ? (
        <div className={styles.documentIntro}>
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
        </div>
      ) : null}

      <p className={styles.attachGuide}>
        <strong>어디서 받나요?</strong> {detail.attachGuide}
      </p>

      <div className={styles.uploadRow}>
        <label className={styles.filePicker}>
          <span>
            {file
              ? fileInputMethod === "clipboard"
                ? "캡처 이미지 붙여넣음"
                : "파일 선택됨"
              : `${detail.label} PDF/이미지 선택`}
          </span>
          <input
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            type="file"
            onChange={(event) => {
              selectFile(event.target.files?.[0], "picker");
              event.target.value = "";
            }}
          />
        </label>
        <button
          disabled={!file || isAnalyzing || !hasConsented}
          type="button"
          onClick={() => void analyzeDocument()}
        >
          {isAnalyzing ? "Parse + Solar 분석 중…" : profile ? "다시 분석하기" : "문서 분석하기"}
        </button>
      </div>
      {isAnalyzing ? (
        <div className={styles.analysisProgress} role="status" aria-live="polite">
          <div className={styles.analysisProgressBar} />
          <span>
            {analysisFlavorIndex >= 0
              ? ANALYSIS_LONG_WAIT_FLAVORS[kind][analysisFlavorIndex]
              : ANALYSIS_STAGES[kind][analysisStageIndex]}
          </span>
        </div>
      ) : null}
      {file && !hasConsented ? (
        <p className={styles.consentHint}>
          외부 전송 동의에 체크해야 분석을 시작할 수 있습니다.
        </p>
      ) : null}
      {kind === "graduation_requirements" ? (
        <button className={styles.pasteZone} type="button">
          <span>캡처를 복사한 뒤 여기에서 <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
          <small>졸업요건 캡처는 파일로 저장하지 않고 바로 붙여넣을 수 있습니다.</small>
        </button>
      ) : null}
      <p className={styles.limit}>
        PDF/PNG/JPG 1개 · 최대 {MAX_DOCUMENT_SIZE_LABEL} · 성공 후 원본 파일 상태 해제
      </p>

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
