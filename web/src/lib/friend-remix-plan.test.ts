import { describe, expect, it } from "vitest";

import { createFriendRemixSelectionPlan } from "./friend-remix-plan";
import type { CourseCandidate, Timetable } from "./timetable";

function course(id: string, courseNumber: string): CourseCandidate {
  return { id, courseNumber, title: courseNumber, courseName: courseNumber, schedule: "월09:00-10:15", credits: 3 };
}

function timetable(...courses: CourseCandidate[]): Timetable {
  return { courses, meetings: [], fixedEvents: [] };
}

describe("createFriendRemixSelectionPlan", () => {
  it("keeps only the viewer's required subjects fixed and fills the old optional count from the friend", () => {
    const mine = timetable(course("mine-required", "REQ1001"), course("mine-choice", "OLD1001"));
    const friend = timetable(course("friend-a", "FRI1001"), course("friend-b", "FRI1002"));

    const plan = createFriendRemixSelectionPlan(mine, friend, ["mine-required"]);

    expect(plan?.requiredSubjects.map((subject) => subject.id)).toEqual(["REQ1001"]);
    expect(plan?.choiceBags).toHaveLength(1);
    expect(plan?.choiceBags[0]).toMatchObject({ minSubjects: 1, maxSubjects: 1 });
    expect(plan?.choiceBags[0]?.subjects.map((subject) => subject.id)).toEqual(["FRI1001", "FRI1002"]);
  });

  it("does not add a duplicate friend subject when it is already one of my required subjects", () => {
    const mine = timetable(course("mine-required", "REQ1001"), course("mine-choice", "OLD1001"));
    const friend = timetable(course("friend-same", "REQ1001"), course("friend-other", "FRI1001"));

    const plan = createFriendRemixSelectionPlan(mine, friend, ["mine-required"]);

    expect(plan?.choiceBags[0]?.subjects.map((subject) => subject.id)).toEqual(["FRI1001"]);
  });

  it("requires saved required-subject metadata instead of silently treating optional courses as fixed", () => {
    const plan = createFriendRemixSelectionPlan(
      timetable(course("mine-choice", "OLD1001")),
      timetable(course("friend", "FRI1001")),
      [],
    );

    expect(plan).toBeNull();
  });
});
