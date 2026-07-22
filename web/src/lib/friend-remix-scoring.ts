import { areaMatchesUnmetLabels } from "./ai-filler-selection";
import { getFriendRemixCourseKey } from "./friend-remix-course-origin";
import type { CourseCandidate, Timetable } from "./timetable";

export type FriendRemixMode = "together" | "opposite";
export type FriendRemixScope = "general_only" | "major_only" | "general_and_major";
export type FriendRemixStrength = "strong" | "weak";

export interface FriendRemixScoreInput {
  friendCourses: readonly CourseCandidate[];
  mode: FriendRemixMode;
  scope: FriendRemixScope;
  strength: FriendRemixStrength;
  unmetRequirementLabels: readonly string[];
}

export interface FriendRemixMatch {
  courseNumber: string;
  title: string;
  points: number;
}

export interface ScoredFriendRemixTimetable {
  candidateId: string;
  timetable: Timetable;
  totalScore: number;
  matchedCourseCount: number;
  matches: FriendRemixMatch[];
}

/** Scores only already-generated valid schedules. It never changes time-conflict generation. */
export function scoreFriendRemixTimetables(
  candidates: readonly Timetable[],
  input: FriendRemixScoreInput,
): ScoredFriendRemixTimetable[] {
  const friendsByCourseNumber = new Map<string, CourseCandidate[]>();
  for (const course of input.friendCourses) {
    const number = normalizedCourseNumber(course);
    if (!number || !isInScope(course, input.scope)) continue;
    const matches = friendsByCourseNumber.get(number) ?? [];
    matches.push(course);
    friendsByCourseNumber.set(number, matches);
  }

  return candidates
    .map((timetable) => scoreOneTimetable(timetable, friendsByCourseNumber, input))
    .sort((first, second) => second.totalScore - first.totalScore || first.candidateId.localeCompare(second.candidateId));
}

function scoreOneTimetable(
  timetable: Timetable,
  friendsByCourseNumber: ReadonlyMap<string, readonly CourseCandidate[]>,
  input: FriendRemixScoreInput,
): ScoredFriendRemixTimetable {
  const matches: FriendRemixMatch[] = [];
  for (const course of timetable.courses) {
    const number = normalizedCourseNumber(course);
    const friendMatches = number ? friendsByCourseNumber.get(number) : undefined;
    if (!number || !friendMatches || !isInScope(course, input.scope)) continue;

    const candidateMatchesUnmet = matchesUnmetArea(course, input.unmetRequirementLabels);
    const friendMatchesUnmet = friendMatches.some((friendCourse) =>
      matchesUnmetArea(friendCourse, input.unmetRequirementLabels),
    );
    const shouldAffectScore =
      input.strength === "strong"
        ? true
        : input.mode === "together"
          ? candidateMatchesUnmet && friendMatchesUnmet
          : !candidateMatchesUnmet && friendMatches.every(
              (friendCourse) => !matchesUnmetArea(friendCourse, input.unmetRequirementLabels),
            );
    if (!shouldAffectScore) continue;
    matches.push({
      courseNumber: number,
      title: course.courseName?.trim() || course.title,
      points: input.mode === "together" ? 1 : -1,
    });
  }
  return {
    candidateId: timetable.courses.map((course) => course.id).sort().join("|"),
    timetable,
    totalScore: matches.reduce((total, match) => total + match.points, 0),
    matchedCourseCount: matches.length,
    matches,
  };
}

export function getFriendRemixCourseTypeLabel(course: CourseCandidate): string {
  const raw = course.courseType?.trim();
  if (raw) return raw;
  return /online|i-campus/i.test(course.schedule) ? "I-Campus" : "기타";
}

export function isGeneralEducationCourse(course: CourseCandidate): boolean {
  const label = getFriendRemixCourseTypeLabel(course);
  return label.includes("교양") || label.includes("일반선택");
}

function normalizedCourseNumber(course: CourseCandidate): string {
  return getFriendRemixCourseKey(course);
}

function isInScope(course: CourseCandidate, scope: FriendRemixScope): boolean {
  if (scope === "general_and_major") return true;
  return scope === "general_only" ? isGeneralEducationCourse(course) : isMajorCourse(course);
}

function isMajorCourse(course: CourseCandidate): boolean {
  return getFriendRemixCourseTypeLabel(course).includes("전공");
}

function matchesUnmetArea(course: CourseCandidate, labels: readonly string[]): boolean {
  return labels.length > 0 && areaMatchesUnmetLabels(getFriendRemixCourseTypeLabel(course), labels);
}
