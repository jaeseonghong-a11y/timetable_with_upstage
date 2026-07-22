import { describe, expect, it } from "vitest";

import { scoreFriendRemixTimetables } from "./friend-remix-scoring";
import type { CourseCandidate, Timetable } from "./timetable";

function course(courseNumber: string, courseType: string, id = courseNumber): CourseCandidate {
  return {
    id,
    title: courseNumber,
    courseName: courseNumber,
    courseNumber,
    courseType,
    schedule: "월 09:00-10:15",
    credits: 3,
  };
}

function timetable(...courses: CourseCandidate[]): Timetable {
  return { courses, meetings: [], fixedEvents: [] };
}

const friendCourses = [
  course("GED001", "균형교양", "friend-ged"),
  course("MAJ001", "전공핵심", "friend-major"),
];

describe("scoreFriendRemixTimetables", () => {
  it("adds every in-scope shared course for strong together mode", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable(course("GED001", "균형교양"), course("MAJ001", "전공핵심"))],
      { friendCourses, mode: "together", scope: "general_and_major", strength: "strong", unmetRequirementLabels: [] },
    );
    expect(result?.totalScore).toBe(2);
  });

  it("can score only major courses when major-only scope is selected", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable(course("GED001", "균형교양"), course("MAJ001", "전공핵심"))],
      { friendCourses, mode: "together", scope: "major_only", strength: "strong", unmetRequirementLabels: [] },
    );

    expect(result?.totalScore).toBe(1);
    expect(result?.matches.map((match) => match.courseNumber)).toEqual(["MAJ001"]);
  });

  it("uses the legacy course id prefix when an old shared timecode lacks a course number", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable({ ...course("unused", "전공핵심", "MAJ001-01"), courseNumber: undefined })],
      {
        friendCourses: [{ ...course("unused", "전공핵심", "MAJ001-02"), courseNumber: undefined }],
        mode: "together",
        scope: "major_only",
        strength: "strong",
        unmetRequirementLabels: [],
      },
    );

    expect(result?.matchedCourseCount).toBe(1);
  });

  it("adds only an unmet-area overlap for weak together mode", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable(course("GED001", "균형교양"), course("MAJ001", "전공핵심"))],
      { friendCourses, mode: "together", scope: "general_and_major", strength: "weak", unmetRequirementLabels: ["균형교양"] },
    );
    expect(result?.totalScore).toBe(1);
  });

  it("subtracts every in-scope shared course for strong opposite mode", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable(course("GED001", "균형교양"), course("MAJ001", "전공핵심"))],
      { friendCourses, mode: "opposite", scope: "general_and_major", strength: "strong", unmetRequirementLabels: [] },
    );
    expect(result?.totalScore).toBe(-2);
  });

  it("subtracts only a non-unmet-area overlap for weak opposite mode", () => {
    const [result] = scoreFriendRemixTimetables(
      [timetable(course("GED001", "균형교양"), course("MAJ001", "전공핵심"))],
      { friendCourses, mode: "opposite", scope: "general_and_major", strength: "weak", unmetRequirementLabels: ["균형교양"] },
    );
    expect(result?.totalScore).toBe(-1);
  });
});
