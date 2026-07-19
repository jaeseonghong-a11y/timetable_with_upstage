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
import { TimetablePlanner } from "./TimetablePlanner";
import styles from "./PlanningWorkspace.module.css";

const STEPS = [
  { id: 1, title: "기본 정보 입력", short: "기본 정보 입력" },
  { id: 2, title: "내 기록 적용하기", short: "내 기록 적용하기" },
  { id: 3, title: "과목 담기", short: "과목 담기" },
  { id: 4, title: "AI 시간표 추천", short: "AI 시간표 추천" },
] as const;

type StepId = (typeof STEPS)[number]["id"];
type DocSubstep = "course_history" | "graduation_requirements";
type PlanSubstep = "select" | "results";
type AiSubstep = "setup" | "results";

export function PlanningWorkspace() {
  const [step, setStep] = useState<StepId>(1);
  const [docSubstep, setDocSubstep] = useState<DocSubstep>("course_history");
  const [planSubstep, setPlanSubstep] = useState<PlanSubstep>("select");
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
    if (nextStep === 3) {
      setPlanSubstep("select");
    }
    if (nextStep === 4) {
      setAiSubstep("setup");
    }
  }

  function goToStep(nextStep: StepId): void {
    if (nextStep !== 1 && !appliedProfile && nextStep > 1) {
      return;
    }
    if (nextStep === 2) {
      setDocSubstep("course_history");
    }
    enterStep(nextStep);
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
    if (prevStep === 2) {
      setDocSubstep("graduation_requirements");
    }
    if (prevStep === 3) {
      setPlanSubstep("results");
    }
    if (prevStep === 4) {
      setAiSubstep("results");
    }
    setStep(prevStep);
  }

  const current = STEPS[step - 1]!;
  /** 0–100 along the connector between first and last step centers. */
  const connectorProgress =
    STEPS.length <= 1 ? 0 : ((step - 1) / (STEPS.length - 1)) * 100;
  const currentDocumentConfirmed = Boolean(confirmedProfiles[docSubstep]);
  const nextBlocked =
    (step === 1 && !appliedProfile) ||
    (step === 2 &&
      (documentAnalysisState.isAnalyzing || !currentDocumentConfirmed)) ||
    (step === 4 &&
      aiSubstep === "setup" &&
      (!aiRecommendAction.canRun || aiRecommendAction.isRunning));
  const stepTitle =
    step === 2
      ? docSubstep === "course_history"
        ? "내 기록 적용하기 · 수강/취득과목 (1/2)"
        : "내 기록 적용하기 · 졸업요건 충족현황 (2/2)"
      : step === 3
        ? planSubstep === "select"
          ? "과목 담기 (1/2)"
          : "과목 담기 (2/2)"
        : step === 4
          ? aiSubstep === "setup"
            ? "AI 시간표 추천 (1/2)"
            : "AI 시간표 추천 (2/2)"
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
    (step === 2 && docSubstep === "course_history") ||
    (step === 3 && planSubstep === "select") ||
    (step === 4 && aiSubstep === "setup");
  const nextLabel =
    step === 3 && planSubstep === "select"
      ? "유효 시간표 확인 (교양 추천 비포함)"
      : step === 4 && aiSubstep === "setup"
        ? aiRecommendAction.isRunning
          ? "추천 생성 중…"
          : "AI 추천 받기"
        : "다음";

  return (
    <div className={styles.workspace}>
      <div className={styles.progress} aria-label="진행 단계">
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
          {STEPS.map((item) => (
            <li key={item.id}>
              <button
                aria-current={item.id === step ? "step" : undefined}
                data-active={item.id === step}
                data-done={item.id < step}
                type="button"
                onClick={() => goToStep(item.id)}
              >
                <span className={styles.stepIndex} aria-hidden="true">
                  {item.id}
                </span>
                <span className={styles.stepLabel}>{item.short}</span>
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
              setRoadmapProgramCodes([
                profile.departmentCode,
                ...(profile.additionalDepartmentCodes ?? []),
              ]);
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
          <div className={step === 3 || step === 4 ? undefined : styles.hiddenStep}>
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
          disabled={step === 1 || (step === 4 && aiRecommendAction.isRunning)}
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
