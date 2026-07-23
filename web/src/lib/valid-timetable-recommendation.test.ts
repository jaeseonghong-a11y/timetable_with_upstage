import { describe, expect, it } from "vitest";

import {
  buildRecommendationCopy,
  rankValidTimetables,
  type ValidTimetableRecommendationContext,
} from "./valid-timetable-recommendation";
import type { RecommendationWeight } from "./timetable-scoring";
import type { Timetable } from "./timetable";

function timetable(id: string, courseNumber: string, startMinutes = 600): Timetable {
  return {
    courses: [
      {
        id,
        title: `${courseNumber} 수업`,
        courseNumber,
        credits: 3,
        schedule: "월09:00-10:15",
      },
    ],
    meetings: [{ day: "mon", startMinutes, endMinutes: startMinutes + 75 }],
    fixedEvents: [],
  };
}

const noWeights: RecommendationWeight[] = [];
const requirements = [{ scope: "general" as const, label: "균형교양 - 인간/문화" }];

describe("rankValidTimetables", () => {
  it("strong graduation consideration prioritizes a valid timetable with a matching optional course", () => {
    const matching = timetable("MATCH", "GED1001");
    const other = timetable("OTHER", "GED1002");
    const contexts: ValidTimetableRecommendationContext[] = [
      {
        candidateId: "MATCH",
        optionalCourses: [{ title: "고전읽기", classification: "균형교양 - 인간/문화", scope: "general" }],
      },
      {
        candidateId: "OTHER",
        optionalCourses: [{ title: "글로벌영어", classification: "글로벌", scope: "general" }],
      },
    ];

    const ranked = rankValidTimetables(
      [other, matching],
      noWeights,
      contexts,
      requirements,
      "strong",
    );

    expect(ranked.map((entry) => entry.candidateId)).toEqual(["MATCH", "OTHER"]);
    expect(ranked[0]?.matchedRequirementLabels).toEqual(["균형교양 - 인간/문화"]);
  });

  it("weak graduation consideration still ranks direct matches but does not invent a match", () => {
    const matching = timetable("MATCH", "GED1001");
    const other = timetable("OTHER", "GED1002");
    const ranked = rankValidTimetables(
      [other, matching],
      noWeights,
      [
        {
          candidateId: "MATCH",
          optionalCourses: [{ title: "고전읽기", classification: "균형교양 - 인간/문화", scope: "general" }],
        },
        {
          candidateId: "OTHER",
          optionalCourses: [{ title: "글로벌영어", classification: "글로벌", scope: "general" }],
        },
      ],
      requirements,
      "weak",
    );

    expect(ranked[0]?.candidateId).toBe("MATCH");
    expect(ranked[1]?.matchedRequirementLabels).toEqual([]);
  });

  it("names a no-9am winner without naming any required course", () => {
    const early = timetable("EARLY", "A", 540);
    const late = timetable("LATE", "B", 660);
    const weights: RecommendationWeight[] = [{ id: "avoid_9am", enabled: true, importance: 5 }];
    const ranked = rankValidTimetables([early, late], weights, [], [], "none");

    const copy = buildRecommendationCopy(ranked[0]!, weights, "none");

    expect(copy.name).toBe("첫수업 회피형");
    expect(copy.reason).not.toContain("필수");
  });
});
