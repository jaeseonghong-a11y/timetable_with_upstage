import type { CourseCandidate } from "./timetable";

export type FriendRemixCourseOrigin = "friend-shared" | "friend-only" | "mine-only";

/**
 * A course number identifies the subject across sections, which is also how remix scoring defines
 * an overlap. Older shared timecodes can miss that field, so their `학수번호-분반` id keeps the
 * course-number portion as a compatible fallback before a manual-course id is used as-is.
 */
export function getFriendRemixCourseOrigins(
  mine: readonly CourseCandidate[],
  friend: readonly CourseCandidate[],
): ReadonlyMap<string, FriendRemixCourseOrigin> {
  const myCourseKeys = new Set(mine.map(getFriendRemixCourseKey));
  const friendCourseKeys = new Set(friend.map(getFriendRemixCourseKey));
  const origins = new Map<string, FriendRemixCourseOrigin>();

  for (const course of [...mine, ...friend]) {
    const key = getFriendRemixCourseKey(course);
    origins.set(course.id, classifyCourseKey(key, myCourseKeys, friendCourseKeys));
  }
  return origins;
}

function classifyCourseKey(
  key: string,
  myCourseKeys: ReadonlySet<string>,
  friendCourseKeys: ReadonlySet<string>,
): FriendRemixCourseOrigin {
  if (myCourseKeys.has(key) && friendCourseKeys.has(key)) return "friend-shared";
  return friendCourseKeys.has(key) ? "friend-only" : "mine-only";
}

export function getFriendRemixCourseKey(course: CourseCandidate): string {
  const courseNumber = course.courseNumber?.trim().toUpperCase();
  if (courseNumber) return courseNumber;
  const legacyCourseNumber = course.id.match(/^(.+)-\d+[A-Z]?$/i)?.[1]?.trim().toUpperCase();
  return legacyCourseNumber || course.id;
}
