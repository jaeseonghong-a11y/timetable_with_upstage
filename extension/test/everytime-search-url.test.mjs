import { strict as assert } from "node:assert";
import test from "node:test";

import { buildEverytimeLectureSearchUrl, makeResolverUrl } from "../src/everytime-search-url.js";

test("uses professor search first when a professor is known", () => {
  const url = new URL(
    buildEverytimeLectureSearchUrl({ courseName: "건축설계스튜디오2", professor: "전경희" }),
  );

  assert.equal(url.searchParams.get("keyword"), "전경희");
  assert.equal(url.searchParams.get("condition"), "professor");
});

test("uses course name search when professor is blank", () => {
  const url = new URL(
    buildEverytimeLectureSearchUrl({ courseName: "건축설계스튜디오2", professor: "  " }),
  );

  assert.equal(url.searchParams.get("keyword"), "건축설계스튜디오2");
  assert.equal(url.searchParams.get("condition"), "name");
});

test("keeps course metadata in the resolver hash while using professor search", () => {
  const url = new URL(
    makeResolverUrl(
      { courseNumber: "ADD2007", courseName: "건축설계스튜디오2", professor: "전경희", section: "41" },
      { requestId: "request-1", originTabId: 10 },
    ),
  );

  const context = JSON.parse(decodeURIComponent(new URLSearchParams(url.hash.slice(1)).get("skku-timetable")));
  assert.equal(context.course.courseName, "건축설계스튜디오2");
  assert.equal(context.course.professor, "전경희");
  assert.equal(context.mapKey, "add2007|전경희");
});
