import { describe, expect, it } from "vitest";

import type { AcademicProfile } from "./academic-profile";
import { mergeGraduationRequirementProfiles } from "./academic-profile-merge";

function makeProfile(
  sourceDocumentId: string,
  requirements: AcademicProfile["requirements"],
): AcademicProfile {
  return {
    schemaVersion: "1.0",
    profile: {
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    },
    sourceDocuments: [{ id: sourceDocumentId, kind: "graduation_requirements", status: "draft" }],
    completedCourses: [],
    requirements,
    reviewIssues: [{ code: "review", message: "원문 확인", sourceDocumentId }],
  };
}

function makeRequirement(
  sourceDocumentId: string,
  label: string,
  credits: number,
): AcademicProfile["requirements"][number] {
  return {
    requirementId: `${sourceDocumentId}-${label}`,
    scope: "general",
    label,
    rule: { kind: "credit_minimum", credits },
    earnedCredits: 0,
    inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
    remainingCredits: credits,
    status: "unmet",
    rawValues: {},
    sourceDocumentId,
    reviewReasons: [],
  };
}

describe("mergeGraduationRequirementProfiles", () => {
  it("keeps all source documents but collapses the same row from overlapping screenshots", () => {
    const merged = mergeGraduationRequirementProfiles([
      makeProfile("first", [
        makeRequirement("first", "의사소통", 4),
        makeRequirement("first", "창의", 3),
      ]),
      makeProfile("second", [
        makeRequirement("second", "의사소통", 4),
        makeRequirement("second", "글로벌", 4),
      ]),
    ]);

    expect(merged.sourceDocuments.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(merged.requirements.map(({ label }) => label)).toEqual(["의사소통", "창의", "글로벌"]);
    expect(merged.reviewIssues).toHaveLength(1);
  });

  it("keeps same-label requirements separate when their rules differ", () => {
    const merged = mergeGraduationRequirementProfiles([
      makeProfile("first", [makeRequirement("first", "글로벌", 2)]),
      makeProfile("second", [makeRequirement("second", "글로벌", 4)]),
    ]);

    expect(merged.requirements).toHaveLength(2);
  });
});
