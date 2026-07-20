import { describe, expect, it } from "vitest";

import type { AcademicProfile } from "./academic-profile";
import {
  confirmAcademicProfile,
  getAcademicProfileValidationErrors,
  getReviewChecklist,
  isAcademicProfileConfirmed,
  markAcademicProfileDraft,
  parseAcademicProfileResponse,
} from "./academic-profile-client";

function makeProfile(): AcademicProfile {
  return {
    schemaVersion: "1.0",
    profile: {
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    },
    sourceDocuments: [{ id: "source-1", kind: "course_history", status: "draft" }],
    completedCourses: [
      {
        courseCode: "BUS2001",
        courseName: "경영학원론",
        majorScope: "제1전공",
        classification: "전공",
        year: 2025,
        term: "spring",
        credits: 3,
        area: "전공코어",
        completionStatus: "earned",
        recommendationPolicy: "exclude",
        flags: [],
        sourceDocumentId: "source-1",
        reviewReasons: ["영역 셀을 확인해 주세요."],
      },
    ],
    requirements: [],
    reviewIssues: [
      { code: "shifted_cell", message: "연도 셀을 확인해 주세요.", sourceDocumentId: "source-1" },
    ],
  };
}

describe("academic profile client state", () => {
  it("validates the API envelope before rendering", () => {
    const profile = makeProfile();

    expect(parseAcademicProfileResponse({ academicProfile: profile })).toBe(profile);
    expect(() => parseAcademicProfileResponse({ academicProfile: { schemaVersion: "1.0" } })).toThrow(
      "응답 형식",
    );
  });

  it("requires every document and row review before confirmation", () => {
    const profile = makeProfile();
    const checklist = getReviewChecklist(profile);

    expect(checklist).toHaveLength(2);
    expect(() => confirmAcademicProfile(profile, new Set([checklist[0]?.id]))).toThrow(
      "확인하지 않은",
    );

    const confirmed = confirmAcademicProfile(
      profile,
      new Set(checklist.map(({ id }) => id)),
    );
    expect(isAcademicProfileConfirmed(confirmed)).toBe(true);
    expect(isAcademicProfileConfirmed(markAcademicProfileDraft(confirmed))).toBe(false);
  });

  it("blocks confirmation when an edited row is invalid", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = { ...profile.completedCourses[0]!, courseCode: "invalid" };

    expect(getAcademicProfileValidationErrors(profile)).toContain(
      '1번째 과목 "경영학원론"의 학수번호를 확인해 주세요.',
    );
    expect(() =>
      confirmAcademicProfile(profile, new Set(getReviewChecklist(profile).map(({ id }) => id))),
    ).toThrow("학수번호");
  });

  it("accepts a SKKU course code with three trailing digits", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      courseCode: "GEDG001",
    };

    expect(getAcademicProfileValidationErrors(profile)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("학수번호")]),
    );
  });

  it("accepts a 2-digit exchange-credit course code (e.g. EXGLV45)", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      courseCode: "EXGLV45",
    };

    expect(getAcademicProfileValidationErrors(profile)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("학수번호")]),
    );
  });

  it("numbers a validation error by the course's displayed card number, not its raw array position", () => {
    const profile = makeProfile();
    // "전공" sorts before "교양" in the review UI (see course-history-grouping's classification
    // tier order), so the second array entry is displayed first — a message built from the raw
    // array index (2번째) would point at a card the user never sees labelled that way.
    profile.completedCourses = [
      { ...profile.completedCourses[0]!, courseCode: "GED1001", classification: "교양" },
      { ...profile.completedCourses[0]!, courseCode: "invalid", classification: "전공" },
    ];

    expect(getAcademicProfileValidationErrors(profile)).toContain(
      '1번째 과목 "경영학원론"의 학수번호를 확인해 주세요.',
    );
  });

  it("names the course in the message so it can be found by search even if the display number is ever wrong again", () => {
    const profile = makeProfile();
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      courseCode: "invalid",
      courseName: "경영전략특강",
    };

    expect(getAcademicProfileValidationErrors(profile)).toContain(
      '1번째 과목 "경영전략특강"의 학수번호를 확인해 주세요.',
    );
  });

  it("accepts a course code with a zero-width space Document Parse/Solar left behind (invisible in the UI)", () => {
    const profile = makeProfile();
    // Built from a numeric code point, not a literal character, so this test file never itself
    // embeds an invisible character: "GED" + U+200B (zero-width space) + "G001".
    const codeWithZeroWidthSpace = `GED${String.fromCharCode(0x200b)}G001`;
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      courseCode: codeWithZeroWidthSpace,
    };

    expect(getAcademicProfileValidationErrors(profile)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("학수번호")]),
    );
  });

  it("does not require confirmation after multiple course codes were successfully split", () => {
    const profile = makeProfile();
    // Server-side normalizeCompletedCourse already strips "다중 학수번호"/credit-count annotations
    // before a course ever reaches the client (see isNonBlockingCourseReason in
    // academic-document.ts), so a successfully-split row has no reviewReasons left by this point —
    // only the reviewIssues-level MULTIPLESUBJECT/unexpected_document_rows codes remain to filter.
    profile.completedCourses[0] = {
      ...profile.completedCourses[0]!,
      reviewReasons: [],
    };
    profile.reviewIssues = [
      {
        code: "MULTIPLESUBJECT",
        message: "Row contains multiple course codes",
        sourceDocumentId: "source-1",
      },
      {
        code: "unexpected_document_rows",
        message: "문서 종류와 맞지 않는 requirements 행은 반영하지 않았습니다.",
        sourceDocumentId: "source-1",
      },
    ];

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("revalidates editable requirement rules before confirmation", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "primary_major",
        label: "제1전공 심화학점",
        rule: { kind: "credit_minimum", credits: Number.NaN },
        earnedCredits: 15,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 21,
        status: "unmet",
        rawValues: {},
        sourceDocumentId: "source-1",
        reviewReasons: [],
      },
    ];

    expect(() => confirmAcademicProfile(profile, new Set())).toThrow("기준 규칙");
  });

  it("accepts a secondary_major requirement scope (복수전공 제2/3전공 rows)", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "secondary_major",
        label: "제3전공 총학점",
        rule: { kind: "credit_minimum", credits: 36 },
        earnedCredits: 15,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 21,
        status: "unmet",
        rawValues: {},
        sourceDocumentId: "source-1",
        reviewReasons: [],
      },
    ];

    expect(() => parseAcademicProfileResponse({ academicProfile: profile })).not.toThrow();
  });

  it("groups repeated review reasons from one shared distribution requirement", () => {
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = ["인간/문화", "사회/역사", "자연/과학/기술"].map(
      (area, index) => ({
        requirementId: `requirement-${index + 1}`,
        scope: "general",
        label: `균형교양 - ${area}`,
        rule: {
          kind: "distribution_minimum",
          groupId: "balanced-general",
          totalAreas: 3,
          minimumAreas: 2,
          totalCredits: 6,
          rawText: "3개 영역 중 최소 2개 영역에서 합계 6학점 이상 이수",
        },
        earnedCredits: null,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 0,
        status: "review" as const,
        rawValues: { 취득학점: index === 0 ? "6 / 0" : "6 / 3" },
        sourceDocumentId: "source-1",
        reviewReasons: ["취득학점 값이 복합 형식이어서 원문 확인이 필요합니다."],
      }),
    );

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("hides duplicate-credit and Solar-supplemented reviewIssues from the confirmation checklist", () => {
    // reviewIssues freeform text only ever reaches the client when table parsing failed entirely
    // (Solar's own commentary passes through unfiltered by our code in that fallback path — see
    // isNonBlockingReviewMessage in academic-profile-client.ts), so this filter is still live.
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [
      {
        code: "duplicate_credit",
        message: "중복 학점 표시 확인 필요: DS기반 행에 동일 과목이 중복 표시됨",
        sourceDocumentId: "source-1",
      },
      {
        code: "solar_requirement_rows_supplemented",
        message: "Solar가 누락한 졸업요건을 표에서 보완했습니다.",
        sourceDocumentId: "source-1",
      },
      {
        code: "duplicate_major_credit",
        message: "제1전공 심화·코어·실험실습은 C/L 과목 중복 취득학점 표시입니다.",
        sourceDocumentId: "source-1",
      },
      {
        code: "credit_above_requirement",
        message: "DS기반(계열1) 취득학점 4가 기준 2를 초과합니다.",
        sourceDocumentId: "source-1",
      },
    ];
    profile.requirements = [];

    expect(getReviewChecklist(profile)).toEqual([]);
  });

  it("hides a distribution_minimum area row's own composite 취득학점 cell, but blocks other reasons", () => {
    // The one requirement-reviewReasons pattern still worth filtering: canonicalizeBalancedGeneralRequirements
    // /readBalancedAreaCredits in academic-document.ts already handle a distribution area row's
    // composite "6 / 0"-style 취득학점 cell, so it doesn't need a person's attention. Every other
    // reviewReasons entry is code-generated for a real reason and must stay blocking.
    const profile = makeProfile();
    profile.completedCourses = [];
    profile.reviewIssues = [];
    profile.requirements = [
      {
        requirementId: "requirement-1",
        scope: "general",
        label: "균형교양 - 인간/문화",
        rule: {
          kind: "distribution_minimum",
          groupId: "balanced-general",
          totalAreas: 3,
          minimumAreas: 2,
          totalCredits: 6,
          rawText: "3개 영역 중 최소 2개 영역에서 합계 6학점 이상 이수",
        },
        earnedCredits: null,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 0,
        status: "review",
        rawValues: { 취득학점: "6 / 0" },
        sourceDocumentId: "source-1",
        reviewReasons: ["취득학점 값이 복합 형식이어서 원문 확인이 필요합니다."],
      },
      {
        requirementId: "requirement-2",
        scope: "general",
        label: "글로벌",
        rule: { kind: "credit_minimum", credits: 4 },
        earnedCredits: 2,
        inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
        remainingCredits: 2,
        status: "review",
        rawValues: {},
        sourceDocumentId: "source-1",
        reviewReasons: ["충족 상태를 자동으로 확정할 수 없어 확인이 필요합니다."],
      },
    ];

    const checklist = getReviewChecklist(profile);
    expect(checklist).toHaveLength(1);
    expect(checklist[0]?.message).toContain("충족 상태를 자동으로 확정할 수 없어");
  });
});
