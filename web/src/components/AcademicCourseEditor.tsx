import { useMemo, useState } from "react";

import type { AcademicProfile, CompletedCourse } from "@/lib/academic-profile";
import {
  formatTermLabel,
  getCourseDisplayNumbers,
  groupCompletedCoursesForReview,
} from "@/lib/course-history-grouping";

import styles from "./AcademicDocumentManager.module.css";

interface Props {
  profile: AcademicProfile;
  onChange: (profile: AcademicProfile) => void;
}

export function AcademicCourseEditor({ profile, onChange }: Props) {
  const [courseSearch, setCourseSearch] = useState("");
  const groupedCourses = useMemo(
    () => groupCompletedCoursesForReview(profile.completedCourses),
    [profile.completedCourses],
  );
  const classifications = groupedCourses.map((group) => group.classification);
  const needsReviewCount = profile.completedCourses.filter(
    (course) => course.reviewReasons.length > 0,
  ).length;
  const sourceDocumentId = profile.sourceDocuments[0]?.id;
  const searchQuery = courseSearch.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!searchQuery) {
      return groupedCourses;
    }
    return groupedCourses
      .map((group) => ({
        ...group,
        yearGroups: group.yearGroups
          .map((yearGroup) => ({
            ...yearGroup,
            termGroups: yearGroup.termGroups
              .map((termGroup) => ({
                ...termGroup,
                entries: termGroup.entries.filter(({ course }) => matchesCourseSearch(course, searchQuery)),
              }))
              .filter((termGroup) => termGroup.entries.length > 0),
          }))
          .filter((yearGroup) => yearGroup.termGroups.length > 0),
      }))
      .filter((group) => group.yearGroups.length > 0);
  }, [groupedCourses, searchQuery]);

  const visibleCourseCount = useMemo(
    () =>
      filteredGroups.reduce(
        (total, group) =>
          total +
          group.yearGroups.reduce(
            (yearTotal, yearGroup) =>
              yearTotal +
              yearGroup.termGroups.reduce(
                (termTotal, termGroup) => termTotal + termGroup.entries.length,
                0,
              ),
            0,
          ),
        0,
      ),
    [filteredGroups],
  );

  // Collapsing only ever applies per 이수구분 group now, never per individual course. Starts
  // fully collapsed so the first thing shown after analysis is a manageable overview, not every
  // field open at once — re-collapsed whenever a genuinely new analysis result lands (tracked by
  // sourceDocumentId, which stays the same across in-place edits), following React's documented
  // pattern for resetting state on a prop change instead of useEffect (avoids an expanded flash).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(classifications));
  const [lastSourceDocumentId, setLastSourceDocumentId] = useState(sourceDocumentId);
  if (sourceDocumentId !== lastSourceDocumentId) {
    setLastSourceDocumentId(sourceDocumentId);
    setCollapsedGroups(new Set(classifications));
    setCourseSearch("");
  }

  function toggleGroupCollapsed(classification: string): void {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(classification)) {
        next.delete(classification);
      } else {
        next.add(classification);
      }
      return next;
    });
  }

  function setAllGroupsCollapsed(collapsed: boolean, nextClassifications: readonly string[]): void {
    setCollapsedGroups(collapsed ? new Set(nextClassifications) : new Set());
  }

  function updateCourse(index: number, course: CompletedCourse): void {
    onChange({
      ...profile,
      completedCourses: profile.completedCourses.map((current, currentIndex) =>
        currentIndex === index ? course : current,
      ),
    });
  }

  function addCourse(): void {
    const nextSourceDocumentId = profile.sourceDocuments[0]?.id;
    if (!nextSourceDocumentId) {
      return;
    }
    onChange({
      ...profile,
      completedCourses: [
        ...profile.completedCourses,
        {
          courseCode: "",
          courseName: "",
          majorScope: "",
          classification: "",
          year: null,
          term: null,
          credits: 0,
          area: "",
          completionStatus: "earned",
          recommendationPolicy: "exclude",
          flags: [],
          sourceDocumentId: nextSourceDocumentId,
          reviewReasons: [],
        },
      ],
    });
  }

  function deleteCourse(index: number): void {
    onChange({
      ...profile,
      completedCourses: profile.completedCourses.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  function renderCourseCard(course: CompletedCourse, index: number, displayNumber: number) {
    return (
      <li
        className={`${styles.dataCard} ${styles.requirementCard}`}
        key={`${course.sourceDocumentId}-${index}`}
      >
        <div className={styles.cardTopline}>
          <div className={styles.cardIdentity}>
            <strong>과목 {displayNumber}</strong>
            <span>{course.courseName || "과목명 미입력"}</span>
          </div>
          <div className={styles.cardActions}>
            {course.reviewReasons.length > 0 ? <span>확인 필요 {course.reviewReasons.length}</span> : null}
            <button className={styles.deleteButton} type="button" onClick={() => deleteCourse(index)}>
              삭제
            </button>
          </div>
        </div>

        <div className={styles.cardBody}>
          <div className={`${styles.fieldGrid} ${styles.courseFieldGrid}`}>
            <label className={styles.field}>
              <span>학수번호</span>
              <input
                maxLength={10}
                value={course.courseCode}
                onChange={(event) =>
                  updateCourse(index, { ...course, courseCode: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label className={styles.field}>
              <span>이수년도</span>
              <input
                min="2000"
                max="2100"
                type="number"
                value={course.year ?? ""}
                onChange={(event) =>
                  updateCourse(index, {
                    ...course,
                    year: event.target.value ? event.target.valueAsNumber : null,
                  })
                }
              />
            </label>
            <label className={styles.field}>
              <span>학기</span>
              <select
                value={course.term ?? ""}
                onChange={(event) =>
                  updateCourse(index, {
                    ...course,
                    term: event.target.value
                      ? (event.target.value as CompletedCourse["term"])
                      : null,
                  })
                }
              >
                <option value="">확인 필요</option>
                <option value="spring">1학기</option>
                <option value="summer">여름학기</option>
                <option value="fall">2학기</option>
                <option value="winter">겨울학기</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>전공 범위</span>
              <input
                value={course.majorScope}
                onChange={(event) => updateCourse(index, { ...course, majorScope: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>이수구분</span>
              <input
                value={course.classification}
                onChange={(event) =>
                  updateCourse(index, { ...course, classification: event.target.value })
                }
              />
            </label>
            <label className={styles.field}>
              <span>이수 상태</span>
              <select
                value={course.completionStatus}
                onChange={(event) =>
                  updateCourse(index, {
                    ...course,
                    completionStatus: event.target.value as CompletedCourse["completionStatus"],
                  })
                }
              >
                <option value="earned">이수</option>
                <option value="failed">미이수</option>
                <option value="withdrawn">철회</option>
                <option value="review">확인 필요</option>
              </select>
            </label>
          </div>
          <label className={styles.retakeToggle}>
            <input
              checked={course.recommendationPolicy === "retake"}
              type="checkbox"
              onChange={(event) =>
                updateCourse(index, {
                  ...course,
                  recommendationPolicy: event.target.checked ? "retake" : "exclude",
                })
              }
            />
            <span>재수강 예정(추천 후보에 포함)</span>
          </label>
        </div>
      </li>
    );
  }

  const displayNumbers = getCourseDisplayNumbers(profile.completedCourses);

  return (
    <div className={styles.dataSection}>
      <div className={styles.sectionHeading}>
        <div>
          <p>기수강 과목</p>
          <h3>{profile.completedCourses.length}개</h3>
        </div>
        <div className={styles.sectionControls}>
          {needsReviewCount > 0 ? (
            <span className={styles.needsReviewBadge}>확인 필요 {needsReviewCount}</span>
          ) : null}
          <button type="button" onClick={() => setAllGroupsCollapsed(true, classifications)}>
            전체 접기
          </button>
          <button type="button" onClick={() => setAllGroupsCollapsed(false, classifications)}>
            전체 펼치기
          </button>
          <button className={styles.secondaryButton} type="button" onClick={addCourse}>
            + 과목 수동 추가
          </button>
        </div>
      </div>

      {profile.completedCourses.length === 0 ? (
        <p className={styles.dataEmpty}>추출된 과목이 없습니다. 필요하면 수동으로 추가해 주세요.</p>
      ) : (
        <>
          <label className={styles.courseSearchField}>
            <span className={styles.srOnly}>재수강할 과목명 검색</span>
            <input
              placeholder="재수강할 과목명 검색"
              type="search"
              value={courseSearch}
              onChange={(event) => setCourseSearch(event.target.value)}
            />
          </label>
          {searchQuery ? (
            <p className={styles.courseSearchMeta}>
              검색 결과 {visibleCourseCount}개 / 전체 {profile.completedCourses.length}개
            </p>
          ) : null}

          {filteredGroups.length === 0 ? (
            <p className={styles.dataEmpty}>검색어와 일치하는 과목이 없습니다.</p>
          ) : (
            <div className={styles.cardList}>
              {filteredGroups.map((group) => {
                // While searching, keep matching groups open so results are immediately usable.
                const isCollapsed = searchQuery
                  ? false
                  : collapsedGroups.has(group.classification);
                const groupCount = group.yearGroups.reduce(
                  (total, yearGroup) =>
                    total +
                    yearGroup.termGroups.reduce(
                      (subtotal, termGroup) => subtotal + termGroup.entries.length,
                      0,
                    ),
                  0,
                );
                return (
                  <section className={styles.courseGroupSection} key={group.classification}>
                    <button
                      aria-expanded={!isCollapsed}
                      className={styles.courseGroupHeading}
                      type="button"
                      onClick={() => toggleGroupCollapsed(group.classification)}
                    >
                      <span>
                        {isCollapsed ? "▶" : "▼"} {group.classification}
                      </span>
                      <span>{groupCount}개</span>
                    </button>
                    {!isCollapsed
                      ? group.yearGroups.map((yearGroup) => (
                          <div className={styles.courseYearGroup} key={yearGroup.year ?? "unknown"}>
                            <p className={styles.courseYearHeading}>
                              {yearGroup.year !== null ? `${yearGroup.year}년` : "연도 미상"}
                            </p>
                            {yearGroup.termGroups.map((termGroup) => (
                              <div
                                className={styles.courseTermGroup}
                                key={termGroup.term ?? "unknown"}
                              >
                                <p className={styles.courseTermHeading}>
                                  {formatTermLabel(termGroup.term)}
                                </p>
                                <ol className={styles.courseCardGrid}>
                                  {termGroup.entries.map(({ course, index }) =>
                                    renderCourseCard(course, index, displayNumbers[index] ?? index + 1),
                                  )}
                                </ol>
                              </div>
                            ))}
                          </div>
                        ))
                      : null}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function matchesCourseSearch(course: CompletedCourse, query: string): boolean {
  const haystack = [
    course.courseCode,
    course.courseName,
    course.classification,
    course.area,
    course.majorScope,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function numberInputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}
