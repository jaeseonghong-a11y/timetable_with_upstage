import type { CourseCandidate } from "./timetable";

const REQUEST_EVENT = "skku-timetable:connector-request";
const RESPONSE_EVENT = "skku-timetable:connector-response";
const CONNECTOR_READY_ATTRIBUTE = "data-skku-timetable-connector";

export interface EverytimeReviewCourse {
  courseNumber: string;
  courseName: string;
  professor: string;
  section: string;
}

export interface EverytimeReviewResponse {
  requestId: string;
  status: "accepted" | "direct" | "matching" | "needs-selection" | "not-found" | "failed" | "complete";
  message?: string;
}

export function toEverytimeReviewCourse(course: CourseCandidate): EverytimeReviewCourse {
  return {
    // A shared timetable opened from a link may predate this field. Its section id is still a
    // useful fallback, but the resolver always treats professor+title as the final guard.
    courseNumber: course.courseNumber?.trim() || course.id.split("-")[0]?.trim() || course.id,
    courseName: course.courseName?.trim() || stripDisplaySection(course.title),
    professor: course.professor?.trim() || "",
    section: course.section?.trim() || "",
  };
}

export function buildEverytimeReviewSearchUrl(course: EverytimeReviewCourse): string {
  const professor = course.professor.trim();
  const url = new URL("https://everytime.kr/lecture/search");
  // A professor search keeps the target section near the top when the same course title is
  // offered many times. The extension still verifies both title and professor before opening a
  // review, so this only narrows the navigation result; it never becomes a match by itself.
  url.searchParams.set("keyword", professor || course.courseName);
  url.searchParams.set("condition", professor ? "professor" : "name");
  return url.toString();
}

export function describeEverytimeReviewResponse(response: EverytimeReviewResponse): string {
  if (response.status === "direct") {
    return "저장된 강의평을 열었어요.";
  }
  if (response.status === "matching") {
    return "과목·교수명으로 강의평을 찾는 중…";
  }
  if (response.status === "needs-selection") {
    return "에타 탭에서 맞는 강의를 한 번 선택해 주세요.";
  }
  if (response.status === "not-found" || response.status === "failed") {
    return response.message ?? "자동 연결하지 못했어요. 에타 검색 결과를 확인해 주세요.";
  }
  return response.message ?? "강의평 연결을 준비하는 중…";
}

export function isEverytimeConnectorAvailable(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.getAttribute(CONNECTOR_READY_ATTRIBUTE) === "ready";
}

export function requestEverytimeReview(
  course: EverytimeReviewCourse,
  onStatus?: (response: EverytimeReviewResponse) => void,
): boolean {
  return dispatchConnectorRequest("open-review", { course }, onStatus);
}

function dispatchConnectorRequest(
  type: "open-review",
  payload: Record<string, unknown>,
  onStatus?: (response: EverytimeReviewResponse) => void,
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined" || !isEverytimeConnectorAvailable()) {
    return false;
  }
  const requestId = crypto.randomUUID();
  const onResponse = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!isConnectorResponse(detail) || detail.requestId !== requestId) {
      return;
    }
    onStatus?.(detail);
    if (detail.status === "complete" || detail.status === "failed" || detail.status === "not-found") {
      window.removeEventListener(RESPONSE_EVENT, onResponse);
    }
  };
  window.addEventListener(RESPONSE_EVENT, onResponse);
  window.dispatchEvent(
    new CustomEvent(REQUEST_EVENT, {
      detail: { version: 1, requestId, type, ...payload },
    }),
  );
  // A service-worker response should arrive immediately. Avoid retaining a listener forever if
  // a browser disables the extension after the page loaded.
  window.setTimeout(() => window.removeEventListener(RESPONSE_EVENT, onResponse), 30_000);
  return true;
}

function isConnectorResponse(value: unknown): value is EverytimeReviewResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const response = value as { requestId?: unknown; status?: unknown; message?: unknown };
  return (
    typeof response.requestId === "string" &&
    typeof response.status === "string" &&
    (response.message === undefined || typeof response.message === "string")
  );
}

function stripDisplaySection(title: string): string {
  return title.replace(/\s*·\s*[^·]+분반\s*$/, "").trim();
}
