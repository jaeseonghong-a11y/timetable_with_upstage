import type { AcademicDocumentKind, AcademicProfile } from "./academic-profile";
import type { CourseCandidateGroup } from "./course-candidates";
import type { StudentPlanningProfile } from "./planning-profile";
import type { SkkuElectiveCampus } from "./skku-course-api";
import {
  parseCourseCandidate,
  type FixedEvent,
  type Weekday,
} from "./timetable";

/** No-login convenience storage. Nothing here is sent to our server. */
export const STUDENT_PROFILE_STORAGE_KEY = "skku-timetable:student-profile:v1";
export const COURSE_PLAN_STORAGE_KEY = "skku-timetable:course-plan:v1";
export const ACADEMIC_ANALYSIS_STORAGE_KEY = "skku-timetable:academic-analysis:v1";

export interface StoredChoiceGroup {
  id: string;
  title: string;
  minSubjects: number;
  maxSubjects: number;
}

export interface StoredSelectedCourseGroup extends CourseCandidateGroup {
  selectionId: string;
  source: "major" | "elective";
  campus?: SkkuElectiveCampus;
  programCodes?: string[];
}

export interface StoredCoursePlan {
  version: 1;
  queryKey: string;
  selectedGroups: StoredSelectedCourseGroup[];
  choiceGroups: StoredChoiceGroup[];
  activeDestination: string;
  courseOwners: Record<string, string>;
  enabledSectionIds: Record<string, string[]>;
  fixedEvents: FixedEvent[];
  extraProgramCodes: string[];
}

export interface StoredAcademicAnalysis {
  version: 1;
  profiles: Partial<Record<AcademicDocumentKind, AcademicProfile>>;
}

export function buildCoursePlanQueryKey(query: {
  departmentCode: string;
  year: number;
  term: number;
}): string {
  return `${query.departmentCode}:${query.year}:${query.term}`;
}

export function readStoredStudentProfile(raw: string | null): StudentPlanningProfile | null {
  const value = parseJson(raw);
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.departmentCode !== "string" ||
    !isNullableNumber(value.admissionYear) ||
    !isNullableNumber(value.currentGrade) ||
    (value.primaryCampus !== "humanities" &&
      value.primaryCampus !== "natural_sciences" &&
      value.primaryCampus !== null) ||
    typeof value.courseYear !== "number" ||
    (value.courseTerm !== 10 && value.courseTerm !== 15 &&
      value.courseTerm !== 20 && value.courseTerm !== 25) ||
    (value.additionalDepartmentCodes !== undefined && !isStringArray(value.additionalDepartmentCodes))
  ) {
    return null;
  }
  return {
    departmentCode: value.departmentCode,
    additionalDepartmentCodes: value.additionalDepartmentCodes ?? [],
    admissionYear: value.admissionYear,
    currentGrade: value.currentGrade,
    primaryCampus: value.primaryCampus,
    courseYear: value.courseYear,
    courseTerm: value.courseTerm,
  };
}

export function writeStoredStudentProfile(
  storage: Pick<Storage, "setItem">,
  profile: StudentPlanningProfile,
): void {
  storage.setItem(STUDENT_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function readStoredCoursePlan(raw: string | null): StoredCoursePlan | null {
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== 1 || typeof value.queryKey !== "string") {
    return null;
  }
  if (
    !Array.isArray(value.selectedGroups) ||
    !Array.isArray(value.choiceGroups) ||
    typeof value.activeDestination !== "string" ||
    !isStringRecord(value.courseOwners) ||
    !isStringArrayRecord(value.enabledSectionIds) ||
    !Array.isArray(value.fixedEvents) ||
    !isStringArray(value.extraProgramCodes)
  ) {
    return null;
  }
  const selectedGroups = value.selectedGroups.flatMap((group) => {
    const parsed = readStoredSelectedCourseGroup(group);
    return parsed ? [parsed] : [];
  });
  if (selectedGroups.length !== value.selectedGroups.length) {
    return null;
  }
  const choiceGroups = value.choiceGroups.flatMap((group) => {
    if (
      !isRecord(group) ||
      typeof group.id !== "string" ||
      typeof group.title !== "string" ||
      typeof group.minSubjects !== "number" ||
      typeof group.maxSubjects !== "number"
    ) {
      return [];
    }
    return [{
      id: group.id,
      title: group.title,
      minSubjects: group.minSubjects,
      maxSubjects: group.maxSubjects,
    }];
  });
  const fixedEvents = value.fixedEvents.flatMap((event) => {
    const parsed = readFixedEvent(event);
    return parsed ? [parsed] : [];
  });
  if (choiceGroups.length !== value.choiceGroups.length || fixedEvents.length !== value.fixedEvents.length) {
    return null;
  }
  return {
    version: 1,
    queryKey: value.queryKey,
    selectedGroups,
    choiceGroups,
    activeDestination: value.activeDestination,
    courseOwners: value.courseOwners,
    enabledSectionIds: value.enabledSectionIds,
    fixedEvents,
    extraProgramCodes: value.extraProgramCodes,
  };
}

export function writeStoredCoursePlan(
  storage: Pick<Storage, "setItem">,
  plan: StoredCoursePlan,
): void {
  storage.setItem(COURSE_PLAN_STORAGE_KEY, JSON.stringify(plan));
}

export function readStoredAcademicAnalysis(raw: string | null): StoredAcademicAnalysis | null {
  const value = parseJson(raw);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
    return null;
  }
  const profiles: Partial<Record<AcademicDocumentKind, AcademicProfile>> = {};
  for (const kind of ["course_history", "graduation_requirements"] as const) {
    const profile = value.profiles[kind];
    if (profile === undefined) {
      continue;
    }
    if (!looksLikeAcademicProfile(profile)) {
      return null;
    }
    profiles[kind] = profile;
  }
  return { version: 1, profiles };
}

export function writeStoredAcademicAnalysis(
  storage: Pick<Storage, "setItem">,
  profiles: Partial<Record<AcademicDocumentKind, AcademicProfile>>,
): void {
  storage.setItem(ACADEMIC_ANALYSIS_STORAGE_KEY, JSON.stringify({ version: 1, profiles }));
}

function readStoredSelectedCourseGroup(value: unknown): StoredSelectedCourseGroup | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.classification !== "string" ||
    typeof value.credits !== "number" ||
    typeof value.selectionId !== "string" ||
    (value.source !== "major" && value.source !== "elective") ||
    !Array.isArray(value.candidates) ||
    (value.campus !== undefined && !isElectiveCampus(value.campus)) ||
    (value.programCodes !== undefined && !isStringArray(value.programCodes))
  ) {
    return null;
  }
  const candidates = value.candidates.flatMap((candidate) => {
    const parsed = parseCourseCandidate(candidate);
    return parsed ? [parsed] : [];
  });
  if (candidates.length !== value.candidates.length) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    classification: value.classification,
    credits: value.credits,
    candidates,
    selectionId: value.selectionId,
    source: value.source,
    campus: value.campus,
    programCodes: value.programCodes,
  };
}

function readFixedEvent(value: unknown): FixedEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !isWeekday(value.day) ||
    typeof value.startMinutes !== "number" ||
    typeof value.endMinutes !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    day: value.day,
    startMinutes: value.startMinutes,
    endMinutes: value.endMinutes,
  };
}

function looksLikeAcademicProfile(value: unknown): value is AcademicProfile {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "string" &&
    isRecord(value.profile) &&
    Array.isArray(value.sourceDocuments) &&
    Array.isArray(value.completedCourses) &&
    Array.isArray(value.requirements) &&
    Array.isArray(value.reviewIssues)
  );
}

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isWeekday(value: unknown): value is Weekday {
  return value === "mon" || value === "tue" || value === "wed" || value === "thu" ||
    value === "fri" || value === "sat" || value === "sun";
}

function isElectiveCampus(value: unknown): value is SkkuElectiveCampus {
  return value === 1 || value === 2 || value === 3;
}
