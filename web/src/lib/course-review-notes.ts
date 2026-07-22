import type { CourseCandidate } from "./timetable";

const STORAGE_KEY = "skku-timetable:course-review-notes:v1";
const CHANGE_EVENT = "skku-timetable:course-review-notes-changed";
const MAX_NOTE_CHARACTERS = 2000;

export type CourseReviewNotesMap = Record<string, string>;

/** 과목명(분반 제외) + 교수명으로 메모를 묶는다. 같은 교수·과목이면 분반이 달라도 동일 키. */
export function buildCourseReviewNoteKey(course: Pick<CourseCandidate, "title" | "courseName" | "professor">): string {
  const courseName = normalizeToken(course.courseName?.trim() || stripDisplaySection(course.title));
  const professor = normalizeToken(course.professor?.trim() || "교수미정");
  return `${courseName}::${professor}`;
}

export function readCourseReviewNotes(storage: Storage = window.localStorage): CourseReviewNotesMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const notes: CourseReviewNotesMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && key.trim()) {
        notes[key] = value.slice(0, MAX_NOTE_CHARACTERS);
      }
    }
    return notes;
  } catch {
    return {};
  }
}

export function getCourseReviewNote(
  course: Pick<CourseCandidate, "title" | "courseName" | "professor">,
  storage: Storage = window.localStorage,
): string {
  return readCourseReviewNotes(storage)[buildCourseReviewNoteKey(course)] ?? "";
}

export function setCourseReviewNote(
  course: Pick<CourseCandidate, "title" | "courseName" | "professor">,
  note: string,
  storage: Storage = window.localStorage,
): string {
  const key = buildCourseReviewNoteKey(course);
  const trimmed = note.trim().slice(0, MAX_NOTE_CHARACTERS);
  const notes = readCourseReviewNotes(storage);
  if (trimmed) {
    notes[key] = trimmed;
  } else {
    delete notes[key];
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(notes));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
  }
  return trimmed;
}

export function subscribeCourseReviewNotes(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handle = (): void => onStoreChange();
  window.addEventListener(CHANGE_EVENT, handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handle);
    window.removeEventListener("storage", handle);
  };
}

function normalizeToken(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripDisplaySection(title: string): string {
  return title.replace(/\s*·\s*[^·]+분반\s*$/u, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
