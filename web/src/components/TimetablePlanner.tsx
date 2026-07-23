"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { Requirement } from "@/lib/academic-profile";
import { areaMatchesUnmetLabels, selectAiFillerSubjects } from "@/lib/ai-filler-selection";
import { markSessionCompleted, track } from "@/lib/analytics";
import {
  buildCoursePlanQueryKey,
  type StoredCoursePlan,
} from "@/lib/browser-planning-storage";
import {
  courseGroupsFromCollection,
  dedupeCandidatesBySchedule,
  shouldShowSectionDetails,
  type CourseCandidateGroup,
} from "@/lib/course-candidates";
import { findSkkuDepartment, type SkkuDepartment } from "@/lib/skku-departments";
import {
  SKKU_ELECTIVE_AREA_DEFINITIONS,
  type SkkuCampus,
  type SkkuCourseQuery,
  type SkkuElectiveArea,
  type SkkuElectiveAreaCode,
  type SkkuElectiveCampus,
  type SkkuElectiveSubject,
} from "@/lib/skku-course-api";
import {
  diagnoseEmptyTimetable,
  estimateCreditRangeFromPlan,
  generateTimetablesForSelectionPlan,
  getAllSectionIds,
  getInitialSectionIds,
  removeSubjectsOwnedBy,
  SelectionPlanError,
  SelectionPlanLimitError,
  toggleEnabledSectionId,
  type ChoiceBag,
  type EmptyTimetableDiagnosis,
  type SubjectOption,
} from "@/lib/selection-plan";
import {
  CombinationLimitError,
  meetingsConflict,
  parseSchedule,
  type CourseCandidate,
  type FixedEvent,
  type Meeting,
  type Timetable,
  type Weekday,
} from "@/lib/timetable";
import {
  DEFAULT_LUNCH_WINDOW_END_MINUTES,
  DEFAULT_LUNCH_WINDOW_START_MINUTES,
  DEFAULT_RECOMMENDATION_WEIGHTS,
  getTimetableCandidateId,
  type RecommendationWeight,
  type ScoreBreakdown,
  type WeightId,
  type WeightImportance,
} from "@/lib/timetable-scoring";

import { DepartmentAddCombobox } from "./DepartmentAddCombobox";
import { EverytimeReviewButton } from "./EverytimeReviewButton";
import { CourseReviewNoteButton } from "./CourseReviewNoteButton";
import { DAYS, formatCredits, formatMinutes, TimetableCard, type TimetableExtra } from "./TimetableCard";
import styles from "./TimetablePlanner.module.css";

interface Props {
  query: SkkuCourseQuery | null;
  queryLabel: string;
  excludedCourseNumbers: readonly string[];
  requirements: readonly Requirement[];
  roadmapProgramCodes: string[];
  /** Browser-only saved selections for this department/year/term. */
  savedCoursePlan?: StoredCoursePlan | null;
  /** Writes only to the user's browser; never sent to the service. */
  onCoursePlanChange?: (plan: StoredCoursePlan) => void;
  /** UI-only: which planner pane to show in the step wizard. */
  view?: "select" | "results" | "ai-setup" | "ai-results";
  /** Increment from the wizard nav to trigger AI recommendation (replaces in-panel button). */
  aiRecommendRequestId?: number;
  /** Fires when AI recommendation availability changes (for wizard next-button gating). */
  onRecommendationsAvailabilityChange?: (hasRecommendations: boolean) => void;
  /** Fires after a successful AI recommendation run so the wizard can advance to results. */
  onRecommendationsReady?: () => void;
  /** Lets the wizard nav mirror the old in-panel AI recommend button state. */
  onAiRecommendActionStateChange?: (state: {
    canRun: boolean;
    isRunning: boolean;
    emptyReason: { title: string; detail: string } | null;
  }) => void;
}

const WEIGHT_LABELS: Record<WeightId, string> = {
  free_days: "공강 요일 만들기",
  back_to_back: "연강 선호/기피",
  lunch_break: "점심시간 확보",
  avoid_9am: "오전 9시 수업 회피",
  day_packing: "하루에 몰아듣기 / 여러날 나눠듣기",
  course_format: "대면/온라인 수업 선호",
};

interface TimetableRecommendationItem {
  candidateId: string;
  rank: number;
  timetable: Timetable;
  scoreBreakdown: ScoreBreakdown[];
  reason: string | null;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

/** Mirrors real transitions inside fetchAiRecommendations (not a timer) — stage 0 covers local
 * candidate-generation work, stage 1 covers the /api/timetable-recommendations Solar call. */
const RECOMMENDATION_STAGES = [
  "조건에 맞는 시간표 후보를 추리는 중…",
  "Solar가 추천 이유를 작성하는 중…",
] as const;

/**
 * Stage 1 (the Solar call) is the real bottleneck and has no sub-progress to report, so a single
 * static label sitting there for several seconds reads as stuck. This rotates a few lightly
 * on-brand quips on a timer while stage 1 is in flight — atmosphere, not a progress claim, same
 * spirit as AcademicDocumentManager's long-wait flavors.
 */
const RECOMMENDATION_STAGE1_FLAVORS = [
  "Solar가 후보를 하나씩 읽어보는 중…",
  "졸업요건과 견주어 보는 중…",
  "그럴듯한 이유를 다듬는 중…",
  "거의 다 됐어요, 조금만 더…",
] as const;
const RECOMMENDATION_STAGE1_FLAVOR_INTERVAL_MS = 2600;
const DEFAULT_RECOMMENDATION_AVERAGE_SECONDS = 20;
const MAX_RECOMMENDATION_DURATION_SAMPLES = 5;

type CourseSource = "major" | "elective";

interface PlannerCourseGroup extends CourseCandidateGroup {
  selectionId: string;
  source: CourseSource;
  campus?: SkkuElectiveCampus;
  programCodes?: string[];
}

interface ProgramCourseCandidateGroup extends CourseCandidateGroup {
  programCodes: string[];
}

interface ElectiveCatalog {
  areas: SkkuElectiveArea[];
  subjects: SkkuElectiveSubject[];
}

interface ChoiceGroupConfig {
  id: string;
  title: string;
  minSubjects: number;
  maxSubjects: number;
}

type CourseDestination = "required" | string;

const INITIAL_CHOICE_GROUPS: ChoiceGroupConfig[] = [
  { id: "choice-1", title: "선택 묶음 1", minSubjects: 1, maxSubjects: 1 },
];

const CAMPUS_OPTIONS: ReadonlyArray<{
  value: SkkuElectiveCampus;
  label: string;
  shortLabel: string;
}> = [
  { value: 1, label: "인문사회과학캠퍼스", shortLabel: "인사캠" },
  { value: 2, label: "자연과학캠퍼스", shortLabel: "자과캠" },
  { value: 3, label: "I-CAMPUS", shortLabel: "I-CAMPUS" },
];

/** 전공과목은 학생의 주 캠퍼스와 무관하게 두 캠퍼스에 개설된 분반을 모두 조회한다. */
const MAJOR_COURSE_CAMPUSES: readonly SkkuCampus[] = [1, 2];

const ELECTIVE_PREVIEW_CONCURRENCY = 3;

function createElectivePreviewLanes(): Promise<void>[] {
  return Array.from({ length: ELECTIVE_PREVIEW_CONCURRENCY }, () => Promise.resolve());
}

/** True only for a well-formed, non-empty course collection — see the 복수전공 loadCourses note. */
function hasAnyCourses(collection: unknown): boolean {
  return (
    typeof collection === "object" &&
    collection !== null &&
    Array.isArray((collection as { courses?: unknown }).courses) &&
    (collection as { courses: unknown[] }).courses.length > 0
  );
}

/**
 * Combines two program-course-group lists, merging by course number (group.id) and unioning each
 * group's programCodes/candidates. Shared by the initial multi-department load and by adding one
 * more department mid-session (loadExtraDepartment) without disturbing anything else in Step 3.
 */
function mergeProgramCourseGroups(
  existing: readonly ProgramCourseCandidateGroup[],
  incoming: readonly ProgramCourseCandidateGroup[],
): ProgramCourseCandidateGroup[] {
  const merged = new Map<string, ProgramCourseCandidateGroup>(
    existing.map((group) => [group.id, group]),
  );
  for (const group of incoming) {
    const current = merged.get(group.id);
    if (!current) {
      merged.set(group.id, group);
      continue;
    }
    merged.set(group.id, {
      ...current,
      programCodes: [...new Set([...current.programCodes, ...group.programCodes])],
      candidates: [
        ...new Map(
          [...current.candidates, ...group.candidates].map((candidate) => [candidate.id, candidate]),
        ).values(),
      ],
    });
  }
  return [...merged.values()];
}

/** How many extra elective subjects the AI recommendation step may consider/add as filler. */
const MAX_FILLER_SHORTLIST = 8;
const MAX_FILLER_SUBJECTS = 5;
// Nothing in this component ever populates this — kept as a stable empty-array reference (not a
// literal inside the component body) purely so the useMemo hooks that depend on it don't recompute
// on every render just because `[]` is a new array identity each time.
const NO_UNAVAILABLE_DAYS: Weekday[] = [];
const AI_FILLER_BAG_ID = "ai-filler";
const AI_FILLER_GROUP_TITLE = "AI 추천 보충 교양";

export function TimetablePlanner({
  query,
  queryLabel,
  excludedCourseNumbers,
  requirements,
  roadmapProgramCodes,
  savedCoursePlan,
  onCoursePlanChange,
  view = "select",
  aiRecommendRequestId = 0,
  onRecommendationsAvailabilityChange,
  onRecommendationsReady,
  onAiRecommendActionStateChange,
}: Props) {
  const showSelect = view === "select";
  const showResults = view === "results";
  const showAiSetup = view === "ai-setup";
  const showAiResults = view === "ai-results";
  const [majorCourseGroups, setMajorCourseGroups] = useState<ProgramCourseCandidateGroup[]>([]);
  const [electiveCourseGroups, setElectiveCourseGroups] = useState<PlannerCourseGroup[]>([]);
  const [electivePreviewGroups, setElectivePreviewGroups] = useState<
    Record<string, PlannerCourseGroup>
  >({});
  const [electiveCatalogs, setElectiveCatalogs] = useState<Record<string, ElectiveCatalog>>({});
  const [electiveCampus, setElectiveCampus] = useState<SkkuElectiveCampus>(1);
  const [selectedElectiveArea, setSelectedElectiveArea] = useState<
    SkkuElectiveAreaCode | "all"
  >("all");
  const [courseSource, setCourseSource] = useState<CourseSource>("major");
  const [selectedMajorProgramCode, setSelectedMajorProgramCode] = useState<string>("all");
  // Departments added ad hoc while browsing Step 3, on top of roadmapProgramCodes from Step 1 —
  // lets a student pull in another major's courses without going back to change their profile.
  const [extraProgramCodes, setExtraProgramCodes] = useState<string[]>([]);
  const [loadingExtraDepartmentCodes, setLoadingExtraDepartmentCodes] = useState<string[]>([]);
  const [extraDepartmentError, setExtraDepartmentError] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [choiceGroups, setChoiceGroups] = useState<ChoiceGroupConfig[]>(INITIAL_CHOICE_GROUPS);
  const [activeDestination, setActiveDestination] = useState<CourseDestination>("required");
  const [courseOwners, setCourseOwners] = useState<Record<string, CourseDestination>>({});
  const [enabledSectionIds, setEnabledSectionIds] = useState<Record<string, string[]>>({});
  const [scheduleConflicts, setScheduleConflicts] = useState<ScheduleConflictPair[] | null>(null);
  const unavailableDays = NO_UNAVAILABLE_DAYS;
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>([]);
  const [newEventLabel, setNewEventLabel] = useState("");
  const [newEventDay, setNewEventDay] = useState<Weekday>("mon");
  const [newEventStart, setNewEventStart] = useState("18:00");
  const [newEventEnd, setNewEventEnd] = useState("20:00");
  const [fixedEventError, setFixedEventError] = useState("");
  const minimumCredits: string = "12";
  const maximumCredits: string = "21";
  const [disabledCourseTypes, setDisabledCourseTypes] = useState<Set<string>>(new Set());
  const [dayOffFilters, setDayOffFilters] = useState<Weekday[]>([]);
  const [courseSearch, setCourseSearch] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [electiveError, setElectiveError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCoursePlanReady, setIsCoursePlanReady] = useState(false);
  const [isElectiveLoading, setIsElectiveLoading] = useState(false);
  const [loadingCourseNumbers, setLoadingCourseNumbers] = useState<string[]>([]);
  const [previewLoadingIds, setPreviewLoadingIds] = useState<string[]>([]);
  const electivePreviewRequestIds = useRef(new Set<string>());
  const electivePreviewLanes = useRef<Promise<void>[]>(createElectivePreviewLanes());
  const electivePreviewLaneCursor = useRef(0);
  const electivePreviewGeneration = useRef(0);
  const electivePrefetchAttempted = useRef(new Set<string>());
  // 선택 묶음을 새로 추가할 때마다 번호를 늘려가며 고유 id를 만든다.
  const nextChoiceGroupId = useRef(2);
  const savedPlanForQuery = useMemo(
    () =>
      query && savedCoursePlan?.queryKey === buildCoursePlanQueryKey(query)
        ? savedCoursePlan
        : null,
    [query, savedCoursePlan],
  );

  useEffect(() => {
    if (!query) {
      return;
    }
    const activeQuery = query;
    electivePreviewGeneration.current += 1;
    electivePreviewRequestIds.current.clear();
    electivePreviewLanes.current = createElectivePreviewLanes();
    electivePreviewLaneCursor.current = 0;
    const controller = new AbortController();
    async function loadCourses(): Promise<void> {
      setIsLoading(true);
      setIsCoursePlanReady(false);
      setCollectionError("");
      setElectiveError("");
      setMajorCourseGroups([]);
      setElectiveCourseGroups(
        savedPlanForQuery?.selectedGroups.filter(({ source }) => source === "elective") ?? [],
      );
      setElectivePreviewGroups({});
      setElectiveCatalogs({});
      setElectiveCampus(activeQuery.campus);
      setSelectedElectiveArea("all");
      setCourseSource("major");
      // 원전공(기본 정보 입력에서 고른 주전공, roadmapProgramCodes의 첫 번째 코드)을 기본 선택
      // 상태로 시작한다 — "전체"부터 보여주면 복수전공 과목까지 한꺼번에 섞여서 헷갈리기 쉽다.
      setSelectedMajorProgramCode(roadmapProgramCodes[0] ?? activeQuery.departmentCode);
      setExtraProgramCodes(savedPlanForQuery?.extraProgramCodes ?? []);
      setExtraDepartmentError("");
      setSelectedGroupIds(savedPlanForQuery?.selectedGroups.map(({ selectionId }) => selectionId) ?? []);
      const restoredChoiceGroups = savedPlanForQuery?.choiceGroups.length
        ? savedPlanForQuery.choiceGroups
        : INITIAL_CHOICE_GROUPS;
      setChoiceGroups(restoredChoiceGroups);
      nextChoiceGroupId.current = getNextChoiceGroupNumber(restoredChoiceGroups);
      setActiveDestination(
        savedPlanForQuery &&
          (savedPlanForQuery.activeDestination === "required" ||
            restoredChoiceGroups.some(({ id }) => id === savedPlanForQuery.activeDestination))
          ? savedPlanForQuery.activeDestination
          : "required",
      );
      setCourseOwners(savedPlanForQuery?.courseOwners ?? {});
      setEnabledSectionIds(savedPlanForQuery?.enabledSectionIds ?? {});
      setFixedEvents(savedPlanForQuery?.fixedEvents ?? []);
      setPreviewLoadingIds([]);
      setDisabledCourseTypes(new Set());
      setDayOffFilters([]);
      try {
        const programCodes = roadmapProgramCodes.length
          ? roadmapProgramCodes
          : [activeQuery.departmentCode];
        // 전공과목은 학생의 주 캠퍼스와 무관하게 그 학과에 개설된 모든 분반을 보여준다(교양은
        // 별도 캠퍼스 선택을 그대로 따름) — 같은 학과라도 캠퍼스마다 다른 분반이 개설되는 경우가
        // 흔해서(예: 경영학과가 인문사회캠퍼스에 108개, 자연과학캠퍼스에 1개), 주 캠퍼스만
        // 조회하면 다른 캠퍼스 분반이 통째로 안 보이게 된다.
        const majorRequests = programCodes.flatMap((departmentCode) =>
          MAJOR_COURSE_CAMPUSES.map(async (campus) => ({
            departmentCode,
            result: await postJson(
              "/api/skku-courses",
              { ...activeQuery, campus, departmentCode },
              controller.signal,
            ),
          })),
        );
        // allSettled, not all: doubling requests to two campuses per department doubles exposure
        // to a single transient SKKU failure, and one rejected request must not wipe out every
        // OTHER department/campus that succeeded — only surface an error if literally none did.
        const majorSettlements = await Promise.allSettled(majorRequests);
        const majorResults = majorSettlements.flatMap((settlement) =>
          settlement.status === "fulfilled" ? [settlement.value] : [],
        );
        if (majorResults.length === 0 && majorSettlements.length > 0) {
          const firstFailure = majorSettlements.find(
            (settlement): settlement is PromiseRejectedResult => settlement.status === "rejected",
          );
          throw firstFailure?.reason ?? new Error("개설강좌를 불러오지 못했습니다.");
        }
        // A department with zero open sections this term/campus is a normal outcome (e.g. a
        // department that only opens sections on the other campus, or a niche 연계전공/융합트랙),
        // not a failure — courseGroupsFromCollection throws on an empty collection, which would
        // otherwise abort every OTHER selected major's courses too since they're all merged here.
        const groups = majorResults.flatMap(({ departmentCode, result }) =>
          hasAnyCourses(result)
            ? courseGroupsFromCollection(result).map((group) => ({
                ...group,
                programCodes: [departmentCode],
              }))
            : [],
        );
        setMajorCourseGroups(mergeProgramCourseGroups([], groups));
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setCollectionError(readThrownMessage(error));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsCoursePlanReady(true);
        }
      }
    }
    void loadCourses();
    return () => controller.abort();
  }, [query, roadmapProgramCodes, savedPlanForQuery]);

  /**
   * Adds one more department's courses to the Step-3 catalog without resetting anything else the
   * student has already picked — unlike loadCourses above, which is a full reset keyed on
   * [query, roadmapProgramCodes]. Lets someone browse a major they never selected in Step 1.
   */
  async function loadExtraDepartment(department: SkkuDepartment): Promise<void> {
    if (!query || extraProgramCodes.includes(department.code)) {
      return;
    }
    const activeQuery = query;
    setExtraProgramCodes((codes) => [...codes, department.code]);
    setLoadingExtraDepartmentCodes((codes) => [...codes, department.code]);
    setExtraDepartmentError("");
    try {
      const settlements = await Promise.allSettled(
        MAJOR_COURSE_CAMPUSES.map((campus) =>
          postJson("/api/skku-courses", { ...activeQuery, campus, departmentCode: department.code }),
        ),
      );
      const results = settlements.flatMap((settlement) =>
        settlement.status === "fulfilled" ? [settlement.value] : [],
      );
      if (results.length === 0) {
        const firstFailure = settlements.find(
          (settlement): settlement is PromiseRejectedResult => settlement.status === "rejected",
        );
        throw firstFailure?.reason ?? new Error("개설강좌를 불러오지 못했습니다.");
      }
      const groups = results.flatMap((result) =>
        hasAnyCourses(result)
          ? courseGroupsFromCollection(result).map((group) => ({
              ...group,
              programCodes: [department.code],
            }))
          : [],
      );
      setMajorCourseGroups((current) => mergeProgramCourseGroups(current, groups));
      setSelectedMajorProgramCode(department.code);
    } catch (error) {
      setExtraDepartmentError(
        `${department.name} 과목을 불러오지 못했습니다. ${readThrownMessage(error)}`,
      );
      setExtraProgramCodes((codes) => codes.filter((code) => code !== department.code));
    } finally {
      setLoadingExtraDepartmentCodes((codes) => codes.filter((code) => code !== department.code));
    }
  }

  /** Stops browsing a manually-added department; courses already added to the plan stay put. */
  function removeExtraDepartment(code: string): void {
    setExtraProgramCodes((codes) => codes.filter((value) => value !== code));
    setMajorCourseGroups((groups) =>
      groups
        .map((group) => ({
          ...group,
          programCodes: group.programCodes.filter((value) => value !== code),
        }))
        .filter((group) => group.programCodes.length > 0),
    );
    setSelectedMajorProgramCode((current) => (current === code ? "all" : current));
  }

  /**
   * The elective catalog fetch is slow on a cold cache (session login + up to 14 sequential
   * SKKU requests, ~10s) — see cache-store.ts. Firing it silently in the background as soon as
   * the department/year query is known, instead of waiting for the user to click the "교양"
   * tab, means the server-side TTL cache is usually already warm by the time they do, so the
   * on-demand fetch in loadAllElectives resolves instantly. Errors are swallowed here on purpose:
   * this is a best-effort head start, not a user-facing action, and loadAllElectives still runs
   * (and shows a visible error) whenever the user actually opens the tab.
   */
  useEffect(() => {
    if (!query) {
      return;
    }
    const activeQuery = query;
    CAMPUS_OPTIONS.forEach(({ value: campus }) => {
      const catalogKey = getElectiveCatalogKey(activeQuery, campus);
      if (electivePrefetchAttempted.current.has(catalogKey)) {
        return;
      }
      electivePrefetchAttempted.current.add(catalogKey);
      void (async () => {
        try {
          const payload = await postJson("/api/skku-electives", {
            year: activeQuery.year,
            term: activeQuery.term,
            campus,
            mode: "all_subjects",
          });
          const catalog = readElectiveCatalog(payload);
          setElectiveCatalogs((catalogs) =>
            catalogs[catalogKey] ? catalogs : { ...catalogs, [catalogKey]: catalog },
          );
        } catch {
          // Best-effort prefetch; loadAllElectives retries on demand and surfaces errors there.
        }
      })();
    });
  }, [query]);

  function selectCourseGroup(
    group: PlannerCourseGroup,
    destination = activeDestination,
    initialSectionIds = getInitialSectionIds(group.candidates),
  ): void {
    setSelectedGroupIds((ids) => [...new Set([...ids, group.selectionId])]);
    setCourseOwners((owners) => ({ ...owners, [group.selectionId]: destination }));
    setEnabledSectionIds((sections) => ({
      ...sections,
      [group.selectionId]: initialSectionIds,
    }));
  }

  function clearSelectedCourse(selectionId: string): void {
    setSelectedGroupIds((ids) => ids.filter((id) => id !== selectionId));
    setCourseOwners((owners) => {
      const next = { ...owners };
      delete next[selectionId];
      return next;
    });
    setEnabledSectionIds((sections) => {
      const next = { ...sections };
      delete next[selectionId];
      return next;
    });
  }

  function removeSelectedCourse(group: PlannerCourseGroup): void {
    clearSelectedCourse(group.selectionId);
    if (group.source === "elective") {
      setElectiveCourseGroups((groups) =>
        groups.filter(({ selectionId }) => selectionId !== group.selectionId),
      );
    }
  }

  /**
   * A course can only belong to one destination at a time. The catalog checkbox reflects
   * membership in the *currently active* destination, not "selected anywhere" — otherwise a
   * course assigned to 필수 still looks checked while browsing 선택 그룹 1, even though it isn't
   * actually in that group.
   */
  function isAssignedToActiveDestination(selectionId: string): boolean {
    return (
      selectedGroupIds.includes(selectionId) &&
      (courseOwners[selectionId] ?? "required") === activeDestination
    );
  }

  function addChoiceGroup(): void {
    const number = nextChoiceGroupId.current;
    nextChoiceGroupId.current += 1;
    const group = {
      id: `choice-${number}`,
      title: `선택 묶음 ${number}`,
      minSubjects: 1,
      maxSubjects: 1,
    };
    setChoiceGroups((groups) => [...groups, group]);
    setActiveDestination(group.id);
  }

  function removeChoiceGroup(groupId: string): void {
    const nextAssignment = removeSubjectsOwnedBy(
      {
        selectedIds: selectedGroupIds,
        owners: courseOwners,
        enabledSectionIds,
      },
      groupId,
    );
    const removedSelectionIds = new Set(nextAssignment.removedIds);
    setChoiceGroups((groups) => groups.filter(({ id }) => id !== groupId));
    setSelectedGroupIds(nextAssignment.selectedIds);
    setCourseOwners(nextAssignment.owners);
    setEnabledSectionIds(nextAssignment.enabledSectionIds);
    setElectiveCourseGroups((groups) =>
      groups.filter(({ selectionId }) => !removedSelectionIds.has(selectionId)),
    );
    if (activeDestination === groupId) {
      setActiveDestination("required");
    }
  }

  function updateChoiceGroup(
    groupId: string,
    update: Partial<Omit<ChoiceGroupConfig, "id">>,
  ): void {
    setChoiceGroups((groups) =>
      groups.map((group) => (group.id === groupId ? { ...group, ...update } : group)),
    );
  }

  function toggleMajorCourseGroup(group: PlannerCourseGroup): void {
    if (isAssignedToActiveDestination(group.selectionId)) {
      removeSelectedCourse(group);
    } else {
      selectCourseGroup(group, activeDestination, enabledSectionIds[group.selectionId]);
    }
  }

  function toggleSection(group: PlannerCourseGroup, sectionId: string): void {
    setEnabledSectionIds((sections) => {
      const current = sections[group.selectionId] ?? getInitialSectionIds(group.candidates);
      return {
        ...sections,
        [group.selectionId]: toggleEnabledSectionId(current, sectionId),
      };
    });
  }

  function selectAllSections(
    group: PlannerCourseGroup,
    sections: readonly Pick<CourseCandidate, "id">[] = group.candidates,
  ): void {
    const sectionIds = getAllSectionIds(sections);
    if (sectionIds.length === 0) {
      return;
    }
    setEnabledSectionIds((current) => ({
      ...current,
      [group.selectionId]: sectionIds,
    }));
  }

  /** Reverts a "분반 전체 선택" back to the single default section (mirrors the initial pick). */
  function deselectAllSections(
    group: PlannerCourseGroup,
    sections: readonly Pick<CourseCandidate, "id">[] = group.candidates,
  ): void {
    setEnabledSectionIds((current) => ({
      ...current,
      [group.selectionId]: getInitialSectionIds(sections),
    }));
  }

  function selectAllCatalogSections(
    group: PlannerCourseGroup,
    sections: readonly Pick<CourseCandidate, "id">[] = group.candidates,
  ): void {
    const sectionIds = getAllSectionIds(sections);
    if (sectionIds.length === 0) {
      return;
    }
    if (isAssignedToActiveDestination(group.selectionId)) {
      selectAllSections(group, sections);
      return;
    }
    if (group.source === "elective") {
      setElectiveCourseGroups((groups) =>
        groups.some(({ selectionId }) => selectionId === group.selectionId)
          ? groups
          : [...groups, group],
      );
    }
    selectCourseGroup(group, activeDestination, sectionIds);
  }

  function toggleCatalogSection(group: PlannerCourseGroup, sectionId: string): void {
    if (isAssignedToActiveDestination(group.selectionId)) {
      toggleSection(group, sectionId);
      return;
    }
    if (group.source === "elective") {
      setElectiveCourseGroups((groups) =>
        groups.some(({ selectionId }) => selectionId === group.selectionId)
          ? groups
          : [...groups, group],
      );
    }
    selectCourseGroup(group, activeDestination, [sectionId]);
  }

  const unmetGeneralLabels = useMemo(() => {
    const unsatisfied = requirements.filter(
      (requirement) => requirement.scope === "general" && requirement.status !== "satisfied",
    );
    return unsatisfied.map((requirement) => requirement.label);
  }, [requirements]);

  async function loadAllElectives(campus: SkkuElectiveCampus): Promise<void> {
    if (!query) {
      return;
    }
    const catalogKey = getElectiveCatalogKey(query, campus);
    if (electiveCatalogs[catalogKey]) {
      return;
    }
    setElectiveError("");
    setIsElectiveLoading(true);
    try {
      const payload = await postJson("/api/skku-electives", {
        year: query.year,
        term: query.term,
        campus,
        mode: "all_subjects",
      });
      const catalog = readElectiveCatalog(payload);
      setElectiveCatalogs((catalogs) => ({ ...catalogs, [catalogKey]: catalog }));
      // 졸업요건 미충족 영역이 있으면 "전체" 대신 그 영역을 기본으로 보여준다 — 사용자가 이미
      // 다른 영역을 직접 골랐다면(더 이상 "all"이 아니면) 덮어쓰지 않는다.
      if (unmetGeneralLabels.length > 0) {
        const matchedArea = catalog.areas.find(
          (area) => area.count > 0 && areaMatchesUnmetLabels(area.label, unmetGeneralLabels),
        );
        if (matchedArea) {
          setSelectedElectiveArea((current) => (current === "all" ? matchedArea.code : current));
        }
      }
    } catch (error) {
      setElectiveError(readThrownMessage(error));
    } finally {
      setIsElectiveLoading(false);
    }
  }

  function preloadElectiveSubject(
    subject: SkkuElectiveSubject,
    campus: SkkuElectiveCampus,
  ): void {
    if (!query) {
      return;
    }
    const selectionId = getElectiveSelectionId(campus, subject.courseNumber);
    if (
      electivePreviewGroups[selectionId] ||
      electivePreviewRequestIds.current.has(selectionId)
    ) {
      return;
    }

    const activeQuery = query;
    const generation = electivePreviewGeneration.current;
    electivePreviewRequestIds.current.add(selectionId);
    setPreviewLoadingIds((ids) => [...new Set([...ids, selectionId])]);

    const loadPreview = async (): Promise<void> => {
      try {
        const group = await fetchElectivePlannerGroup(activeQuery, campus, subject);
        if (electivePreviewGeneration.current === generation) {
          setElectivePreviewGroups((groups) => ({ ...groups, [selectionId]: group }));
        }
      } catch {
        // Preview failure must not block normal selection, which retries with a visible error.
      } finally {
        if (electivePreviewGeneration.current === generation) {
          electivePreviewRequestIds.current.delete(selectionId);
          setPreviewLoadingIds((ids) => ids.filter((id) => id !== selectionId));
        }
      }
    };
    const laneIndex = electivePreviewLaneCursor.current % electivePreviewLanes.current.length;
    electivePreviewLaneCursor.current += 1;
    electivePreviewLanes.current[laneIndex] = electivePreviewLanes.current[laneIndex].then(
      loadPreview,
      loadPreview,
    );
  }

  async function toggleElectiveSubject(subject: SkkuElectiveSubject): Promise<void> {
    const campus = electiveCampus;
    const selectionId = getElectiveSelectionId(campus, subject.courseNumber);
    const existing = electiveCourseGroups.find((group) => group.selectionId === selectionId);
    if (existing) {
      if (isAssignedToActiveDestination(selectionId)) {
        removeSelectedCourse(existing);
      } else {
        selectCourseGroup(existing, activeDestination, enabledSectionIds[selectionId]);
      }
      return;
    }
    if (!query || loadingCourseNumbers.includes(selectionId)) {
      return;
    }
    const previewGroup = electivePreviewGroups[selectionId];
    if (previewGroup) {
      setElectiveCourseGroups((groups) => [...groups, previewGroup]);
      selectCourseGroup(previewGroup);
      return;
    }
    setLoadingCourseNumbers((numbers) => [...numbers, selectionId]);
    setElectiveError("");
    const destination = activeDestination;
    try {
      const scopedGroup = await fetchElectivePlannerGroup(query, campus, subject);
      setElectivePreviewGroups((groups) => ({ ...groups, [selectionId]: scopedGroup }));
      setElectiveCourseGroups((groups) => [...groups, scopedGroup]);
      selectCourseGroup(scopedGroup, destination);
    } catch (error) {
      setElectiveError(readThrownMessage(error));
    } finally {
      setLoadingCourseNumbers((numbers) =>
        numbers.filter((courseNumber) => courseNumber !== selectionId),
      );
    }
  }

  const electiveCatalogKey = query ? getElectiveCatalogKey(query, electiveCampus) : "";
  const electiveCatalog = electiveCatalogs[electiveCatalogKey];
  const electiveAreas = useMemo(() => electiveCatalog?.areas ?? [], [electiveCatalog]);
  const electiveSubjects = useMemo(() => electiveCatalog?.subjects ?? [], [electiveCatalog]);

  const excludedCourseSet = useMemo(
    () => new Set(excludedCourseNumbers.map((courseNumber) => courseNumber.trim().toUpperCase())),
    [excludedCourseNumbers],
  );
  const courseGroups = useMemo(
    (): PlannerCourseGroup[] => {
      const currentGroups: PlannerCourseGroup[] = [
        ...majorCourseGroups.map((group) => ({
          ...group,
          selectionId: `major:${group.id}`,
          source: "major" as const,
        })),
        ...electiveCourseGroups,
      ];
      // The live course catalog wins when it is available. Saved groups only fill a temporary
      // gap while the catalog loads (or if a transient request fails), so a saved plan never
      // makes the same subject appear twice.
      const bySelectionId = new Map(currentGroups.map((group) => [group.selectionId, group]));
      for (const group of savedPlanForQuery?.selectedGroups ?? []) {
        if (!bySelectionId.has(group.selectionId)) {
          bySelectionId.set(group.selectionId, group);
        }
      }
      return [...bySelectionId.values()];
    },
    [electiveCourseGroups, majorCourseGroups, savedPlanForQuery],
  );
  const availableCourseGroups = useMemo(
    () => courseGroups.filter((group) => !excludedCourseSet.has(group.id.trim().toUpperCase())),
    [courseGroups, excludedCourseSet],
  );
  const availableCourseTypes = useMemo(() => {
    const labels = new Set<string>();
    for (const group of availableCourseGroups) {
      for (const candidate of group.candidates) {
        labels.add(getCourseTypeLabel(candidate));
      }
    }
    return [...labels].sort((first, second) => first.localeCompare(second, "ko"));
  }, [availableCourseGroups]);
  function toggleCourseType(label: string): void {
    setDisabledCourseTypes((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }
  function addFixedEvent(): void {
    const label = newEventLabel.trim();
    if (!label) {
      setFixedEventError("일정 이름을 입력해 주세요.");
      return;
    }
    const startMinutes = parseTimeInputToMinutes(newEventStart);
    const endMinutes = parseTimeInputToMinutes(newEventEnd);
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
      setFixedEventError("시작 시각이 종료 시각보다 빨라야 합니다.");
      return;
    }
    const candidate: FixedEvent = {
      id: `fixed-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      label,
      day: newEventDay,
      startMinutes,
      endMinutes,
    };
    if (fixedEvents.some((event) => meetingsConflict(event, candidate))) {
      setFixedEventError("이미 등록한 다른 고정 일정과 시간이 겹칩니다.");
      return;
    }
    setFixedEvents((current) => [...current, candidate]);
    setNewEventLabel("");
    setFixedEventError("");
  }
  function removeFixedEvent(id: string): void {
    setFixedEvents((current) => current.filter((event) => event.id !== id));
  }
  /**
   * Format filtering happens here, while picking courses — not on already-generated timetables.
   * A course whose every section is filtered out simply disappears from the catalog; sections
   * already chosen for it drop out of the plan the same way excluded (기수강) courses do.
   */
  const formatFilteredCourseGroups = useMemo(
    () =>
      availableCourseGroups
        .map((group) => filterGroupCandidatesByFormat(group, disabledCourseTypes))
        .filter((group) => group.candidates.length > 0),
    [availableCourseGroups, disabledCourseTypes],
  );
  const visibleCourseGroups = useMemo(() => {
    const keyword = courseSearch.trim().toLowerCase();
    if (!keyword) {
      return formatFilteredCourseGroups;
    }
    return formatFilteredCourseGroups.filter((group) =>
      `${group.id} ${group.title} ${group.classification}`.toLowerCase().includes(keyword),
    );
  }, [courseSearch, formatFilteredCourseGroups]);
  const majorCourseGroupsBySource = useMemo(
    () => visibleCourseGroups.filter((group) => group.source === "major"),
    [visibleCourseGroups],
  );
  const majorProgramTabs = useMemo(
    () =>
      [...new Set([...roadmapProgramCodes, ...extraProgramCodes])].map((code) => ({
        code,
        label: findSkkuDepartment(code)?.name ?? code,
        count: majorCourseGroupsBySource.filter((group) => group.programCodes?.includes(code)).length,
        isExtra: extraProgramCodes.includes(code) && !roadmapProgramCodes.includes(code),
      })),
    [extraProgramCodes, majorCourseGroupsBySource, roadmapProgramCodes],
  );
  const selectedMajorProgramLabel = useMemo(() => {
    if (selectedMajorProgramCode === "all") {
      return "전체 전공";
    }
    return majorProgramTabs.find((tab) => tab.code === selectedMajorProgramCode)?.label ??
      selectedMajorProgramCode;
  }, [majorProgramTabs, selectedMajorProgramCode]);
  const visibleMajorCourseGroups = useMemo(
    () =>
      selectedMajorProgramCode === "all"
        ? majorCourseGroupsBySource
        : majorCourseGroupsBySource.filter((group) =>
            group.programCodes?.includes(selectedMajorProgramCode),
          ),
    [majorCourseGroupsBySource, selectedMajorProgramCode],
  );
  const visibleElectiveSubjects = useMemo(() => {
    const availableSubjects = electiveSubjects.filter(
      (subject) =>
        !excludedCourseSet.has(subject.courseNumber.trim().toUpperCase()) &&
        (selectedElectiveArea === "all" || subject.areaCode === selectedElectiveArea),
    );
    const keyword = courseSearch.trim().toLowerCase();
    if (!keyword) {
      return availableSubjects;
    }
    return availableSubjects.filter((subject) =>
      `${subject.courseNumber} ${subject.name}`.toLowerCase().includes(keyword),
    );
  }, [courseSearch, electiveSubjects, excludedCourseSet, selectedElectiveArea]);
  const electiveAreaLabels = useMemo(
    () => new Map(electiveAreas.map((area) => [area.code, area.label])),
    [electiveAreas],
  );
  const selectedElectiveAreaLabel = selectedElectiveArea === "all"
    ? "전체 교양"
    : electiveAreaLabels.get(selectedElectiveArea) ?? "선택 영역";
  // Deliberately NOT format-filtered: the format filter narrows what's browsable in the catalog
  // (formatFilteredCourseGroups), but a course the user already added to the plan must stay in
  // the plan even if they later hide its format while searching for something else.
  const effectiveSelectedGroupIds = useMemo(() => {
    const availableIds = new Set(availableCourseGroups.map((group) => group.selectionId));
    return selectedGroupIds.filter((id) => availableIds.has(id));
  }, [availableCourseGroups, selectedGroupIds]);
  const selectedCourseGroups = useMemo(
    () =>
      availableCourseGroups.filter(({ selectionId }) =>
        effectiveSelectedGroupIds.includes(selectionId),
      ),
    [availableCourseGroups, effectiveSelectedGroupIds],
  );

  useEffect(() => {
    if (!query || !isCoursePlanReady || !onCoursePlanChange) {
      return;
    }
    onCoursePlanChange({
      version: 1,
      queryKey: buildCoursePlanQueryKey(query),
      selectedGroups: selectedCourseGroups,
      choiceGroups,
      activeDestination,
      courseOwners,
      enabledSectionIds,
      fixedEvents,
      extraProgramCodes,
    });
  }, [
    activeDestination,
    choiceGroups,
    courseOwners,
    enabledSectionIds,
    extraProgramCodes,
    fixedEvents,
    isCoursePlanReady,
    onCoursePlanChange,
    query,
    selectedCourseGroups,
  ]);

  const sectionIdToGroup = useMemo(() => {
    const map = new Map<string, PlannerCourseGroup>();
    for (const group of selectedCourseGroups) {
      for (const candidate of group.candidates) {
        map.set(candidate.id, group);
      }
    }
    return map;
  }, [selectedCourseGroups]);

  const manualSelectionPlanSubjects = useMemo(() => {
    const choiceGroupIds = new Set(choiceGroups.map(({ id }) => id));
    const requiredSubjects: SubjectOption[] = [];
    const choiceSubjects = new Map<string, SubjectOption[]>(
      choiceGroups.map(({ id }) => [id, []]),
    );
    for (const group of selectedCourseGroups) {
      const enabledIds = new Set(
        enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates),
      );
      const subject = {
        id: group.selectionId,
        title: group.title,
        credits: group.credits,
        sections: group.candidates.filter((candidate) => enabledIds.has(candidate.id)),
      };
      const owner = courseOwners[group.selectionId] ?? "required";
      if (owner === "required" || !choiceGroupIds.has(owner)) {
        requiredSubjects.push(subject);
      } else {
        choiceSubjects.get(owner)?.push(subject);
      }
    }
    const choiceBags: ChoiceBag[] = choiceGroups.flatMap((choiceGroup) => {
      const subjects = choiceSubjects.get(choiceGroup.id) ?? [];
      return subjects.length > 0 ? [{ ...choiceGroup, subjects }] : [];
    });
    return { requiredSubjects, choiceBags };
  }, [choiceGroups, courseOwners, enabledSectionIds, selectedCourseGroups]);
  const requiredSectionIds = useMemo(
    () =>
      new Set(
        manualSelectionPlanSubjects.requiredSubjects.flatMap((subject) =>
          subject.sections.map((section) => section.id),
        ),
      ),
    [manualSelectionPlanSubjects.requiredSubjects],
  );

  // 필수 과목 학점 + 선택 묶음별 최소/최대 선택 개수로 담긴 학점의 하한·상한을 자동 계산한다.
  const packedCreditRange = useMemo(
    () => estimateCreditRangeFromPlan(manualSelectionPlanSubjects),
    [manualSelectionPlanSubjects],
  );
  // 담긴 학점 범위가 허용 범위(12~21학점)를 벗어나면 경고를 띄운다.
  const packedCreditRangeOutOfBounds = useMemo(() => {
    if (!packedCreditRange) {
      return false;
    }
    const min = Number(minimumCredits);
    const max = Number(maximumCredits);
    return packedCreditRange.minCredits < min || packedCreditRange.maxCredits > max;
  }, [packedCreditRange]);

  const result = useMemo(() => {
    if (selectedCourseGroups.length === 0) {
      return { entries: [], error: null };
    }
    try {
      const parsedMin = minimumCredits === "" ? Number.NaN : Number(minimumCredits);
      const parsedMax = maximumCredits === "" ? Number.NaN : Number(maximumCredits);
      const timetables = generateTimetablesForSelectionPlan(
        {
          requiredSubjects: manualSelectionPlanSubjects.requiredSubjects,
          choiceBags: manualSelectionPlanSubjects.choiceBags,
          creditRange: {
            minCredits: parsedMin,
            maxCredits: parsedMax,
          },
        },
        {
          unavailableDays,
          fixedEvents,
        },
      );

      return {
        entries: timetables.map((timetable, index) => ({
          index,
          timetable,
          extras: describeTimetableExtras(timetable, sectionIdToGroup, courseOwners, choiceGroups),
        })),
        error: null,
      };
    } catch (error) {
      return {
        entries: [],
        error:
          error instanceof CombinationLimitError ||
          error instanceof SelectionPlanError ||
          error instanceof SelectionPlanLimitError
            ? error.message
            : "시간표 조합을 만드는 중 오류가 발생했습니다.",
      };
    }
  }, [
    choiceGroups,
    courseOwners,
    fixedEvents,
    manualSelectionPlanSubjects,
    maximumCredits,
    minimumCredits,
    sectionIdToGroup,
    selectedCourseGroups,
    unavailableDays,
  ]);

  // Only computed when there's actually an empty result to explain — diagnoseEmptyTimetable is
  // rule-based (see selection-plan.ts), never AI-guessed, so the same plan always yields the same
  // specific reason instead of the old one-size-fits-all "조건을 만족하는 조합이 없습니다".
  const emptyTimetableDiagnosis = useMemo(() => {
    if (result.error || result.entries.length > 0 || selectedCourseGroups.length === 0) {
      return null;
    }
    const parsedMin = minimumCredits === "" ? Number.NaN : Number(minimumCredits);
    const parsedMax = maximumCredits === "" ? Number.NaN : Number(maximumCredits);
    return diagnoseEmptyTimetable(
      {
        requiredSubjects: manualSelectionPlanSubjects.requiredSubjects,
        choiceBags: manualSelectionPlanSubjects.choiceBags,
        creditRange: { minCredits: parsedMin, maxCredits: parsedMax },
      },
      {
        unavailableDays,
        fixedEvents,
      },
    );
  }, [
    fixedEvents,
    manualSelectionPlanSubjects,
    maximumCredits,
    minimumCredits,
    result,
    selectedCourseGroups,
    unavailableDays,
  ]);

  // 유효 시간표 중 하나라도 그 요일이 공강이면 선택지로 둔다.
  // (예전엔 "일부만 공강"인 요일만 보여줘서, 모든 조합이 같은 요일 공강이면 필터 자체가 안 떴다.)
  const dayOffOptions = useMemo(() => {
    if (result.entries.length === 0) {
      return [];
    }
    return DAYS.filter(({ id }) =>
      result.entries.some(({ timetable }) => isDayFree(timetable, id)),
    );
  }, [result.entries]);

  const filteredEntries = useMemo(() => {
    if (dayOffFilters.length === 0) {
      return result.entries;
    }
    return result.entries.filter(({ timetable }) =>
      dayOffFilters.every((day) => isDayFree(timetable, day)),
    );
  }, [dayOffFilters, result.entries]);

  const [recommendationWeights, setRecommendationWeights] = useState<RecommendationWeight[]>(
    DEFAULT_RECOMMENDATION_WEIGHTS,
  );
  const [customPreference, setCustomPreference] = useState("");
  const [recommendations, setRecommendations] = useState<TimetableRecommendationItem[] | null>(
    null,
  );
  const [aiCandidateTimetables, setAiCandidateTimetables] = useState<
    ReadonlyMap<string, { timetable: Timetable; extras: TimetableExtra[] }>
  >(new Map());
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendationStage, setRecommendationStage] = useState(0);
  const [recommendationFlavorIndex, setRecommendationFlavorIndex] = useState(-1);
  const [recommendationElapsedSeconds, setRecommendationElapsedSeconds] = useState(0);
  const [recommendationAverageSeconds, setRecommendationAverageSeconds] = useState(
    DEFAULT_RECOMMENDATION_AVERAGE_SECONDS,
  );
  const [recommendationError, setRecommendationError] = useState("");
  const [aiExplanationFailed, setAiExplanationFailed] = useState(false);
  const recommendationDurationSamples = useRef<number[]>([]);

  useEffect(() => {
    if (!isRecommending) {
      return;
    }
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setRecommendationElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecommending]);

  useEffect(() => {
    if (!isRecommending || recommendationStage !== 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setRecommendationFlavorIndex(
        (current) => (current + 1) % RECOMMENDATION_STAGE1_FLAVORS.length,
      );
    }, RECOMMENDATION_STAGE1_FLAVOR_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isRecommending, recommendationStage]);

  const recommendationStageLabel =
    recommendationStage === 1 && recommendationFlavorIndex >= 0
      ? RECOMMENDATION_STAGE1_FLAVORS[recommendationFlavorIndex]
      : RECOMMENDATION_STAGES[recommendationStage];

  const timetableListShownFired = useRef(false);
  useEffect(() => {
    if (timetableListShownFired.current || filteredEntries.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      timetableListShownFired.current = true;
      track("timetable_list_shown");
      markSessionCompleted();
    }, 3000);
    return () => clearTimeout(timer);
  }, [filteredEntries.length]);

  const aiRecommendShownFired = useRef(false);
  useEffect(() => {
    if (aiRecommendShownFired.current || !recommendations || recommendations.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      aiRecommendShownFired.current = true;
      track("ai_recommend_shown");
      markSessionCompleted();
    }, 3000);
    return () => clearTimeout(timer);
  }, [recommendations]);

  useEffect(() => {
    onRecommendationsAvailabilityChange?.(Boolean(recommendations && recommendations.length > 0));
  }, [onRecommendationsAvailabilityChange, recommendations]);

  const hasSelectionForAi =
    manualSelectionPlanSubjects.requiredSubjects.length > 0 ||
    manualSelectionPlanSubjects.choiceBags.length > 0;
  const canRunAiRecommend =
    !result.error && result.entries.length > 0 && hasSelectionForAi;
  const aiEmptyReason = useMemo(() => {
    if (canRunAiRecommend) {
      return null;
    }
    if (result.error) {
      return { title: "시간표를 만들 수 없어요", detail: result.error };
    }
    if (!hasSelectionForAi) {
      return {
        title: "과목을 먼저 담아 주세요",
        detail: "이전 단계에서 필수 과목이나 선택 묶음 후보를 추가해 주세요.",
      };
    }
    if (result.entries.length === 0) {
      return describeEmptyTimetableDiagnosis(emptyTimetableDiagnosis);
    }
    return null;
  }, [
    canRunAiRecommend,
    emptyTimetableDiagnosis,
    hasSelectionForAi,
    result.entries.length,
    result.error,
  ]);

  useEffect(() => {
    onAiRecommendActionStateChange?.({
      canRun: canRunAiRecommend,
      isRunning: isRecommending,
      emptyReason: aiEmptyReason,
    });
  }, [aiEmptyReason, canRunAiRecommend, isRecommending, onAiRecommendActionStateChange]);

  const lastAiRecommendRequestId = useRef(0);

  const [previousManualPlanSubjects, setPreviousManualPlanSubjects] = useState(
    manualSelectionPlanSubjects,
  );
  if (previousManualPlanSubjects !== manualSelectionPlanSubjects) {
    setPreviousManualPlanSubjects(manualSelectionPlanSubjects);
    setRecommendations(null);
    setRecommendationError("");
    setAiCandidateTimetables(new Map());
  }

  function toggleRecommendationWeight(id: WeightId): void {
    track("weight_adjust", { weight_type: id });
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === id ? { ...weight, enabled: !weight.enabled } : weight,
      ),
    );
  }

  function setRecommendationWeightImportance(id: WeightId, importance: WeightImportance): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) => (weight.id === id ? { ...weight, importance } : weight)),
    );
  }

  function setBackToBackConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "back_to_back"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  function setLunchBreakConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "lunch_break"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  function setCourseFormatConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "course_format"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  function setDayPackingConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "day_packing"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  function setFreeDaysConfig(
    partial: Partial<NonNullable<RecommendationWeight["config"]>>,
  ): void {
    setRecommendationWeights((weights) =>
      weights.map((weight) =>
        weight.id === "free_days"
          ? { ...weight, config: { ...weight.config, ...partial } }
          : weight,
      ),
    );
  }

  function togglePreferredFreeDay(day: Weekday): void {
    const freeDaysWeight = recommendationWeights.find((weight) => weight.id === "free_days");
    const current = freeDaysWeight?.config?.preferredFreeDays ?? [];
    const next = current.includes(day)
      ? current.filter((entry) => entry !== day)
      : [...current, day];
    setFreeDaysConfig({ preferredFreeDays: next });
  }

  /**
   * Looks beyond the user's manually chosen courses: pulls in elective subjects the user never
   * added to a choice group, preferring areas that match unmet 교양(general) graduation
   * requirements, and excluding already-completed subjects. Returns a synthetic, optional choice
   * bag (`minSubjects: 0`) so the combination engine can freely mix in 0..N of them — the existing
   * credit-range filter then keeps only combinations that actually land in the desired range.
   */
  async function buildAiFillerSubjects(): Promise<{
    bag: ChoiceBag | null;
    extrasBySectionId: Map<string, TimetableExtra>;
  }> {
    const extrasBySectionId = new Map<string, TimetableExtra>();
    if (!query) {
      return { bag: null, extrasBySectionId };
    }

    const campus = electiveCampus;
    let catalog: ElectiveCatalog;
    try {
      const payload = await postJson("/api/skku-electives", {
        year: query.year,
        term: query.term,
        campus,
        mode: "all_subjects",
      });
      catalog = readElectiveCatalog(payload);
    } catch {
      return { bag: null, extrasBySectionId };
    }

    const usedSelectionIds = new Set([
      ...manualSelectionPlanSubjects.requiredSubjects.map((subject) => subject.id),
      ...manualSelectionPlanSubjects.choiceBags.flatMap((bag) =>
        bag.subjects.map((subject) => subject.id),
      ),
    ]);
    const shortlist = selectAiFillerSubjects({
      catalogSubjects: catalog.subjects,
      usedSelectionIds,
      excludedCourseNumbers: new Set(excludedCourseNumbers),
      unmetGeneralLabels,
      hasAnyRequirements: requirements.length > 0,
      areaLabelByCode: new Map(SKKU_ELECTIVE_AREA_DEFINITIONS.map((area) => [area.code, area.label])),
      selectionIdFor: (courseNumber) => getElectiveSelectionId(campus, courseNumber),
      maxShortlist: MAX_FILLER_SHORTLIST,
    });
    if (shortlist.length === 0) {
      return { bag: null, extrasBySectionId };
    }

    const groups = await Promise.all(
      shortlist.map((subject) =>
        fetchElectivePlannerGroup(query, campus, subject).catch(() => null),
      ),
    );

    const subjects: SubjectOption[] = [];
    for (const group of groups) {
      if (!group) {
        continue;
      }
      const filtered = filterGroupCandidatesByFormat(group, disabledCourseTypes);
      if (filtered.candidates.length === 0) {
        continue;
      }
      // AI-suggested filler subjects keep one section per distinct schedule (day/time), not one
      // per professor: two sections meeting at the exact same time are interchangeable for
      // timetable-shape purposes, and offering both only multiplied the combination space with
      // near-duplicate timetables that differ solely by professor — which both looked repetitive
      // to the user and forced Solar to invent unfounded distinguishing reasons (e.g. fabricated
      // professor reputation). Sections that meet at genuinely different times are kept, since
      // they produce real timetable-shape variety instead of noise (previously collapsed to a
      // single "first" section, which cut candidate diversity far more than necessary).
      const scheduleDeduped = dedupeCandidatesBySchedule(filtered.candidates);
      if (scheduleDeduped.length === 0) {
        continue;
      }
      subjects.push({
        id: filtered.selectionId,
        title: filtered.title,
        credits: filtered.credits,
        sections: scheduleDeduped,
      });
      for (const section of scheduleDeduped) {
        extrasBySectionId.set(section.id, {
          groupTitle: AI_FILLER_GROUP_TITLE,
          title: filtered.title,
          classification: filtered.classification || "영역 미상",
        });
      }
    }
    if (subjects.length === 0) {
      return { bag: null, extrasBySectionId };
    }

    return {
      bag: {
        id: AI_FILLER_BAG_ID,
        title: AI_FILLER_GROUP_TITLE,
        subjects,
        minSubjects: 0,
        maxSubjects: Math.min(subjects.length, MAX_FILLER_SUBJECTS),
      },
      extrasBySectionId,
    };
  }

  async function fetchAiRecommendations(): Promise<void> {
    const hasAnySelection =
      manualSelectionPlanSubjects.requiredSubjects.length > 0 ||
      manualSelectionPlanSubjects.choiceBags.length > 0;
    if (!hasAnySelection) {
      setRecommendationError("이전 단계에서 필수 과목이나 선택 묶음 후보를 먼저 추가해 주세요.");
      setIsRecommending(false);
      return;
    }
    if (result.error || result.entries.length === 0) {
      setRecommendationError("유효 시간표가 없어 AI 추천을 만들 수 없습니다. 과목·조건을 조정해 주세요.");
      setIsRecommending(false);
      return;
    }
    track("ai_recommend_click");
    const startedAt = performance.now();
    setRecommendationElapsedSeconds(0);
    setIsRecommending(true);
    setRecommendationStage(0);
    setRecommendationFlavorIndex(-1);
    setRecommendationError("");
    try {
      const filler = await buildAiFillerSubjects();
      const timetables = generateTimetablesForSelectionPlan(
        {
          requiredSubjects: manualSelectionPlanSubjects.requiredSubjects,
          choiceBags: [
            ...manualSelectionPlanSubjects.choiceBags,
            ...(filler.bag ? [filler.bag] : []),
          ],
          creditRange: {
            minCredits: minimumCredits === "" ? Number.NaN : Number(minimumCredits),
            maxCredits: maximumCredits === "" ? Number.NaN : Number(maximumCredits),
          },
        },
        {
          unavailableDays,
          fixedEvents,
        },
      );
      const dayFiltered =
        dayOffFilters.length === 0
          ? timetables
          : timetables.filter((timetable) =>
              dayOffFilters.every((day) => isDayFree(timetable, day)),
            );

      if (dayFiltered.length === 0) {
        setRecommendationError(
          "조건을 만족하는 추천 조합을 만들지 못했습니다. 학점 범위·공강일·요일 제약을 조정해 보세요.",
        );
        setRecommendations(null);
        setAiCandidateTimetables(new Map());
        return;
      }

      const candidateMap = new Map<string, { timetable: Timetable; extras: TimetableExtra[] }>();
      for (const timetable of dayFiltered) {
        candidateMap.set(getTimetableCandidateId(timetable), {
          timetable,
          extras: describeTimetableExtras(
            timetable,
            sectionIdToGroup,
            courseOwners,
            choiceGroups,
            filler.extrasBySectionId,
          ),
        });
      }
      setAiCandidateTimetables(candidateMap);

      setRecommendationStage(1);
      const allowedFreeDays = new Set(dayOffOptions.map(({ id }) => id));
      const weightsForRequest = recommendationWeights.map((weight) => {
        if (weight.id !== "free_days") {
          return weight;
        }
        const preferredFreeDays = (weight.config?.preferredFreeDays ?? []).filter((day) =>
          allowedFreeDays.has(day),
        );
        return {
          ...weight,
          config: { ...weight.config, preferredFreeDays },
        };
      });
      const payload = await postJson("/api/timetable-recommendations", {
        timetables: dayFiltered,
        weights: weightsForRequest,
        // 필수(고정) 과목 제목 — Solar가 추천 이유를 이 과목들이 아니라 '추가로 담긴' 과목에
        // 집중해서 쓰도록 알려준다.
        requiredCourseTitles: manualSelectionPlanSubjects.requiredSubjects.map(
          (subject) => subject.title,
        ),
        customPreference: customPreference.trim() || undefined,
      });
      const parsed = readRecommendationResponse(payload);
      // 졸업요건 기여도는 Solar에 맡기지 않고 여기서 각 후보의 실제 교양 과목 영역으로 계산한다
      // ("계산은 코드로") — 후보마다 담긴 교양이 다르므로 기여 문구도 후보별로 달라지고, 실제로
      // 미충족 영역에 해당하는 과목이 없으면 null(미표시)이 된다.
      const withContribution = parsed.recommendations.map((recommendation) => ({
        ...recommendation,
        requirementContribution: describeRequirementContribution(
          candidateMap.get(recommendation.candidateId)?.extras ?? [],
          unmetGeneralLabels,
        ),
      }));
      setRecommendations(withContribution);
      setAiExplanationFailed(parsed.aiExplanationFailed);
      if (withContribution.length > 0) {
        onRecommendationsReady?.();
      }
    } catch (error) {
      setRecommendationError(readThrownMessage(error));
      setRecommendations(null);
    } finally {
      const durationMilliseconds = Math.round(performance.now() - startedAt);
      const durationSeconds = Math.max(1, Math.round(durationMilliseconds / 1000));
      recommendationDurationSamples.current = [
        ...recommendationDurationSamples.current.slice(-(MAX_RECOMMENDATION_DURATION_SAMPLES - 1)),
        durationSeconds,
      ];
      setRecommendationAverageSeconds(
        Math.round(
          recommendationDurationSamples.current.reduce((sum, seconds) => sum + seconds, 0) /
            recommendationDurationSamples.current.length,
        ),
      );
      track("ai_recommend_done", { duration_ms: durationMilliseconds });
      setIsRecommending(false);
      setRecommendationStage(0);
    }
  }

  useEffect(() => {
    if (!aiRecommendRequestId || aiRecommendRequestId === lastAiRecommendRequestId.current) {
      return;
    }
    lastAiRecommendRequestId.current = aiRecommendRequestId;
    void fetchAiRecommendations();
    // Intentionally keyed only by request id; fetch reads the latest planner state.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wizard nav trigger
  }, [aiRecommendRequestId]);

  const excludedCount = courseGroups.length - availableCourseGroups.length;

  function renderSelectedSubjectCard(group: PlannerCourseGroup): ReactNode {
    const selectedSections =
      enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates);
    const owner = courseOwners[group.selectionId] ?? "required";
    return (
      <div className={styles.selectedSubjectCard} key={group.selectionId}>
        <details className={styles.selectedSubject}>
          <summary>
            <span className={styles.summaryTitle}>
              <strong>{group.title}</strong>
              <small>
                {group.id}
                {group.credits > 0 ? ` · ${formatCredits(group.credits)}학점` : ""}
              </small>
            </span>
            <span className={styles.summaryActions}>
              <label
                className={styles.subjectDestinationInline}
                onClick={(event) => event.stopPropagation()}
              >
                <span className={styles.srOnly}>과목 위치</span>
                <select
                  value={owner}
                  onChange={(event) =>
                    setCourseOwners((owners) => ({
                      ...owners,
                      [group.selectionId]: event.target.value,
                    }))
                  }
                >
                  <option value="required">필수 과목</option>
                  {choiceGroups.map((choiceGroup) => (
                    <option key={choiceGroup.id} value={choiceGroup.id}>
                      {choiceGroup.title}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                분반 {selectedSections.length}/{group.candidates.length}
              </small>
              <button
                aria-label={`${group.title} 선택 해제`}
                className={styles.removeSelectedCourseInline}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeSelectedCourse(group);
                }}
              >
                삭제
              </button>
            </span>
          </summary>
          <div className={styles.subjectConfiguration}>
            {group.candidates.length > 1 ? (
              <button
                className={styles.selectAllSections}
                type="button"
                onClick={() =>
                  selectedSections.length === group.candidates.length
                    ? deselectAllSections(group)
                    : selectAllSections(group)
                }
              >
                {selectedSections.length === group.candidates.length
                  ? "분반 전체 선택 해제"
                  : "분반 전체 선택"}
              </button>
            ) : null}
            <SelectedSectionChoices
              candidates={group.candidates}
              selectedSectionIds={selectedSections}
              onToggleSection={(sectionId) => toggleSection(group, sectionId)}
            />
          </div>
        </details>
      </div>
    );
  }

  return (
    <section className={styles.planner} aria-label="시간표 조합">
      {showSelect ? (
        <div className={styles.stepIntro}>
          <div className={styles.stepHeading}>
            <h2>STEP 3 · 과목 담기</h2>
            {isLoading || isElectiveLoading ? (
              <span className={styles.loadingBadge}>
                {isElectiveLoading
                  ? "교양 강좌 조회 중… (처음 조회는 최대 10초 정도 걸릴 수 있어요)"
                  : "성대 강좌 조회 중…"}
              </span>
            ) : query ? (
              <span className={styles.contextBadge}>{queryLabel}</span>
            ) : (
              <span className={styles.contextBadge}>개설강좌 조회 전</span>
            )}
          </div>
          <p className={styles.stepLead}>
            {query
              ? "필요한 과목과 분반을 담아 주세요. 시간표 결과는 다음 화면에서 확인합니다."
              : "위 기본정보를 입력하면 해당 소속의 실제 개설강좌가 여기에 표시됩니다."}
          </p>
        </div>
      ) : null}
      {showResults ? (
        <div className={styles.stepIntro}>
          <div className={styles.stepHeading}>
            <h2>STEP 4 · 유효 시간표 확인</h2>
          </div>
          <p className={styles.stepLead}>
            요일, 시간, 학점 조건을 조정하여 담아 둔 과목으로 만들 수 있는 시간표를 확인합니다.
          </p>
        </div>
      ) : null}
      {showAiSetup ? (
        <div className={styles.stepIntro}>
          <div className={styles.stepHeading}>
            <h2>STEP 5 · AI 시간표 추천</h2>
            {isRecommending ? <span className={styles.loadingBadge}>분석 중…</span> : null}
          </div>
          <p className={styles.stepLead}>
            {isRecommending
              ? `${recommendationStageLabel} 완료되면 결과 화면으로 이동합니다.`
              : "선호 조건을 고른 뒤 추천을 받으면, 다음 화면에서 결과 카드를 확인합니다."}
          </p>
        </div>
      ) : null}
      {showAiResults ? (
        <div className={styles.stepIntro}>
          <div className={styles.stepHeading}>
            <h2>STEP 5 · AI 시간표 추천</h2>
          </div>
          <p className={styles.stepLead}>
            앞에서 담은 과목을 유지한 채, 조건에 맞는 상위 후보를 보여줍니다.
          </p>
        </div>
      ) : null}
      {showSelect && collectionError ? (
        <p className={styles.collectionError} role="alert">{collectionError}</p>
      ) : null}
      {showSelect && electiveError ? (
        <p className={styles.collectionError} role="alert">{electiveError}</p>
      ) : null}

      <div className={`${styles.aiOnlyGrid} ${showSelect ? styles.courseSelectionGrid : ""}`}>
        {showSelect ? (
        <aside className={styles.controls}>
          <fieldset>
            <legend className={styles.sectionTitle}>과목 담기</legend>
            <p className={styles.featureStepCue}>
              <span>1</span>
              담을 곳 선택
            </p>
            <section className={styles.destinationPicker} aria-label="새로 선택한 과목을 담을 곳">
              <div className={styles.destinationPickerHeading}>
                <span>과목을 담을 곳</span>
                <small>필수 또는 선택 묶음을 고르세요.</small>
              </div>
              <div className={styles.destinationTabs}>
                <button
                  aria-pressed={activeDestination === "required"}
                  className={activeDestination === "required" ? styles.activeDestinationTab : undefined}
                  type="button"
                  onClick={() => setActiveDestination("required")}
                >
                  <span>필수</span>
                  <small>
                    {selectedCourseGroups.filter(
                      ({ selectionId }) =>
                        !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                    ).length}개
                  </small>
                </button>
                {choiceGroups.map((choiceGroup, index) => (
                  <button
                    aria-pressed={activeDestination === choiceGroup.id}
                    className={activeDestination === choiceGroup.id ? styles.activeDestinationTab : undefined}
                    key={choiceGroup.id}
                    type="button"
                    onClick={() => setActiveDestination(choiceGroup.id)}
                  >
                    <span>{getChoiceGroupButtonLabel(choiceGroup, index)}</span>
                    <small>
                      {selectedCourseGroups.filter(
                        ({ selectionId }) => courseOwners[selectionId] === choiceGroup.id,
                      ).length}개
                    </small>
                  </button>
                ))}
                <button
                  className={styles.addDestinationTab}
                  type="button"
                  onClick={addChoiceGroup}
                >
                  + 그룹 추가
                </button>
              </div>
            </section>
            <p className={styles.featureStepCue}>
              <span>2</span>
              전공·교양 고르기
            </p>
            <div className={styles.sourceTabs} role="tablist" aria-label="과목 분류">
              <button
                aria-selected={courseSource === "major"}
                className={courseSource === "major" ? styles.activeSourceTab : undefined}
                role="tab"
                type="button"
                onClick={() => {
                  setCourseSource("major");
                  setCourseSearch("");
                }}
              >
                전공 과목
              </button>
              <button
                aria-selected={courseSource === "elective"}
                className={courseSource === "elective" ? styles.activeSourceTab : undefined}
                role="tab"
                type="button"
                onClick={() => {
                  setCourseSource("elective");
                  setCourseSearch("");
                  void loadAllElectives(electiveCampus);
                }}
              >
                교양 과목
              </button>
            </div>
            {courseSource === "major" ? (
              <div className={styles.majorFilters}>
                <div className={styles.electiveAreaFilter}>
                  <span>선택한 전공</span>
                  <p className={styles.selectedMajorProgram}>{selectedMajorProgramLabel}</p>
                  {majorProgramTabs.length > 1 ? (
                    <div className={styles.areaChoices} aria-label="전공 선택">
                      <button
                        aria-pressed={selectedMajorProgramCode === "all"}
                        className={selectedMajorProgramCode === "all" ? styles.activeArea : undefined}
                        type="button"
                        onClick={() => {
                          setSelectedMajorProgramCode("all");
                          setCourseSearch("");
                        }}
                      >
                        <span>전체</span>
                        <small>{majorCourseGroupsBySource.length}</small>
                      </button>
                      {majorProgramTabs.map((tab) =>
                        tab.isExtra ? (
                          <span className={styles.areaChoiceExtra} key={tab.code}>
                            <button
                              aria-pressed={selectedMajorProgramCode === tab.code}
                              className={selectedMajorProgramCode === tab.code ? styles.activeArea : undefined}
                              type="button"
                              onClick={() => {
                                setSelectedMajorProgramCode(tab.code);
                                setCourseSearch("");
                              }}
                            >
                              <span>{tab.label}</span>
                              <small>{tab.count}</small>
                            </button>
                            <button
                              aria-label={`${tab.label} 목록에서 제거`}
                              className={styles.removeExtraTab}
                              type="button"
                              onClick={() => removeExtraDepartment(tab.code)}
                            >
                              ×
                            </button>
                          </span>
                        ) : (
                          <button
                            aria-pressed={selectedMajorProgramCode === tab.code}
                            className={selectedMajorProgramCode === tab.code ? styles.activeArea : undefined}
                            key={tab.code}
                            type="button"
                            onClick={() => {
                              setSelectedMajorProgramCode(tab.code);
                              setCourseSearch("");
                            }}
                          >
                            <span>{tab.label}</span>
                            <small>{tab.count}</small>
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              <div className={styles.electiveAreaFilter}>
                <DepartmentAddCombobox
                  excludeCodes={[...roadmapProgramCodes, ...extraProgramCodes]}
                  id="planner-extra-department-search"
                  placeholder="다른 전공·연계전공·트랙명 또는 코드 검색"
                  onSelect={(department) => void loadExtraDepartment(department)}
                />
                {loadingExtraDepartmentCodes.length > 0 ? (
                  <small className={styles.electiveCatalogNote}>
                    {loadingExtraDepartmentCodes
                      .map((code) => findSkkuDepartment(code)?.name ?? code)
                      .join(", ")}{" "}
                    과목을 불러오는 중…
                  </small>
                ) : null}
                {extraDepartmentError ? (
                  <p className={styles.courseEmpty} role="alert">
                    {extraDepartmentError}
                  </p>
                ) : null}
              </div>
              </div>
            ) : null}
            {courseSource === "elective" ? (
              <div className={styles.electiveCampusPicker}>
                <span>교양 캠퍼스</span>
                <div className={styles.campusChoices} aria-label="교양 캠퍼스">
                  {CAMPUS_OPTIONS.map((campus) => (
                    <button
                      aria-label={campus.label}
                      aria-pressed={electiveCampus === campus.value}
                      className={electiveCampus === campus.value ? styles.activeCampus : undefined}
                      disabled={isElectiveLoading}
                      key={campus.value}
                      type="button"
                      onClick={() => {
                        setElectiveCampus(campus.value);
                        setSelectedElectiveArea("all");
                        setCourseSearch("");
                        void loadAllElectives(campus.value);
                      }}
                    >
                      {campus.shortLabel}
                    </button>
                  ))}
                </div>
                {electiveCatalog ? (
                  <div className={styles.electiveAreaFilter}>
                    <span>교양 영역</span>
                    <div className={styles.areaChoices} aria-label="교양 영역">
                      <button
                        aria-pressed={selectedElectiveArea === "all"}
                        className={selectedElectiveArea === "all" ? styles.activeArea : undefined}
                        type="button"
                        onClick={() => {
                          setSelectedElectiveArea("all");
                          setCourseSearch("");
                        }}
                      >
                        <span>전체</span>
                        <small>{electiveSubjects.length}</small>
                      </button>
                      {electiveAreas.map((area) => (
                        <button
                          aria-pressed={selectedElectiveArea === area.code}
                          className={selectedElectiveArea === area.code ? styles.activeArea : undefined}
                          disabled={area.count === 0}
                          key={area.code}
                          type="button"
                          onClick={() => {
                            setSelectedElectiveArea(area.code);
                            setCourseSearch("");
                          }}
                        >
                          <span>{area.label}</span>
                          <small>{area.count}</small>
                        </button>
                      ))}
                    </div>
                    {selectedElectiveArea !== "all" &&
                    areaMatchesUnmetLabels(
                      electiveAreaLabels.get(selectedElectiveArea) ?? "",
                      unmetGeneralLabels,
                    ) ? (
                      <small className={styles.electiveCatalogNote}>
                        졸업요건 미충족 영역이라 기본으로 보여드립니다. 다른 영역을 보려면
                        위에서 골라주세요.
                      </small>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className={styles.featureStepCue}>
              <span>3</span>
              과목·분반 고르기
            </p>
            <label className={styles.courseSearch}>
              <span className={styles.srOnly}>과목 검색</span>
              <input
                disabled={
                  courseSource === "major"
                    ? visibleMajorCourseGroups.length === 0 && !courseSearch
                    : !electiveCatalog || isElectiveLoading
                }
                placeholder={
                  courseSource === "major"
                    ? "과목명·학수번호·이수구분 검색"
                    : `${getCampusLabel(electiveCampus)} ${selectedElectiveAreaLabel}에서 과목명·학수번호 검색`
                }
                type="search"
                value={courseSearch}
                onChange={(event) => setCourseSearch(event.target.value)}
              />
            </label>
            {excludedCount > 0 ? (
              <p className={styles.excludedNotice}>
                기수강 과목 {excludedCount}개 자동 제외 · 재수강 체크 시 다시 표시
              </p>
            ) : null}
            {availableCourseTypes.length > 0 ? (
              <div className={styles.courseTypeFilter}>
                <span>강의 형식으로 좁히기</span>
                <div className={styles.courseTypeChoices}>
                  {availableCourseTypes.map((label) => {
                    const checked = !disabledCourseTypes.has(label);
                    return (
                      <label className={styles.courseTypeChoice} key={label}>
                        <input
                          checked={checked}
                          type="checkbox"
                          onChange={() => toggleCourseType(label)}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className={styles.courseList}>
              {courseSource === "major" ? visibleMajorCourseGroups.map((group) => {
                const isSelectedElsewhere = selectedGroupIds.includes(group.selectionId);
                const checked = isAssignedToActiveDestination(group.selectionId);
                const selectedSections = checked
                  ? enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates)
                  : [];
                return (
                  <div className={styles.courseCatalogItem} key={group.selectionId}>
                    <label className={styles.courseToggle}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={() => toggleMajorCourseGroup(group)}
                      />
                      <span>
                        <strong>{group.title}</strong>
                        <small>
                          {group.id}
                          {group.classification ? ` · ${group.classification}` : ""}
                          {group.credits > 0 ? ` · ${formatCredits(group.credits)}학점` : ""}
                        </small>
                      </span>
                      <small>
                        {checked
                          ? getDestinationLabel(courseOwners[group.selectionId], choiceGroups)
                          : isSelectedElsewhere
                            ? `${getDestinationLabel(courseOwners[group.selectionId], choiceGroups)}에 있음 · 눌러서 옮기기`
                            : `${group.candidates.length}개 분반`}
                      </small>
                    </label>
                    {shouldShowSectionDetails(group.candidates.length)
                      ? (
                        <CourseSectionDetails
                          group={group}
                          selectedSectionIds={selectedSections}
                          onDeselectAllSections={() => deselectAllSections(group)}
                          onSelectAllSections={() => selectAllCatalogSections(group)}
                          onToggleSection={(sectionId) => toggleCatalogSection(group, sectionId)}
                        />
                      )
                      : null}
                  </div>
                );
              }) : visibleElectiveSubjects.map((subject) => {
                const selectionId = getElectiveSelectionId(electiveCampus, subject.courseNumber);
                const selectedGroup = electiveCourseGroups.find(
                  (group) => group.selectionId === selectionId,
                );
                const previewGroup = electivePreviewGroups[selectionId];
                const isSelectedElsewhere = Boolean(selectedGroup) && !isAssignedToActiveDestination(selectionId);
                const checked = isAssignedToActiveDestination(selectionId);
                const loading = loadingCourseNumbers.includes(selectionId);
                const previewLoading = previewLoadingIds.includes(selectionId);
                const displayedGroup = selectedGroup ?? previewGroup;
                // Filtered only for rendering/counts — toggle handlers below keep using the raw
                // `displayedGroup` so a filtered-out section is never permanently dropped from state.
                const filteredDisplayedGroup = displayedGroup
                  ? filterGroupCandidatesByFormat(displayedGroup, disabledCourseTypes)
                  : undefined;
                const selectedSections = checked && selectedGroup
                  ? enabledSectionIds[selectionId] ?? getInitialSectionIds(selectedGroup.candidates)
                  : [];
                return (
                  <ElectivePreviewBoundary
                    key={selectionId}
                    onVisible={() => preloadElectiveSubject(subject, electiveCampus)}
                  >
                    <label className={styles.courseToggle}>
                      <input
                        checked={checked}
                        disabled={loading}
                        type="checkbox"
                        onChange={() => void toggleElectiveSubject(subject)}
                      />
                      <span>
                        <strong>{subject.name}</strong>
                        <small>
                          {subject.courseNumber} · {electiveAreaLabels.get(subject.areaCode) ?? "교양"}
                          {displayedGroup && displayedGroup.credits > 0
                            ? ` · ${formatCredits(displayedGroup.credits)}학점`
                            : ""}
                        </small>
                      </span>
                      <small>
                        {loading
                          ? "분반 조회 중…"
                          : checked
                            ? getDestinationLabel(courseOwners[selectionId], choiceGroups)
                            : isSelectedElsewhere
                              ? `${getDestinationLabel(courseOwners[selectionId], choiceGroups)}에 있음 · 눌러서 옮기기`
                              : previewGroup
                                ? `${filterGroupCandidatesByFormat(previewGroup, disabledCourseTypes).candidates.length}개 분반`
                                : previewLoading
                                  ? "분반 확인 중…"
                                  : "선택"}
                      </small>
                    </label>
                    {filteredDisplayedGroup && shouldShowSectionDetails(filteredDisplayedGroup.candidates.length)
                      ? (
                        <CourseSectionDetails
                          group={filteredDisplayedGroup}
                          selectedSectionIds={selectedSections}
                          onDeselectAllSections={() =>
                            deselectAllSections(displayedGroup!, filteredDisplayedGroup.candidates)
                          }
                          onSelectAllSections={() =>
                            selectAllCatalogSections(displayedGroup!, filteredDisplayedGroup.candidates)
                          }
                          onToggleSection={(sectionId) =>
                            toggleCatalogSection(displayedGroup!, sectionId)
                          }
                        />
                      )
                      : displayedGroup
                        ? null
                        : (
                          // 분반 미리보기가 아직 로드되지 않은 항목은 접힌 분반 요약과 같은 높이의
                          // 자리를 미리 잡아 둔다 — 스크롤 중 분반이 로드되며 요약이 나타날 때 아래
                          // 항목들의 체크박스가 밀려 내려가는 레이아웃 시프트를 막는다.
                          <div className={styles.sectionDetailsPlaceholder} aria-hidden="true" />
                        )}
                  </ElectivePreviewBoundary>
                );
              })}
              {courseSource === "major" && !isLoading && query && visibleMajorCourseGroups.length === 0 ? (
                <p className={styles.courseEmpty}>
                  {majorCourseGroups.length === 0
                    ? "이 조건에서 조회된 개설강좌가 없습니다. 학기·캠퍼스를 확인해 주세요."
                    : "검색어와 일치하는 과목이 없습니다."}
                </p>
              ) : null}
              {courseSource === "elective" && !electiveCatalog && !isElectiveLoading && query ? (
                <p className={styles.courseEmpty}>교양 과목을 불러오지 못했습니다. 캠퍼스를 다시 선택해 주세요.</p>
              ) : null}
              {courseSource === "elective" && electiveCatalog && !isElectiveLoading && visibleElectiveSubjects.length === 0 ? (
                <p className={styles.courseEmpty}>
                  {electiveSubjects.length === 0
                    ? "이 캠퍼스에서 조회된 교양 과목이 없습니다."
                    : selectedElectiveArea === "all"
                      ? "검색어와 일치하거나 새로 수강할 수 있는 교양 과목이 없습니다."
                      : "선택한 영역에서 검색어와 일치하거나 새로 수강할 수 있는 과목이 없습니다."}
                </p>
              ) : null}
              {!query ? <p className={styles.courseEmpty}>먼저 기본정보를 입력해 주세요.</p> : null}
            </div>

          </fieldset>

          <fieldset>
            <legend>고정 일정(알바 등)</legend>
            {fixedEvents.length > 0 ? (
              <ul className={styles.fixedEventList}>
                {fixedEvents.map((event) => (
                  <li key={event.id}>
                    <span>
                      {DAYS.find(({ id }) => id === event.day)?.label ?? event.day} ·{" "}
                      {formatMinutes(event.startMinutes)}-{formatMinutes(event.endMinutes)} ·{" "}
                      {event.label}
                    </span>
                    <button type="button" onClick={() => removeFixedEvent(event.id)}>
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.fixedEventForm}>
              <input
                placeholder="일정 이름(예: 알바)"
                type="text"
                value={newEventLabel}
                onChange={(event) => setNewEventLabel(event.target.value)}
              />
              <select
                value={newEventDay}
                onChange={(event) => setNewEventDay(event.target.value as Weekday)}
              >
                {DAYS.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <input
                type="time"
                value={newEventStart}
                onChange={(event) => setNewEventStart(event.target.value)}
              />
              <span aria-hidden="true">~</span>
              <input
                type="time"
                value={newEventEnd}
                onChange={(event) => setNewEventEnd(event.target.value)}
              />
              <button type="button" onClick={addFixedEvent}>추가</button>
            </div>
            {fixedEventError ? <p className={styles.fixedEventError}>{fixedEventError}</p> : null}
            <small>등록한 시간에는 과목이 배치되지 않도록 시간표 조합에서 제외합니다.</small>
          </fieldset>
        </aside>
        ) : null}

        {showSelect ? (
          <section className={styles.selectionPlanEditor} aria-label="담은 과목 확인">
            <div className={styles.selectionPlanHeading}>
              <div>
                <p className={styles.featureStepCue}>
                  <span>4</span>
                  담은 과목 확인
                </p>
                <strong className={styles.sectionTitle}>담은 과목</strong>
                <small>필수·선택 묶음별 과목과 분반을 바로 확인하고 수정하세요.</small>
              </div>
              <button className={styles.addChoiceGroupButton} onClick={addChoiceGroup} type="button">
                + 그룹 추가
              </button>
            </div>

            <div className={styles.choiceGroupRules}>
              <section className={`${styles.subjectSection} ${styles.requiredSubjectSection}`}>
                <div className={styles.subjectSectionHeading}>
                  <div>
                    <strong>필수 과목</strong>
                    <small>모든 시간표에 반드시 들어갑니다.</small>
                  </div>
                  <span>
                    {
                      selectedCourseGroups.filter(
                        ({ selectionId }) =>
                          !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                      ).length
                    }개
                  </span>
                </div>
                <div className={styles.destinationBlock}>
                  <div className={styles.requiredRule}>
                    <span>고정 선택</span>
                    <small>이곳에 담은 과목은 조합마다 바뀌지 않습니다.</small>
                  </div>
                  <div className={styles.selectedSubjectList}>
                    {selectedCourseGroups
                      .filter(
                        ({ selectionId }) =>
                          !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                      )
                      .map((group) => renderSelectedSubjectCard(group))}
                    {selectedCourseGroups.filter(
                      ({ selectionId }) =>
                        !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                    ).length === 0 ? (
                      <p className={styles.groupEmpty}>아직 담은 필수 과목이 없습니다.</p>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className={`${styles.subjectSection} ${styles.choiceSubjectSection}`}>
                <div className={styles.subjectSectionHeading}>
                  <div>
                    <strong>선택 과목</strong>
                    <small>선택 묶음마다 설정한 수만 시간표에 들어갑니다.</small>
                  </div>
                  <span>
                    {selectedCourseGroups.filter(({ selectionId }) =>
                      choiceGroups.some((choiceGroup) => courseOwners[selectionId] === choiceGroup.id),
                    ).length}개
                  </span>
                </div>
                {choiceGroups.map((choiceGroup) => {
                  const groupSubjects = selectedCourseGroups.filter(
                    ({ selectionId }) => courseOwners[selectionId] === choiceGroup.id,
                  );
                  return (
                    <div className={styles.destinationBlock} key={choiceGroup.id}>
                    <div className={styles.choiceGroupRule}>
                      <div className={styles.choiceGroupRuleHeader}>
                        <label>
                          <span className={styles.srOnly}>선택 묶음 이름</span>
                          <input
                            onChange={(event) =>
                              updateChoiceGroup(choiceGroup.id, { title: event.target.value })
                            }
                            type="text"
                            value={choiceGroup.title}
                          />
                        </label>
                        <strong>{groupSubjects.length}개</strong>
                      </div>
                      <div className={styles.cardinalityInputs}>
                        <p className={styles.cardinalityLabel}>
                          이 묶음에서 시간표에 넣을 과목 수 (예: 1~2개면, 담긴 과목 중 1개 또는
                          2개가 시간표에 포함됩니다)
                        </p>
                        <div className={styles.cardinalityFields}>
                          <label>
                            <span className={styles.srOnly}>최소 과목 수</span>
                            <span className={styles.cardinalityField}>
                              <input
                                max="20"
                                min="0"
                                onChange={(event) =>
                                  updateChoiceGroup(choiceGroup.id, {
                                    minSubjects: Number(event.target.value),
                                  })
                                }
                                type="number"
                                value={choiceGroup.minSubjects}
                              />
                              <span aria-hidden="true">개</span>
                            </span>
                          </label>
                          <span aria-hidden="true">~</span>
                          <label>
                            <span className={styles.srOnly}>최대 과목 수</span>
                            <span className={styles.cardinalityField}>
                              <input
                                max="20"
                                min="0"
                                onChange={(event) =>
                                  updateChoiceGroup(choiceGroup.id, {
                                    maxSubjects: Number(event.target.value),
                                  })
                                }
                                type="number"
                                value={choiceGroup.maxSubjects}
                              />
                              <span aria-hidden="true">개</span>
                            </span>
                          </label>
                        </div>
                      </div>
                      <button
                        aria-label={`${choiceGroup.title} 삭제`}
                        className={styles.removeChoiceGroup}
                        onClick={() => removeChoiceGroup(choiceGroup.id)}
                        type="button"
                      >
                        삭제
                      </button>
                    </div>
                    <div className={styles.selectedSubjectList}>
                      {groupSubjects.map((group) => renderSelectedSubjectCard(group))}
                      {groupSubjects.length === 0 ? (
                        <p className={styles.groupEmpty}>아직 담은 과목이 없습니다.</p>
                      ) : null}
                    </div>
                    </div>
                  );
                })}
              </section>
            </div>

            <button
              className={styles.checkScheduleConflicts}
              type="button"
              onClick={() =>
                setScheduleConflicts(findScheduleConflicts(selectedCourseGroups, enabledSectionIds))
              }
            >
              시간 겹치는 과목 확인하기
            </button>

            {scheduleConflicts !== null ? (
              <div className={styles.scheduleConflictResult} role="status">
                {scheduleConflicts.length > 0 ? (
                  <ul>
                    {scheduleConflicts.map((conflict) => (
                      <li key={`${conflict.firstLabel}__${conflict.secondLabel}`}>
                        {conflict.firstLabel}과 {conflict.secondLabel}은 시간이 겹칩니다. 시간표
                        추천 시 두 분반은 함께 포함되지 않습니다.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>시간이 겹치는 과목이 없습니다.</p>
                )}
              </div>
            ) : null}

            <fieldset>
              <legend>현재 담긴 과목의 총 학점</legend>
              <div className={styles.creditRangeInputs}>
                <label>
                  <span>최소</span>
                  <input
                    inputMode="numeric"
                    min="0"
                    readOnly
                    step="1"
                    type="number"
                    value={packedCreditRange?.minCredits ?? 0}
                  />
                </label>
                <span aria-hidden="true">~</span>
                <label>
                  <span>최대</span>
                  <input
                    inputMode="numeric"
                    min="0"
                    readOnly
                    step="1"
                    type="number"
                    value={packedCreditRange?.maxCredits ?? 0}
                  />
                </label>
              </div>
              {!packedCreditRange ? (
                <small>담은 과목이 없어 아직 계산할 수 없습니다.</small>
              ) : null}
              {packedCreditRangeOutOfBounds ? (
                <p className={styles.packedCreditRangeWarning}>
                  총 학점은 12~21학점 사이로 구성해주세요. 이 범위를 벗어나면 시간표가
                  만들어지지 않습니다.
                </p>
              ) : null}
            </fieldset>
          </section>
        ) : null}

        <div className={styles.results} aria-live="polite">
          {showResults || showAiResults ? (
            <p className={styles.timetableReviewNotice}>
              <strong>강의평 보기</strong>
              <span>시간표의 과목을 누르면 에브리타임 강의평으로 바로 연결돼요.</span>
            </p>
          ) : null}
          {showResults ? (
            <>
          <div className={styles.resultHeading}>
            <div>
              <p>유효 시간표</p>
              <h2>
                {filteredEntries.length}개
                {dayOffFilters.length > 0 ? <small> · 전체 {result.entries.length}개 중</small> : null}
              </h2>
            </div>
            <span>순위 없음 · {minimumCredits || "?"}~{maximumCredits || "?"}학점</span>
          </div>

          {result.entries.length > 0 && dayOffOptions.length > 0 ? (
            <div className={styles.dayOffFilter}>
              <span>공강일로 결과 좁히기</span>
              <div className={styles.dayChoices}>
                {dayOffOptions.map(({ id, label }) => {
                  const checked = dayOffFilters.includes(id);
                  return (
                    <label className={styles.dayChoice} key={id}>
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={() =>
                          setDayOffFilters((days) =>
                            checked ? days.filter((day) => day !== id) : [...days, id],
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {result.error ? <p className={styles.error}>{result.error}</p> : null}
          {!result.error && effectiveSelectedGroupIds.length === 0 ? (
            <p className={styles.empty}>이전 단계에서 필수 과목이나 선택 묶음 후보를 추가해 주세요.</p>
          ) : null}
          {!result.error && effectiveSelectedGroupIds.length > 0 && result.entries.length === 0 ? (() => {
            const diagnosisText = describeEmptyTimetableDiagnosis(emptyTimetableDiagnosis);
            return (
              <p className={styles.emptyDiagnosis} role="alert">
                <strong>{diagnosisText.title}</strong>
                {diagnosisText.detail}
              </p>
            );
          })() : null}
          {!result.error && result.entries.length > 0 && filteredEntries.length === 0 ? (
            <p className={styles.empty}>선택한 공강일 필터에 맞는 조합이 없습니다. 필터를 줄여 보세요.</p>
          ) : null}
          {!result.error && filteredEntries.length > 0 ? (
            <ol className={`${styles.timetableList} ${styles.validTimetableList}`}>
              {filteredEntries.map(({ index, timetable, extras }) => (
                <TimetableCard
                  compact
                  extras={extras}
                  index={index}
                  key={timetable.courses.map(({ id }) => id).join("-")}
                  requiredCourseIds={requiredSectionIds}
                  timetable={timetable}
                />
              ))}
            </ol>
          ) : null}
            </>
          ) : null}

          {showAiSetup ? (
          <div
            aria-busy={isRecommending}
            className={styles.recommendationSection}
          >
            {isRecommending ? (
              <div className={styles.aiLoadingPanel} role="status" aria-live="polite">
                <span className={styles.aiSpinner} aria-hidden="true" />
                <strong>AI가 분석 중입니다...</strong>
                <p className={styles.aiLoadingTiming}>
                  {recommendationElapsedSeconds}초째 · 평균 {recommendationAverageSeconds}초
                </p>
                <p>{recommendationStageLabel} 잠시만 기다려 주세요.</p>
                <div className={styles.aiSkeletonList} aria-hidden="true">
                  <div className={styles.aiSkeletonCard} />
                  <div className={styles.aiSkeletonCard} />
                  <div className={styles.aiSkeletonCard} />
                </div>
              </div>
            ) : (
              <>
            <h3>AI 추천 조건</h3>

            <div className={styles.recommendationWeights}>
              <datalist id="importance-ticks">
                <option value="1" />
                <option value="2" />
                <option value="3" />
                <option value="4" />
                <option value="5" />
              </datalist>
              {recommendationWeights.map((weight) => (
                <div className={styles.recommendationWeight} key={weight.id}>
                  <div className={styles.recommendationWeightMain}>
                    <label className={styles.recommendationWeightToggle}>
                      <input
                        checked={weight.enabled}
                        type="checkbox"
                        onChange={() => toggleRecommendationWeight(weight.id)}
                      />
                      <span>{WEIGHT_LABELS[weight.id]}</span>
                    </label>
                    {weight.enabled ? (
                      <label className={styles.importanceSlider}>
                        <span className={styles.srOnly}>{WEIGHT_LABELS[weight.id]} 중요도</span>
                        <span className={styles.importanceSliderTrack}>
                          <input
                            aria-label={`${WEIGHT_LABELS[weight.id]} 중요도`}
                            list="importance-ticks"
                            max={5}
                            min={1}
                            step={1}
                            style={
                              {
                                "--importance-pct": `${((weight.importance - 1) / 4) * 100}%`,
                              } as CSSProperties
                            }
                            type="range"
                            value={weight.importance}
                            onChange={(event) =>
                              setRecommendationWeightImportance(
                                weight.id,
                                Number(event.target.value) as WeightImportance,
                              )
                            }
                          />
                          <span className={styles.importanceTicks} aria-hidden="true">
                            <i>1</i>
                            <i>2</i>
                            <i>3</i>
                            <i>4</i>
                            <i>5</i>
                          </span>
                        </span>
                      </label>
                    ) : null}
                  </div>
                  {weight.enabled && weight.id === "free_days" ? (
                    <div className={styles.freeDayPreference}>
                      <div className={styles.dayChoices}>
                        {dayOffOptions.length === 0 ? (
                          <label className={`${styles.anyDayChoice} ${styles.anyDayChoiceDisabled}`}>
                            <input checked disabled type="checkbox" />
                            <span>불가능</span>
                          </label>
                        ) : (
                          <>
                            <label className={styles.anyDayChoice}>
                              <input
                                checked={
                                  (weight.config?.preferredFreeDays ?? []).filter((day) =>
                                    dayOffOptions.some((option) => option.id === day),
                                  ).length === 0
                                }
                                type="checkbox"
                                onChange={() => setFreeDaysConfig({ preferredFreeDays: [] })}
                              />
                              <span>상관없음</span>
                            </label>
                            {dayOffOptions.map(({ id, label }) => {
                              const checked = (weight.config?.preferredFreeDays ?? []).includes(id);
                              return (
                                <label className={styles.dayChoice} key={id}>
                                  <input
                                    checked={checked}
                                    type="checkbox"
                                    onChange={() => togglePreferredFreeDay(id)}
                                  />
                                  <span>{label}</span>
                                </label>
                              );
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {weight.enabled && weight.id === "lunch_break" ? (
                    <span className={styles.backToBackConfig}>
                      <input
                        aria-label="점심 시작 시각"
                        type="time"
                        value={formatMinutes(
                          weight.config?.lunchStartMinutes ?? DEFAULT_LUNCH_WINDOW_START_MINUTES,
                        )}
                        onChange={(event) => {
                          const minutes = parseTimeInputToMinutes(event.target.value);
                          if (minutes !== null) {
                            setLunchBreakConfig({ lunchStartMinutes: minutes });
                          }
                        }}
                      />
                      <span aria-hidden="true">~</span>
                      <input
                        aria-label="점심 종료 시각"
                        type="time"
                        value={formatMinutes(
                          weight.config?.lunchEndMinutes ?? DEFAULT_LUNCH_WINDOW_END_MINUTES,
                        )}
                        onChange={(event) => {
                          const minutes = parseTimeInputToMinutes(event.target.value);
                          if (minutes !== null) {
                            setLunchBreakConfig({ lunchEndMinutes: minutes });
                          }
                        }}
                      />
                    </span>
                  ) : null}
                  {weight.enabled && weight.id === "day_packing" ? (
                    <span className={styles.backToBackConfig}>
                      <select
                        aria-label="하루에 몰아듣기 / 여러날 나눠듣기"
                        value={weight.config?.packing ?? "compact"}
                        onChange={(event) =>
                          setDayPackingConfig({
                            packing: event.target.value as "compact" | "spread",
                          })
                        }
                      >
                        <option value="compact">하루에 몰아듣기</option>
                        <option value="spread">여러날 나눠듣기</option>
                      </select>
                    </span>
                  ) : null}
                  {weight.enabled && weight.id === "course_format" ? (
                    <span className={styles.backToBackConfig}>
                      <select
                        aria-label="대면/온라인 수업 선호"
                        value={weight.config?.format ?? "in_person"}
                        onChange={(event) =>
                          setCourseFormatConfig({
                            format: event.target.value as "in_person" | "online",
                          })
                        }
                      >
                        <option value="in_person">대면</option>
                        <option value="online">온라인</option>
                      </select>
                    </span>
                  ) : null}
                  {weight.enabled && weight.id === "back_to_back" ? (
                    <span className={styles.backToBackConfig}>
                      <select
                        aria-label="연강 선호/기피"
                        value={weight.config?.direction ?? "avoid"}
                        onChange={(event) =>
                          setBackToBackConfig({
                            direction: event.target.value as "prefer" | "avoid",
                          })
                        }
                      >
                        <option value="avoid">기피</option>
                        <option value="prefer">선호</option>
                      </select>
                      <input
                        aria-label="연강 기준 시간"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        type="number"
                        value={(weight.config?.thresholdMinutes ?? 180) / 60}
                        onChange={(event) =>
                          setBackToBackConfig({
                            thresholdMinutes: Number(event.target.value) * 60,
                          })
                        }
                      />
                      <span>시간 이상</span>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <label className={styles.customPreferenceInput}>
              <span>기타 원하는 조건 (자유 입력, 선택)</span>
              <textarea
                placeholder="예: 화요일엔 3교시 이후 수업만 듣고 싶어요"
                value={customPreference}
                onChange={(event) => setCustomPreference(event.target.value)}
              />
            </label>

            {recommendationError ? <p className={styles.error}>{recommendationError}</p> : null}
              </>
            )}
          </div>
          ) : null}

          {showAiResults ? (
          <div className={styles.recommendationSection}>
            <h3>AI 추천 결과</h3>
            {aiExplanationFailed && recommendations ? (
              <p className={styles.recommendationNotice}>
                Solar 추천 이유 생성에 실패해 가중치 기준 순위만 표시합니다.
              </p>
            ) : null}
            {recommendations && recommendations.length > 0 ? (
              <ol className={`${styles.timetableList} ${styles.aiRecommendationList}`}>
                {recommendations.map((recommendation) => {
                  const localEntry = aiCandidateTimetables.get(recommendation.candidateId);
                  const timetable = localEntry?.timetable ?? recommendation.timetable;
                  const extras = localEntry?.extras ?? [];
                  const hasFooterContent =
                    recommendation.reason ||
                    recommendation.requirementContribution ||
                    recommendation.customPreferenceNote;
                  return (
                    <TimetableCard
                      compact
                      extras={extras}
                      footer={
                        hasFooterContent ? (
                          <div className={styles.recommendationFooter}>
                            {recommendation.reason ? (
                              <p>
                                <span className={styles.recommendationLabel}>AI 추천 근거</span>
                                {recommendation.reason}
                              </p>
                            ) : null}
                            {recommendation.requirementContribution ? (
                              <p className={styles.recommendationRequirement}>
                                <span className={styles.recommendationLabel}>졸업요건 기여</span>
                                {recommendation.requirementContribution}
                              </p>
                            ) : null}
                            {recommendation.customPreferenceNote ? (
                              <p className={styles.recommendationCustomNote}>
                                <span className={styles.recommendationLabel}>입력하신 조건 반영</span>
                                {recommendation.customPreferenceNote}
                              </p>
                            ) : null}
                          </div>
                        ) : null
                      }
                      heading={`AI 추천 ${recommendation.rank}순위`}
                      index={recommendation.rank - 1}
                      key={recommendation.candidateId}
                      requiredCourseIds={requiredSectionIds}
                      timetable={timetable}
                    />
                  );
                })}
              </ol>
            ) : (
              <p className={styles.empty}>
                아직 추천 결과가 없습니다. 이전 화면에서 조건을 고른 뒤 AI 추천 받기를 눌러 주세요.
              </p>
            )}
          </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ElectivePreviewBoundary({
  children,
  onVisible,
}: {
  children: ReactNode;
  onVisible: () => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onVisibleRef.current();
          observer.disconnect();
        }
      },
      // 뷰포트 위·아래로 넉넉히 앞당겨 분반 미리보기를 시작한다 — 화면에 실제로 닿기 훨씬 전에
      // 로드를 걸어, 스크롤이 도착했을 땐 이미 분반 요약이 준비돼 있게 한다(자리확보와 함께 시프트↓).
      { rootMargin: "1400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.courseCatalogItem} ref={elementRef}>
      {children}
    </div>
  );
}

function filterCandidatesByProfessor(
  candidates: readonly CourseCandidate[],
  professorSearch: string,
): CourseCandidate[] {
  const query = professorSearch.trim().toLowerCase();
  if (!query) {
    return [...candidates];
  }
  return candidates.filter((candidate) =>
    (candidate.professor || "교수 미정").toLowerCase().includes(query),
  );
}

function CourseSectionDetails({
  group,
  selectedSectionIds,
  onSelectAllSections,
  onDeselectAllSections,
  onToggleSection,
}: {
  group: CourseCandidateGroup;
  selectedSectionIds: readonly string[];
  onSelectAllSections: () => void;
  onDeselectAllSections: () => void;
  onToggleSection: (sectionId: string) => void;
}) {
  const [professorSearch, setProfessorSearch] = useState("");
  const filteredCandidates = useMemo(
    () => filterCandidatesByProfessor(group.candidates, professorSearch),
    [group.candidates, professorSearch],
  );

  if (group.candidates.length === 1) {
    return (
      <div className={styles.singleCourseSection}>
        <CourseSectionMetadata candidate={group.candidates[0]!} />
        <span className={styles.sectionReviewActions}>
          <EverytimeReviewButton course={group.candidates[0]!} compact />
          <CourseReviewNoteButton course={group.candidates[0]!} compact />
        </span>
      </div>
    );
  }

  const allSelected = group.candidates.every((candidate) =>
    selectedSectionIds.includes(candidate.id),
  );
  const searchActive = professorSearch.trim().length > 0;

  return (
    <details className={styles.courseSectionDetails}>
      <summary>
        <span>분반별 교수·수업 방식</span>
        <small>
          {selectedSectionIds.length > 0
            ? `${selectedSectionIds.length}/${group.candidates.length} 선택`
            : `${group.candidates.length}개 분반`}
        </small>
      </summary>
      <label className={styles.professorSearchField}>
        <span className={styles.srOnly}>교수명 검색</span>
        <input
          placeholder="교수명 검색"
          type="search"
          value={professorSearch}
          onChange={(event) => setProfessorSearch(event.target.value)}
        />
      </label>
      {searchActive ? (
        <p className={styles.professorSearchMeta}>
          검색 결과 {filteredCandidates.length}개 / 전체 {group.candidates.length}개
        </p>
      ) : null}
      <div className={styles.sectionBulkActions}>
        <button
          type="button"
          onClick={allSelected ? onDeselectAllSections : onSelectAllSections}
        >
          {allSelected ? "분반 전체 선택 해제" : "분반 전체 선택"}
        </button>
      </div>
      {filteredCandidates.length === 0 ? (
        <p className={styles.professorSearchEmpty}>검색어와 일치하는 교수가 없습니다.</p>
      ) : (
        <div className={styles.courseSectionRows}>
          {filteredCandidates.map((candidate) => {
            const checked = selectedSectionIds.includes(candidate.id);
            return (
              <CourseSectionChoice
                candidate={candidate}
                checked={checked}
                key={candidate.id}
                onToggle={() => onToggleSection(candidate.id)}
              />
            );
          })}
        </div>
      )}
    </details>
  );
}

function SelectedSectionChoices({
  candidates,
  selectedSectionIds,
  onToggleSection,
}: {
  candidates: readonly CourseCandidate[];
  selectedSectionIds: readonly string[];
  onToggleSection: (sectionId: string) => void;
}) {
  const [professorSearch, setProfessorSearch] = useState("");
  const filteredCandidates = useMemo(
    () => filterCandidatesByProfessor(candidates, professorSearch),
    [candidates, professorSearch],
  );
  const searchActive = professorSearch.trim().length > 0;

  return (
    <div className={styles.selectedSectionChoices}>
      {candidates.length > 1 ? (
        <>
          <label className={styles.professorSearchField}>
            <span className={styles.srOnly}>교수명 검색</span>
            <input
              placeholder="교수명 검색"
              type="search"
              value={professorSearch}
              onChange={(event) => setProfessorSearch(event.target.value)}
            />
          </label>
          {searchActive ? (
            <p className={styles.professorSearchMeta}>
              검색 결과 {filteredCandidates.length}개 / 전체 {candidates.length}개
            </p>
          ) : null}
        </>
      ) : null}
      {filteredCandidates.length === 0 ? (
        <p className={styles.professorSearchEmpty}>검색어와 일치하는 교수가 없습니다.</p>
      ) : (
        <div className={styles.sectionChoices}>
          {filteredCandidates.map((candidate) => (
            <div className={styles.sectionChoiceRow} key={candidate.id}>
              <label>
                <input
                  checked={selectedSectionIds.includes(candidate.id)}
                  type="checkbox"
                  onChange={() => onToggleSection(candidate.id)}
                />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>
                    {candidate.professor || "교수 미정"} · {getCourseTypeLabel(candidate)}
                  </small>
                  <small>
                    {candidate.schedule || "시간 미정/온라인"}
                    {candidate.campus ? ` · ${candidate.campus}` : ""}
                  </small>
                </span>
              </label>
              <span className={styles.sectionReviewActions}>
                <EverytimeReviewButton course={candidate} compact />
                <CourseReviewNoteButton course={candidate} compact />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CourseSectionChoice({
  candidate,
  checked,
  onToggle,
}: {
  candidate: CourseCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`${styles.courseSectionChoice} ${checked ? styles.courseSectionChoiceSelected : ""}`}>
      <label>
        <input checked={checked} type="checkbox" onChange={onToggle} />
        <CourseSectionMetadata candidate={candidate} />
      </label>
      <span className={styles.sectionReviewActions}>
        <EverytimeReviewButton course={candidate} compact />
        <CourseReviewNoteButton course={candidate} compact />
      </span>
    </div>
  );
}

function CourseSectionMetadata({ candidate }: { candidate: CourseCandidate }) {
  return (
    <span className={styles.courseSectionRow}>
      <strong>{candidate.title}</strong>
      <small>
        {candidate.professor || "교수 미정"} · {getCourseTypeLabel(candidate)}
      </small>
      <small>
        {candidate.schedule || "시간 미정/온라인"}
        {candidate.campus ? ` · ${candidate.campus}` : ""}
      </small>
    </span>
  );
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(readCourseApiError(payload));
  }
  return payload;
}

/** Lists the non-required subjects a generated timetable drew from each choice group. */
/**
 * Grounds "졸업요건 기여" entirely in the candidate's own courses instead of trusting Solar:
 * looks at the timetable's extra(교양) courses, keeps those whose 영역 actually matches an unmet
 * general requirement, and names them. Returns null when nothing genuinely contributes — which is
 * exactly what stops the old "실제로는 기여 안 하는데 기여한다고 함"(예: 근거 없는 DS기반) 문제.
 * Required(고정) 과목은 extras에 포함되지 않으므로 자연히 제외된다.
 */
function describeRequirementContribution(
  extras: readonly TimetableExtra[],
  unmetGeneralLabels: readonly string[],
): string | null {
  if (unmetGeneralLabels.length === 0) {
    return null;
  }
  const contributing = extras.filter((extra) =>
    areaMatchesUnmetLabels(extra.classification, unmetGeneralLabels),
  );
  if (contributing.length === 0) {
    return null;
  }
  const areaLabels = [...new Set(contributing.map((extra) => extra.classification))].join("·");
  const courseNames = [...new Set(contributing.map((extra) => `"${extra.title}"`))].join(", ");
  return `교양 과목 ${courseNames}이(가) ${areaLabels} 영역 졸업요건 충족에 도움이 됩니다.`;
}

function describeTimetableExtras(
  timetable: Timetable,
  sectionIdToGroup: ReadonlyMap<string, PlannerCourseGroup>,
  courseOwners: Readonly<Record<string, CourseDestination>>,
  choiceGroups: readonly ChoiceGroupConfig[],
  fillerExtrasBySectionId?: ReadonlyMap<string, TimetableExtra>,
): TimetableExtra[] {
  const seenSubjectIds = new Set<string>();
  const extras: TimetableExtra[] = [];
  for (const course of timetable.courses) {
    const fillerExtra = fillerExtrasBySectionId?.get(course.id);
    if (fillerExtra && !seenSubjectIds.has(fillerExtra.title)) {
      seenSubjectIds.add(fillerExtra.title);
      extras.push(fillerExtra);
      continue;
    }
    const group = sectionIdToGroup.get(course.id);
    if (!group || seenSubjectIds.has(group.selectionId)) {
      continue;
    }
    const owner = courseOwners[group.selectionId] ?? "required";
    const choiceGroup = choiceGroups.find(({ id }) => id === owner);
    if (!choiceGroup) {
      continue;
    }
    seenSubjectIds.add(group.selectionId);
    extras.push({
      groupTitle: choiceGroup.title,
      title: group.title,
      classification: group.classification || "영역 미상",
    });
  }
  return extras;
}

function isDayFree(timetable: Timetable, day: Weekday): boolean {
  return !timetable.meetings.some((meeting) => meeting.day === day) &&
    !timetable.fixedEvents.some((event) => event.day === day);
}

interface ScheduleConflictPair {
  firstLabel: string;
  secondLabel: string;
}

/**
 * Compares every currently-checked section (과목명 + 분반 + 요일/시간, the smallest unit a user can
 * pick) across every course card in "담은 과목 확인" and returns each pair whose meetings overlap.
 * Deliberately a plain function called from a button click (not a useMemo) — the result must only
 * refresh when the user explicitly re-checks, not on every checkbox toggle.
 */
function findScheduleConflicts(
  groups: readonly PlannerCourseGroup[],
  enabledSectionIds: Record<string, string[]>,
): ScheduleConflictPair[] {
  const instances: Array<{ groupId: string; label: string; meetings: Meeting[] }> = [];
  for (const group of groups) {
    const enabledIds = new Set(
      enabledSectionIds[group.selectionId] ?? getInitialSectionIds(group.candidates),
    );
    for (const candidate of group.candidates) {
      if (!enabledIds.has(candidate.id)) {
        continue;
      }
      const label = candidate.campus ? `${candidate.title} (${candidate.campus})` : candidate.title;
      instances.push({
        groupId: group.selectionId,
        label,
        meetings: parseSchedule(candidate.schedule),
      });
    }
  }

  const conflicts: ScheduleConflictPair[] = [];
  for (let i = 0; i < instances.length; i += 1) {
    for (let j = i + 1; j < instances.length; j += 1) {
      const first = instances[i];
      const second = instances[j];
      // Sections of the same course are alternatives, never taken together — comparing them
      // against each other would just flag "conflicts" between choices the user picks between.
      if (first.groupId === second.groupId) {
        continue;
      }
      const overlaps = first.meetings.some((firstMeeting) =>
        second.meetings.some((secondMeeting) => meetingsConflict(firstMeeting, secondMeeting)),
      );
      if (overlaps) {
        conflicts.push({ firstLabel: first.label, secondLabel: second.label });
      }
    }
  }
  return conflicts;
}

/** Parses an `<input type="time">` value ("HH:MM", 24-hour) into minutes since midnight. */
function parseTimeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

async function fetchElectivePlannerGroup(
  query: SkkuCourseQuery,
  campus: SkkuElectiveCampus,
  subject: SkkuElectiveSubject,
): Promise<PlannerCourseGroup> {
  const payload = await postJson("/api/skku-electives", {
    year: query.year,
    term: query.term,
    campus,
    mode: "sections",
    courseNumber: subject.courseNumber,
  });
  const [group] = courseGroupsFromCollection(payload);
  if (!group) {
    throw new Error("선택한 교양 과목의 개설 분반이 없습니다.");
  }
  return scopeElectiveGroup(group, campus);
}

function getElectiveCatalogKey(query: SkkuCourseQuery, campus: SkkuElectiveCampus): string {
  return `${query.year}:${query.term}:${campus}`;
}

function getElectiveSelectionId(campus: SkkuElectiveCampus, courseNumber: string): string {
  return `elective:${campus}:${courseNumber}`;
}

function getCampusLabel(campus: SkkuElectiveCampus): string {
  return CAMPUS_OPTIONS.find((option) => option.value === campus)?.shortLabel ?? "선택 캠퍼스";
}

function getCourseTypeLabel(candidate: {
  campus?: string;
  courseType?: string;
  schedule: string;
}): string {
  if (candidate.courseType?.trim()) {
    return candidate.courseType.trim();
  }
  const onlineHint = `${candidate.campus ?? ""} ${candidate.schedule}`
    .replaceAll("-", "")
    .toLowerCase();
  return onlineHint.includes("icampus") ? "온라인(I-CAMPUS)" : "수업 방식 미정";
}

/**
 * Returns a shallow copy with only the sections whose lecture format is still allowed.
 * Never mutates the original group, so callers may safely keep pointing at the raw,
 * unfiltered group for anything that gets written back into persistent state.
 */
function filterGroupCandidatesByFormat<G extends { candidates: CourseCandidate[] }>(
  group: G,
  disabledCourseTypes: ReadonlySet<string>,
): G {
  if (disabledCourseTypes.size === 0) {
    return group;
  }
  return {
    ...group,
    candidates: group.candidates.filter(
      (candidate) => !disabledCourseTypes.has(getCourseTypeLabel(candidate)),
    ),
  };
}

function getDestinationLabel(
  destination: CourseDestination | undefined,
  choiceGroups: readonly ChoiceGroupConfig[],
): string {
  if (!destination || destination === "required") {
    return "필수";
  }
  return choiceGroups.find(({ id }) => id === destination)?.title ?? "필수";
}

function getChoiceGroupButtonLabel(choiceGroup: ChoiceGroupConfig, index: number): string {
  const defaultTitle = `선택 묶음 ${index + 1}`;
  return choiceGroup.title.trim() === defaultTitle ? `선택 ${index + 1}` : choiceGroup.title;
}

function getNextChoiceGroupNumber(groups: readonly ChoiceGroupConfig[]): number {
  return groups.reduce((nextNumber, { id }) => {
    const match = /^choice-(\d+)$/.exec(id);
    return match ? Math.max(nextNumber, Number(match[1]) + 1) : nextNumber;
  }, 2);
}

function scopeElectiveGroup(
  group: CourseCandidateGroup,
  campus: SkkuElectiveCampus,
): PlannerCourseGroup {
  const campusLabel = getCampusLabel(campus);
  return {
    ...group,
    selectionId: getElectiveSelectionId(campus, group.id),
    source: "elective",
    campus,
    candidates: group.candidates.map((candidate) => ({
      ...candidate,
      id: `${campus}:${candidate.id}`,
      title: `${candidate.title} · ${campusLabel}`,
    })),
  };
}

function readElectiveCatalog(value: unknown): ElectiveCatalog {
  return {
    areas: readElectiveAreas(value),
    subjects: readElectiveSubjects(value),
  };
}

function readElectiveAreas(value: unknown): SkkuElectiveArea[] {
  if (!isRecord(value) || !Array.isArray(value.areas)) {
    throw new Error("교양 영역 응답 형식이 올바르지 않습니다.");
  }
  return value.areas.flatMap((area) => {
    if (
      !isRecord(area) ||
      typeof area.code !== "string" ||
      typeof area.label !== "string" ||
      typeof area.count !== "number"
    ) {
      return [];
    }
    return [{ code: area.code as SkkuElectiveAreaCode, label: area.label, count: area.count }];
  });
}

function readElectiveSubjects(value: unknown): SkkuElectiveSubject[] {
  if (!isRecord(value) || !Array.isArray(value.subjects)) {
    throw new Error("교양 과목 응답 형식이 올바르지 않습니다.");
  }
  return value.subjects.flatMap((subject) => {
    if (
      !isRecord(subject) ||
      typeof subject.areaCode !== "string" ||
      typeof subject.courseNumber !== "string" ||
      typeof subject.name !== "string"
    ) {
      return [];
    }
    return [{
      areaCode: subject.areaCode as SkkuElectiveAreaCode,
      courseNumber: subject.courseNumber,
      name: subject.name,
    }];
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function readThrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : "개설강좌를 불러오지 못했습니다.";
}

const GENERIC_EMPTY_TIMETABLE_DIAGNOSIS = {
  title: "조건을 만족하는 조합이 없어요",
  detail: "요일·시작 시간이나 과목 그룹을 조정해 보세요.",
};

function describeEmptyTimetableDiagnosis(
  diagnosis: EmptyTimetableDiagnosis | null,
): { title: string; detail: string } {
  if (!diagnosis) {
    return GENERIC_EMPTY_TIMETABLE_DIAGNOSIS;
  }
  switch (diagnosis.reason) {
    case "credit_range_unreachable":
      return {
        title: "총 학점을 12~21학점 사이로 조정해 주세요",
        detail: "",
      };
    case "no_available_sections":
      return {
        title: "들을 수 있는 분반이 없어요",
        detail: `“${diagnosis.subjectTitle}”이(가) 요일·시작 시간 조건이나 고정 일정과 모두 겹쳐요. 조건을 확인해 주세요.`,
      };
    case "schedule_conflict":
      return {
        title: "시간이 겹치는 과목이 있어요",
        detail: "담은 과목끼리 시간표를 만들 수 없게 겹쳐요. 분반이나 과목 구성을 조정해 주세요.",
      };
    default:
      return GENERIC_EMPTY_TIMETABLE_DIAGNOSIS;
  }
}

function readCourseApiError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "개설강좌를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function readRecommendationResponse(value: unknown): {
  recommendations: TimetableRecommendationItem[];
  aiExplanationFailed: boolean;
} {
  if (!isRecord(value) || !Array.isArray(value.recommendations)) {
    throw new Error("추천 결과 형식이 올바르지 않습니다.");
  }
  return {
    recommendations: value.recommendations as TimetableRecommendationItem[],
    aiExplanationFailed: value.aiExplanationFailed === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
