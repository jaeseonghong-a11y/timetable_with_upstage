import { describe, expect, it } from "vitest";

import { computeMergedTimetable, type MergedTimetableSource } from "./merged-timetable";
import type { CourseCandidate, Timetable } from "./timetable";

function course(id: string, title: string, schedule: string): CourseCandidate {
  return { id, title, schedule };
}

function timetable(courses: CourseCandidate[]): Timetable {
  return { courses, meetings: [], fixedEvents: [] };
}

function source(id: string, label: string, courses: CourseCandidate[]): MergedTimetableSource {
  return { id, label, timetable: timetable(courses) };
}

describe("computeMergedTimetable", () => {
  it("returns nothing when no one has any courses", () => {
    const result = computeMergedTimetable([source("me", "나", [])]);
    expect(result.busyBlocks).toEqual([]);
    expect(result.sharedBlocks).toEqual([]);
  });

  it("marks a single person's class time as busy but never shared", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
    ]);
    expect(result.busyBlocks).toEqual([{ day: "mon", startMinutes: 540, endMinutes: 615 }]);
    expect(result.sharedBlocks).toEqual([]);
  });

  it("marks the exact same course at the exact same time for 2+ people as shared", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("A1", "수학", "월 09:00-10:15")]),
    ]);
    expect(result.sharedBlocks).toEqual([
      { day: "mon", startMinutes: 540, endMinutes: 615, title: "수학", sourceLabels: ["나", "재성"] },
    ]);
    // The shared time is still covered by exactly one busy block (union), not duplicated.
    expect(result.busyBlocks).toEqual([{ day: "mon", startMinutes: 540, endMinutes: 615 }]);
  });

  it("does not treat different courses at the same time as shared", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("B1", "영어", "월 09:00-10:15")]),
    ]);
    expect(result.sharedBlocks).toEqual([]);
    // Both courses occupy the identical range, so the union is still one merged busy block.
    expect(result.busyBlocks).toEqual([{ day: "mon", startMinutes: 540, endMinutes: 615 }]);
  });

  it("does not treat the same course title at a different time as shared", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("A2", "수학", "월 11:00-12:15")]),
    ]);
    expect(result.sharedBlocks).toEqual([]);
    expect(result.busyBlocks).toEqual([
      { day: "mon", startMinutes: 540, endMinutes: 615 },
      { day: "mon", startMinutes: 660, endMinutes: 735 },
    ]);
  });

  it("merges overlapping and back-to-back busy time from different people into one block", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("B1", "영어", "월 10:15-11:00")]),
    ]);
    expect(result.busyBlocks).toEqual([{ day: "mon", startMinutes: 540, endMinutes: 660 }]);
  });

  it("leaves a gap between busy blocks when there is genuinely free time in between", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("B1", "영어", "월 13:00-14:15")]),
    ]);
    expect(result.busyBlocks).toEqual([
      { day: "mon", startMinutes: 540, endMinutes: 615 },
      { day: "mon", startMinutes: 780, endMinutes: 855 },
    ]);
  });

  it("only counts a group as shared once even with 3+ people in the same class", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15")]),
      source("f1", "재성", [course("A1", "수학", "월 09:00-10:15")]),
      source("f2", "규동", [course("A1", "수학", "월 09:00-10:15")]),
    ]);
    expect(result.sharedBlocks).toHaveLength(1);
    expect(result.sharedBlocks[0]?.sourceLabels).toEqual(["나", "재성", "규동"]);
  });

  it("keeps different days independent", () => {
    const result = computeMergedTimetable([
      source("me", "나", [course("A1", "수학", "월 09:00-10:15, 수 09:00-10:15")]),
      source("f1", "재성", [course("A1", "수학", "월 09:00-10:15")]),
    ]);
    expect(result.sharedBlocks).toEqual([
      { day: "mon", startMinutes: 540, endMinutes: 615, title: "수학", sourceLabels: ["나", "재성"] },
    ]);
    expect(result.busyBlocks).toEqual(
      expect.arrayContaining([{ day: "wed", startMinutes: 540, endMinutes: 615 }]),
    );
  });
});
