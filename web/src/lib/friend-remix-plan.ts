import type { ChoiceBag, SelectionPlan, SubjectOption } from "./selection-plan";
import { getFriendRemixCourseKey } from "./friend-remix-course-origin";
import type { CourseCandidate, Timetable } from "./timetable";

/**
 * A remix starts from the viewer's own required subjects. Their earlier optional selections are
 * intentionally discarded; the remaining course count is filled with the friend's subjects.
 * Different sections of one course number remain alternatives of the same subject.
 */
export function createFriendRemixSelectionPlan(
  mine: Timetable,
  friend: Timetable,
  requiredCourseIds: readonly string[],
): SelectionPlan | null {
  const requiredIdSet = new Set(requiredCourseIds);
  const requiredSubjects = toSubjects(mine.courses.filter((course) => requiredIdSet.has(course.id)));
  if (requiredSubjects.length === 0) return null;

  const requiredSubjectIds = new Set(requiredSubjects.map((subject) => subject.id));
  const friendSubjects = toSubjects(friend.courses).filter(
    (subject) => !requiredSubjectIds.has(subject.id),
  );
  const optionalCourseCount = Math.min(
    Math.max(0, mine.courses.length - requiredSubjects.length),
    friendSubjects.length,
  );
  const choiceBags: ChoiceBag[] = optionalCourseCount > 0
    ? [{
        id: "friend-remix",
        title: "친구 시간표 과목",
        subjects: friendSubjects,
        minSubjects: optionalCourseCount,
        maxSubjects: optionalCourseCount,
      }]
    : [];
  return { requiredSubjects, choiceBags };
}

function toSubjects(courses: readonly CourseCandidate[]): SubjectOption[] {
  const groups = new Map<string, CourseCandidate[]>();
  for (const course of courses) {
    const id = getFriendRemixCourseKey(course);
    const group = groups.get(id) ?? [];
    if (!group.some((candidate) => candidate.id === course.id)) group.push(course);
    groups.set(id, group);
  }
  return [...groups.entries()].map(([id, sections]) => ({
    id,
    title: sections[0]?.courseName?.trim() || sections[0]?.title || id,
    credits: sections[0]?.credits ?? 0,
    sections,
  }));
}
