import { describe, expect, it } from "vitest";

import type { CompletedCourse } from "./academic-profile";
import { formatCourseYearTerm, groupCompletedCoursesForReview } from "./course-history-grouping";

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
  it("groups by classification and sorts entries by year then 학기 within each group", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "전공필수", year: 2023, term: "fall" }),
      makeCourse({ courseCode: "B", classification: "교양선택", year: 2022, term: "spring" }),
      makeCourse({ courseCode: "C", classification: "전공필수", year: 2022, term: "spring" }),
      makeCourse({ courseCode: "D", classification: "전공필수", year: 2023, term: "spring" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual(["전공필수", "교양선택"]);
    // C(2022 spring) -> D(2023 spring) -> A(2023 fall), one flat list, not split by year.
    expect(groups[0]!.entries).toEqual([
      { course: courses[2], index: 2 },
      { course: courses[3], index: 3 },
      { course: courses[0], index: 0 },
    ]);
  });

  it("orders classification groups 전공, 교양, 일반선택, DS, other, then 미상 last", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "교양필수" }),
      makeCourse({ courseCode: "B", classification: "" }),
      makeCourse({ courseCode: "C", classification: "DS기반(공통)" }),
      makeCourse({ courseCode: "D", classification: "일반선택" }),
      makeCourse({ courseCode: "E", classification: "소양인증" }),
      makeCourse({ courseCode: "F", classification: "전공선택" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual([
      "전공선택",
      "교양필수",
      "일반선택",
      "DS기반(공통)",
      "소양인증",
      "이수구분 미상",
    ]);
  });

  it("sorts undated entries and entries with no 학기 last within a classification", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "전공선택", year: 2023, term: null }),
      makeCourse({ courseCode: "B", classification: "전공선택", year: null, term: null }),
      makeCourse({ courseCode: "C", classification: "전공선택", year: 2021, term: "fall" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups[0]!.entries.map((entry) => entry.course.courseCode)).toEqual(["C", "A", "B"]);
  });

  it("returns an empty array for no courses", () => {
    expect(groupCompletedCoursesForReview([])).toEqual([]);
  });
});

describe("formatCourseYearTerm", () => {
  it("formats a known year and term", () => {
    expect(formatCourseYearTerm({ year: 2023, term: "fall" })).toBe("2023년 2학기");
  });

  it("falls back to 미상 labels for missing year/term", () => {
    expect(formatCourseYearTerm({ year: null, term: null })).toBe("연도 미상 학기 미상");
    expect(formatCourseYearTerm({ year: 2023, term: null })).toBe("2023년 학기 미상");
  });
});
