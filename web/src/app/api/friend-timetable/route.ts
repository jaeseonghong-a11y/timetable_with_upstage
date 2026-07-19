import { saveFriendTimetable } from "../../../lib/friend-timetable-blob";

type ApiErrorCode = "invalid_request" | "not_found" | "forbidden";

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Saves (POST without `code`) or updates (POST with matching `code`+`editToken`) a friend
 * timetable entry in Vercel Blob. No login: the `editToken` returned on creation is the only
 * proof of ownership, and it never leaves the client after that (see friend-timetable-blob.ts).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "JSON 본문이 필요합니다.");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_request", "요청 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(body.courses) || body.courses.length === 0) {
    return errorResponse(400, "invalid_request", "저장할 과목이 없습니다.");
  }
  if (typeof body.ownerLabel !== "string") {
    return errorResponse(400, "invalid_request", "표시 이름이 필요합니다.");
  }
  const code = typeof body.code === "string" && body.code ? body.code : undefined;
  const editToken = typeof body.editToken === "string" && body.editToken ? body.editToken : undefined;

  const result = await saveFriendTimetable({
    code,
    editToken,
    ownerLabel: body.ownerLabel,
    courses: body.courses,
  });

  switch (result.outcome) {
    case "created":
      return Response.json({ code: result.code, editToken: result.editToken }, { status: 201 });
    case "updated":
      return Response.json({ code: result.code });
    case "invalid":
      return errorResponse(400, "invalid_request", result.message);
    case "forbidden":
      return errorResponse(403, "forbidden", "이 코드를 수정할 권한이 없습니다.");
    case "not_found":
      return errorResponse(404, "not_found", "해당 코드를 찾을 수 없습니다.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
