"use client";

import { useEffect, useMemo, useState } from "react";

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
import { SyllabusUploader } from "./SyllabusUploader";
import { TimetablePlanner } from "./TimetablePlanner";
import styles from "./PlanningWorkspace.module.css";

const STEPS = [
  { id: 1, title: "기본 정보 입력", short: "소속·학기 설정" },
  { id: 2, title: "학사문서 읽기 (skip 가능)", short: "skip 가능" },
  { id: 3, title: "과목 담기", short: "담기 → 유효 시간표" },
  { id: 4, title: "AI 시간표 추천", short: "조건 → 결과" },
  { id: 5, title: "강의계획서 확인", short: "평가 방식 확인" },
] as const;

type StepId = (typeof STEPS)[number]["id"];
type PlanSubstep = "select" | "results";
type AiSubstep = "setup" | "results";

export function PlanningWorkspace() {
  const [step, setStep] = useState<StepId>(1);
  const [planSubstep, setPlanSubstep] = useState<PlanSubstep>("select");
  const [aiSubstep, setAiSubstep] = useState<AiSubstep>("setup");
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

  useEffect(() => {
    if (step >= 3) {
      setHasEnteredPlanner(true);
    }
  }, [step]);

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

  function goToStep(nextStep: StepId): void {
    if (nextStep !== 1 && !appliedProfile && nextStep > 1) {
      return;
    }
    setStep(nextStep);
    if (nextStep === 3) {
      setPlanSubstep("select");
    }
    if (nextStep === 4) {
      setAiSubstep("setup");
    }
  }

  function goNext(): void {
    if (step === 3 && planSubstep === "select") {
      setPlanSubstep("results");
      return;
    }
    if (step === 4 && aiSubstep === "setup") {
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
    const nextStep = (step + 1) as StepId;
    setStep(nextStep);
    if (nextStep === 3) {
      setPlanSubstep("select");
    }
    if (nextStep === 4) {
      setAiSubstep("setup");
    }
  }

  function goPrev(): void {
    if (step === 3 && planSubstep === "results") {
      setPlanSubstep("select");
      return;
    }
    if (step === 4 && aiSubstep === "results") {
      setAiSubstep("setup");
      return;
    }
    if (step <= 1) {
      return;
    }
    const prevStep = (step - 1) as StepId;
    setStep(prevStep);
    if (prevStep === 3) {
      setPlanSubstep("results");
    }
    if (prevStep === 4) {
      setAiSubstep("results");
    }
  }

  const current = STEPS[step - 1]!;
  const progressPercent = (step / STEPS.length) * 100;
  const hasDocumentAnalysis =
    documentAnalysisState.hasAnalyzedDocument ||
    Object.keys(workingProfiles).length > 0 ||
    Object.keys(confirmedProfiles).length > 0;
  const nextBlocked =
    (step === 1 && !appliedProfile) ||
    (step === 2 && (documentAnalysisState.isAnalyzing || !hasDocumentAnalysis)) ||
    (step === 4 &&
      aiSubstep === "setup" &&
      (!aiRecommendAction.canRun || aiRecommendAction.isRunning));
  const stepTitle =
    step === 3
      ? planSubstep === "select"
        ? "과목 담기 (1/2)"
        : "유효 시간표 확인 (2/2)"
      : step === 4
        ? aiSubstep === "setup"
          ? "AI 추천 조건 (1/2)"
          : "AI 추천 결과 (2/2)"
        : current.title;
  const plannerView =
    step === 4
      ? aiSubstep === "results"
        ? "ai-results"
        : "ai-setup"
      : planSubstep === "results"
        ? "results"
        : "select";
  const showNextButton =
    step < STEPS.length ||
    (step === 3 && planSubstep === "select") ||
    (step === 4 && aiSubstep === "setup");
  const nextLabel =
    step === 3 && planSubstep === "select"
      ? "유효 시간표 보기"
      : step === 4 && aiSubstep === "setup"
        ? aiRecommendAction.isRunning
          ? "추천 생성 중…"
          : "AI 추천 받기"
        : "다음";

  return (
    <div className={styles.workspace}>
      <div className={styles.progress} aria-label="진행 단계">
        <div className={styles.progressHeader}>
          <strong>
            {step}단계 · {stepTitle}
          </strong>
          <span>
            {step}/{STEPS.length}
          </span>
        </div>
        <div
          aria-valuemax={STEPS.length}
          aria-valuemin={1}
          aria-valuenow={step}
          className={styles.progressTrack}
          role="progressbar"
        >
          <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
        </div>
        <ol className={styles.stepList}>
          {STEPS.map((item) => (
            <li key={item.id}>
              <button
                data-active={item.id === step}
                data-done={item.id < step}
                type="button"
                onClick={() => goToStep(item.id)}
              >
                <strong>{item.id}단계</strong>
                <span>{item.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.stepPanel}>
        {step === 1 ? (
          <StudentProfileForm
            appliedProfile={appliedProfile}
            profile={studentProfile}
            onApply={(profile) => {
              setAppliedProfile({ ...profile });
              track("profile_applied");
            }}
            onChange={setStudentProfile}
          />
        ) : null}

        {step === 2 ? (
          <AcademicDocumentManager
            profileDetails={toAcademicProfileDetails(studentProfile)}
            onAnalysisStateChange={setDocumentAnalysisState}
            onWorkingProfileChange={updateWorkingProfile}
            onConfirmedProfileChange={updateConfirmedProfile}
          />
        ) : null}

        {hasEnteredPlanner ? (
          <div className={step === 3 || step === 4 ? undefined : styles.hiddenStep}>
            <TimetablePlanner
              aiRecommendRequestId={aiRecommendRequestId}
              excludedCourseNumbers={excludedCourseNumbers}
              query={courseQuery}
              queryLabel={appliedProfile ? getCourseQueryLabel(appliedProfile) : ""}
              requirements={requirements}
              view={plannerView}
              onAiRecommendActionStateChange={setAiRecommendAction}
              onRecommendationsReady={() => setAiSubstep("results")}
            />
          </div>
        ) : null}

        {step === 5 ? <SyllabusUploader /> : null}
      </div>

      <div className={styles.nav}>
        <button
          disabled={step === 1 || (step === 4 && aiRecommendAction.isRunning)}
          type="button"
          onClick={goPrev}
        >
          이전
        </button>
        <div className={styles.navActions}>
          {step === 2 ? (
            <button type="button" onClick={goNext}>
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
              ? "문서 분석이 끝나면 다음으로 갈 수 있습니다. 지금은 건너뛰기도 가능합니다."
              : hasDocumentAnalysis
                ? "문서 분석이 완료되었습니다. 다음으로 가거나, 원하면 다른 문서도 이어서 분석할 수 있습니다."
                : "문서 분석이 끝나야 다음으로 갈 수 있습니다. 원하지 않으면 지금 건너뛰어도 됩니다."}
          </p>
        ) : null}
        {step === 3 && planSubstep === "select" ? (
          <p className={styles.navHint}>과목을 담은 뒤 다음에서 유효 시간표를 확인합니다.</p>
        ) : null}
        {step === 4 && aiSubstep === "setup" ? (
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
