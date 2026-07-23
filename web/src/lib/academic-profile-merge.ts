import type { AcademicProfile, Requirement, RequirementRule } from "./academic-profile";

/**
 * Combines independently parsed graduation-requirement screenshots without retaining any input
 * file. GLS tables often need two or more overlapping screenshots; the same visible row is kept
 * once, while rows with different rules remain separate for the user to review.
 */
export function mergeGraduationRequirementProfiles(
  profiles: readonly AcademicProfile[],
): AcademicProfile {
  if (profiles.length === 0) {
    throw new Error("병합할 졸업요건 분석 결과가 없습니다.");
  }

  const firstProfile = profiles[0]!;
  return {
    ...firstProfile,
    sourceDocuments: profiles.flatMap((profile) => profile.sourceDocuments.map((document) => ({
      ...document,
      status: "draft" as const,
    }))),
    completedCourses: mergeUnique(
      profiles.flatMap((profile) => profile.completedCourses),
      (course) => [
        course.courseCode.trim().toUpperCase(),
        course.courseName.trim(),
        course.completionStatus,
        course.year ?? "",
        course.term ?? "",
      ].join("|"),
    ),
    requirements: mergeUnique(
      profiles.flatMap((profile) => profile.requirements),
      getRequirementMergeKey,
    ),
    reviewIssues: mergeUnique(
      profiles.flatMap((profile) => profile.reviewIssues),
      (issue) => `${issue.code}|${issue.message.trim()}`,
    ),
  };
}

function mergeUnique<T>(items: readonly T[], getKey: (item: T) => string): T[] {
  const itemsByKey = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!itemsByKey.has(key)) {
      itemsByKey.set(key, item);
    }
  }
  return [...itemsByKey.values()];
}

function getRequirementMergeKey(requirement: Requirement): string {
  return [
    requirement.scope,
    normalizeText(requirement.label),
    getRuleSignature(requirement.rule),
  ].join("|");
}

function getRuleSignature(rule: RequirementRule): string {
  switch (rule.kind) {
    case "credit_minimum":
      return `${rule.kind}:${rule.credits}`;
    case "distribution_minimum":
      return [
        rule.kind,
        rule.totalAreas,
        rule.minimumAreas,
        rule.totalCredits,
        normalizeText(rule.rawText),
      ].join(":");
    case "completion":
    case "manual":
      return `${rule.kind}:${normalizeText(rule.rawText)}`;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
