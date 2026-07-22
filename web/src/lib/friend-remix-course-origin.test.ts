import { describe, expect, it } from "vitest";

import { getFriendRemixCourseOrigins } from "./friend-remix-course-origin";
import type { CourseCandidate } from "./timetable";

function course(id: string, courseNumber?: string): CourseCandidate {
  return {
    id,
    title: id,
    courseNumber,
    schedule: "월 09:00-10:15",
  };
}

describe("getFriendRemixCourseOrigins", () => {
  it("classifies shared, friend-only, and mine-only courses by course number", () => {
    const mySharedSection = course("mine-shared-01", "GED001");
    const friendSharedSection = course("friend-shared-02", "ged001");
    const mineOnly = course("mine-only", "MAJ001");
    const friendOnly = course("friend-only", "GED002");

    const origins = getFriendRemixCourseOrigins(
      [mySharedSection, mineOnly],
      [friendSharedSection, friendOnly],
    );

    expect(origins.get(mySharedSection.id)).toBe("friend-shared");
    expect(origins.get(friendSharedSection.id)).toBe("friend-shared");
    expect(origins.get(mineOnly.id)).toBe("mine-only");
    expect(origins.get(friendOnly.id)).toBe("friend-only");
  });

  it("uses the candidate id when a manual course has no course number", () => {
    const shared = course("manual-shared");
    const mineOnly = course("manual-mine-only");

    const origins = getFriendRemixCourseOrigins([shared, mineOnly], [shared]);

    expect(origins.get(shared.id)).toBe("friend-shared");
    expect(origins.get(mineOnly.id)).toBe("mine-only");
  });
});
