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
  { id: 2, title: "학사문서 읽기", short: "기수강·졸업요건" },
  { id: 3, title: "과목 담기", short: "유효 시간표 확인" },
  { id: 4, title: "AI 시간표 추천", short: "조건 맞춰 추천" },
  { id: 5, title: "강의계획서 확인", short: "평가 방식 확인" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export function PlanningWorkspace() {
  const [step, setStep] = useState<StepId>(1);
  const [studentProfile, setStudentProfile] = useState(INITIAL_STUDENT_PROFILE);
  const [appliedProfile, setAppliedProfile] = useState<StudentPlanningProfile | null>(null);
  const [workingProfiles, setWorkingProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [confirmedProfiles, setConfirmedProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [hasEnteredPlanner, setHasEnteredPlanner] = useState(false);

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

  function goNext(): void {
    if (step >= STEPS.length) {
      return;
    }
    setStep((current) => (current + 1) as StepId);
  }

  function goPrev(): void {
    if (step <= 1) {
      return;
    }
    setStep((current) => (current - 1) as StepId);
  }

  const current = STEPS[step - 1]!;
  const progressPercent = (step / STEPS.length) * 100;
  const nextBlocked = step === 1 && !appliedProfile;

  return (
    <div className={styles.workspace}>
      <div className={styles.progress} aria-label="진행 단계">
        <div className={styles.progressHeader}>
          <strong>
            {step}단계 · {current.title}
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
                onClick={() => {
                  if (item.id === 1 || appliedProfile || item.id <= step) {
                    setStep(item.id);
                  }
                }}
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
            onWorkingProfileChange={updateWorkingProfile}
            onConfirmedProfileChange={updateConfirmedProfile}
          />
        ) : null}

        {hasEnteredPlanner ? (
          <div className={step === 3 || step === 4 ? undefined : styles.hiddenStep}>
            <TimetablePlanner
              excludedCourseNumbers={excludedCourseNumbers}
              query={courseQuery}
              queryLabel={appliedProfile ? getCourseQueryLabel(appliedProfile) : ""}
              requirements={requirements}
              view={step === 4 ? "ai" : "plan"}
            />
          </div>
        ) : null}

        {step === 5 ? <SyllabusUploader /> : null}
      </div>

      <div className={styles.nav}>
        <button disabled={step === 1} type="button" onClick={goPrev}>
          이전
        </button>
        {step < STEPS.length ? (
          <button
            data-primary="true"
            disabled={nextBlocked}
            type="button"
            onClick={goNext}
          >
            다음
          </button>
        ) : (
          <span />
        )}
        {nextBlocked ? (
          <p className={styles.navHint}>기본정보를 적용해야 다음 단계로 갈 수 있습니다.</p>
        ) : null}
        {step === 2 ? (
          <p className={styles.navHint}>학사문서는 나중에 해도 됩니다. 건너뛰고 다음으로 가도 됩니다.</p>
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
