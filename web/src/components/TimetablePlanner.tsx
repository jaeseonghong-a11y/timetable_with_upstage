"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  courseGroupsFromCollection,
  shouldShowSectionDetails,
  type CourseCandidateGroup,
} from "@/lib/course-candidates";
import type {
  SkkuCourseQuery,
  SkkuElectiveArea,
  SkkuElectiveAreaCode,
  SkkuElectiveCampus,
  SkkuElectiveSubject,
} from "@/lib/skku-course-api";
import {
  generateTimetablesForSelectionPlan,
  getInitialSectionIds,
  removeSubjectsOwnedBy,
  SelectionPlanError,
  SelectionPlanLimitError,
  type SubjectOption,
} from "@/lib/selection-plan";
import {
  CombinationLimitError,
  mergeMeetingsForDisplay,
  parseSchedule,
  type CourseCandidate,
  type Timetable,
  type Weekday,
} from "@/lib/timetable";

import styles from "./TimetablePlanner.module.css";

interface Props {
  query: SkkuCourseQuery | null;
  queryLabel: string;
  excludedCourseNumbers: readonly string[];
}

const DAYS: ReadonlyArray<{ id: Weekday; label: string }> = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
];

const START_OPTIONS = [
  { value: "", label: "상관없음" },
  { value: "600", label: "10:00 이후" },
  { value: "720", label: "12:00 이후" },
] as const;

type CourseSource = "major" | "elective";

interface PlannerCourseGroup extends CourseCandidateGroup {
  selectionId: string;
  source: CourseSource;
  campus?: SkkuElectiveCampus;
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
  { id: "choice-1", title: "선택 그룹 1", minSubjects: 1, maxSubjects: 1 },
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

const TIMETABLE_START_MINUTES = 8 * 60;
const TIMETABLE_END_MINUTES = 22 * 60;
const PIXELS_PER_MINUTE = 0.8;

export function TimetablePlanner({ query, queryLabel, excludedCourseNumbers }: Props) {
  const [majorCourseGroups, setMajorCourseGroups] = useState<CourseCandidateGroup[]>([]);
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
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [choiceGroups, setChoiceGroups] = useState<ChoiceGroupConfig[]>(INITIAL_CHOICE_GROUPS);
  const [activeDestination, setActiveDestination] = useState<CourseDestination>("choice-1");
  const [courseOwners, setCourseOwners] = useState<Record<string, CourseDestination>>({});
  const [enabledSectionIds, setEnabledSectionIds] = useState<Record<string, string[]>>({});
  const [unavailableDays, setUnavailableDays] = useState<Weekday[]>([]);
  const [earliestStart, setEarliestStart] = useState("");
  const [minimumCredits, setMinimumCredits] = useState("15");
  const [maximumCredits, setMaximumCredits] = useState("18");
  const [courseSearch, setCourseSearch] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [electiveError, setElectiveError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isElectiveLoading, setIsElectiveLoading] = useState(false);
  const [loadingCourseNumbers, setLoadingCourseNumbers] = useState<string[]>([]);
  const [previewLoadingIds, setPreviewLoadingIds] = useState<string[]>([]);
  const nextChoiceGroupId = useRef(2);
  const electivePreviewRequestIds = useRef(new Set<string>());
  const electivePreviewQueue = useRef<Promise<void>>(Promise.resolve());
  const electivePreviewGeneration = useRef(0);

  useEffect(() => {
    if (!query) {
      return;
    }
    const activeQuery = query;
    electivePreviewGeneration.current += 1;
    electivePreviewRequestIds.current.clear();
    electivePreviewQueue.current = Promise.resolve();
    const controller = new AbortController();
    async function loadCourses(): Promise<void> {
      setIsLoading(true);
      setCollectionError("");
      setElectiveError("");
      setMajorCourseGroups([]);
      setElectiveCourseGroups([]);
      setElectivePreviewGroups({});
      setElectiveCatalogs({});
      setElectiveCampus(activeQuery.campus);
      setSelectedElectiveArea("all");
      setCourseSource("major");
      setSelectedGroupIds([]);
      setChoiceGroups(INITIAL_CHOICE_GROUPS);
      setActiveDestination("choice-1");
      setCourseOwners({});
      setEnabledSectionIds({});
      setPreviewLoadingIds([]);
      nextChoiceGroupId.current = 2;
      try {
        const majorResult = await postJson("/api/skku-courses", activeQuery, controller.signal);
        setMajorCourseGroups(courseGroupsFromCollection(majorResult));
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setCollectionError(readThrownMessage(error));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }
    void loadCourses();
    return () => controller.abort();
  }, [query]);

  function selectCourseGroup(group: PlannerCourseGroup, destination = activeDestination): void {
    setSelectedGroupIds((ids) => [...new Set([...ids, group.selectionId])]);
    setCourseOwners((owners) => ({ ...owners, [group.selectionId]: destination }));
    setEnabledSectionIds((sections) => ({
      ...sections,
      [group.selectionId]: getInitialSectionIds(group.candidates),
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

  function toggleMajorCourseGroup(group: PlannerCourseGroup): void {
    if (selectedGroupIds.includes(group.selectionId)) {
      removeSelectedCourse(group);
    } else {
      selectCourseGroup(group);
    }
  }

  function addChoiceGroup(): void {
    const number = nextChoiceGroupId.current;
    nextChoiceGroupId.current += 1;
    const group = {
      id: `choice-${number}`,
      title: `선택 그룹 ${number}`,
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

  function toggleSection(group: PlannerCourseGroup, sectionId: string): void {
    setEnabledSectionIds((sections) => {
      const current = sections[group.selectionId] ?? getInitialSectionIds(group.candidates);
      return {
        ...sections,
        [group.selectionId]: current.includes(sectionId)
          ? current.filter((id) => id !== sectionId)
          : [...current, sectionId],
      };
    });
  }

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
      setElectiveCatalogs((catalogs) => ({
        ...catalogs,
        [catalogKey]: readElectiveCatalog(payload),
      }));
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
    electivePreviewQueue.current = electivePreviewQueue.current.then(loadPreview, loadPreview);
  }

  async function toggleElectiveSubject(subject: SkkuElectiveSubject): Promise<void> {
    const campus = electiveCampus;
    const selectionId = getElectiveSelectionId(campus, subject.courseNumber);
    const existing = electiveCourseGroups.find((group) => group.selectionId === selectionId);
    if (existing) {
      removeSelectedCourse(existing);
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
    (): PlannerCourseGroup[] => [
      ...majorCourseGroups.map((group) => ({
        ...group,
        selectionId: `major:${group.id}`,
        source: "major" as const,
      })),
      ...electiveCourseGroups,
    ],
    [electiveCourseGroups, majorCourseGroups],
  );
  const availableCourseGroups = useMemo(
    () => courseGroups.filter((group) => !excludedCourseSet.has(group.id.trim().toUpperCase())),
    [courseGroups, excludedCourseSet],
  );
  const visibleCourseGroups = useMemo(() => {
    const keyword = courseSearch.trim().toLowerCase();
    if (!keyword) {
      return availableCourseGroups;
    }
    return availableCourseGroups.filter((group) =>
      `${group.id} ${group.title} ${group.classification}`.toLowerCase().includes(keyword),
    );
  }, [availableCourseGroups, courseSearch]);
  const visibleMajorCourseGroups = useMemo(
    () => visibleCourseGroups.filter((group) => group.source === "major"),
    [visibleCourseGroups],
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
  const choiceGroupSubjectCounts = useMemo(
    () =>
      new Map(
        choiceGroups.map((choiceGroup) => [
          choiceGroup.id,
          selectedCourseGroups.filter(
            ({ selectionId }) => courseOwners[selectionId] === choiceGroup.id,
          ).length,
        ]),
      ),
    [choiceGroups, courseOwners, selectedCourseGroups],
  );

  const result = useMemo(() => {
    if (selectedCourseGroups.length === 0) {
      return { timetables: [], error: null };
    }
    try {
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
          sections: group.candidates.filter(({ id }) => enabledIds.has(id)),
        };
        const owner = courseOwners[group.selectionId] ?? "required";
        if (owner === "required" || !choiceGroupIds.has(owner)) {
          requiredSubjects.push(subject);
        } else {
          choiceSubjects.get(owner)?.push(subject);
        }
      }

      return {
        timetables: generateTimetablesForSelectionPlan(
          {
            requiredSubjects,
            choiceBags: choiceGroups.flatMap((choiceGroup) => {
              const subjects = choiceSubjects.get(choiceGroup.id) ?? [];
              return subjects.length > 0
                ? [{
                    ...choiceGroup,
                    subjects,
                  }]
                : [];
            }),
            creditRange: {
              minCredits: minimumCredits === "" ? Number.NaN : Number(minimumCredits),
              maxCredits: maximumCredits === "" ? Number.NaN : Number(maximumCredits),
            },
          },
          {
            unavailableDays,
            earliestStartMinutes: earliestStart ? Number(earliestStart) : undefined,
          },
        ),
        error: null,
      };
    } catch (error) {
      return {
        timetables: [],
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
    earliestStart,
    enabledSectionIds,
    maximumCredits,
    minimumCredits,
    selectedCourseGroups,
    unavailableDays,
  ]);

  const excludedCount = courseGroups.length - availableCourseGroups.length;

  return (
    <section className={styles.planner} aria-label="시간표 조합">
      <div className={styles.notice}>
        <div>
          <strong>{query ? queryLabel : "개설강좌 조회 전"}</strong>
          <span>
            {query
              ? "선택한 소속 범위의 공개 개설강좌를 서버에서 직접 조회합니다."
              : "위 기본정보를 입력하면 해당 소속의 실제 개설강좌가 여기에 표시됩니다."}
          </span>
        </div>
        {isLoading || isElectiveLoading ? (
          <span className={styles.loadingBadge}>성대 강좌 조회 중…</span>
        ) : null}
      </div>
      {collectionError ? <p className={styles.collectionError} role="alert">{collectionError}</p> : null}
      {electiveError ? <p className={styles.collectionError} role="alert">{electiveError}</p> : null}

      <div className={styles.grid}>
        <aside className={styles.controls}>
          <fieldset>
            <legend>넣을 과목</legend>
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
                <small className={styles.electiveCatalogNote}>
                  캠퍼스별 과목을 따로 찾아 함께 선택할 수 있습니다. 캠퍼스 간 이동 제한은 추후
                  추천 단계에서 적용합니다.
                </small>
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
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className={styles.assignmentTarget}>
              <span>새로 선택한 과목을 담을 곳</span>
              <select
                value={activeDestination}
                onChange={(event) => setActiveDestination(event.target.value)}
              >
                <option value="required">필수 과목 · 모든 조합에 포함</option>
                {choiceGroups.map((choiceGroup) => (
                  <option key={choiceGroup.id} value={choiceGroup.id}>
                    {choiceGroup.title} · {choiceGroup.minSubjects}~{choiceGroup.maxSubjects}과목 선택
                  </option>
                ))}
              </select>
              <small>과목을 체크하면 이 위치에 들어갑니다. 아래에서 언제든 옮길 수 있습니다.</small>
            </label>
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
            <div className={styles.courseList}>
              {courseSource === "major" ? visibleMajorCourseGroups.map((group) => {
                const checked = selectedGroupIds.includes(group.selectionId);
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
                          : `${group.candidates.length}개 분반`}
                      </small>
                    </label>
                    {shouldShowSectionDetails(group.candidates.length, checked)
                      ? <CourseSectionDetails group={group} />
                      : null}
                  </div>
                );
              }) : visibleElectiveSubjects.map((subject) => {
                const selectionId = getElectiveSelectionId(electiveCampus, subject.courseNumber);
                const selectedGroup = electiveCourseGroups.find(
                  (group) => group.selectionId === selectionId,
                );
                const previewGroup = electivePreviewGroups[selectionId];
                const checked = Boolean(selectedGroup);
                const loading = loadingCourseNumbers.includes(selectionId);
                const previewLoading = previewLoadingIds.includes(selectionId);
                const displayedGroup = selectedGroup ?? previewGroup;
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
                            : previewGroup
                              ? `${previewGroup.candidates.length}개 분반`
                              : previewLoading
                                ? "분반 확인 중…"
                                : "선택"}
                      </small>
                    </label>
                    {displayedGroup && shouldShowSectionDetails(
                      displayedGroup.candidates.length,
                      checked,
                    )
                      ? <CourseSectionDetails group={displayedGroup} />
                      : null}
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

            <section className={styles.selectionPlanEditor} aria-label="과목 조합 설정">
              <div className={styles.selectionPlanHeading}>
                <div>
                  <strong>과목 조합 설정</strong>
                  <small>각 선택 그룹에서 몇 과목을 고를지 정합니다.</small>
                </div>
                <button type="button" onClick={addChoiceGroup}>+ 선택 그룹 추가</button>
              </div>

              <div className={styles.choiceGroupRules}>
                <div className={styles.requiredRule}>
                  <span>필수 과목</span>
                  <strong>
                    {selectedCourseGroups.filter(
                      ({ selectionId }) =>
                        !courseOwners[selectionId] || courseOwners[selectionId] === "required",
                    ).length}개
                  </strong>
                  <small>모든 시간표에 들어갑니다.</small>
                </div>
                {choiceGroups.map((choiceGroup) => (
                  <div className={styles.choiceGroupRule} key={choiceGroup.id}>
                    <label>
                      <span className={styles.srOnly}>선택 그룹 이름</span>
                      <input
                        type="text"
                        value={choiceGroup.title}
                        onChange={(event) =>
                          updateChoiceGroup(choiceGroup.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <div className={styles.cardinalityInputs}>
                      <label>
                        <span>최소</span>
                        <input
                          min="0"
                          max="20"
                          type="number"
                          value={choiceGroup.minSubjects}
                          onChange={(event) =>
                            updateChoiceGroup(choiceGroup.id, {
                              minSubjects: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <span>~</span>
                      <label>
                        <span>최대</span>
                        <input
                          min="0"
                          max="20"
                          type="number"
                          value={choiceGroup.maxSubjects}
                          onChange={(event) =>
                            updateChoiceGroup(choiceGroup.id, {
                              maxSubjects: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <small>{choiceGroupSubjectCounts.get(choiceGroup.id) ?? 0}개 후보</small>
                    <button
                      aria-label={`${choiceGroup.title} 삭제`}
                      className={styles.removeChoiceGroup}
                      type="button"
                      onClick={() => removeChoiceGroup(choiceGroup.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>

              {selectedCourseGroups.length > 0 ? (
                <div className={styles.selectedSubjectList}>
                  {selectedCourseGroups.map((group) => {
                    const selectedSections = enabledSectionIds[group.selectionId]
                      ?? getInitialSectionIds(group.candidates);
                    const owner = courseOwners[group.selectionId] ?? "required";
                    return (
                      <details className={styles.selectedSubject} key={group.selectionId}>
                        <summary>
                          <span>
                            <strong>{group.title}</strong>
                            <small>{group.id}</small>
                          </span>
                          <small>
                            {getDestinationLabel(owner, choiceGroups)} · 분반 {selectedSections.length}/
                            {group.candidates.length}
                          </small>
                        </summary>
                        <div className={styles.subjectConfiguration}>
                          <label className={styles.subjectDestination}>
                            <span>과목 위치</span>
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
                          <button
                            className={styles.removeSelectedCourse}
                            type="button"
                            onClick={() => removeSelectedCourse(group)}
                          >
                            이 과목 선택 해제
                          </button>
                          <div className={styles.sectionChoices}>
                            {group.candidates.map((candidate) => (
                              <label key={candidate.id}>
                                <input
                                  checked={selectedSections.includes(candidate.id)}
                                  type="checkbox"
                                  onChange={() => toggleSection(group, candidate.id)}
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
                            ))}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.selectionPlanEmpty}>
                  과목을 선택하면 여기서 그룹 이동과 분반 선택을 할 수 있습니다.
                </p>
              )}
            </section>
          </fieldset>

          <fieldset>
            <legend>수업 없는 요일</legend>
            <div className={styles.dayChoices}>
              {DAYS.map(({ id, label }) => {
                const checked = unavailableDays.includes(id);
                return (
                  <label className={styles.dayChoice} key={id}>
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={() =>
                        setUnavailableDays((days) =>
                          checked ? days.filter((day) => day !== id) : [...days, id],
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className={styles.startSelect}>
            <span>첫 수업</span>
            <select value={earliestStart} onChange={(event) => setEarliestStart(event.target.value)}>
              {START_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend>원하는 학점 범위</legend>
            <div className={styles.creditRangeInputs}>
              <label>
                <span>최소</span>
                <input
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  type="number"
                  value={minimumCredits}
                  onChange={(event) => setMinimumCredits(event.target.value)}
                />
              </label>
              <span aria-hidden="true">~</span>
              <label>
                <span>최대</span>
                <input
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  type="number"
                  value={maximumCredits}
                  onChange={(event) => setMaximumCredits(event.target.value)}
                />
              </label>
            </div>
            <small>과목 학점은 선택한 분반 수와 관계없이 과목당 한 번만 합산합니다.</small>
          </fieldset>
        </aside>

        <div className={styles.results} aria-live="polite">
          <div className={styles.resultHeading}>
            <div>
              <p>유효 시간표</p>
              <h2>{result.timetables.length}개</h2>
            </div>
            <span>순위 없음 · {minimumCredits || "?"}~{maximumCredits || "?"}학점</span>
          </div>

          {result.error ? <p className={styles.error}>{result.error}</p> : null}
          {!result.error && effectiveSelectedGroupIds.length === 0 ? (
            <p className={styles.empty}>왼쪽에서 필수 과목이나 선택 그룹 후보를 추가해 주세요.</p>
          ) : null}
          {!result.error && effectiveSelectedGroupIds.length > 0 && result.timetables.length === 0 ? (
            <p className={styles.empty}>
              조건을 만족하는 조합이 없습니다. 학점·요일·시작 시간이나 과목 그룹을 조정해 보세요.
            </p>
          ) : null}
          {!result.error && result.timetables.length > 0 ? (
            <ol className={styles.timetableList}>
              {result.timetables.map((timetable, index) => (
                <TimetableCard
                  index={index}
                  key={timetable.courses.map(({ id }) => id).join("-")}
                  timetable={timetable}
                />
              ))}
            </ol>
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
      { rootMargin: "120px 0px" },
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

function CourseSectionDetails({ group }: { group: CourseCandidateGroup }) {
  if (group.candidates.length === 1) {
    return (
      <div className={styles.singleCourseSection}>
        <CourseSectionRow candidate={group.candidates[0]!} />
      </div>
    );
  }

  return (
    <details className={styles.courseSectionDetails}>
      <summary>
        <span>분반별 교수·수업 방식</span>
        <small>{group.candidates.length}개</small>
      </summary>
      <div className={styles.courseSectionRows}>
        {group.candidates.map((candidate) => (
          <CourseSectionRow candidate={candidate} key={candidate.id} />
        ))}
      </div>
    </details>
  );
}

function CourseSectionRow({ candidate }: { candidate: CourseCandidate }) {
  return (
    <div className={styles.courseSectionRow}>
      <strong>{candidate.section ? `${candidate.section}분반` : "분반 미정"}</strong>
      <span>{candidate.professor || "교수 미정"}</span>
      <span>{getCourseTypeLabel(candidate)}</span>
    </div>
  );
}

function TimetableCard({ index, timetable }: { index: number; timetable: Timetable }) {
  const scheduledCourses = timetable.courses.flatMap((course, courseIndex) =>
    mergeMeetingsForDisplay(parseSchedule(course.schedule)).map((meeting) => ({
      course,
      courseIndex,
      meeting,
    })),
  );
  const unscheduledCourses = timetable.courses.filter(
    (course) => parseSchedule(course.schedule).length === 0,
  );
  const totalCredits = timetable.courses.reduce(
    (credits, course) => credits + (course.credits ?? 0),
    0,
  );

  return (
    <li className={styles.timetableCard}>
      <details open={index === 0}>
        <summary>
          <span>조합 {index + 1}</span>
          <small>
            {timetable.courses.length}과목 · {formatCredits(totalCredits)}학점 · 눌러서 시간표{" "}
            {index === 0 ? "접기" : "보기"}
          </small>
        </summary>
        <div className={styles.weeklyViewport}>
          <div className={styles.weeklyTimetable}>
            <div className={styles.weekHeader}>
              <span aria-hidden="true" />
              {DAYS.map((day) => <strong key={day.id}>{day.label}</strong>)}
            </div>
            <div
              className={styles.weekBody}
              style={{
                height: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
              }}
            >
              {Array.from(
                { length: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) / 60 + 1 },
                (_, hourIndex) => {
                  const minutes = TIMETABLE_START_MINUTES + hourIndex * 60;
                  const top = (minutes - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE;
                  return (
                    <div className={styles.hourLine} key={minutes} style={{ top }}>
                      <span>{formatMinutes(minutes)}</span>
                    </div>
                  );
                },
              )}
              <div className={styles.dayColumns}>
                {DAYS.map((day) => (
                  <div className={styles.dayColumn} key={day.id}>
                    {scheduledCourses
                      .filter(({ meeting }) => meeting.day === day.id)
                      .map(({ course, courseIndex, meeting }) => {
                        const visibleStart = Math.max(meeting.startMinutes, TIMETABLE_START_MINUTES);
                        const visibleEnd = Math.min(meeting.endMinutes, TIMETABLE_END_MINUTES);
                        if (visibleStart >= visibleEnd) {
                          return null;
                        }
                        return (
                          <div
                            className={styles.courseBlock}
                            data-color={courseIndex % 6}
                            key={`${course.id}-${meeting.startMinutes}`}
                            style={{
                              top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                              height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                            }}
                            title={`${course.title} · ${formatMinutes(meeting.startMinutes)}-${formatMinutes(meeting.endMinutes)}`}
                          >
                            <strong>{course.title}</strong>
                            <small>{formatMinutes(meeting.startMinutes)}-{formatMinutes(meeting.endMinutes)}</small>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {unscheduledCourses.length > 0 ? (
          <p className={styles.unscheduledNotice}>
            시간 미정/온라인: {unscheduledCourses.map((course) => course.title).join(", ")}
          </p>
        ) : null}
      </details>
    </li>
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

function formatCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(1)));
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

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function readThrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : "개설강좌를 불러오지 못했습니다.";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
