import { describe, expect, it } from "vitest";

import {
  diagnoseEmptyTimetable,
  enumerateSubjectSelections,
  estimateCreditRangeFromPlan,
  generateTimetablesForSelectionPlan,
  getAllSectionIds,
  getInitialSectionIds,
  removeSubjectsOwnedBy,
  SelectionPlanError,
  SelectionPlanLimitError,
  toggleEnabledSectionId,
  type SubjectOption,
} from "./selection-plan";

function subject(id: string, sectionCount = 1, credits = 3): SubjectOption {
  return {
    id,
    title: id,
    credits,
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      id: `${id}-${index + 1}`,
      title: `${id} ${index + 1}분반`,
      schedule: "",
    })),
  };
}

function subjectAt(id: string, schedule: string, credits = 3): SubjectOption {
  return {
    id,
    title: id,
    credits,
    sections: [{ id: `${id}-1`, title: `${id} 1분반`, schedule }],
  };
}

describe("enumerateSubjectSelections", () => {
  it("enables only the first section when a subject is initially selected", () => {
    expect(getInitialSectionIds(subject("A", 3).sections)).toEqual(["A-1"]);
    expect(getInitialSectionIds([])).toEqual([]);
  });

  it("enables every section id for select-all", () => {
    expect(getAllSectionIds(subject("A", 3).sections)).toEqual(["A-1", "A-2", "A-3"]);
    expect(getAllSectionIds([])).toEqual([]);
  });

  it("lets users add or replace sections without leaving a selected subject empty", () => {
    expect(toggleEnabledSectionId(["A-1"], "A-2")).toEqual(["A-1", "A-2"]);
    expect(toggleEnabledSectionId(["A-1", "A-2"], "A-1")).toEqual(["A-2"]);
    expect(toggleEnabledSectionId(["A-2"], "A-2")).toEqual(["A-2"]);
  });

  it("removes every course and section setting owned by a deleted group", () => {
    expect(removeSubjectsOwnedBy(
      {
        selectedIds: ["A", "B", "C"],
        owners: { A: "one", B: "two", C: "one" },
        enabledSectionIds: { A: ["A-1"], B: ["B-1"], C: ["C-2"] },
      },
      "one",
    )).toEqual({
      selectedIds: ["B"],
      owners: { B: "two" },
      enabledSectionIds: { B: ["B-1"] },
      removedIds: ["A", "C"],
    });
  });

  it("enumerates every allowed subject subset while preserving all sections", () => {
    const required = subject("REQ", 2);
    const first = subject("A", 3);
    const second = subject("B", 1);

    const selections = enumerateSubjectSelections({
      requiredSubjects: [required],
      choiceBags: [{ id: "interest", title: "관심 과목", subjects: [first, second] }],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      ["REQ", "A"],
      ["REQ", "B"],
    ]);
    expect(selections[0]?.[0]?.sections).toHaveLength(2);
    expect(selections[0]?.[1]?.sections).toHaveLength(3);
  });

  it("supports optional bags and choosing several subjects from one bag", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "free",
          title: "자유 선택",
          subjects: [subject("A"), subject("B")],
          minSubjects: 0,
          maxSubjects: 2,
        },
      ],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      [],
      ["A"],
      ["B"],
      ["A", "B"],
    ]);
  });

  it("estimates a fixed credit total when every subject is required", () => {
    expect(estimateCreditRangeFromPlan({
      requiredSubjects: [subject("A", 1, 3), subject("B", 1, 2)],
      choiceBags: [],
    })).toEqual({ minCredits: 5, maxCredits: 5 });
  });

  it("estimates min/max credits from choice-bag cardinality", () => {
    expect(estimateCreditRangeFromPlan({
      requiredSubjects: [subject("REQ", 1, 3)],
      choiceBags: [{
        id: "electives",
        title: "교양",
        minSubjects: 1,
        maxSubjects: 2,
        subjects: [subject("A", 1, 2), subject("B", 1, 3), subject("C", 1, 3)],
      }],
    })).toEqual({ minCredits: 5, maxCredits: 9 });
  });

  it("returns null when nothing is selected", () => {
    expect(estimateCreditRangeFromPlan({
      requiredSubjects: [],
      choiceBags: [],
    })).toBeNull();
  });

  it("keeps only subject combinations inside the requested credit range", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [subject("REQ", 1, 3)],
      choiceBags: [{
        id: "credit-options",
        title: "학점 선택",
        subjects: [subject("A", 1, 12), subject("B", 1, 15), subject("C", 1, 18)],
      }],
      creditRange: { minCredits: 15, maxCredits: 18 },
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([
      ["REQ", "A"],
      ["REQ", "B"],
    ]);
  });

  it("counts subject credits once even when several sections are enabled", () => {
    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [subject("A", 2, 3)],
      choiceBags: [],
      creditRange: { minCredits: 3, maxCredits: 3 },
    });

    expect(timetables).toHaveLength(2);
  });

  it("rejects an inverted credit range", () => {
    expect(() => enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [],
      creditRange: { minCredits: 18, maxCredits: 15 },
    })).toThrow("최소·최대 학점");
  });

  it("combines exact counts from several groups before expanding their sections", () => {
    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "one",
          title: "1번 그룹",
          subjects: [subject("A"), subject("B")],
          minSubjects: 1,
          maxSubjects: 1,
        },
        {
          id: "two",
          title: "2번 그룹",
          subjects: [subject("C"), subject("D")],
          minSubjects: 1,
          maxSubjects: 1,
        },
        {
          id: "three",
          title: "3번 그룹",
          subjects: [subject("E"), subject("F"), subject("G")],
          minSubjects: 2,
          maxSubjects: 2,
        },
      ],
    });

    expect(timetables).toHaveLength(12);
    expect(timetables.map(({ courses }) => courses.map(({ id }) => id))).toContainEqual([
      "A-1",
      "C-1",
      "E-1",
      "F-1",
    ]);
  });

  it("uses only the sections enabled by the user", () => {
    const selectedSection = subject("A", 2);
    selectedSection.sections = [selectedSection.sections[1]!];

    const timetables = generateTimetablesForSelectionPlan({
      requiredSubjects: [selectedSection],
      choiceBags: [],
    });

    expect(timetables.map(({ courses }) => courses[0]?.id)).toEqual(["A-2"]);
  });

  it("removes completed subjects unless the user explicitly re-enables them", () => {
    const selections = enumerateSubjectSelections({
      requiredSubjects: [],
      choiceBags: [
        {
          id: "retake",
          title: "수강 후보",
          subjects: [subject("DONE"), subject("NEW")],
        },
      ],
      excludedSubjectIds: ["DONE"],
    });

    expect(selections.map((items) => items.map(({ id }) => id))).toEqual([["NEW"]]);
  });

  it("rejects a subject duplicated across bags instead of silently losing combinations", () => {
    const duplicate = subject("SAME");
    expect(() =>
      enumerateSubjectSelections({
        requiredSubjects: [],
        choiceBags: [
          { id: "one", title: "책가방 1", subjects: [duplicate] },
          { id: "two", title: "책가방 2", subjects: [duplicate] },
        ],
      }),
    ).toThrow(SelectionPlanError);
  });

  it("prunes over-budget partial selections instead of letting later bags multiply them", () => {
    // Each bag offers 2 "light" (1 credit) and 2 "heavy" (20 credits) subjects, exactly one pick
    // per bag. The full unpruned cartesian product is 4×4×4=64, and even just the first two bags
    // alone (4×4=16) would already exceed a maxSelections of 15 before a single credit is ever
    // checked. Once a single heavy pick is chosen, the running total (20) already exceeds
    // maxCredits (3), so pruning must drop that branch immediately — before it reaches later bags
    // — for this call to succeed at all under such a tight safety limit.
    const bag = (id: string) => ({
      id,
      title: id,
      subjects: [
        subject(`${id}-light-1`, 1, 1),
        subject(`${id}-light-2`, 1, 1),
        subject(`${id}-heavy-1`, 1, 20),
        subject(`${id}-heavy-2`, 1, 20),
      ],
      minSubjects: 1,
      maxSubjects: 1,
    });

    const selections = enumerateSubjectSelections(
      {
        requiredSubjects: [],
        choiceBags: [bag("one"), bag("two"), bag("three")],
        creditRange: { minCredits: 0, maxCredits: 3 },
      },
      15,
    );

    expect(selections).toHaveLength(8);
    expect(
      selections.every((subjects) =>
        subjects.every((selected) => selected.id.includes("-light-")),
      ),
    ).toBe(true);
  });

  it("fails rather than returning an arbitrary subset when the safety limit is exceeded", () => {
    expect(() =>
      enumerateSubjectSelections(
        {
          requiredSubjects: [],
          choiceBags: [
            {
              id: "many",
              title: "많은 후보",
              subjects: [subject("A"), subject("B"), subject("C")],
            },
          ],
        },
        2,
      ),
    ).toThrow(SelectionPlanLimitError);
  });
});

describe("diagnoseEmptyTimetable", () => {
  it("returns null when the plan is empty", () => {
    expect(diagnoseEmptyTimetable({ requiredSubjects: [], choiceBags: [] })).toBeNull();
  });

  it("flags credit_range_unreachable when required subjects can't reach the minimum credits", () => {
    const diagnosis = diagnoseEmptyTimetable({
      requiredSubjects: [subject("A", 1, 3), subject("B", 1, 3)],
      choiceBags: [],
      creditRange: { minCredits: 12, maxCredits: 21 },
    });
    expect(diagnosis).toEqual({ reason: "credit_range_unreachable" });
  });

  it("flags no_available_sections when every section of a required subject is filtered out by day constraints", () => {
    const diagnosis = diagnoseEmptyTimetable(
      { requiredSubjects: [subjectAt("A", "월09:00-10:15")], choiceBags: [] },
      { unavailableDays: ["mon"] },
    );
    expect(diagnosis).toEqual({ reason: "no_available_sections", subjectTitle: "A" });
  });

  it("flags no_available_sections for a choice bag that can't meet its own minimum after filtering", () => {
    const diagnosis = diagnoseEmptyTimetable(
      {
        requiredSubjects: [],
        choiceBags: [
          {
            id: "bag",
            title: "선택 그룹",
            minSubjects: 1,
            subjects: [subjectAt("A", "월09:00-10:15")],
          },
        ],
      },
      { unavailableDays: ["mon"] },
    );
    expect(diagnosis).toEqual({ reason: "no_available_sections", subjectTitle: "선택 그룹" });
  });

  it("treats a fixed-event conflict on every section as no_available_sections too", () => {
    const diagnosis = diagnoseEmptyTimetable(
      { requiredSubjects: [subjectAt("A", "월09:00-10:15")], choiceBags: [] },
      {
        fixedEvents: [
          { id: "job", label: "알바", day: "mon", startMinutes: 480, endMinutes: 700 },
        ],
      },
    );
    expect(diagnosis).toEqual({ reason: "no_available_sections", subjectTitle: "A" });
  });

  it("flags schedule_conflict when required subjects only have sections that overlap each other", () => {
    const diagnosis = diagnoseEmptyTimetable({
      requiredSubjects: [subjectAt("A", "월09:00-10:15"), subjectAt("B", "월09:30-10:45")],
      choiceBags: [],
    });
    expect(diagnosis).toEqual({ reason: "schedule_conflict" });
  });

  it("checks credit range before schedule conflicts when both would independently explain an empty result", () => {
    const diagnosis = diagnoseEmptyTimetable(
      {
        requiredSubjects: [subjectAt("A", "월09:00-10:15", 3), subjectAt("B", "월09:30-10:45", 3)],
        choiceBags: [],
        creditRange: { minCredits: 12, maxCredits: 21 },
      },
      {},
    );
    expect(diagnosis).toEqual({ reason: "credit_range_unreachable" });
  });
});
