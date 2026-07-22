import { describe, expect, it } from "vitest";

import type { CourseCandidate, FixedEvent, Meeting, Timetable, Weekday } from "./timetable";
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  getFreeDayLabels,
  getTimetableCandidateId,
  scoreTimetables,
  type RecommendationWeight,
} from "./timetable-scoring";

function meeting(day: Weekday, startMinutes: number, endMinutes: number): Meeting {
  return { day, startMinutes, endMinutes };
}

function course(id: string, courseType?: string): CourseCandidate {
  return { id, title: id, schedule: "", courseType };
}

function timetable(
  courses: CourseCandidate[],
  meetings: Meeting[],
  fixedEvents: FixedEvent[] = [],
): Timetable {
  return { courses, meetings, fixedEvents };
}

function fixedEvent(day: Weekday, startMinutes: number, endMinutes: number): FixedEvent {
  return { id: `fixed-${day}-${startMinutes}`, label: "알바", day, startMinutes, endMinutes };
}

function weight(
  id: RecommendationWeight["id"],
  overrides: Partial<RecommendationWeight> = {},
): RecommendationWeight {
  return { id, enabled: true, importance: "medium", ...overrides };
}

describe("timetable-scoring", () => {
  it("produces a stable, order-independent candidate id", () => {
    const a = timetable([course("B1"), course("A1")], []);
    const b = timetable([course("A1"), course("B1")], []);
    expect(getTimetableCandidateId(a)).toBe(getTimetableCandidateId(b));
  });

  it("returns zero scores and empty breakdowns when no weight is enabled", () => {
    const t = timetable([course("A1")], [meeting("mon", 540, 600)]);
    const scored = scoreTimetables([t], [weight("free_days", { enabled: false })]);
    expect(scored[0]).toMatchObject({ totalScore: 0, breakdown: [] });
  });

  it("ranks the timetable with more free days higher under free_days", () => {
    const busy = timetable(
      [course("A1")],
      [
        meeting("mon", 600, 660),
        meeting("tue", 600, 660),
        meeting("wed", 600, 660),
        meeting("thu", 600, 660),
        meeting("fri", 600, 660),
      ],
    );
    const spacious = timetable([course("B1")], [meeting("mon", 600, 660), meeting("tue", 600, 660)]);

    const [first] = scoreTimetables([busy, spacious], [weight("free_days")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(spacious));
  });

  it("penalizes 9am starts under avoid_9am", () => {
    const early = timetable([course("A1")], [meeting("mon", 540, 615)]);
    const later = timetable([course("B1")], [meeting("mon", 600, 675)]);

    const [first] = scoreTimetables([early, later], [weight("avoid_9am")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(later));
  });

  it("rewards a free lunch window between 11:00 and 13:00", () => {
    const withLunch = timetable(
      [course("A1")],
      [meeting("mon", 540, 660), meeting("mon", 780, 900)],
    );
    const withoutLunch = timetable([course("B1")], [meeting("mon", 540, 840)]);

    const [first] = scoreTimetables([withLunch, withoutLunch], [weight("lunch_break")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(withLunch));
  });

  it("uses a custom lunch window from weight config", () => {
    // 12:00–14:00 창: 12시 수업이 있으면 나쁘고, 14시 이후만 있으면 좋음
    const freeCustomLunch = timetable(
      [course("A1")],
      [meeting("mon", 540, 660), meeting("mon", 840, 900)],
    );
    const blocksCustomLunch = timetable([course("B1")], [meeting("mon", 720, 780)]);

    const [first] = scoreTimetables(
      [freeCustomLunch, blocksCustomLunch],
      [
        weight("lunch_break", {
          config: { lunchStartMinutes: 12 * 60, lunchEndMinutes: 14 * 60 },
        }),
      ],
    );
    expect(first?.candidateId).toBe(getTimetableCandidateId(freeCustomLunch));
  });

  it("avoids long back-to-back runs by default (direction=avoid)", () => {
    const longRun = timetable([course("A1")], [meeting("mon", 540, 750)]); // 210 min >= 180
    const shortRun = timetable([course("B1")], [meeting("mon", 540, 630)]); // 90 min

    const [first] = scoreTimetables([longRun, shortRun], [weight("back_to_back")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(shortRun));
  });

  it("prefers long back-to-back runs when direction=prefer", () => {
    const longRun = timetable([course("A1")], [meeting("mon", 540, 750)]);
    const shortRun = timetable([course("B1")], [meeting("mon", 540, 630)]);

    const [first] = scoreTimetables(
      [longRun, shortRun],
      [weight("back_to_back", { config: { direction: "prefer" } })],
    );
    expect(first?.candidateId).toBe(getTimetableCandidateId(longRun));
  });

  it("distinguishes in-person and online course type preferences", () => {
    const inPerson = timetable([course("A1", "오프라인")], [meeting("mon", 600, 660)]);
    const online = timetable([course("B1", "온라인(사전제작)")], [meeting("mon", 600, 660)]);

    const [firstInPerson] = scoreTimetables([inPerson, online], [weight("prefer_in_person")]);
    expect(firstInPerson?.candidateId).toBe(getTimetableCandidateId(inPerson));

    const [firstOnline] = scoreTimetables([inPerson, online], [weight("prefer_online")]);
    expect(firstOnline?.candidateId).toBe(getTimetableCandidateId(online));
  });

  it("prefers fewer active days under compact_days", () => {
    const compact = timetable([course("A1")], [meeting("mon", 600, 660), meeting("mon", 660, 720)]);
    const spread = timetable([course("B1")], [meeting("mon", 600, 660), meeting("tue", 600, 660)]);

    const [first] = scoreTimetables([compact, spread], [weight("compact_days")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(compact));
  });

  it("prefers a smaller total daily span under minimize_daily_span", () => {
    const tight = timetable([course("A1")], [meeting("mon", 600, 660)]);
    const spanning = timetable([course("B1")], [meeting("mon", 540, 900)]);

    const [first] = scoreTimetables([tight, spanning], [weight("minimize_daily_span")]);
    expect(first?.candidateId).toBe(getTimetableCandidateId(tight));
  });

  it("weighs a high-importance preference over a low-importance conflicting one", () => {
    // A wins free_days (4 free days) but starts at 9am; B wins avoid_9am (no 9am start) but
    // uses every weekday. With avoid_9am set to "high" it should outweigh a "low" free_days.
    const a = timetable([course("A1")], [meeting("mon", 540, 600)]);
    const b = timetable(
      [course("B1")],
      [
        meeting("mon", 600, 660),
        meeting("tue", 600, 660),
        meeting("wed", 600, 660),
        meeting("thu", 600, 660),
        meeting("fri", 600, 660),
      ],
    );

    const [first] = scoreTimetables(
      [a, b],
      [
        weight("free_days", { importance: "low" }),
        weight("avoid_9am", { importance: "high" }),
      ],
    );
    expect(first?.candidateId).toBe(getTimetableCandidateId(b));
  });

  it("exposes a full default weight list with one entry per WeightId", () => {
    const ids = new Set(DEFAULT_RECOMMENDATION_WEIGHTS.map((entry) => entry.id));
    expect(ids.size).toBe(DEFAULT_RECOMMENDATION_WEIGHTS.length);
    expect(ids.has("free_days")).toBe(true);
    expect(ids.has("prefer_in_person")).toBe(true);
    expect(ids.has("prefer_online")).toBe(true);
  });

  // Regression: a day with zero course meetings but a fixed personal event (알바 등) must not be
  // treated as free — this was the root cause of the AI recommendation once claiming a Wednesday
  // free day that was actually blocked by a fixed event.
  it("does not count a day that only has a fixed event as free under free_days", () => {
    const onlyFixedEventOnWednesday = timetable(
      [course("A1")],
      [meeting("mon", 600, 660)],
      [fixedEvent("wed", 1080, 1200)],
    );
    const trulyFreeWednesday = timetable([course("B1")], [meeting("mon", 600, 660)]);

    const [first] = scoreTimetables(
      [onlyFixedEventOnWednesday, trulyFreeWednesday],
      [weight("free_days")],
    );
    expect(first?.candidateId).toBe(getTimetableCandidateId(trulyFreeWednesday));
  });
});

describe("getFreeDayLabels", () => {
  it("lists every weekday with no meeting as free", () => {
    const t = timetable([course("A1")], [meeting("mon", 600, 660)]);
    expect(getFreeDayLabels(t)).toEqual(["화요일", "수요일", "목요일", "금요일"]);
  });

  it("excludes a day that only has a fixed event, not a course meeting", () => {
    const t = timetable([course("A1")], [meeting("mon", 600, 660)], [fixedEvent("wed", 1080, 1200)]);
    expect(getFreeDayLabels(t)).toEqual(["화요일", "목요일", "금요일"]);
  });

  it("returns an empty list when every weekday is occupied", () => {
    const t = timetable(
      [course("A1")],
      [
        meeting("mon", 600, 660),
        meeting("tue", 600, 660),
        meeting("wed", 600, 660),
        meeting("thu", 600, 660),
        meeting("fri", 600, 660),
      ],
    );
    expect(getFreeDayLabels(t)).toEqual([]);
  });
});
