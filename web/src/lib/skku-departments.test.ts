import { describe, expect, it } from "vitest";

import {
  dedupeSkkuDepartmentsByName,
  filterSkkuDepartments,
  getDepartmentAliasCodes,
  groupSkkuDepartments,
  type SkkuDepartment,
} from "./skku-departments";

const DEPARTMENTS: readonly SkkuDepartment[] = [
  { code: "316307", name: "건축학과", college: "공과대학" },
  { code: "316308", name: "건축공학과", college: "공과대학" },
  { code: "316901", name: "경영학과", college: "경영대학" },
];

describe("SKKU department choices", () => {
  it("groups departments under one college heading in source order", () => {
    expect(groupSkkuDepartments(DEPARTMENTS)).toEqual([
      {
        college: "공과대학",
        departments: [DEPARTMENTS[0], DEPARTMENTS[1]],
      },
      {
        college: "경영대학",
        departments: [DEPARTMENTS[2]],
      },
    ]);
  });

  it("searches by college, department name, and six-digit code", () => {
    expect(filterSkkuDepartments("공과대학", DEPARTMENTS)).toEqual([
      DEPARTMENTS[0],
      DEPARTMENTS[1],
    ]);
    expect(filterSkkuDepartments("건축학과", DEPARTMENTS)).toEqual([DEPARTMENTS[0]]);
    expect(filterSkkuDepartments("316901", DEPARTMENTS)).toEqual([DEPARTMENTS[2]]);
  });

  it("resolves every code sharing a duplicated interdisciplinary-major name", () => {
    // 인공지능융합전공 is listed twice by SKKU's own department API: once under 성균융합원
    // (31760605) and once under 소프트웨어융합대학 (31780105), with overlapping but non-identical
    // course offerings. Either code must resolve to both.
    expect(getDepartmentAliasCodes("31760605").slice().sort()).toEqual(["31760605", "31780105"]);
    expect(getDepartmentAliasCodes("31780105").slice().sort()).toEqual(["31760605", "31780105"]);
  });

  it("resolves an unlisted or non-duplicated code to just itself", () => {
    expect(getDepartmentAliasCodes("316901")).toEqual(["316901"]);
    expect(getDepartmentAliasCodes("999999")).toEqual(["999999"]);
  });

  it("collapses same-named entries to the first-listed one", () => {
    const withDuplicates: readonly SkkuDepartment[] = [
      { code: "31760605", name: "인공지능융합전공", college: "성균융합원" },
      { code: "316307", name: "건축학과", college: "공과대학" },
      { code: "31780105", name: "인공지능융합전공", college: "소프트웨어융합대학" },
    ];
    expect(dedupeSkkuDepartmentsByName(withDuplicates)).toEqual([
      { code: "31760605", name: "인공지능융합전공", college: "성균융합원" },
      { code: "316307", name: "건축학과", college: "공과대학" },
    ]);
  });
});
