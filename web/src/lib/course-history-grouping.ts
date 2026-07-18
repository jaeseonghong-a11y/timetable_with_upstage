import type { AcademicTerm, CompletedCourse } from "./academic-profile";

const UNKNOWN_CLASSIFICATION = "이수구분 미상";

export interface CourseHistoryEntry {
  course: CompletedCourse;
  index: number;
}

export interface CourseHistoryClassificationGroup {
  classification: string;
  entries: readonly CourseHistoryEntry[];
}

/** Lower sorts first: 전공 → 교양 → 일반선택 → DS → anything else → 이수구분 미상 last. */
function classificationTier(classification: string): number {
  if (classification === UNKNOWN_CLASSIFICATION) {
    return 5;
  }
  if (classification.includes("전공")) {
    return 0;
  }
  if (classification.includes("교양")) {
    return 1;
  }
  if (classification.includes("일반선택")) {
    return 2;
  }
  if (/ds/i.test(classification)) {
    return 3;
  }
  return 4;
}

const TERM_ORDER: Record<AcademicTerm, number> = { spring: 0, summer: 1, fall: 2, winter: 3 };
const TERM_LABELS: Record<AcademicTerm, string> = {
  spring: "1학기",
  summer: "여름학기",
  fall: "2학기",
  winter: "겨울학기",
};

function compareByYearTerm(a: CompletedCourse, b: CompletedCourse): number {
  if (a.year !== b.year) {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year;
  }
  const termRankA = a.term ? TERM_ORDER[a.term] : 4;
  const termRankB = b.term ? TERM_ORDER[b.term] : 4;
  return termRankA - termRankB;
}

/** e.g. "2023년 1학기", or "연도 미상"/"학기 미상" for missing pieces. */
export function formatCourseYearTerm(course: Pick<CompletedCourse, "year" | "term">): string {
  const yearLabel = course.year !== null ? `${course.year}년` : "연도 미상";
  const termLabel = course.term ? TERM_LABELS[course.term] : "학기 미상";
  return `${yearLabel} ${termLabel}`;
}

/**
 * Groups completed courses for review by 이수구분 (classification) — a flat list of dozens of
 * courses is hard to scan, and this mirrors how a transcript itself is organized. Classification
 * groups are ordered 전공, 교양, 일반선택, DS, anything else, then unclassified rows last (stable
 * within each tier, so first-seen order still breaks ties). Within a group, entries sort by
 * year/학기 but stay in one flat list — the card grid renders them continuously rather than
 * breaking into a new row per year, so year changes don't fragment the multi-column layout; the
 * year/학기 is shown per card instead (see formatCourseYearTerm). `index` on each entry is the
 * position in the original array, so grouping never breaks index-keyed handlers upstream.
 */
export function groupCompletedCoursesForReview(
  courses: readonly CompletedCourse[],
): readonly CourseHistoryClassificationGroup[] {
  const classificationOrder: string[] = [];
  const byClassification = new Map<string, CourseHistoryEntry[]>();

  courses.forEach((course, index) => {
    const classification = course.classification.trim() || UNKNOWN_CLASSIFICATION;
    if (!byClassification.has(classification)) {
      byClassification.set(classification, []);
      classificationOrder.push(classification);
    }
    byClassification.get(classification)!.push({ course, index });
  });

  const orderedClassifications = [...classificationOrder].sort(
    (a, b) => classificationTier(a) - classificationTier(b),
  );

  return orderedClassifications.map((classification) => ({
    classification,
    entries: [...byClassification.get(classification)!].sort((a, b) =>
      compareByYearTerm(a.course, b.course),
    ),
  }));
}
