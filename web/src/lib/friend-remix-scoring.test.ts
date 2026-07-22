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
