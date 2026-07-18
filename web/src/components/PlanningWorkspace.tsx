"use client";

import { useEffect, useMemo, useState } from "react";

import type { AcademicDocumentKind, AcademicProfile, Requirement } from "@/lib/academic-profile";
import { initAbandonTracking, track } from "@/lib/analytics";
import type { CurriculumRoadmap } from "@/lib/curriculum-roadmap";
import {
  getExcludedCourseNumbers,
  getCourseQueryLabel,
  INITIAL_STUDENT_PROFILE,
  toAcademicProfileDetails,
  toSkkuCourseQuery,
  type StudentPlanningProfile,
} from "@/lib/planning-profile";

import { AcademicDocumentManager } from "./AcademicDocumentManager";
import { CurriculumRoadmapCollection } from "./CurriculumRoadmapCollection";
import { StudentProfileForm } from "./StudentProfileForm";
import { TimetablePlanner } from "./TimetablePlanner";

export function PlanningWorkspace() {
  const [studentProfile, setStudentProfile] = useState(INITIAL_STUDENT_PROFILE);
  const [appliedProfile, setAppliedProfile] = useState<StudentPlanningProfile | null>(null);
  const [workingProfiles, setWorkingProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [confirmedProfiles, setConfirmedProfiles] = useState<
    Partial<Record<AcademicDocumentKind, AcademicProfile>>
  >({});
  const [curriculumRoadmaps, setCurriculumRoadmaps] = useState<CurriculumRoadmap[]>([]);
  const [roadmapProgramCodes, setRoadmapProgramCodes] = useState<string[]>([]);

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

  return (
    <>
      <StudentProfileForm
        appliedProfile={appliedProfile}
        profile={studentProfile}
        onApply={(profile) => {
          setAppliedProfile({ ...profile });
          setCurriculumRoadmaps([]);
          setRoadmapProgramCodes([profile.departmentCode, ...(profile.additionalDepartmentCodes ?? [])]);
          track("profile_applied");
        }}
        onChange={setStudentProfile}
      />
      <AcademicDocumentManager
        profileDetails={toAcademicProfileDetails(studentProfile)}
        onWorkingProfileChange={updateWorkingProfile}
        onConfirmedProfileChange={updateConfirmedProfile}
      />
      {appliedProfile ? (
        <CurriculumRoadmapCollection
          key={`${roadmapProgramCodes.join(",")}-${appliedProfile.admissionYear}-${appliedProfile.currentGrade}-${appliedProfile.courseTerm}`}
          academicYear={appliedProfile.admissionYear}
          programCodes={roadmapProgramCodes}
          currentGrade={appliedProfile.currentGrade}
          semester={appliedProfile.courseTerm === 10 ? 1 : appliedProfile.courseTerm === 20 ? 2 : null}
          onChange={setCurriculumRoadmaps}
        />
      ) : null}
      <TimetablePlanner
        excludedCourseNumbers={excludedCourseNumbers}
        query={courseQuery}
        queryLabel={appliedProfile ? getCourseQueryLabel(appliedProfile) : ""}
        curriculumRoadmaps={curriculumRoadmaps}
        roadmapProgramCodes={roadmapProgramCodes}
        roadmapContext={
          appliedProfile &&
          appliedProfile.admissionYear !== null &&
          appliedProfile.currentGrade !== null &&
          (appliedProfile.courseTerm === 10 || appliedProfile.courseTerm === 20)
            ? {
                programCode: appliedProfile.departmentCode,
                admissionYear: appliedProfile.admissionYear,
                currentGrade: appliedProfile.currentGrade,
                semester: appliedProfile.courseTerm === 10 ? 1 : 2,
              }
            : null
        }
        requirements={requirements}
      />
    </>
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
