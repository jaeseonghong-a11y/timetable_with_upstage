// Navigation-only helpers shared by the extension background worker and its unit tests. This
// module never requests an Everytime API or reads review content; it only prepares a search URL.
export function buildEverytimeLectureSearchUrl(course) {
  const professor = String(course.professor || "").trim();
  const courseName = String(course.courseName || "").trim();
  const url = new URL("https://everytime.kr/lecture/search");
  url.searchParams.set("keyword", professor || courseName);
  url.searchParams.set("condition", professor ? "professor" : "name");
  return url.toString();
}

export function makeResolverUrl(course, context) {
  const url = new URL(buildEverytimeLectureSearchUrl(course));
  url.hash = `skku-timetable=${encodeURIComponent(JSON.stringify({ ...context, course, mapKey: courseKey(course) }))}`;
  return url.toString();
}

function courseKey(course) {
  const code = normalize(course.courseNumber) || normalize(course.courseName);
  return `${code}|${normalize(course.professor)}`;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}
