import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/friend-timetable-blob", () => ({
  saveFriendTimetable: vi.fn(),
}));

const { saveFriendTimetable } = await import("../../../lib/friend-timetable-blob");
const { POST } = await import("./route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/friend-timetable", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/friend-timetable", () => {
  it("rejects a non-JSON body", async () => {
    const response = await POST(
      new Request("http://localhost/api/friend-timetable", { method: "POST", body: "not json" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request with no courses", async () => {
    const response = await POST(jsonRequest({ ownerLabel: "재성", courses: [] }));
    expect(response.status).toBe(400);
    expect(saveFriendTimetable).not.toHaveBeenCalled();
  });

  it("rejects a request with a missing ownerLabel", async () => {
    const response = await POST(jsonRequest({ courses: [{ id: "A1", title: "과목", schedule: "" }] }));
    expect(response.status).toBe(400);
  });

  it("returns 201 with code and editToken on creation", async () => {
    vi.mocked(saveFriendTimetable).mockResolvedValueOnce({
      outcome: "created",
      code: "ABCD2345",
      editToken: "secret-token",
    });

    const response = await POST(
      jsonRequest({ ownerLabel: "재성", courses: [{ id: "A1", title: "과목", schedule: "" }] }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; editToken: string };
    expect(body).toEqual({ code: "ABCD2345", editToken: "secret-token" });
  });

  it("returns 200 with only the code on update", async () => {
    vi.mocked(saveFriendTimetable).mockResolvedValueOnce({ outcome: "updated", code: "ABCD2345" });

    const response = await POST(
      jsonRequest({
        code: "ABCD2345",
        editToken: "secret-token",
        ownerLabel: "재성",
        courses: [{ id: "A1", title: "과목", schedule: "" }],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { code: string; editToken?: string };
    expect(body.code).toBe("ABCD2345");
    expect(body.editToken).toBeUndefined();
  });

  it("returns 403 when the outcome is forbidden", async () => {
    vi.mocked(saveFriendTimetable).mockResolvedValueOnce({ outcome: "forbidden" });
    const response = await POST(
      jsonRequest({
        code: "ABCD2345",
        editToken: "wrong",
        ownerLabel: "재성",
        courses: [{ id: "A1", title: "과목", schedule: "" }],
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 when the outcome is not_found", async () => {
    vi.mocked(saveFriendTimetable).mockResolvedValueOnce({ outcome: "not_found" });
    const response = await POST(
      jsonRequest({
        code: "ZZZZZZZZ",
        editToken: "whatever",
        ownerLabel: "재성",
        courses: [{ id: "A1", title: "과목", schedule: "" }],
      }),
    );
    expect(response.status).toBe(404);
  });
});
