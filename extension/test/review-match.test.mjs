import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/review-match.js", import.meta.url), "utf8");
const sandbox = { globalThis: {} };
vm.runInNewContext(source, sandbox);
const { chooseReviewAnchor } = sandbox.globalThis.SkkuTimetableReviewMatch;

test("matches a single result only when course and professor agree", () => {
  const result = chooseReviewAnchor(
    { courseName: "건축설계스튜디오2", professor: "전경희" },
    [
      { id: "1", text: "건축설계스튜디오2 전경희" },
      { id: "2", text: "건축설계스튜디오2 김교수" },
    ],
  );
  assert.equal(result.kind, "auto");
  assert.equal(result.entry.id, "1");
});

test("does not guess when several same course and professor results remain", () => {
  const result = chooseReviewAnchor(
    { courseName: "건축설계스튜디오2", professor: "전경희" },
    [
      { id: "1", text: "건축설계스튜디오2 전경희 1분반" },
      { id: "2", text: "건축설계스튜디오2 전경희 2분반" },
    ],
  );
  assert.equal(result.kind, "choose");
});

test("allows a unique title-only match when professor information is missing", () => {
  const result = chooseReviewAnchor(
    { courseName: "영어쓰기", professor: "" },
    [{ id: "1", text: "영어쓰기 김교수" }],
  );
  assert.equal(result.kind, "auto");
  assert.equal(result.entry.id, "1");
});
