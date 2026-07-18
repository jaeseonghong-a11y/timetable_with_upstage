import type { CompletedCourse } from "./academic-profile";

const UNKNOWN_CLASSIFICATION = "이수구분 미상";

export interface CourseHistoryEntry {
  course: CompletedCourse;
  index: number;
}

export interface CourseHistoryYearGroup {
  year: number | null;
  entries: readonly CourseHistoryEntry[];
}

export interface CourseHistoryClassificationGroup {
  classification: string;
  yearGroups: readonly CourseHistoryYearGroup[];
}

/**
 * Groups completed courses for review by 이수구분 (classification), then by year within each —
 * a flat list of dozens of courses is hard to scan, and this mirrors how a transcript itself is
 * organized. Groups keep the source array's relative order (first-seen classification first,
 * ascending year), with unclassified/undated entries always sorted last so unclear data doesn't
 * get lost in the middle. `index` on each entry is the position in the original array, so
 * grouping never breaks index-keyed handlers (edit/delete/collapse) upstream.
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

  const orderedClassifications = [
    ...classificationOrder.filter((name) => name !== UNKNOWN_CLASSIFICATION),
    ...classificationOrder.filter((name) => name === UNKNOWN_CLASSIFICATION),
  ];

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
      yearGroups: years.map((year) => ({ year, entries: byYear.get(year)! })),
    };
  });
}
