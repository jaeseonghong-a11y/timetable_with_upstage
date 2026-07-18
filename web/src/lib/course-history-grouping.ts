import type { AcademicTerm, CompletedCourse } from "./academic-profile";

const UNKNOWN_CLASSIFICATION = "이수구분 미상";

export interface CourseHistoryEntry {
  course: CompletedCourse;
  index: number;
}

export interface CourseHistoryTermGroup {
  term: AcademicTerm | null;
  entries: readonly CourseHistoryEntry[];
}

export interface CourseHistoryYearGroup {
  year: number | null;
  termGroups: readonly CourseHistoryTermGroup[];
}

export interface CourseHistoryClassificationGroup {
  classification: string;
  yearGroups: readonly CourseHistoryYearGroup[];
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
const UNKNOWN_TERM_RANK = 4;
export const TERM_LABELS: Record<AcademicTerm, string> = {
  spring: "1학기",
  summer: "여름학기",
  fall: "2학기",
  winter: "겨울학기",
};

function termRank(term: AcademicTerm | null): number {
  return term ? TERM_ORDER[term] : UNKNOWN_TERM_RANK;
}

/** e.g. "1학기", or "학기 미상" when missing. */
export function formatTermLabel(term: AcademicTerm | null): string {
  return term ? TERM_LABELS[term] : "학기 미상";
}

/**
 * Groups completed courses for review by 이수구분 (classification), then by year, then by 학기 —
 * a flat list of dozens of courses is hard to scan, and this mirrors how a transcript itself is
 * organized. Classification groups are ordered 전공, 교양, 일반선택, DS, anything else, then
 * unclassified rows last (stable within each tier, so first-seen order still breaks ties). Years
 * within a group are separate blocks (a new year always starts on its own row), ascending, with
 * undated entries last; 학기 within a year stays in one flowing card grid, ascending, with an
 * unset 학기 last — the caller renders a divider at each 학기 change instead of breaking the
 * grid, since a divider element spanning the full grid row naturally forces a line break there.
 * `index` on each entry is the position in the original array, so grouping never breaks
 * index-keyed handlers upstream.
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

  return orderedClassifications.map((classification) => {
    const entries = byClassification.get(classification)!;
    const byYear = new Map<number | null, CourseHistoryEntry[]>();
    for (const entry of entries) {
      const year = entry.course.year;
      if (!byYear.has(year)) {
        byYear.set(year, []);
      }
      byYear.get(year)!.push(entry);
    }
    const years = [...byYear.keys()].sort((a, b) => {
      if (a === null) return b === null ? 0 : 1;
      if (b === null) return -1;
      return a - b;
    });

    return {
      classification,
      yearGroups: years.map((year) => {
        const yearEntries = byYear.get(year)!;
        const byTerm = new Map<AcademicTerm | null, CourseHistoryEntry[]>();
        for (const entry of yearEntries) {
          const term = entry.course.term;
          if (!byTerm.has(term)) {
            byTerm.set(term, []);
          }
          byTerm.get(term)!.push(entry);
        }
        const terms = [...byTerm.keys()].sort((a, b) => termRank(a) - termRank(b));
        return {
          year,
          termGroups: terms.map((term) => ({ term, entries: byTerm.get(term)! })),
        };
      }),
    };
  });
}
