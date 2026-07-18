import { describe, expect, it } from "vitest";

import type { CompletedCourse } from "./academic-profile";
import { groupCompletedCoursesForReview } from "./course-history-grouping";

function makeCourse(overrides: Partial<CompletedCourse>): CompletedCourse {
  return {
    courseCode: "ABC1001",
    courseName: "테스트 과목",
    majorScope: "",
    classification: "전공선택",
    year: 2024,
    term: "spring",
    credits: 3,
    area: "",
    completionStatus: "earned",
    recommendationPolicy: "exclude",
    flags: [],
    sourceDocumentId: "doc-1",
    reviewReasons: [],
    ...overrides,
  };
}

describe("groupCompletedCoursesForReview", () => {
  it("groups by classification first, then by year ascending, preserving original index", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "전공필수", year: 2023 }),
      makeCourse({ courseCode: "B", classification: "교양선택", year: 2022 }),
      makeCourse({ courseCode: "C", classification: "전공필수", year: 2022 }),
      makeCourse({ courseCode: "D", classification: "전공필수", year: 2023 }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual(["전공필수", "교양선택"]);
    expect(groups[0]!.yearGroups.map((yearGroup) => yearGroup.year)).toEqual([2022, 2023]);
    expect(groups[0]!.yearGroups[0]!.entries).toEqual([{ course: courses[2], index: 2 }]);
    expect(groups[0]!.yearGroups[1]!.entries).toEqual([
      { course: courses[0], index: 0 },
      { course: courses[3], index: 3 },
    ]);
  });

  it("reorders 전공 classifications before 교양, even when 교양 appears first in the source", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "교양필수", year: 2023 }),
      makeCourse({ courseCode: "B", classification: "일반선택", year: 2023 }),
      makeCourse({ courseCode: "C", classification: "전공선택", year: 2023 }),
      makeCourse({ courseCode: "D", classification: "교양선택", year: 2023 }),
      makeCourse({ courseCode: "E", classification: "전공필수", year: 2023 }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual([
      "전공선택",
      "전공필수",
      "일반선택",
      "교양필수",
      "교양선택",
    ]);
  });

  it("sorts unclassified and undated entries last", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "", year: 2023 }),
      makeCourse({ courseCode: "B", classification: "전공선택", year: null }),
      makeCourse({ courseCode: "C", classification: "전공선택", year: 2021 }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual(["전공선택", "이수구분 미상"]);
    expect(groups[0]!.yearGroups.map((yearGroup) => yearGroup.year)).toEqual([2021, null]);
  });

  it("returns an empty array for no courses", () => {
    expect(groupCompletedCoursesForReview([])).toEqual([]);
  });
});
