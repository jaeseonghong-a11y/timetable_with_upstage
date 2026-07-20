import { describe, expect, it } from "vitest";

import type { CompletedCourse } from "./academic-profile";
import { formatTermLabel, groupCompletedCoursesForReview } from "./course-history-grouping";

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
  it("groups by classification, then by year (own block, ascending), then by 학기 within a year", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "전공필수", year: 2023, term: "fall" }),
      makeCourse({ courseCode: "B", classification: "교양선택", year: 2022, term: "spring" }),
      makeCourse({ courseCode: "C", classification: "전공필수", year: 2022, term: "spring" }),
      makeCourse({ courseCode: "D", classification: "전공필수", year: 2023, term: "spring" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual(["전공필수", "교양선택"]);
    expect(groups[0]!.yearGroups.map((yearGroup) => yearGroup.year)).toEqual([2022, 2023]);
    expect(groups[0]!.yearGroups[0]!.termGroups).toEqual([
      { term: "spring", entries: [{ course: courses[2], index: 2 }] },
    ]);
    // 2023 has both spring(D) and fall(A) — separate term groups, spring first, same year block.
    expect(groups[0]!.yearGroups[1]!.termGroups).toEqual([
      { term: "spring", entries: [{ course: courses[3], index: 3 }] },
      { term: "fall", entries: [{ course: courses[0], index: 0 }] },
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

  it("puts undated entries in their own trailing year block, and unset 학기 last within a year", () => {
    const courses = [
      makeCourse({ courseCode: "A", classification: "전공선택", year: 2023, term: null }),
      makeCourse({ courseCode: "B", classification: "전공선택", year: null, term: null }),
      makeCourse({ courseCode: "C", classification: "전공선택", year: 2021, term: "fall" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups[0]!.yearGroups.map((yearGroup) => yearGroup.year)).toEqual([2021, 2023, null]);
    expect(groups[0]!.yearGroups[1]!.termGroups).toEqual([
      { term: null, entries: [{ course: courses[0], index: 0 }] },
    ]);
  });

  it("returns an empty array for no courses", () => {
    expect(groupCompletedCoursesForReview([])).toEqual([]);
  });

  it("splits classification groups by 전공 범위 once 2+ distinct majorScopes are present", () => {
    const courses = [
      makeCourse({ courseCode: "A", majorScope: "제1전공", classification: "전공" }),
      makeCourse({ courseCode: "B", majorScope: "제3전공", classification: "전공" }),
      makeCourse({ courseCode: "C", majorScope: "제1전공", classification: "교양" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual([
      "제1전공 전공",
      "제3전공 전공",
      "제1전공 교양",
    ]);
  });

  it("does not split by majorScope when every course shares the same one (single-major documents)", () => {
    const courses = [
      makeCourse({ courseCode: "A", majorScope: "제1전공", classification: "전공" }),
      makeCourse({ courseCode: "B", majorScope: "제1전공", classification: "교양" }),
    ];

    const groups = groupCompletedCoursesForReview(courses);

    expect(groups.map((group) => group.classification)).toEqual(["전공", "교양"]);
  });
});

describe("formatTermLabel", () => {
  it("formats a known term", () => {
    expect(formatTermLabel("fall")).toBe("2학기");
    expect(formatTermLabel("winter")).toBe("겨울학기");
  });

  it("falls back to 학기 미상 when missing", () => {
    expect(formatTermLabel(null)).toBe("학기 미상");
  });
});
