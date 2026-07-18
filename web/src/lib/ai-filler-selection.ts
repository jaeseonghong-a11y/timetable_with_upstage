import type { SkkuElectiveAreaCode, SkkuElectiveSubject } from "./skku-course-api";

/**
 * The graduation-requirement sheet and the elective course search use independently worded area
 * names for the same 핵심교양 areas — confirmed against a real document, the sheet labels the
 * 소통과사고 area "의사소통", which shares no substring with the catalog's own label. Known
 * mismatches are listed here; combined labels ("인간/문화", "고전·명저") are also split on their
 * delimiter below so a requirement naming just one half still matches.
 */
const AREA_LABEL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  소통과사고: ["의사소통"],
};

function areaLabelFragments(areaLabel: string): string[] {
  const aliases = AREA_LABEL_ALIASES[areaLabel] ?? [];
  return [areaLabel, ...aliases].flatMap((label) => label.split(/[/·]/)).filter(Boolean);
}

export interface AiFillerSelectionInput {
  catalogSubjects: readonly SkkuElectiveSubject[];
  /** Subject ids (matching SubjectOption.id) already used as required/choice subjects. */
  usedSelectionIds: ReadonlySet<string>;
  /** Already-completed course numbers (from 수강내역) that must never be re-suggested. */
  excludedCourseNumbers: ReadonlySet<string>;
  /** Labels of unmet `scope: "general"` graduation requirements, if a profile was uploaded. */
  unmetGeneralLabels: readonly string[];
  /** Whether any graduation requirement rows exist at all (profile was uploaded). */
  hasAnyRequirements: boolean;
  areaLabelByCode: ReadonlyMap<SkkuElectiveAreaCode, string>;
  /** Builds the same subject id scheme used elsewhere so exclusion checks line up. */
  selectionIdFor: (courseNumber: string) => string;
  maxShortlist: number;
}

/**
 * Picks which elective subjects the AI recommendation step may add as filler, without touching
 * the network. A profile with fully satisfied 교양 requirements yields an empty shortlist
 * (respecting that the student no longer needs more); an unmet profile prioritizes matching
 * areas; no profile at all falls back to any available area.
 */
export function selectAiFillerSubjects(input: AiFillerSelectionInput): SkkuElectiveSubject[] {
  const {
    catalogSubjects,
    usedSelectionIds,
    excludedCourseNumbers,
    unmetGeneralLabels,
    hasAnyRequirements,
    areaLabelByCode,
    selectionIdFor,
    maxShortlist,
  } = input;

  if (hasAnyRequirements && unmetGeneralLabels.length === 0) {
    return [];
  }

  const matchesUnmetArea = (areaCode: SkkuElectiveAreaCode): boolean => {
    const areaLabel = areaLabelByCode.get(areaCode) ?? "";
    if (!areaLabel) {
      return false;
    }
    const fragments = areaLabelFragments(areaLabel);
    return unmetGeneralLabels.some((label) =>
      fragments.some((fragment) => label.includes(fragment) || fragment.includes(label)),
    );
  };

  const excludedUpper = new Set([...excludedCourseNumbers].map((value) => value.toUpperCase()));
  const availableSubjects = catalogSubjects.filter(
    (subject) =>
      !usedSelectionIds.has(selectionIdFor(subject.courseNumber)) &&
      !excludedUpper.has(subject.courseNumber.toUpperCase()),
  );
  const prioritized =
    unmetGeneralLabels.length > 0
      ? availableSubjects.filter((subject) => matchesUnmetArea(subject.areaCode))
      : availableSubjects;

  return prioritized.slice(0, maxShortlist);
}
