import { describe, expect, it } from "vitest";

import { buildEverytimeReviewSearchUrl, toEverytimeReviewCourse } from "./everytime-review-bridge";

describe("Everytime review bridge", () => {
  it("keeps the raw course name and number when preparing an extension request", () => {
    expect(
      toEverytimeReviewCourse({
        id: "ADD2007-41",
        title: "건축설계스튜디오2 · 41분반",
        courseName: "건축설계스튜디오2",
        courseNumber: "ADD2007",
        professor: "전경희",
        section: "41",
        schedule: "월09:00-10:15",
      }),
    ).toEqual({
      courseNumber: "ADD2007",
      courseName: "건축설계스튜디오2",
      professor: "전경희",
      section: "41",
    });
  });

  it("falls back to the section id and removes only the display suffix", () => {
    const course = toEverytimeReviewCourse({
      id: "GEDG001-41",
      title: "영어쓰기 · 41분반",
      schedule: "",
    });
    expect(course.courseNumber).toBe("GEDG001");
    expect(course.courseName).toBe("영어쓰기");
  });

  it("prefers a professor search when professor data is available", () => {
    const url = new URL(
      buildEverytimeReviewSearchUrl({
        courseNumber: "GEDG001",
        courseName: "영어 쓰기 & 발표",
        professor: "김교수",
        section: "01",
      }),
    );
    expect(url.pathname).toBe("/lecture/search");
    expect(url.searchParams.get("keyword")).toBe("김교수");
    expect(url.searchParams.get("condition")).toBe("professor");
  });

  it("falls back to a name search when professor data is blank", () => {
    const url = new URL(
      buildEverytimeReviewSearchUrl({
        courseNumber: "GEDG001",
        courseName: "영어 쓰기 & 발표",
        professor: "   ",
        section: "01",
      }),
    );
    expect(url.searchParams.get("keyword")).toBe("영어 쓰기 & 발표");
    expect(url.searchParams.get("condition")).toBe("name");
  });
});
