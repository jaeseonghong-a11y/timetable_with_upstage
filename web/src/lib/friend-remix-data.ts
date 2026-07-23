import type { FriendEntry } from "./friend-list-storage";
import { parseCourseCandidate, type Timetable } from "./timetable";

export interface FriendRemixSource {
  code: string;
  label: string;
  timetable: Timetable;
  /** null only for a share saved before the required-course marker was introduced. */
  requiredCourseIds: string[] | null;
}

export async function loadFriendRemixSources(input: {
  myCode: string | null;
  myLabel: string;
  friends: readonly FriendEntry[];
}): Promise<{ mine: FriendRemixSource | null; friends: FriendRemixSource[]; errors: string[] }> {
  const errors: string[] = [];
  let mine: FriendRemixSource | null = null;
  if (input.myCode) {
    try {
      mine = await fetchFriendRemixSource(input.myCode, input.myLabel || "내 시간표");
    } catch (error) {
      errors.push(readError(error));
    }
  }
  const loadedFriends = await Promise.all(
    input.friends.map(async (friend) => {
      try {
        return await fetchFriendRemixSource(friend.code, friend.nickname || friend.code);
      } catch (error) {
        errors.push(readError(error));
        return null;
      }
    }),
  );
  return { mine, friends: loadedFriends.flatMap((friend) => (friend ? [friend] : [])), errors };
}

async function fetchFriendRemixSource(code: string, fallbackLabel: string): Promise<FriendRemixSource> {
  // This is the existing no-login share endpoint. No timetable data is stored by the remix route.
  const response = await fetch(`/api/friend-timetable/${encodeURIComponent(code)}`);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(readApiError(payload));
  const parsed = parseResponse(payload);
  if (!parsed) throw new Error("시간표 응답 형식이 올바르지 않습니다.");
  return {
    code,
    label: fallbackLabel || parsed.ownerLabel || code,
    timetable: parsed.timetable,
    requiredCourseIds: parsed.requiredCourseIds,
  };
}

function parseResponse(payload: unknown): {
  ownerLabel: string;
  timetable: Timetable;
  requiredCourseIds: string[] | null;
} | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    ownerLabel?: unknown;
    requiredCourseIds?: unknown;
    timetable?: { courses?: unknown };
  };
  if (typeof record.ownerLabel !== "string" || !Array.isArray(record.timetable?.courses)) return null;
  const rawCourses = record.timetable.courses;
  const courses = rawCourses.flatMap((course) => {
    const parsed = parseCourseCandidate(course);
    return parsed ? [parsed] : [];
  });
  if (courses.length !== rawCourses.length) return null;
  if (
    record.requiredCourseIds !== undefined &&
    (!Array.isArray(record.requiredCourseIds) ||
      !record.requiredCourseIds.every((courseId) => typeof courseId === "string"))
  ) {
    return null;
  }
  const knownCourseIds = new Set(courses.map((course) => course.id));
  const requiredCourseIds = record.requiredCourseIds === undefined
    ? null
    : [...new Set(record.requiredCourseIds.filter((courseId) => knownCourseIds.has(courseId)))];
  return {
    ownerLabel: record.ownerLabel,
    timetable: { courses, meetings: [], fixedEvents: [] },
    requiredCourseIds,
  };
}

function readApiError(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }
  return "시간표를 불러오지 못했습니다.";
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "시간표를 불러오지 못했습니다.";
}
