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

interface ConnectorResponse {
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
  const url = new URL("https://everytime.kr/lecture/search");
  url.searchParams.set("keyword", course.courseName);
  url.searchParams.set("condition", "name");
  return url.toString();
}

export function isEverytimeConnectorAvailable(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.getAttribute(CONNECTOR_READY_ATTRIBUTE) === "ready";
}

export function requestEverytimeReview(
  course: EverytimeReviewCourse,
  onStatus?: (response: ConnectorResponse) => void,
): boolean {
  return dispatchConnectorRequest("open-review", { course }, onStatus);
}

export function requestEverytimeReviewBatch(
  courses: readonly EverytimeReviewCourse[],
  onStatus?: (response: ConnectorResponse) => void,
): boolean {
  return dispatchConnectorRequest("resolve-review-batch", { courses }, onStatus);
}

function dispatchConnectorRequest(
  type: "open-review" | "resolve-review-batch",
  payload: Record<string, unknown>,
  onStatus?: (response: ConnectorResponse) => void,
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

function isConnectorResponse(value: unknown): value is ConnectorResponse {
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
