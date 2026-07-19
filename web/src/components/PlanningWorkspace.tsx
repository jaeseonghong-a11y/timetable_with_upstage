"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AcademicDocumentKind, AcademicProfile, Requirement } from "@/lib/academic-profile";
import { initAbandonTracking, track } from "@/lib/analytics";
import {
  getExcludedCourseNumbers,
  getCourseQueryLabel,
  INITIAL_STUDENT_PROFILE,
  toAcademicProfileDetails,
  toSkkuCourseQuery,
  type StudentPlanningProfile,
} from "@/lib/planning-profile";

import { AcademicDocumentManager } from "./AcademicDocumentManager";
import { StudentProfileForm } from "./StudentProfileForm";
import { TimetablePlanner } from "./TimetablePlanner";
import styles from "./PlanningWorkspace.module.css";

const STEPS = [
  { id: 1, title: "기본 정보 입력" },
  { id: 2, title: "내 기록 적용하기" },
  { id: 3, title: "과목 담기" },
  { id: 4, title: "유효 시간표 확인" },
  { id: 5, title: "AI 시간표 추천" },
] as const;

type StepId = (typeof STEPS)[number]["id"];
type DocSubstep = "course_history" | "graduation_requirements";
type AiSubstep = "setup" | "results";

export function PlanningWorkspace() {
  const [step, setStep] = useState<StepId>(1);
  const [docSubstep, setDocSubstep] = useState<DocSubstep>("course_history");
  const [aiSubstep, setAiSubstep] = useState<AiSubstep>("setup");
  const [hasEnteredDocuments, setHasEnteredDocuments] = useState(false);
  const [aiRecommendRequestId, setAiRecommendRequestId] = useState(0);
  const [aiRecommendAction, setAiRecommendAction] = useState({
    canRun: false,
    isRunning: false,
  });
  const [studentProfile, setStudentProfile] = useState(INITIAL_STUDENT_PROFILE);
  const [appliedProfile, setAppliedProfile] = useState<StudentPlanningProfile | null>(null);
  const [workingProfiles, setWorkingProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [confirmedProfiles, setConfirmedProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [roadmapProgramCodes, setRoadmapProgramCodes] = useState<string[]>([]);
  const [hasEnteredPlanner, setHasEnteredPlanner] = useState(false);
  const [documentAnalysisState, setDocumentAnalysisState] = useState({
    isAnalyzing: false,
    hasAnalyzedDocument: false,
  });

  const courseQuery = useMemo(
    () => (appliedProfile ? toSkkuCourseQuery(appliedProfile) : null),
    [appliedProfile],
  );
  const excludedCourseNumbers = useMemo(
    () =>
      getExcludedCourseNumbers(
        workingProfiles.course_history ?? confirmedProfiles.course_history,
      ),
    [confirmedProfiles.course_history, workingProfiles.course_history],
  );
  const requirements = useMemo<readonly Requirement[]>(
    () =>
      (workingProfiles.graduation_requirements ?? confirmedProfiles.graduation_requirements)
        ?.requirements ?? [],
    [confirmedProfiles.graduation_requirements, workingProfiles.graduation_requirements],
  );

  useEffect(() => initAbandonTracking(), []);

  const progressRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip on mount: the very first screen should still show the hero title above the progress
    // header, not jump straight past it. Only step/substep changes from here on scroll up.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step, docSubstep, aiSubstep]);

  function updateWorkingProfile(
    kind: AcademicDocumentKind,
    profile: AcademicProfile | undefined,
  ): void {
    setWorkingProfiles((current) => updateProfileMap(current, kind, profile));
  }

  function updateConfirmedProfile(
    kind: AcademicDocumentKind,
    profile: AcademicProfile | undefined,
  ): void {
    setConfirmedProfiles((current) => updateProfileMap(current, kind, profile));
  }

  function enterStep(nextStep: StepId): void {
    setStep(nextStep);
    if (nextStep === 2) {
      setHasEnteredDocuments(true);
    }
    if (nextStep >= 3) {
      setHasEnteredPlanner(true);
    }
    if (nextStep === 5) {
      setAiSubstep("setup");
    }
  }

  function goToStep(nextStep: StepId): void {
    if (nextStep !== 1 && !appliedProfile) {
      return;
    }
    enterStep(nextStep);
  }

  function goToDocSubstep(target: DocSubstep): void {
    if (!appliedProfile) {
      return;
    }
    setDocSubstep(target);
    enterStep(2);
  }

  function skipCurrentDocument(): void {
    if (docSubstep === "course_history") {
      setDocSubstep("graduation_requirements");
      return;
    }
    enterStep(3);
  }

  function goNext(): void {
    if (step === 2 && docSubstep === "course_history") {
      setDocSubstep("graduation_requirements");
      return;
    }
    if (step === 5 && aiSubstep === "setup") {
      if (!aiRecommendAction.canRun || aiRecommendAction.isRunning) {
        return;
      }
      // Show loading immediately; TimetablePlanner will keep/clear this via callbacks.
      setAiRecommendAction((current) => ({ ...current, isRunning: true }));
      setAiRecommendRequestId((current) => current + 1);
      return;
    }
    if (step >= STEPS.length) {
      return;
    }
    if (step === 1) {
      setDocSubstep("course_history");
    }
    enterStep((step + 1) as StepId);
  }

  function goPrev(): void {
    if (step === 2 && docSubstep === "graduation_requirements") {
      setDocSubstep("course_history");
      return;
    }
    if (step === 5 && aiSubstep === "results") {
      setAiSubstep("setup");
      return;
    }
    if (step <= 1) {
      return;
    }
    const prevStep = (step - 1) as StepId;
    if (prevStep === 2) {
      setDocSubstep("graduation_requirements");
    }
    if (prevStep === 5) {
      setAiSubstep("results");
    }
    setStep(prevStep);
  }

  const current = STEPS[step - 1]!;
  /** 0–100 along the connector between first and last step centers — tracks the 5 real steps;
   * 2-1/2-2 render as one grouped slot (see stepListSlots) so they don't need their own. */
  const connectorProgress =
    STEPS.length <= 1 ? 0 : ((step - 1) / (STEPS.length - 1)) * 100;
  const currentDocumentConfirmed = Boolean(confirmedProfiles[docSubstep]);
  const nextBlocked =
    (step === 1 && !appliedProfile) ||
    (step === 2 &&
      (documentAnalysisState.isAnalyzing || !currentDocumentConfirmed)) ||
    (step === 5 &&
      aiSubstep === "setup" &&
      (!aiRecommendAction.canRun || aiRecommendAction.isRunning));
  const stepTitle =
    step === 2
      ? docSubstep === "course_history"
        ? "내 기록 적용하기 · 수강/취득과목 (1/2)"
        : "내 기록 적용하기 · 졸업요건 충족현황 (2/2)"
      : step === 5
        ? aiSubstep === "setup"
          ? "AI 시간표 추천 (1/2)"
          : "AI 시간표 추천 (2/2)"
        : current.title;
  const plannerView =
    step === 5
      ? aiSubstep === "results"
        ? "ai-results"
        : "ai-setup"
      : step === 4
        ? "results"
        : "select";
  const showNextButton = step < STEPS.length || (step === 5 && aiSubstep === "setup");
  const nextLabel =
    step === 5 && aiSubstep === "setup"
      ? aiRecommendAction.isRunning
        ? "추천 생성 중…"
        : "AI 추천 받기"
      : step === 3
        ? "유효 시간표 확인"
        : "다음";

  interface StepListButton {
    key: string;
    indexLabel: string;
    label: string;
    subLabel?: string;
    isActive: boolean;
    isDone: boolean;
    onClick: () => void;
  }

  // 2-1/2-2 render as one grouped slot (tight internal spacing, shared pill background) rather
  // than their own equal-width columns, so they read as two halves of step 2 instead of
  // standalone steps on par with 1/3/4/5 — narrower gap + shared container is the standard way
  // stepper UIs signal "these belong together" without a dedicated nested-stepper component.
  const stepListSlots: Array<StepListButton | { key: string; group: StepListButton[] }> = [
    {
      key: "1",
      indexLabel: "1",
      label: "기본 정보 입력",
      isActive: step === 1,
      isDone: step > 1,
      onClick: () => goToStep(1),
    },
    {
      key: "2-group",
      group: [
        {
          key: "2-1",
          indexLabel: "2-1",
          label: "내 기록 적용하기",
          subLabel: "수강/취득 과목",
          isActive: step === 2 && docSubstep === "course_history",
          isDone: step > 2 || (step === 2 && docSubstep === "graduation_requirements"),
          onClick: () => goToDocSubstep("course_history"),
        },
        {
          key: "2-2",
          indexLabel: "2-2",
          label: "내 기록 적용하기",
          subLabel: "졸업요건충족현황",
          isActive: step === 2 && docSubstep === "graduation_requirements",
          isDone: step > 2,
          onClick: () => goToDocSubstep("graduation_requirements"),
        },
      ],
    },
    {
      key: "3",
      indexLabel: "3",
      label: "과목 담기",
      isActive: step === 3,
      isDone: step > 3,
      onClick: () => goToStep(3),
    },
    {
      key: "4",
      indexLabel: "4",
      label: "유효 시간표 확인",
      isActive: step === 4,
      isDone: step > 4,
      onClick: () => goToStep(4),
    },
    {
      key: "5",
      indexLabel: "5",
      label: "AI 시간표 추천",
      isActive: step === 5,
      isDone: false,
      onClick: () => goToStep(5),
    },
  ];

  return (
    <div className={styles.workspace}>
      <div ref={progressRef} className={styles.progress} aria-label="진행 단계">
        <div className={styles.progressHeader}>
          <div>
            <p className={styles.progressEyebrow}>진행 단계</p>
            <strong>
              {step}단계 · {stepTitle}
            </strong>
          </div>
          <span className={styles.progressCount}>
            {step} / {STEPS.length}
          </span>
        </div>
        <ol
          className={styles.stepList}
          style={{ ["--connector-progress" as string]: String(connectorProgress) }}
        >
          {stepListSlots.map((slot) =>
            "group" in slot ? (
              <li key={slot.key}>
                <div
                  className={styles.subStepGroup}
                  data-active={slot.group.some((entry) => entry.isActive)}
                >
                  {slot.group.map((entry) => (
                    <button
                      aria-current={entry.isActive ? "step" : undefined}
                      data-active={entry.isActive}
                      data-done={entry.isDone}
                      key={entry.key}
                      type="button"
                      onClick={entry.onClick}
                    >
                      <span className={styles.stepIndex} aria-hidden="true">
                        {entry.indexLabel}
                      </span>
                      <span className={styles.stepSubLabel}>{entry.subLabel}</span>
                    </button>
                  ))}
                </div>
              </li>
            ) : (
              <li key={slot.key}>
                <button
                  aria-current={slot.isActive ? "step" : undefined}
                  data-active={slot.isActive}
                  data-done={slot.isDone}
                  type="button"
                  onClick={slot.onClick}
                >
                  <span className={styles.stepIndex} aria-hidden="true">
                    {slot.indexLabel}
                  </span>
                  <span className={styles.stepLabel}>{slot.label}</span>
                </button>
              </li>
            ),
          )}
        </ol>
      </div>

      <div className={styles.stepPanel}>
        {step === 1 ? (
          <StudentProfileForm
            appliedProfile={appliedProfile}
            profile={studentProfile}
            onApply={(profile) => {
              setAppliedProfile({ ...profile });
              setRoadmapProgramCodes([
                profile.departmentCode,
                ...(profile.additionalDepartmentCodes ?? []),
              ]);
              // Mount TimetablePlanner (hidden) right away so its major-course fetch starts in
              // the background while the student is still on step 2, instead of only starting
              // once they open step 3 — the two-campus fetch takes long enough that waiting for
              // step 3 to even begin loading made 과목 담기 feel stuck on open.
              setHasEnteredPlanner(true);
              track("profile_applied");
            }}
            onChange={setStudentProfile}
          />
        ) : null}

        {hasEnteredDocuments ? (
          <div className={step === 2 ? undefined : styles.hiddenStep}>
            <AcademicDocumentManager
              activeKind={docSubstep}
              profileDetails={toAcademicProfileDetails(studentProfile)}
              onAnalysisStateChange={setDocumentAnalysisState}
              onWorkingProfileChange={updateWorkingProfile}
              onConfirmedProfileChange={updateConfirmedProfile}
            />
          </div>
        ) : null}

        {hasEnteredPlanner ? (
          <div className={step === 3 || step === 4 || step === 5 ? undefined : styles.hiddenStep}>
            <TimetablePlanner
              aiRecommendRequestId={aiRecommendRequestId}
              excludedCourseNumbers={excludedCourseNumbers}
              query={courseQuery}
              queryLabel={appliedProfile ? getCourseQueryLabel(appliedProfile) : ""}
              requirements={requirements}
              roadmapProgramCodes={roadmapProgramCodes}
              view={plannerView}
              onAiRecommendActionStateChange={setAiRecommendAction}
              onRecommendationsReady={() => setAiSubstep("results")}
            />
          </div>
        ) : null}
      </div>

      <div className={styles.nav}>
        <button
          disabled={step === 1 || (step === 5 && aiRecommendAction.isRunning)}
          type="button"
          onClick={goPrev}
        >
          이전
        </button>
        <div className={styles.navActions}>
          {step === 2 ? (
            <button type="button" onClick={skipCurrentDocument}>
              건너뛰기
            </button>
          ) : null}
          {showNextButton ? (
            <button data-primary="true" disabled={nextBlocked} type="button" onClick={goNext}>
              {nextLabel}
            </button>
          ) : null}
        </div>
        {step === 1 && !appliedProfile ? (
          <p className={styles.navHint}>기본정보를 적용해야 다음 단계로 갈 수 있습니다.</p>
        ) : null}
        {step === 2 ? (
          <p className={styles.navHint}>
            {documentAnalysisState.isAnalyzing
              ? "문서 분석 중에는 잠시만 기다려 주세요. 원하지 않으면 건너뛸 수 있습니다."
              : currentDocumentConfirmed
                ? "검토 내용을 확정했습니다. 다음으로 갈 수 있습니다."
                : "문서를 분석하고 검토한 뒤 확정해야 다음으로 갈 수 있습니다. 원하지 않으면 건너뛰세요."}
          </p>
        ) : null}
        {step === 3 ? (
          <p className={styles.navHint}>과목을 담은 뒤 다음에서 유효 시간표를 확인합니다.</p>
        ) : null}
        {step === 4 ? (
          <p className={styles.navHint}>
            요일·시작 시간이나 학점 범위를 조정하며 시간표를 확인하세요. 마음에 들면 다음에서
            AI 추천을 받아보세요.
          </p>
        ) : null}
        {step === 5 && aiSubstep === "setup" ? (
          <p className={styles.navHint}>
            {aiRecommendAction.isRunning
              ? "AI가 분석 중입니다... 완료되면 결과 화면으로 이동합니다."
              : "조건을 고른 뒤 AI 추천 받기를 누르면 결과 화면으로 바로 이동합니다."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function updateProfileMap(
  profiles: Partial<Record<AcademicDocumentKind, AcademicProfile>>,
  kind: AcademicDocumentKind,
  profile: AcademicProfile | undefined,
): Partial<Record<AcademicDocumentKind, AcademicProfile>> {
  const next = { ...profiles };
  if (profile) {
    next[kind] = profile;
  } else {
    delete next[kind];
  }
  return next;
}
