import type { CourseCandidate } from "./timetable";

export type FriendRemixCourseOrigin = "friend-shared" | "friend-only" | "mine-only";

/**
 * A course number identifies the subject across sections, which is also how remix scoring defines
 * an overlap. Falling back to the candidate id keeps manually entered courses distinguishable.
 */
export function getFriendRemixCourseOrigins(
  mine: readonly CourseCandidate[],
  friend: readonly CourseCandidate[],
): ReadonlyMap<string, FriendRemixCourseOrigin> {
  const myCourseKeys = new Set(mine.map(courseKey));
  const friendCourseKeys = new Set(friend.map(courseKey));
  const origins = new Map<string, FriendRemixCourseOrigin>();

  for (const course of [...mine, ...friend]) {
    const key = courseKey(course);
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

function courseKey(course: CourseCandidate): string {
  return course.courseNumber?.trim().toUpperCase() || course.id;
}
