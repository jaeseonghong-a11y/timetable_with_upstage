import { afterEach, describe, expect, it } from "vitest";

import {
  buildCourseReviewNoteKey,
  getCourseReviewNote,
  setCourseReviewNote,
} from "./course-review-notes";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("course-review-notes", () => {
  const storage = new MemoryStorage();

  afterEach(() => {
    storage.clear();
  });

  it("uses the same key for the same course and professor across sections", () => {
    const sectionA = {
      title: "기업법 · 01분반",
      courseName: "기업법",
      professor: "김지헌",
    };
    const sectionB = {
      title: "기업법 · 02분반",
      courseName: "기업법",
      professor: "김지헌",
    };
    expect(buildCourseReviewNoteKey(sectionA)).toBe(buildCourseReviewNoteKey(sectionB));
  });

  it("shares a saved note across sections of the same course and professor", () => {
    const sectionA = {
      title: "기업법 · 01분반",
      courseName: "기업법",
      professor: "김지헌",
    };
    const sectionB = {
      title: "기업법 · 02분반",
      courseName: "기업법",
      professor: "김지헌",
    };

    setCourseReviewNote(sectionA, "과제가 많음", storage);
    expect(getCourseReviewNote(sectionB, storage)).toBe("과제가 많음");
  });

  it("keeps notes separate when professors differ", () => {
    setCourseReviewNote(
      { title: "기업법 · 01분반", courseName: "기업법", professor: "김지헌" },
      "A 메모",
      storage,
    );
    setCourseReviewNote(
      { title: "기업법 · 02분반", courseName: "기업법", professor: "다른교수" },
      "B 메모",
      storage,
    );

    expect(
      getCourseReviewNote(
        { title: "기업법 · 01분반", courseName: "기업법", professor: "김지헌" },
        storage,
      ),
    ).toBe("A 메모");
    expect(
      getCourseReviewNote(
        { title: "기업법 · 02분반", courseName: "기업법", professor: "다른교수" },
        storage,
      ),
    ).toBe("B 메모");
  });
});
