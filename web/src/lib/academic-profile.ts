export type AcademicDocumentKind = "course_history" | "graduation_requirements";
export type AcademicDocumentStatus = "draft" | "confirmed";
export type AcademicTerm = "spring" | "summer" | "fall" | "winter";
export type CompletionStatus = "earned" | "failed" | "withdrawn" | "review";
export type RequirementScope =
  | "primary_major"
  | "secondary_major"
  | "general"
  | "ds"
  | "university"
  | "other";
export type RequirementStatus = "satisfied" | "in_progress" | "unmet" | "review";

// Exchange-credit recognition codes (e.g. EXGLV45) use only 2 digits, unlike SKKU's own 3-4 digit
// numbering. Kept here as the single source of truth (not copy-pasted per module) after a real
// incident where the client-side confirm-time copy of this pattern silently drifted out of sync
// with the server-side parsing copy and rejected valid courses on every confirm attempt.
export const COURSE_CODE_PATTERN = /^[A-Z]{2,6}[0-9]{2,4}$/;

// U+200B/200C/200D (zero-width space/non-joiner/joiner) and U+FEFF (BOM) — built from numeric
// code points, not literal characters, so this source file never itself embeds an invisible one.
const INVISIBLE_CODE_POINTS = [0x200b, 0x200c, 0x200d, 0xfeff];
const INVISIBLE_CHARACTERS_PATTERN = new RegExp(
  `[${INVISIBLE_CODE_POINTS.map((codePoint) => String.fromCharCode(codePoint)).join("")}]`,
  "g",
);

/**
 * Normalizes a course code for matching against COURSE_CODE_PATTERN. Strips zero-width/BOM
 * characters in addition to ordinary whitespace trimming — these can survive a Document
 * Parse/Solar round trip, are invisible in the UI, and a plain .trim() leaves them behind (JS's
 * `trim()` only strips characters in the Unicode "White_Space" category, which excludes
 * zero-width space/joiners and the BOM), so a code that looks completely normal on screen can
 * still fail a naive pattern test.
 */
export function normalizeCourseCodeForMatch(code: string): string {
  return code.replace(INVISIBLE_CHARACTERS_PATTERN, "").trim().toUpperCase();
}

export interface CompletedCourse {
  courseCode: string;
  courseName: string;
  majorScope: string;
  classification: string;
  year: number | null;
  term: AcademicTerm | null;
  credits: number;
  area: string;
  completionStatus: CompletionStatus;
  recommendationPolicy: "exclude" | "retake";
  flags: string[];
  sourceDocumentId: string;
  reviewReasons: string[];
}

export interface DistributionMinimumRule {
  kind: "distribution_minimum";
  groupId: string;
  totalAreas: number;
  minimumAreas: number;
  totalCredits: number;
  rawText: string;
}

export type RequirementRule =
  | { kind: "credit_minimum"; credits: number }
  | DistributionMinimumRule
  | { kind: "completion" | "manual"; rawText: string };

export function isDistributionMinimumSatisfied(
  rule: DistributionMinimumRule,
  creditsByArea: readonly number[],
): boolean {
  if (
    creditsByArea.length !== rule.totalAreas ||
    creditsByArea.some((credits) => !Number.isFinite(credits) || credits < 0)
  ) {
    return false;
  }
  const completedAreaCount = creditsByArea.filter((credits) => credits > 0).length;
  const totalCredits = creditsByArea.reduce((sum, credits) => sum + credits, 0);
  return completedAreaCount >= rule.minimumAreas && totalCredits >= rule.totalCredits;
}

export interface Requirement {
  requirementId: string;
  scope: RequirementScope;
  label: string;
  rule: RequirementRule;
  earnedCredits: number | null;
  inProgressCredits: {
    spring: number;
    summer: number;
    fall: number;
    winter: number;
    total: number;
  };
  remainingCredits: number | null;
  status: RequirementStatus;
  rawValues: Record<string, string>;
  sourceDocumentId: string;
  reviewReasons: string[];
}

export interface ReviewIssue {
  code: string;
  message: string;
  sourceDocumentId: string;
}

export interface AcademicProfile {
  schemaVersion: "1.0";
  profile: {
    departmentCode: string | null;
    majorCodes: string[];
    admissionYear: number | null;
    currentGrade: number | null;
    primaryCampus: "humanities" | "natural_sciences" | null;
  };
  sourceDocuments: Array<{
    id: string;
    kind: AcademicDocumentKind;
    status: AcademicDocumentStatus;
  }>;
  completedCourses: CompletedCourse[];
  requirements: Requirement[];
  reviewIssues: ReviewIssue[];
}
