import { deleteFriendTimetable, getFriendTimetable } from "../../../../lib/friend-timetable-blob";

type ApiErrorCode = "invalid_request" | "not_found" | "forbidden";

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;
  const view = await getFriendTimetable(code);
  if (!view) {
    return errorResponse(404, "not_found", "해당 코드를 찾을 수 없습니다.");
  }
  return Response.json(view);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const { code } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "JSON 본문이 필요합니다.");
  }
  const editToken =
    typeof body === "object" && body !== null && "editToken" in body && typeof body.editToken === "string"
      ? body.editToken
      : "";
  if (!editToken) {
    return errorResponse(400, "invalid_request", "editToken이 필요합니다.");
  }

  const result = await deleteFriendTimetable(code, editToken);
  switch (result) {
    case "deleted":
      return new Response(null, { status: 204 });
    case "forbidden":
      return errorResponse(403, "forbidden", "이 코드를 삭제할 권한이 없습니다.");
    case "not_found":
      return errorResponse(404, "not_found", "해당 코드를 찾을 수 없습니다.");
  }
}
