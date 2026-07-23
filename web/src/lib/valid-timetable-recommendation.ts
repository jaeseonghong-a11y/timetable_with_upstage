import type { RequirementScope } from "./academic-profile";
import { areaMatchesUnmetLabels } from "./ai-filler-selection";
import {
  getFreeDayLabels,
  scoreTimetables,
  type RecommendationWeight,
  type ScoredTimetable,
} from "./timetable-scoring";
import type { Timetable } from "./timetable";

export type GraduationConsiderationStrength = "none" | "weak" | "strong";
export type OptionalCourseScope = "general" | "major";

export interface UnmetGraduationRequirement {
  scope: RequirementScope;
  label: string;
}

export interface OptionalCourseForRecommendation {
  title: string;
  classification: string;
  scope: OptionalCourseScope;
}

export interface ValidTimetableRecommendationContext {
  candidateId: string;
  optionalCourses: OptionalCourseForRecommendation[];
}

export interface RankedValidTimetable extends ScoredTimetable {
  graduationScore: number;
  matchedRequirementLabels: string[];
  context: ValidTimetableRecommendationContext;
}

export interface RecommendationCopy {
  name: string;
  reason: string;
}

const WEIGHT_REASON_LABELS: Record<RecommendationWeight["id"], string> = {
  free_days: "공강 조건",
  back_to_back: "연강 조건",
  lunch_break: "점심 시간 조건",
  avoid_9am: "첫수업 회피 조건",
  day_packing: "요일 배치 조건",
  course_format: "수업 방식 조건",
};

/**
 * Scores only STEP 4's already-valid schedules. This deliberately never adds subjects or calls
 * the selection engine: STEP 5 is a ranking/explanation layer, not another combination maker.
 */
export function rankValidTimetables(
  timetables: readonly Timetable[],
  weights: readonly RecommendationWeight[],
  contexts: readonly ValidTimetableRecommendationContext[],
  unmetRequirements: readonly UnmetGraduationRequirement[],
  graduationStrength: GraduationConsiderationStrength,
): RankedValidTimetable[] {
  const contextsById = new Map(contexts.map((context) => [context.candidateId, context]));
  return scoreTimetables(timetables, weights)
    .map((entry) => {
      const context = contextsById.get(entry.candidateId) ?? {
        candidateId: entry.candidateId,
        optionalCourses: [],
      };
      const matchedRequirementLabels = findMatchedRequirementLabels(
        context.optionalCourses,
        unmetRequirements,
      );
      return {
        ...entry,
        context,
        matchedRequirementLabels,
        graduationScore: graduationScore(
          context.optionalCourses,
          matchedRequirementLabels,
          unmetRequirements,
          graduationStrength,
        ),
      };
    })
    .sort(
      (first, second) =>
        second.totalScore + second.graduationScore - (first.totalScore + first.graduationScore) ||
        first.candidateId.localeCompare(second.candidateId),
    );
}

/** Matches explicit area/requirement wording first, and then a conservative major-scope fallback. */
export function findMatchedRequirementLabels(
  optionalCourses: readonly OptionalCourseForRecommendation[],
  unmetRequirements: readonly UnmetGraduationRequirement[],
): string[] {
  const matched = new Set<string>();
  for (const course of optionalCourses) {
    for (const requirement of unmetRequirements) {
      if (courseMatchesRequirement(course, requirement)) {
        matched.add(requirement.label);
      }
    }
  }
  return [...matched];
}

export function buildRecommendationCopy(
  entry: RankedValidTimetable,
  weights: readonly RecommendationWeight[],
  graduationStrength: GraduationConsiderationStrength,
): RecommendationCopy {
  const dominantWeight = [...entry.breakdown]
    .sort((first, second) => second.weightedScore - first.weightedScore)[0]?.weightId;
  const name = buildRecommendationName(entry.timetable, dominantWeight, weights, entry);
  const enabledFilterLabels = entry.breakdown
    .filter((item) => item.weightedScore > 0)
    .map((item) => WEIGHT_REASON_LABELS[item.weightId])
    .slice(0, 2);
  const optionalCourseNames = [...new Set(entry.context.optionalCourses.map((course) => course.title))]
    .slice(0, 2)
    .map((title) => `“${title}”`);
  const clauses: string[] = [];
  if (optionalCourseNames.length > 0) {
    clauses.push(`${optionalCourseNames.join(", ")}을(를) 포함했고`);
  }
  if (enabledFilterLabels.length > 0) {
    clauses.push(`${enabledFilterLabels.join("·")}을 반영했고`);
  }
  if (graduationStrength !== "none" && entry.matchedRequirementLabels.length > 0) {
    clauses.push(`미충족 요건 “${entry.matchedRequirementLabels.slice(0, 2).join("·")}”도 고려했습니다`);
  }
  if (clauses.length === 0) {
    return { name, reason: "선택한 시간표 조건을 기준으로 비교해 추천한 조합입니다." };
  }
  return { name, reason: `${clauses.join(" ")} 추천한 조합입니다.` };
}

function graduationScore(
  optionalCourses: readonly OptionalCourseForRecommendation[],
  matchedRequirementLabels: readonly string[],
  unmetRequirements: readonly UnmetGraduationRequirement[],
  strength: GraduationConsiderationStrength,
): number {
  if (strength === "none" || unmetRequirements.length === 0 || optionalCourses.length === 0) {
    return 0;
  }
  const directMatches = matchedRequirementLabels.length;
  const majorScopeSupport = optionalCourses.some((course) => course.scope === "major") &&
    unmetRequirements.some((requirement) => isMajorRequirementScope(requirement.scope));
  if (strength === "weak") {
    return directMatches;
  }
  return directMatches * 4 + (majorScopeSupport ? 1 : 0);
}

function courseMatchesRequirement(
  course: OptionalCourseForRecommendation,
  requirement: UnmetGraduationRequirement,
): boolean {
  const classification = course.classification.trim();
  if (classification && areaMatchesUnmetLabels(classification, [requirement.label])) {
    return true;
  }
  // Major classifications from the public course API frequently say only “전공핵심/전공선택”,
  // while the graduation sheet says “제1전공/제2전공”. Treat that shared major scope as a small
  // ranking signal, but never label it as a completed requirement in the UI.
  return course.scope === "major" &&
    isMajorRequirementScope(requirement.scope) &&
    /전공|DS/i.test(classification || requirement.label);
}

function isMajorRequirementScope(scope: RequirementScope): boolean {
  return scope === "primary_major" || scope === "secondary_major" || scope === "ds";
}

function buildRecommendationName(
  timetable: Timetable,
  dominantWeight: RecommendationWeight["id"] | undefined,
  weights: readonly RecommendationWeight[],
  entry: RankedValidTimetable,
): string {
  if (dominantWeight === "free_days") {
    const preferred = weights.find((weight) => weight.id === "free_days")?.config?.preferredFreeDays ?? [];
    const freeDays = getFreeDayLabels(timetable);
    const preferredLabel = preferred
      .map((day) => ({ mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" })[day])
      .find((label) => freeDays.some((freeDay) => freeDay.startsWith(label)));
    return preferredLabel ? `${preferredLabel}요일 공강형` : "공강 여유형";
  }
  if (dominantWeight === "avoid_9am") return "첫수업 회피형";
  if (dominantWeight === "lunch_break") return "점심 여유형";
  if (dominantWeight === "back_to_back") {
    const direction = weights.find((weight) => weight.id === "back_to_back")?.config?.direction;
    return direction === "prefer" ? "연강 집중형" : "연강 회피형";
  }
  if (dominantWeight === "day_packing") {
    const packing = weights.find((weight) => weight.id === "day_packing")?.config?.packing;
    return packing === "spread" ? "요일 분산형" : "요일 집중형";
  }
  if (dominantWeight === "course_format") {
    const format = weights.find((weight) => weight.id === "course_format")?.config?.format;
    return format === "online" ? "온라인 선호형" : "대면 수업 선호형";
  }
  return entry.matchedRequirementLabels.length > 0 ? "졸업요건 우선형" : "균형 시간표형";
}
