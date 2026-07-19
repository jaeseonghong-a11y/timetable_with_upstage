import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/friend-timetable-blob", () => ({
  deleteFriendTimetable: vi.fn(),
  getFriendTimetable: vi.fn(),
}));

const { deleteFriendTimetable, getFriendTimetable } = await import(
  "../../../../lib/friend-timetable-blob"
);
const { DELETE, GET } = await import("./route");

function context(code: string) {
  return { params: Promise.resolve({ code }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/friend-timetable/[code]", () => {
  it("returns the timetable view when found", async () => {
    vi.mocked(getFriendTimetable).mockResolvedValueOnce({
      ownerLabel: "재성",
      timetable: { courses: [{ id: "A1", title: "과목", schedule: "" }], meetings: [], fixedEvents: [] },
      updatedAt: "2026-07-20T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/api/friend-timetable/ABCD2345"), context("ABCD2345"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ownerLabel: string };
    expect(body.ownerLabel).toBe("재성");
    expect(getFriendTimetable).toHaveBeenCalledWith("ABCD2345");
  });

  it("returns 404 when not found", async () => {
    vi.mocked(getFriendTimetable).mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/friend-timetable/NOPE0000"), context("NOPE0000"));
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/friend-timetable/[code]", () => {
  function deleteRequest(body: unknown): Request {
    return new Request("http://localhost/api/friend-timetable/ABCD2345", {
      method: "DELETE",
      body: JSON.stringify(body),
    });
  }

  it("rejects a non-JSON body", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/friend-timetable/ABCD2345", { method: "DELETE", body: "not json" }),
      context("ABCD2345"),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a request with no editToken", async () => {
    const response = await DELETE(deleteRequest({}), context("ABCD2345"));
    expect(response.status).toBe(400);
    expect(deleteFriendTimetable).not.toHaveBeenCalled();
  });

  it("returns 204 when deleted", async () => {
    vi.mocked(deleteFriendTimetable).mockResolvedValueOnce("deleted");
    const response = await DELETE(deleteRequest({ editToken: "secret" }), context("ABCD2345"));
    expect(response.status).toBe(204);
    expect(deleteFriendTimetable).toHaveBeenCalledWith("ABCD2345", "secret");
  });

  it("returns 403 when the editToken is wrong", async () => {
    vi.mocked(deleteFriendTimetable).mockResolvedValueOnce("forbidden");
    const response = await DELETE(deleteRequest({ editToken: "wrong" }), context("ABCD2345"));
    expect(response.status).toBe(403);
  });

  it("returns 404 when the code doesn't exist", async () => {
    vi.mocked(deleteFriendTimetable).mockResolvedValueOnce("not_found");
    const response = await DELETE(deleteRequest({ editToken: "whatever" }), context("NOPE0000"));
    expect(response.status).toBe(404);
  });
});
