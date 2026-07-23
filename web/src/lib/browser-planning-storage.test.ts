import { describe, expect, it } from "vitest";

import {
  ACADEMIC_ANALYSIS_STORAGE_KEY,
  COURSE_PLAN_STORAGE_KEY,
  STUDENT_PROFILE_STORAGE_KEY,
  buildCoursePlanQueryKey,
  readStoredAcademicAnalysis,
  readStoredCoursePlan,
  readStoredStudentProfile,
  writeStoredAcademicAnalysis,
  writeStoredCoursePlan,
  writeStoredStudentProfile,
} from "./browser-planning-storage";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("browser planning storage", () => {
  it("round-trips the identity-minimized STEP 1 profile", () => {
    const storage = new MemoryStorage();
    writeStoredStudentProfile(storage, {
      departmentCode: "316901",
      additionalDepartmentCodes: ["316902"],
      admissionYear: 2022,
      currentGrade: 3,
      primaryCampus: "humanities",
      courseYear: 2026,
      courseTerm: 15,
    });

    expect(readStoredStudentProfile(storage.getItem(STUDENT_PROFILE_STORAGE_KEY))).toMatchObject({
      departmentCode: "316901",
      additionalDepartmentCodes: ["316902"],
      primaryCampus: "humanities",
      courseTerm: 15,
    });
  });

  it("keeps a selected course plan scoped to the course query", () => {
    const storage = new MemoryStorage();
    writeStoredCoursePlan(storage, {
      version: 1,
      queryKey: buildCoursePlanQueryKey({ departmentCode: "316901", year: 2026, term: 20 }),
      selectedGroups: [{
        id: "ADD2007",
        title: "건축설계스튜디오2",
        classification: "전공심화",
        credits: 6,
        selectionId: "major:ADD2007",
        source: "major",
        programCodes: ["316901"],
        candidates: [{
          id: "ADD2007-01",
          title: "건축설계스튜디오2 · 01분반",
          schedule: "월12:00-13:15",
          courseNumber: "ADD2007",
          credits: 6,
        }],
      }],
      choiceGroups: [{ id: "choice-1", title: "선택 묶음 1", minSubjects: 1, maxSubjects: 1 }],
      activeDestination: "required",
      courseOwners: { "major:ADD2007": "required" },
      enabledSectionIds: { "major:ADD2007": ["ADD2007-01"] },
      fixedEvents: [],
      extraProgramCodes: [],
    });

    const stored = readStoredCoursePlan(storage.getItem(COURSE_PLAN_STORAGE_KEY));
    expect(stored?.queryKey).toBe("316901:2026:20");
    expect(stored?.selectedGroups[0]?.candidates[0]?.courseNumber).toBe("ADD2007");
  });

  it("stores only structured academic output, never a file", () => {
    const storage = new MemoryStorage();
    writeStoredAcademicAnalysis(storage, {
      course_history: {
        schemaVersion: "1.0",
        profile: {
          departmentCode: "316901",
          majorCodes: ["316901"],
          admissionYear: 2022,
          currentGrade: 3,
          primaryCampus: "humanities",
        },
        sourceDocuments: [{ id: "doc-1", kind: "course_history", status: "draft" }],
        completedCourses: [],
        requirements: [],
        reviewIssues: [],
      },
    });

    const raw = storage.getItem(ACADEMIC_ANALYSIS_STORAGE_KEY);
    expect(raw).not.toContain("File");
    expect(readStoredAcademicAnalysis(raw)?.profiles.course_history?.sourceDocuments).toHaveLength(1);
  });

  it("ignores malformed saved data instead of applying it", () => {
    expect(readStoredStudentProfile('{"departmentCode":123}')).toBeNull();
    expect(readStoredCoursePlan('{"version":1}')).toBeNull();
    expect(readStoredAcademicAnalysis('{"version":1,"profiles":{"course_history":{}}}')).toBeNull();
  });
});
