import { describe, expect, it } from "vitest";

import { parseFriendRemixTimetableResponse } from "./friend-remix-data";

describe("parseFriendRemixTimetableResponse", () => {
  it("accepts a legacy shared timetable with no required-course marker", () => {
    const parsed = parseFriendRemixTimetableResponse({
      ownerLabel: "친구",
      timetable: {
        courses: [{ id: "ARCH1001-01", title: "건축설계", schedule: "월09:00-10:15" }],
      },
      requiredCourseIds: null,
    });

    expect(parsed).toEqual({
      ownerLabel: "친구",
      timetable: {
        courses: [{ id: "ARCH1001-01", title: "건축설계", schedule: "월09:00-10:15" }],
        meetings: [],
        fixedEvents: [],
      },
      requiredCourseIds: null,
    });
  });

  it("still rejects a malformed required-course marker", () => {
    expect(
      parseFriendRemixTimetableResponse({
        ownerLabel: "친구",
        timetable: { courses: [{ id: "ARCH1001-01", title: "건축설계", schedule: "" }] },
        requiredCourseIds: [42],
      }),
    ).toBeNull();
  });
});
