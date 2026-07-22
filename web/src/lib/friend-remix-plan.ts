import type { ChoiceBag, SelectionPlan, SubjectOption } from "./selection-plan";
import type { CourseCandidate, Timetable } from "./timetable";

/**
 * Keep the viewer's course-count while offering the sections that either timetable already uses.
 * Different sections of the same course number intentionally become alternatives of one subject.
 */
export function createFriendRemixSelectionPlan(
  mine: Timetable,
  friend: Timetable,
): SelectionPlan | null {
  const subjects = toSubjects([...mine.courses, ...friend.courses]);
  if (subjects.length === 0 || mine.courses.length === 0) return null;
  const numberToChoose = Math.min(mine.courses.length, subjects.length);
  const bag: ChoiceBag = {
    id: "friend-remix",
    title: "내 시간표와 친구 시간표의 과목",
    subjects,
    minSubjects: numberToChoose,
    maxSubjects: numberToChoose,
  };
  return { requiredSubjects: [], choiceBags: [bag] };
}

function toSubjects(courses: readonly CourseCandidate[]): SubjectOption[] {
  const groups = new Map<string, CourseCandidate[]>();
  for (const course of courses) {
    const id = course.courseNumber?.trim().toUpperCase() || course.id;
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
