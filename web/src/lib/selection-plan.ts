import {
  CombinationLimitError,
  generateValidTimetables,
  meetingsConflict,
  parseSchedule,
  type CourseCandidate,
  type Timetable,
  type TimetableConstraints,
} from "./timetable";

export interface SubjectOption {
  /** Canonical subject id, normally the course number without a section suffix. */
  id: string;
  title: string;
  /** Credits are counted once per subject, independently of its section count. */
  credits: number;
  sections: CourseCandidate[];
}

export interface CreditRange {
  minCredits: number;
  maxCredits: number;
}

export interface ChoiceBag {
  id: string;
  title: string;
  subjects: SubjectOption[];
  /** Defaults to one: use zero for an optional bag. */
  minSubjects?: number;
  /** Defaults to one: increase it when several subjects may be chosen from this bag. */
  maxSubjects?: number;
}

export interface SelectionPlan {
  requiredSubjects: SubjectOption[];
  choiceBags: ChoiceBag[];
  excludedSubjectIds?: string[];
  creditRange?: CreditRange;
}

export interface SubjectAssignmentState {
  selectedIds: readonly string[];
  owners: Readonly<Record<string, string>>;
  enabledSectionIds: Readonly<Record<string, readonly string[]>>;
}

export interface SubjectAssignmentRemoval {
  selectedIds: string[];
  owners: Record<string, string>;
  enabledSectionIds: Record<string, string[]>;
  removedIds: string[];
}

export class SelectionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionPlanError";
  }
}

export class SelectionPlanLimitError extends Error {
  constructor(limit: number) {
    super(`과목 선택 경우의 수가 안전 한도 ${limit}개를 초과했습니다. 책가방 조건을 좁혀 주세요.`);
    this.name = "SelectionPlanLimitError";
  }
}

const DEFAULT_MAX_SELECTIONS = 10_000;
const DEFAULT_MAX_TIMETABLES = 500;

/** Selects one deterministic section when a subject is first added to the plan. */
export function getInitialSectionIds(
  sections: readonly Pick<CourseCandidate, "id">[],
): string[] {
  const firstSection = sections[0];
  return firstSection ? [firstSection.id] : [];
}

/** Enables every provided section id (used by “분반 전체 선택”). */
export function getAllSectionIds(
  sections: readonly Pick<CourseCandidate, "id">[],
): string[] {
  return sections.map((section) => section.id);
}

/** Toggles one allowed section while keeping at least one section enabled. */
export function toggleEnabledSectionId(
  currentSectionIds: readonly string[],
  sectionId: string,
): string[] {
  if (!currentSectionIds.includes(sectionId)) {
    return [...currentSectionIds, sectionId];
  }
  return currentSectionIds.length === 1
    ? [...currentSectionIds]
    : currentSectionIds.filter((id) => id !== sectionId);
}

/** Removes every selected subject owned by one deleted choice group. */
export function removeSubjectsOwnedBy(
  state: SubjectAssignmentState,
  ownerId: string,
): SubjectAssignmentRemoval {
  const removedIds = Object.entries(state.owners).flatMap(([subjectId, owner]) =>
    owner === ownerId ? [subjectId] : [],
  );
  const removedIdSet = new Set(removedIds);
  return {
    selectedIds: state.selectedIds.filter((id) => !removedIdSet.has(id)),
    owners: Object.fromEntries(
      Object.entries(state.owners).filter(([subjectId]) => !removedIdSet.has(subjectId)),
    ),
    enabledSectionIds: Object.fromEntries(
      Object.entries(state.enabledSectionIds)
        .filter(([subjectId]) => !removedIdSet.has(subjectId))
        .map(([subjectId, sectionIds]) => [subjectId, [...sectionIds]]),
    ),
    removedIds,
  };
}

/**
 * Estimates the credit total range implied by required subjects and choice-bag cardinalities.
 * Used to prefill the planner credit filter from the 3-A selection (not a hard plan validator).
 */
export function estimateCreditRangeFromPlan(
  plan: Pick<SelectionPlan, "requiredSubjects" | "choiceBags" | "excludedSubjectIds">,
): CreditRange | null {
  const excludedIds = new Set(plan.excludedSubjectIds ?? []);
  const requiredSubjects = plan.requiredSubjects.filter((subject) => !excludedIds.has(subject.id));
  const choiceBags = plan.choiceBags
    .map((bag) => ({
      ...bag,
      subjects: bag.subjects.filter((subject) => !excludedIds.has(subject.id)),
    }))
    .filter((bag) => bag.subjects.length > 0);

  if (requiredSubjects.length === 0 && choiceBags.length === 0) {
    return null;
  }

  let minCredits = requiredSubjects.reduce((total, subject) => total + subject.credits, 0);
  let maxCredits = minCredits;

  for (const bag of choiceBags) {
    const credits = bag.subjects.map((subject) => subject.credits).sort((a, b) => a - b);
    const minSubjects = Math.max(0, bag.minSubjects ?? 1);
    const maxSubjects = Math.max(0, bag.maxSubjects ?? 1);
    const takeMin = Math.min(minSubjects, credits.length);
    const takeMax = Math.min(maxSubjects, credits.length);
    minCredits += credits.slice(0, takeMin).reduce((total, value) => total + value, 0);
    maxCredits += credits.slice(credits.length - takeMax).reduce((total, value) => total + value, 0);
  }

  return { minCredits, maxCredits };
}

export type EmptyTimetableReason =
  | "credit_range_unreachable"
  | "no_available_sections"
  | "schedule_conflict";

export interface EmptyTimetableDiagnosis {
  reason: EmptyTimetableReason;
  /** Set only for no_available_sections: which subject/bag has zero usable sections left. */
  subjectTitle?: string;
}

/**
 * Best-effort deterministic explanation for why generateTimetablesForSelectionPlan returned zero
 * timetables even though the plan itself is valid (no thrown error) — checked in the order a
 * student would naturally rule them out: is the credit range even reachable, does every
 * required subject (and each bag, against its own minimum) still have at least one section left
 * once day/time filters and fixed events are applied, and only then genuine schedule conflicts
 * between the remaining candidates. Deliberately rule-based, not inferred by a model, so the same
 * plan always gets the same answer. Returns null when there is nothing to explain.
 */
export function diagnoseEmptyTimetable(
  plan: SelectionPlan,
  constraints: TimetableConstraints = {},
): EmptyTimetableDiagnosis | null {
  const excludedIds = new Set(plan.excludedSubjectIds ?? []);
  const requiredSubjects = plan.requiredSubjects.filter((subject) => !excludedIds.has(subject.id));
  const choiceBags = plan.choiceBags
    .map((bag) => ({
      ...bag,
      subjects: bag.subjects.filter((subject) => !excludedIds.has(subject.id)),
    }))
    .filter((bag) => bag.subjects.length > 0);

  if (requiredSubjects.length === 0 && choiceBags.length === 0) {
    return null;
  }

  if (plan.creditRange) {
    const achievable = estimateCreditRangeFromPlan({
      requiredSubjects,
      choiceBags,
    });
    if (
      achievable &&
      (achievable.maxCredits < plan.creditRange.minCredits ||
        achievable.minCredits > plan.creditRange.maxCredits)
    ) {
      return { reason: "credit_range_unreachable" };
    }
  }

  const unavailableDays = new Set(constraints.unavailableDays ?? []);
  const earliestStartMinutes = constraints.earliestStartMinutes;
  const fixedEvents = constraints.fixedEvents ?? [];
  const hasViableSection = (subject: SubjectOption): boolean =>
    subject.sections.some((section) => {
      const meetings = parseSchedule(section.schedule);
      return meetings.every(
        (meeting) =>
          !unavailableDays.has(meeting.day) &&
          (earliestStartMinutes === undefined || meeting.startMinutes >= earliestStartMinutes) &&
          !fixedEvents.some((fixed) => meetingsConflict(meeting, fixed)),
      );
    });

  for (const subject of requiredSubjects) {
    if (!hasViableSection(subject)) {
      return { reason: "no_available_sections", subjectTitle: subject.title };
    }
  }
  for (const bag of choiceBags) {
    const minSubjects = bag.minSubjects ?? 1;
    const viableCount = bag.subjects.filter(hasViableSection).length;
    if (viableCount < minSubjects) {
      return { reason: "no_available_sections", subjectTitle: bag.title };
    }
  }

  return { reason: "schedule_conflict" };
}

/**
 * Enumerates every subject set allowed by required subjects and bag cardinalities.
 *
 * This layer never asks an LLM to invent combinations. Each returned subject still owns all of
 * its sections, so the timetable layer can deterministically choose exactly one section later.
 */
export function enumerateSubjectSelections(
  plan: SelectionPlan,
  maxSelections = DEFAULT_MAX_SELECTIONS,
): SubjectOption[][] {
  if (!Number.isInteger(maxSelections) || maxSelections < 1) {
    throw new RangeError("maxSelections는 1 이상의 정수여야 합니다.");
  }

  const excludedIds = new Set(plan.excludedSubjectIds ?? []);
  validatePlan(plan, excludedIds);

  // Branch-and-bound on the running credit total: validatePlan already rejected non-negative
  // credits and an inverted range, so a selection's credit total only ever grows as more bags
  // are folded in. Once a partial selection already exceeds maxCredits, no combination of
  // remaining bags can bring it back into range, so it is dropped here instead of being carried
  // forward to multiply against every later bag's choices — this is what was blowing past the
  // 10,000-combination safety limit for generous choice bags, without changing which
  // combinations end up in the final result (still exactly the ones inside creditRange).
  const maxCredits = plan.creditRange?.maxCredits;

  let selections: SubjectOption[][] = [plan.requiredSubjects];
  let selectionCredits: number[] = [sumCredits(plan.requiredSubjects)];

  for (const bag of plan.choiceBags) {
    const availableSubjects = bag.subjects.filter((subject) => !excludedIds.has(subject.id));
    const minSubjects = bag.minSubjects ?? 1;
    const maxSubjects = bag.maxSubjects ?? 1;
    if (availableSubjects.length < minSubjects) {
      return [];
    }

    const bagSelections: SubjectOption[][] = [];
    for (let count = minSubjects; count <= Math.min(maxSubjects, availableSubjects.length); count += 1) {
      bagSelections.push(...combinations(availableSubjects, count));
    }
    const bagSelectionCredits = bagSelections.map(sumCredits);

    const nextSelections: SubjectOption[][] = [];
    const nextSelectionCredits: number[] = [];
    selections.forEach((selected, selectedIndex) => {
      const baseCredits = selectionCredits[selectedIndex] ?? 0;
      bagSelections.forEach((bagSelection, bagIndex) => {
        const credits = baseCredits + (bagSelectionCredits[bagIndex] ?? 0);
        if (maxCredits !== undefined && credits > maxCredits) {
          return;
        }
        if (nextSelections.length === maxSelections) {
          throw new SelectionPlanLimitError(maxSelections);
        }
        nextSelections.push([...selected, ...bagSelection]);
        nextSelectionCredits.push(credits);
      });
    });
    selections = nextSelections;
    selectionCredits = nextSelectionCredits;
  }

  const creditRange = plan.creditRange;
  if (!creditRange) {
    return selections;
  }
  // maxCredits was already enforced during pruning above; only minCredits remains to check.
  return selections.filter(
    (_subjects, index) => (selectionCredits[index] ?? 0) >= creditRange.minCredits,
  );
}

function sumCredits(subjects: readonly SubjectOption[]): number {
  return subjects.reduce((total, subject) => total + subject.credits, 0);
}

/**
 * Expands subject-group choices first, then chooses exactly one enabled section per subject.
 * A single global limit guards the complete result instead of truncating each group independently.
 */
export function generateTimetablesForSelectionPlan(
  plan: SelectionPlan,
  constraints: TimetableConstraints = {},
  maxTimetables = DEFAULT_MAX_TIMETABLES,
): Timetable[] {
  if (!Number.isInteger(maxTimetables) || maxTimetables < 1) {
    throw new RangeError("maxTimetables는 1 이상의 정수여야 합니다.");
  }

  const subjectSelections = enumerateSubjectSelections(plan);
  const timetables: Timetable[] = [];
  for (const subjects of subjectSelections) {
    let subjectTimetables: Timetable[];
    try {
      subjectTimetables = generateValidTimetables(
        subjects.map(({ sections }) => sections),
        constraints,
        maxTimetables,
      );
    } catch (error) {
      if (error instanceof CombinationLimitError) {
        throw new CombinationLimitError(maxTimetables);
      }
      throw error;
    }

    for (const timetable of subjectTimetables) {
      if (timetables.length === maxTimetables) {
        throw new CombinationLimitError(maxTimetables);
      }
      timetables.push(timetable);
    }
  }
  return timetables;
}

function validatePlan(plan: SelectionPlan, excludedIds: ReadonlySet<string>): void {
  if (
    plan.creditRange &&
    (
      !Number.isFinite(plan.creditRange.minCredits) ||
      !Number.isFinite(plan.creditRange.maxCredits) ||
      plan.creditRange.minCredits < 0 ||
      plan.creditRange.minCredits > plan.creditRange.maxCredits
    )
  ) {
    throw new SelectionPlanError("원하는 최소·최대 학점 범위를 확인해 주세요.");
  }

  const subjectOwners = new Map<string, string>();
  const sectionIds = new Set<string>();

  for (const subject of plan.requiredSubjects) {
    if (excludedIds.has(subject.id)) {
      throw new SelectionPlanError(`필수과목 ${subject.title}은 제외 과목일 수 없습니다.`);
    }
    validateSubject(subject, "필수과목", subjectOwners, sectionIds);
  }

  const bagIds = new Set<string>();
  for (const bag of plan.choiceBags) {
    if (!bag.id || bagIds.has(bag.id)) {
      throw new SelectionPlanError("책가방 id는 비어 있지 않고 서로 달라야 합니다.");
    }
    bagIds.add(bag.id);

    const minSubjects = bag.minSubjects ?? 1;
    const maxSubjects = bag.maxSubjects ?? 1;
    if (
      !Number.isInteger(minSubjects) ||
      !Number.isInteger(maxSubjects) ||
      minSubjects < 0 ||
      minSubjects > maxSubjects ||
      maxSubjects > bag.subjects.length
    ) {
      throw new SelectionPlanError(`${bag.title}의 최소·최대 포함 과목 수가 올바르지 않습니다.`);
    }

    for (const subject of bag.subjects) {
      validateSubject(subject, bag.title, subjectOwners, sectionIds);
    }
  }
}

function validateSubject(
  subject: SubjectOption,
  owner: string,
  subjectOwners: Map<string, string>,
  sectionIds: Set<string>,
): void {
  if (!subject.id || subject.sections.length === 0) {
    throw new SelectionPlanError(`${owner}의 과목은 id와 한 개 이상의 분반이 필요합니다.`);
  }
  if (!Number.isFinite(subject.credits) || subject.credits < 0) {
    throw new SelectionPlanError(`${subject.title}의 학점 정보를 확인해 주세요.`);
  }
  const existingOwner = subjectOwners.get(subject.id);
  if (existingOwner) {
    throw new SelectionPlanError(
      `${subject.title}이 ${existingOwner}과 ${owner}에 중복으로 들어 있습니다. 한 곳에만 배치해 주세요.`,
    );
  }
  subjectOwners.set(subject.id, owner);

  for (const section of subject.sections) {
    if (!section.id || sectionIds.has(section.id)) {
      throw new SelectionPlanError(`${subject.title}의 분반 id는 비어 있지 않고 전체에서 고유해야 합니다.`);
    }
    sectionIds.add(section.id);
  }
}

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) {
    return [[]];
  }

  const results: T[][] = [];
  function visit(startIndex: number, selected: T[]): void {
    if (selected.length === count) {
      results.push(selected);
      return;
    }
    const remaining = count - selected.length;
    for (let index = startIndex; index <= values.length - remaining; index += 1) {
      const value = values[index];
      if (value !== undefined) {
        visit(index + 1, [...selected, value]);
      }
    }
  }
  visit(0, []);
  return results;
}
