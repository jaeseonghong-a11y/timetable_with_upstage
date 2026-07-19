import { randomInt, randomUUID, createHash } from "node:crypto";

import { del, get, head, put } from "@vercel/blob";

import { parseCourseCandidate, type CourseCandidate, type Timetable } from "./timetable";

/** Unambiguous charset (no 0/O/1/I/L) so a code is easy to read aloud or copy by hand. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const MAX_CODE_GENERATION_ATTEMPTS = 5;
const MAX_COURSES = 30;
const MAX_OWNER_LABEL_LENGTH = 24;
const BLOB_ACCESS = "private" as const;

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Guards against a malformed/malicious `code` (e.g. path traversal) ever reaching a Blob path. */
export function isValidFriendCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

function blobPathname(code: string): string {
  return `friend-timetables/${code}.json`;
}

interface StoredRecord {
  version: 1;
  ownerLabel: string;
  editTokenHash: string;
  courses: CourseCandidate[];
  updatedAt: string;
}

export interface FriendTimetableSaveInput {
  /** Omit to create a new entry. Provide to update an existing one (editToken required). */
  code?: string;
  editToken?: string;
  ownerLabel: string;
  courses: CourseCandidate[];
}

export type FriendTimetableSaveResult =
  | { outcome: "created"; code: string; editToken: string }
  | { outcome: "updated"; code: string }
  | { outcome: "invalid"; message: string }
  | { outcome: "forbidden" }
  | { outcome: "not_found" };

export interface FriendTimetableView {
  ownerLabel: string;
  timetable: Timetable;
  updatedAt: string;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

function hashEditToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeOwnerLabel(raw: string): string {
  const trimmed = raw.trim().slice(0, MAX_OWNER_LABEL_LENGTH);
  return trimmed || "이름 없음";
}

/**
 * Validates and normalizes the course list a client wants to save — same shape/limit as
 * timetable-share.ts's link-sharing path, since neither meetings nor fixedEvents are needed
 * (TimetableCard derives meetings from course.schedule itself, and fixedEvents are personal).
 */
function normalizeCourses(value: unknown): CourseCandidate[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const courses = value.slice(0, MAX_COURSES).flatMap((entry) => {
    const course = parseCourseCandidate(entry);
    return course ? [course] : [];
  });
  return courses.length > 0 ? courses : null;
}

async function readRecord(code: string): Promise<StoredRecord | null> {
  if (!isValidFriendCode(code)) {
    return null;
  }
  try {
    const result = await get(blobPathname(code), { access: BLOB_ACCESS, useCache: false });
    if (!result || result.statusCode !== 200) {
      return null;
    }
    const parsed: unknown = await new Response(result.stream).json();
    return isStoredRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).version === 1 &&
    typeof (value as Record<string, unknown>).ownerLabel === "string" &&
    typeof (value as Record<string, unknown>).editTokenHash === "string" &&
    Array.isArray((value as Record<string, unknown>).courses) &&
    typeof (value as Record<string, unknown>).updatedAt === "string"
  );
}

export async function saveFriendTimetable(
  input: FriendTimetableSaveInput,
): Promise<FriendTimetableSaveResult> {
  const courses = normalizeCourses(input.courses);
  if (!courses) {
    return { outcome: "invalid", message: "저장할 과목이 없습니다." };
  }
  const ownerLabel = sanitizeOwnerLabel(input.ownerLabel);

  if (input.code) {
    const existing = await readRecord(input.code);
    if (!existing) {
      return { outcome: "not_found" };
    }
    if (!input.editToken || hashEditToken(input.editToken) !== existing.editTokenHash) {
      return { outcome: "forbidden" };
    }
    const record: StoredRecord = {
      version: 1,
      ownerLabel,
      editTokenHash: existing.editTokenHash,
      courses,
      updatedAt: new Date().toISOString(),
    };
    await put(blobPathname(input.code), JSON.stringify(record), {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return { outcome: "updated", code: input.code };
  }

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateCode();
    const alreadyExists = await head(blobPathname(code))
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) {
      continue;
    }
    const editToken = randomUUID();
    const record: StoredRecord = {
      version: 1,
      ownerLabel,
      editTokenHash: hashEditToken(editToken),
      courses,
      updatedAt: new Date().toISOString(),
    };
    await put(blobPathname(code), JSON.stringify(record), {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    return { outcome: "created", code, editToken };
  }
  return { outcome: "invalid", message: "코드 생성에 반복 실패했습니다. 다시 시도해 주세요." };
}

export async function getFriendTimetable(code: string): Promise<FriendTimetableView | null> {
  const record = await readRecord(code);
  if (!record) {
    return null;
  }
  return {
    ownerLabel: record.ownerLabel,
    timetable: { courses: record.courses, meetings: [], fixedEvents: [] },
    updatedAt: record.updatedAt,
  };
}

export type DeleteFriendTimetableResult = "deleted" | "forbidden" | "not_found";

export async function deleteFriendTimetable(
  code: string,
  editToken: string,
): Promise<DeleteFriendTimetableResult> {
  const existing = await readRecord(code);
  if (!existing) {
    return "not_found";
  }
  if (hashEditToken(editToken) !== existing.editTokenHash) {
    return "forbidden";
  }
  await del(blobPathname(code));
  return "deleted";
}

/** Exported for tests that need to assert on the exact code alphabet/length without duplicating them. */
export const FRIEND_CODE_ALPHABET = CODE_ALPHABET;
export const FRIEND_CODE_LENGTH = CODE_LENGTH;
