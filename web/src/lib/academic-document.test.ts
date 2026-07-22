import { describe, expect, it } from "vitest";

import {
  AcademicExtractionError,
  cleanCompletedCourseExtraction,
  extractTableSegmentsForRetry,
  parseAcademicExtraction,
  supplementCompletedCoursesFromMarkdown,
  supplementGraduationRequirementsFromMarkdown,
} from "./academic-document";

const EMPTY_REQUIREMENT_ARRAYS = {
  requirements: [],
  reviewIssues: [],
};

describe("parseAcademicExtraction", () => {
  it("builds a privacy-minimized course-history draft", () => {
    const content = JSON.stringify({
      completedCourses: [
        {
          courseCode: "bus2001",
          courseName: "경영학원론",
          majorScope: "제1전공",
          classification: "전공",
          year: 2025,
          term: "fall",
          credits: 3,
          area: "전공코어",
          completionStatus: "earned",
          flags: ["국제어", "국제어"],
          reviewReasons: [],
          exactGrade: "A+",
          studentName: "반환하면 안 됨",
        },
      ],
      ...EMPTY_REQUIREMENT_ARRAYS,
      studentNumber: "2020123456",
    });

    const profile = parseAcademicExtraction(content, "course_history", "source-1");

    expect(profile.sourceDocuments).toEqual([
      { id: "source-1", kind: "course_history", status: "draft" },
    ]);
    expect(profile.completedCourses).toEqual([
      {
        courseCode: "BUS2001",
        courseName: "경영학원론",
        majorScope: "제1전공",
        classification: "전공",
        year: 2025,
        term: "fall",
        credits: 3,
        area: "전공코어",
        completionStatus: "earned",
        recommendationPolicy: "exclude",
        flags: ["국제어"],
        sourceDocumentId: "source-1",
        reviewReasons: [],
      },
    ]);
    expect(JSON.stringify(profile)).not.toContain("A+");
    expect(JSON.stringify(profile)).not.toContain("2020123456");
    expect(profile.profile).toEqual({
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    });
  });

  it("accepts a Solar-returned course code with a zero-width space (invisible in the UI, not stripped by a plain trim())", () => {
    // Built from a numeric code point, not a literal character, so this test file never itself
    // embeds an invisible character: "BUS" + U+200B (zero-width space) + "2001".
    const codeWithZeroWidthSpace = `BUS${String.fromCharCode(0x200b)}2001`;
    const content = JSON.stringify({
      completedCourses: [
        {
          courseCode: codeWithZeroWidthSpace,
          courseName: "경영학원론",
          majorScope: "제1전공",
          classification: "전공",
          year: 2025,
          term: "fall",
          credits: 3,
          area: "전공코어",
          completionStatus: "earned",
          flags: [],
          reviewReasons: [],
        },
      ],
      ...EMPTY_REQUIREMENT_ARRAYS,
    });

    const profile = parseAcademicExtraction(content, "course_history", "source-1");

    expect(profile.completedCourses).toHaveLength(1);
    expect(profile.completedCourses[0]?.courseCode).toBe("BUS2001");
  });

  it("accepts fenced JSON and builds requirement identifiers on the server", () => {
    const content = `\`\`\`json
${JSON.stringify({
  completedCourses: [],
  requirements: [
    {
      scope: "general",
      label: "균형교양 - 인간/문화",
      rule: {
        kind: "distribution_minimum",
        minimumAreas: 2,
        totalCredits: 6,
        rawText: "3개 영역 중 2개 영역 이상 6학점",
      },
      earnedCredits: null,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 0,
      status: "review",
      rawValues: { 취득학점: "6 / 0" },
      reviewReasons: ["복합값 확인 필요"],
    },
  ],
  reviewIssues: [{ code: "composite_value", message: "복합 셀을 확인해주세요." }],
})}
\`\`\``;

    const profile = parseAcademicExtraction(
      content,
      "graduation_requirements",
      "source-2",
    );

    expect(profile.requirements[0]).toMatchObject({
      requirementId: "requirement-1",
      status: "review",
      rawValues: { 취득학점: "6 / 0" },
      sourceDocumentId: "source-2",
    });
    expect(profile.reviewIssues).toEqual([
      {
        code: "composite_value",
        message: "복합 셀을 확인해주세요.",
        sourceDocumentId: "source-2",
      },
    ]);
  });

  it("drops a malformed row and creates an explicit review issue", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [
          {
            courseCode: "not-a-course-code",
            courseName: "형식 오류",
            majorScope: "",
            classification: "",
            year: null,
            term: null,
            credits: 3,
            area: "",
            completionStatus: "review",
            flags: [],
            reviewReasons: ["확인 필요"],
          },
        ],
        ...EMPTY_REQUIREMENT_ARRAYS,
      }),
      "course_history",
      "source-3",
    );

    expect(profile.completedCourses).toEqual([]);
    expect(profile.reviewIssues).toEqual([
      expect.objectContaining({ code: "invalid_completed_course", sourceDocumentId: "source-3" }),
    ]);
  });

  it("accepts SKKU three-digit course codes and Korean semester labels", () => {
    const terms = [
      ["GEDG001", "1학기", "spring"],
      ["GEDM012", "2 학기", "fall"],
      ["CHS7001", "여름학", "summer"],
      ["BIZ2021", "겨울학", "winter"],
    ];
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: terms.map(([courseCode, term]) => ({
          courseCode,
          courseName: "테스트 과목",
          majorScope: "제1전공",
          classification: "교양",
          year: 2025,
          term,
          credits: 3,
          area: "영역",
          completionStatus: "earned",
          flags: [],
          reviewReasons: ["다중 학수번호"],
        })),
        requirements: [],
        reviewIssues: [
          { code: "E3", message: "제1전공" },
          { code: "MULTIPLESUBJECT", message: "Row contains multiple course codes" },
        ],
      }),
      "course_history",
      "source-skku-codes",
    );

    expect(profile.completedCourses.map(({ courseCode, term }) => [courseCode, term])).toEqual(
      terms.map(([courseCode, , normalizedTerm]) => [courseCode, normalizedTerm]),
    );
    expect(profile.completedCourses.every((course) => course.reviewReasons.length === 0)).toBe(
      true,
    );
    expect(profile.reviewIssues).toEqual([]);
  });

  it("preserves all requirement rows when Solar returns safe values in mixed JSON types", () => {
    const requirements = Array.from({ length: 16 }, (_, index) => ({
      scope: index < 3 ? "제1전공" : "general",
      label: index < 3 ? `제1전공 요건 ${index + 1}` : `교양 요건 ${index + 1}`,
      rule: { kind: "credit_minimum", credits: String(index + 2) },
      earnedCredits: String(index),
      inProgressCredits: {
        "1학기": "0",
        여름: 0,
        "2학기": "0",
        겨울: 0,
        계: "0",
      },
      remainingCredits: String(index + 2),
      status: "미충족",
      rawValues: {
        기준학점: index + 2,
        취득학점: index,
        잔여학점: index + 2,
      },
    }));

    const profile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], requirements, reviewIssues: [] }),
      "graduation_requirements",
      "source-requirements",
    );

    expect(profile.requirements).toHaveLength(16);
    expect(profile.requirements[0]).toMatchObject({
      requirementId: "requirement-1",
      scope: "primary_major",
      rule: { kind: "credit_minimum", credits: 2 },
      earnedCredits: 0,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 2,
      status: "unmet",
      rawValues: { 기준학점: "2", 취득학점: "0", 잔여학점: "2" },
      reviewReasons: [],
    });
    expect(profile.reviewIssues).toEqual([]);
  });

  it("keeps a composite requirement as a review row instead of dropping it", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "균형교양 - 인간/문화",
            rule: {
              kind: "distribution_minimum",
              minimumAreas: "2",
              totalCredits: "6",
              rawText: "3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
            },
            earnedCredits: "6 / 0",
            inProgressCredits: {
              spring: "0 / 0",
              summer: "0 / 0",
              fall: "0 / 0",
              winter: "0 / 0",
              total: "0 / 0",
            },
            remainingCredits: "0",
            status: "satisfied",
            rawValues: { 기준학점: "영역 이수", 취득학점: "6 / 0", 잔여학점: 0 },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-composite",
    );

    expect(profile.requirements).toHaveLength(1);
    expect(profile.requirements[0]).toMatchObject({
      earnedCredits: null,
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      remainingCredits: 0,
      status: "review",
      rawValues: { 취득학점: "6 / 0", 잔여학점: "0" },
    });
    expect(profile.requirements[0]?.reviewReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("취득학점")]),
    );
    expect(profile.reviewIssues).toEqual([]);
  });

  it("does not create blocking reviews for unused in-progress credits or known DS duplication", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "ds",
            label: "DS기반(공통)",
            rule: { kind: "manual", rawText: "졸업요건 원문 확인" },
            earnedCredits: 0,
            remainingCredits: 2,
            status: "unmet",
            rawValues: { 기준학점: 2, 취득학점: 0, 잔여학점: 2 },
            reviewReasons: [
              "중복 표시 주의",
              "졸업요건 규칙을 자동으로 확정하지 못해 원문 기준으로 표시했습니다.",
              "수강학점 일부가 비어 있거나 복합 형식이어서 0으로 표시했습니다.",
            ],
          },
        ],
        reviewIssues: [
          {
            code: "duplicate_credit",
            message:
              "중복 학점 표시 확인 필요: DS기반(계열1)과 DS기반(공통)에서 동일한 전공 과목이 중복 표시됨",
          },
        ],
      }),
      "graduation_requirements",
      "source-known-information",
    );

    expect(profile.requirements[0]).toMatchObject({
      rule: { kind: "credit_minimum", credits: 2 },
      inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
      status: "unmet",
      reviewReasons: [],
    });
    expect(profile.reviewIssues).toEqual([]);
  });

  it("derives a satisfied credit requirement from remaining credits instead of Solar warnings", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "의사소통",
            rule: { kind: "credit_minimum", credits: 4 },
            earnedCredits: 4,
            remainingCredits: 0,
            status: "unmet",
            rawValues: { 기준학점: 4, 취득학점: 4, 잔여학점: 0 },
            reviewReasons: ["기준학점 미달"],
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-satisfied-requirement",
    );

    expect(profile.requirements[0]).toMatchObject({
      label: "의사소통",
      rule: { kind: "credit_minimum", credits: 4 },
      earnedCredits: 4,
      remainingCredits: 0,
      status: "satisfied",
      reviewReasons: [],
    });
  });

  it("recomputes remaining credits from code instead of trusting Solar's own arithmetic, and flags a mismatch", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "글로벌",
            rule: { kind: "credit_minimum", credits: 10 },
            earnedCredits: 6,
            inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
            // Solar reported 5, but 10 - 6 - 0 = 4: code must win, not Solar's arithmetic.
            remainingCredits: 5,
            status: "unmet",
            rawValues: { 기준학점: "10", 취득학점: "6", 잔여학점: "5" },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-remaining-mismatch",
    );

    expect(profile.requirements[0]).toMatchObject({
      remainingCredits: 4,
      status: "review",
    });
    expect(profile.requirements[0]?.reviewReasons).toEqual(
      expect.arrayContaining([expect.stringContaining("기준·취득·수강학점으로 계산한 잔여학점")]),
    );
  });

  it("does not flag a remaining-credits mismatch that in-progress credits fully explain", () => {
    // The school's own document is generated as of last confirmed semester and does not subtract
    // credits from courses the student is currently taking, so its printed 잔여학점 (기준-취득)
    // routinely differs from the code-computed value (기준-취득-수강중) for any enrolled student.
    // That is expected, not an extraction error, and must not be flagged for review.
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "글로벌",
            rule: { kind: "credit_minimum", credits: 10 },
            earnedCredits: 6,
            inProgressCredits: { spring: 2, summer: 0, fall: 0, winter: 0, total: 2 },
            // Document prints 10 - 6 = 4 (ignores the 2 in-progress credits); code computes
            // 10 - 6 - 2 = 2. The gap is fully explained by inProgressCredits.total.
            remainingCredits: 4,
            status: "in_progress",
            rawValues: { 기준학점: "10", 취득학점: "6", 잔여학점: "4" },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-remaining-explained-by-in-progress",
    );

    expect(profile.requirements[0]).toMatchObject({
      remainingCredits: 2,
      reviewReasons: [],
    });
  });

  it("computes remaining credits even when Solar omits the field entirely", () => {
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "창의",
            rule: { kind: "credit_minimum", credits: 3 },
            earnedCredits: 1,
            inProgressCredits: { spring: 1, summer: 0, fall: 0, winter: 0, total: 1 },
            remainingCredits: null,
            status: "in_progress",
            rawValues: { 기준학점: "3", 취득학점: "1" },
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-remaining-missing",
    );

    expect(profile.requirements[0]).toMatchObject({
      remainingCredits: 1,
      reviewReasons: [],
    });
  });

  it("does not let Solar's own free-text reviewReasons force an otherwise-satisfied requirement into review", () => {
    // Reproduces a live case (2026-07-19, table parsing failed for a pasted-screenshot document):
    // Solar reported internally consistent numbers (글로벌 fully earned) but also invented a
    // nonsensical per-row reviewReasons entry. Before this fix, that alone flipped status to
    // "review", which made the AI filler treat 글로벌 as still unmet and keep recommending
    // English-presentation courses for a requirement the student had already completed.
    const profile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: [
          {
            scope: "general",
            label: "글로벌",
            rule: { kind: "credit_minimum", credits: 2 },
            earnedCredits: 2,
            inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
            remainingCredits: 0,
            status: "satisfied",
            rawValues: { 기준학점: "2", 취득학점: "2", 잔여학점: "0" },
            reviewReasons: ["기준학점과 취득학점이 모두 기록되어 있어 모호함"],
          },
        ],
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-global-satisfied",
    );

    expect(profile.requirements[0]).toMatchObject({
      label: "글로벌",
      status: "satisfied",
      reviewReasons: [],
    });
  });

  it("supplements general and DS rows omitted by Solar from the Document Parse table", () => {
    const tableRows = [
      ["제1전공 심화학점", "36", "15", "0", "0", "0", "0", "0", "21"],
      ["제1전공 코어학점", "60", "30", "0", "0", "0", "0", "0", "30"],
      ["제1전공 실험실습", "9", "3", "0", "0", "0", "0", "0", "6"],
      ["의사소통", "4", "4", "0", "0", "0", "0", "0", "0"],
      ["창의", "3", "3", "0", "0", "0", "0", "0", "0"],
      ["글로벌(필수)", "2", "2", "0", "0", "0", "0", "0", "0"],
      ["글로벌", "4", "4", "0", "0", "0", "0", "0", "0"],
      ["인문사회과학/자연과학기반", "18", "15", "0", "0", "0", "0", "0", "3"],
      ["성균인성·리더십", "2", "2", "0", "0", "0", "0", "0", "0"],
      ["고전·명저", "3", "3", "0", "0", "0", "0", "0", "0"],
      ["DS기반(계열1)", "2", "4", "0", "0", "0", "0", "0", "0"],
      ["DS기반(공통)", "2", "0", "0", "0", "0", "0", "0", "2"],
      [
        "균형교양 - 인간/문화",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
      [
        "균형교양 - 사회/역사",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 3",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
      [
        "균형교양 - 자연/과학/기술",
        "균형교양 3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수",
        "6 / 3",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0 / 0",
        "0",
      ],
    ];
    const markdown = [
      "| 구분 | 기준학점 | 취득학점 | 1학기 | 여름 | 2학기 | 겨울 | 계 | 잔여학점 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...tableRows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
    const solarProfile = parseAcademicExtraction(
      JSON.stringify({
        completedCourses: [],
        requirements: tableRows.slice(0, 3).map((row) => ({
          scope: "primary_major",
          label: row[0],
          rule: { kind: "credit_minimum", credits: Number(row[1]) },
          earnedCredits: Number(row[2]),
          inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
          remainingCredits: Number(row[8]),
          status: "unmet",
          rawValues: {},
          reviewReasons: ["수강학점 일부가 비어 있거나 복합 형식이어서 0으로 표시했습니다."],
        })),
        reviewIssues: [],
      }),
      "graduation_requirements",
      "source-full-table",
    );

    const supplemented = supplementGraduationRequirementsFromMarkdown(
      solarProfile,
      markdown,
      "source-full-table",
    );

    expect(supplemented.requirements).toHaveLength(15);
    expect(supplemented.requirements.map((requirement) => requirement.label)).toEqual(
      tableRows.map((row) => row[0]),
    );
    expect(supplemented.requirements[3]).toMatchObject({
      label: "의사소통",
      scope: "general",
      status: "satisfied",
    });
    expect(supplemented.requirements.slice(0, 12).every(
      (requirement) => requirement.reviewReasons.length === 0,
    )).toBe(true);
    expect(supplemented.requirements[10]).toMatchObject({
      label: "DS기반(계열1)",
      scope: "ds",
    });
    expect(supplemented.requirements.slice(12).map((requirement) => requirement.rule)).toEqual([
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
      expect.objectContaining({
        kind: "distribution_minimum",
        groupId: "balanced-general",
        totalAreas: 3,
        minimumAreas: 2,
        totalCredits: 6,
      }),
    ]);
    expect(supplemented.requirements.slice(12).map((requirement) => requirement.earnedCredits)).toEqual([
      0,
      3,
      3,
    ]);
    expect(supplemented.requirements.slice(12).every(
      (requirement) => requirement.status === "satisfied" && requirement.reviewReasons.length === 0,
    )).toBe(true);
    expect(supplemented.reviewIssues).toEqual([
      expect.objectContaining({
        code: "solar_requirement_rows_supplemented",
        message: expect.stringContaining("12개"),
      }),
    ]);
  });

  it("expands HTML rowspans when Document Parse preserves a merged requirement cell", () => {
    const html = `<table>
      <tr><th>구분</th><th>기준학점</th><th>취득학점</th><th>1학기</th><th>여름</th><th>2학기</th><th>겨울</th><th>계</th><th>잔여학점</th></tr>
      <tr><td>균형교양 - 인간/문화</td><td rowspan="3">3개 영역 중 2개 영역 이상에서 총 6학점 이상 이수</td><td>6 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
      <tr><td>균형교양 - 사회/역사</td><td>6 / 3</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
      <tr><td>균형교양 - 자연/과학/기술</td><td>6 / 3</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0 / 0</td><td>0</td></tr>
    </table>`;
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], requirements: [], reviewIssues: [] }),
      "graduation_requirements",
      "source-html-table",
    );

    const supplemented = supplementGraduationRequirementsFromMarkdown(
      emptyProfile,
      html,
      "source-html-table",
    );

    expect(supplemented.requirements).toHaveLength(3);
    expect(supplemented.requirements.every((requirement) => requirement.scope === "general")).toBe(
      true,
    );
    expect(supplemented.requirements[2]?.rule).toMatchObject({
      kind: "distribution_minimum",
      minimumAreas: 2,
      totalCredits: 6,
    });
  });

  it("rejects a response without the fixed top-level arrays", () => {
    expect(() =>
      parseAcademicExtraction('{"completedCourses":[]}', "course_history", "source-4"),
    ).toThrow(AcademicExtractionError);
  });

  it("ignores an outer pipe-table row whose cell wraps a whole embedded <table>, without losing the embedded table's own rows", () => {
    // Live-verified against a real GLS export (2026-07-20): Document Parse can render a page's
    // course table as an embedded <table>...</table> sitting inside ONE cell of an *outer*
    // pipe-table row (e.g. "휴학구분 인성품: 미취득 <table>...</table>" | "국제품: 미취득 ..." |
    // "AI품: 미취득 ..."). parseMarkdownTableRows reads that whole line as one 3-cell row, finds a
    // course code inside the huge embedded blob, and would otherwise stamp every course found
    // there with the *outer* row's own cells as majorScope/classification — here, page-header
    // junk text ("국제품: 미취득 창의품: 미취득") never meant to be a 이수구분 value at all.
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 전공 | 2023 | 1학기 | ABC1001 정상과목 | 전공코어 | 3 | A+ |",
      '| 휴학구분 인성품: 미취득 <table><tr><td>제1전공</td><td>전공</td><td>2023</td><td>1학기</td><td>XYZ2002 임베디드과목</td><td>전공코어</td><td>3</td><td>A+</td></tr></table> | 국제품: 미취득 창의품: 미취득 | AI품: 미취득 인턴십품: 미취득 |',
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-embedded-table",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-embedded-table",
    );

    expect(supplemented.completedCourses).toHaveLength(2);
    expect(
      supplemented.completedCourses.every(
        (course) => !course.classification.includes("국제품") && !course.majorScope.includes("휴학구분"),
      ),
    ).toBe(true);
    expect(supplemented.completedCourses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courseCode: "ABC1001", majorScope: "제1전공", classification: "전공" }),
        expect.objectContaining({ courseCode: "XYZ2002", majorScope: "제1전공", classification: "전공" }),
      ]),
    );
  });

  it("resolves a cross-contaminated 이수구분 cell (e.g. \"교양 일반선택\") to the single most specific real category", () => {
    // Live-verified: Document Parse's table reconstruction can bleed an adjacent row's 이수구분
    // value into this row's cell. 전공 beats 교양 beats DS beats 선택 (see sanitizeClassification).
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 교양 일반선택 | 2022 | 1학기 | GED9010 교양오염과목 | 의사소통 | 2 | A |",
      "| 제1전공 | 전공 선택 국제어 | 2023 | 1학기 | COS9010 전공오염과목 | 전공코어 | 3 | A+ |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-contaminated-classification",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-contaminated-classification",
    );

    expect(supplemented.completedCourses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courseCode: "GED9010", classification: "교양" }),
        expect.objectContaining({ courseCode: "COS9010", classification: "전공" }),
      ]),
    );
  });

  it("recognizes a 2-digit exchange-credit course code (e.g. EXGL99) instead of swallowing it into the preceding course's name", () => {
    // Live-verified: SKKU's own course codes are always 3-4 digits, but exchange-credit
    // recognition codes (real example: EXGLV45) are only 2 digits — the old {3,4}-digit pattern
    // never matched them at all, so their trailing text got absorbed into whichever real course
    // happened to sit right before them in the same garbled Document Parse cell.
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 전공 | 2023 | 1학기 | PHL9016 고중세철학사 EXGL99 University Exchange Course | 전공코어 | 3 | A |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-2digit-code",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-2digit-code",
    );

    expect(supplemented.completedCourses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ courseCode: "PHL9016", courseName: "고중세철학사" }),
        expect.objectContaining({ courseCode: "EXGL99", courseName: "University Exchange Course" }),
      ]),
    );
  });

  it("strips a dangling year/학기 tail left on a course name by an adjacent garbled row", () => {
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 교양 | 2022 | 1학기 | GED9020 스피치와토론 2025 1 학기 2025 | 의사소통 | 2 | A |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-trailing-noise",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-trailing-noise",
    );

    expect(supplemented.completedCourses).toEqual([
      expect.objectContaining({ courseCode: "GED9020", courseName: "스피치와토론" }),
    ]);
  });

  it("borrows a non-blank courseName from a sibling occurrence when the dedup winner's own name is blank", () => {
    // The occurrence picked for its correct classification (전공, not 선택) can still have a
    // blank name — a different row-boundary garbling issue than which section owns the course —
    // while the *rejected* 선택 occurrence's own row happened to capture the name cleanly.
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 선택 | 2023 | 1학기 | XYZ9030 진짜과목이름 | 전공코어 | 3 | A |",
      "| 제3전공 | 전공 | 2023 | 1학기 | XYZ9030 | 전공코어 | 3 | A |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-name-borrow",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-name-borrow",
    );

    expect(supplemented.completedCourses).toEqual([
      expect.objectContaining({
        courseCode: "XYZ9030",
        courseName: "진짜과목이름",
        majorScope: "제3전공",
        classification: "전공",
      }),
    ]);
  });

  it("resolves a 복수전공 document's duplicated course rows to the genuine (non-선택) occurrence", () => {
    // GLS repeats the whole course-history table once per declared major: 제1전공's own section
    // lists COS9001 as its real 전공 and CNT9001 as a "선택" placeholder for the other major's
    // course; the 제3전공 section mirrors that (CNT9001 real, COS9001 "선택"). GED9001 (교양) is
    // duplicated identically in both, as it belongs to neither major specifically.
    const markdown = [
      "| 전공 | 이수구분 | 년도 | 학기 | 학수번호 | 영역 | 학점 | 성적 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 | 전공 | 2023 | 1학기 | COS9001 동양철학입문 | 전공코어 | 3 | A+ |",
      "| 제1전공 | 선택 | 2024 | 2학기 | CNT9001 문화콘텐츠입문 | 전공코어 | 3 | A |",
      "| 제1전공 | 교양 | 2022 | 1학기 | GED9001 영어쓰기 | 글로벌 | 2 | A |",
      "| 제3전공 | 선택 | 2023 | 1학기 | COS9001 동양철학입문 | 전공코어 | 3 | A+ |",
      "| 제3전공 | 전공 | 2024 | 2학기 | CNT9001 문화콘텐츠입문 | 전공코어 | 3 | A |",
      "| 제3전공 | 교양 | 2022 | 1학기 | GED9001 영어쓰기 | 글로벌 | 2 | A |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], ...EMPTY_REQUIREMENT_ARRAYS }),
      "course_history",
      "source-double-major",
    );

    const supplemented = supplementCompletedCoursesFromMarkdown(
      emptyProfile,
      markdown,
      "source-double-major",
    );

    expect(supplemented.completedCourses).toHaveLength(3);
    expect(supplemented.completedCourses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseCode: "COS9001",
          majorScope: "제1전공",
          classification: "전공",
        }),
        expect.objectContaining({
          courseCode: "CNT9001",
          majorScope: "제3전공",
          classification: "전공",
        }),
        expect.objectContaining({
          courseCode: "GED9001",
          majorScope: "제1전공",
          classification: "교양",
        }),
      ]),
    );
  });

  it("classifies 제2전공/제3전공 graduation-requirement rows as secondary_major instead of falling back to other", () => {
    const markdown = [
      "| 구분 | 기준학점 | 취득학점 | 1학기 | 여름 | 2학기 | 겨울 | 계 | 잔여학점 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 제1전공 총학점 | 42 | 42 | 0 | 0 | 0 | 0 | 0 | 0 |",
      "| 제3전공 총학점 | 42 | 40 | 0 | 0 | 0 | 0 | 0 | 2 |",
    ].join("\n");
    const emptyProfile = parseAcademicExtraction(
      JSON.stringify({ completedCourses: [], requirements: [], reviewIssues: [] }),
      "graduation_requirements",
      "source-secondary-major",
    );

    const supplemented = supplementGraduationRequirementsFromMarkdown(
      emptyProfile,
      markdown,
      "source-secondary-major",
    );

    expect(supplemented.requirements).toEqual([
      expect.objectContaining({
        label: "제1전공 총학점",
        scope: "primary_major",
        reviewReasons: [],
      }),
      expect.objectContaining({
        label: "제3전공 총학점",
        scope: "secondary_major",
        reviewReasons: [],
      }),
    ]);
  });
});

describe("cleanCompletedCourseExtraction", () => {
  const course = (courseCode: string) => ({
    courseCode,
    courseName: "테스트과목",
    majorScope: "",
    classification: "",
    year: null,
    term: null,
    credits: 3,
    area: "",
    completionStatus: "earned" as const,
    recommendationPolicy: "exclude" as const,
    flags: [],
    sourceDocumentId: "source-1",
    reviewReasons: [],
  });

  const baseProfile = (reviewIssues: Array<{ code: string; message: string }>) => ({
    schemaVersion: "1.0" as const,
    profile: {
      departmentCode: null,
      majorCodes: [],
      admissionYear: null,
      currentGrade: null,
      primaryCampus: null,
    },
    sourceDocuments: [{ id: "source-1", kind: "course_history" as const, status: "draft" as const }],
    completedCourses: [course("ADD2013")],
    requirements: [],
    reviewIssues: reviewIssues.map((issue) => ({ ...issue, sourceDocumentId: "source-1" })),
  });

  it("drops Solar's freeform document-level reviewIssues once the table parser succeeded", () => {
    const profile = baseProfile([
      {
        code: "unclear_classification",
        message: "ADD2013 한국건축사: 전공 과목 이수 정보가 학수번호, 영역, 학점 등과 함께 표시되어 구체적인 이수구분이 명확히 구분되지 않음",
      },
      { code: "document_truncated", message: "문서가 길어 일부만 자동 추출했습니다." },
    ]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013"], true);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "document_truncated" }),
    ]);
  });

  it("keeps the narrower legacy filter when the table parser found no rows", () => {
    const profile = baseProfile([
      { code: "unclear_classification", message: "표에서 확인되지 않은 항목입니다." },
      { code: "invalid_completed_course", message: "1번째 행은 형식을 만족하지 않습니다." },
    ]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013"], false);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "unclear_classification" }),
    ]);
  });

  it("still reports missing course codes regardless of table parsing outcome", () => {
    const profile = baseProfile([]);

    const cleaned = cleanCompletedCourseExtraction(profile, ["ADD2013", "ADD2029"], true);

    expect(cleaned.reviewIssues).toEqual([
      expect.objectContaining({ code: "missing_completed_courses", message: expect.stringContaining("1개") }),
    ]);
  });
});

describe("extractTableSegmentsForRetry", () => {
  it("trims to just the <table> blocks so the missing-course retry sends a shorter prompt", () => {
    const markdown = `# 성균관대학교 개인별 수강/취득 과목 리스트
학번: 2020123456 성명: 홍길동 (개인정보는 실제로는 여기 있을 수 있는 자리표시일 뿐)

<table><tr><td>BIZ2021</td><td>관리회계</td></tr></table>

작성일: 2026-07-23 이 문서는 참고용입니다.

<table><tr><td>COS3001</td><td>자료구조</td></tr></table>`;

    const trimmed = extractTableSegmentsForRetry(markdown);

    expect(trimmed).toContain("BIZ2021");
    expect(trimmed).toContain("COS3001");
    expect(trimmed).not.toContain("작성일");
    expect(trimmed.length).toBeLessThan(markdown.length);
  });

  it("falls back to the full markdown when no <table> tag is present (pipe-markdown exports)", () => {
    const markdown = `| 학수번호 | 과목명 |\n| --- | --- |\n| BIZ2021 | 관리회계 |`;

    expect(extractTableSegmentsForRetry(markdown)).toBe(markdown);
  });
});
