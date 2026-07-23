import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => {
  const store = new Map<string, string>();

  function streamOf(content: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
        controller.close();
      },
    });
  }

  return {
    __reset: () => store.clear(),
    put: vi.fn(
      async (
        pathname: string,
        body: string,
        options: { allowOverwrite?: boolean },
      ): Promise<{ pathname: string }> => {
        if (store.has(pathname) && !options.allowOverwrite) {
          throw new Error("blob already exists at this pathname");
        }
        store.set(pathname, body);
        return { pathname };
      },
    ),
    head: vi.fn(async (pathname: string): Promise<{ pathname: string }> => {
      if (!store.has(pathname)) {
        throw new Error("blob not found");
      }
      return { pathname };
    }),
    get: vi.fn(async (pathname: string) => {
      const content = store.get(pathname);
      if (content === undefined) {
        return null;
      }
      return { statusCode: 200, stream: streamOf(content), headers: new Headers(), blob: {} };
    }),
    del: vi.fn(async (pathname: string): Promise<void> => {
      store.delete(pathname);
    }),
  };
});

const blobModule = await import("@vercel/blob");
const { __reset } = blobModule as unknown as { __reset: () => void };

const {
  deleteFriendTimetable,
  getFriendTimetable,
  isValidFriendCode,
  saveFriendTimetable,
} = await import("./friend-timetable-blob");

function course(id: string) {
  return { id, title: `과목 ${id}`, schedule: "" };
}

beforeEach(() => {
  __reset();
  vi.clearAllMocks();
});

describe("saveFriendTimetable — creating a new entry", () => {
  it("generates a code and editToken, and getFriendTimetable can read it back", async () => {
    const result = await saveFriendTimetable({
      ownerLabel: "재성",
      courses: [course("A1"), course("B1")],
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") {
      throw new Error("expected created");
    }
    expect(result.code).toHaveLength(8);
    expect(isValidFriendCode(result.code)).toBe(true);
    expect(result.editToken).toBeTruthy();

    const view = await getFriendTimetable(result.code);
    expect(view?.ownerLabel).toBe("재성");
    expect(view?.timetable.courses.map((c) => c.id)).toEqual(["A1", "B1"]);
    expect(view?.timetable.meetings).toEqual([]);
    expect(view?.timetable.fixedEvents).toEqual([]);
  });

  it("rejects an empty course list", async () => {
    const result = await saveFriendTimetable({ ownerLabel: "재성", courses: [] });
    expect(result.outcome).toBe("invalid");
  });

  it("falls back to a default label when ownerLabel is blank", async () => {
    const result = await saveFriendTimetable({ ownerLabel: "   ", courses: [course("A1")] });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") {
      throw new Error("expected created");
    }
    const view = await getFriendTimetable(result.code);
    expect(view?.ownerLabel).toBe("이름 없음");
  });

  it("round-trips only required ids that belong to the saved timetable", async () => {
    const result = await saveFriendTimetable({
      ownerLabel: "재성",
      courses: [course("A1"), course("B1")],
      requiredCourseIds: ["A1", "missing", "A1"],
    });
    if (result.outcome !== "created") {
      throw new Error("expected created");
    }

    const view = await getFriendTimetable(result.code);
    expect(view?.requiredCourseIds).toEqual(["A1"]);
  });
});

describe("saveFriendTimetable — updating an existing entry", () => {
  it("overwrites the same code when the editToken matches", async () => {
    const created = await saveFriendTimetable({ ownerLabel: "재성", courses: [course("A1")] });
    if (created.outcome !== "created") {
      throw new Error("expected created");
    }

    const updated = await saveFriendTimetable({
      code: created.code,
      editToken: created.editToken,
      ownerLabel: "재성2",
      courses: [course("B1"), course("C1")],
    });
    expect(updated.outcome).toBe("updated");

    const view = await getFriendTimetable(created.code);
    expect(view?.ownerLabel).toBe("재성2");
    expect(view?.timetable.courses.map((c) => c.id)).toEqual(["B1", "C1"]);
  });

  it("refuses to overwrite with a wrong editToken", async () => {
    const created = await saveFriendTimetable({ ownerLabel: "재성", courses: [course("A1")] });
    if (created.outcome !== "created") {
      throw new Error("expected created");
    }

    const result = await saveFriendTimetable({
      code: created.code,
      editToken: "wrong-token",
      ownerLabel: "누군가",
      courses: [course("Z9")],
    });
    expect(result.outcome).toBe("forbidden");

    // The original entry must be untouched.
    const view = await getFriendTimetable(created.code);
    expect(view?.ownerLabel).toBe("재성");
  });

  it("refuses to overwrite when no editToken is given at all", async () => {
    const created = await saveFriendTimetable({ ownerLabel: "재성", courses: [course("A1")] });
    if (created.outcome !== "created") {
      throw new Error("expected created");
    }

    const result = await saveFriendTimetable({
      code: created.code,
      ownerLabel: "누군가",
      courses: [course("Z9")],
    });
    expect(result.outcome).toBe("forbidden");
  });

  it("reports not_found when updating a code that was never created", async () => {
    const result = await saveFriendTimetable({
      code: "ZZZZZZZZ",
      editToken: "whatever",
      ownerLabel: "재성",
      courses: [course("A1")],
    });
    expect(result.outcome).toBe("not_found");
  });
});

describe("getFriendTimetable", () => {
  it("returns null for a code that was never saved", async () => {
    expect(await getFriendTimetable("NOPE0000")).toBeNull();
  });

  it("returns null for a malformed code without touching the blob store", async () => {
    expect(await getFriendTimetable("../secret")).toBeNull();
  });
});

describe("deleteFriendTimetable", () => {
  it("deletes when the editToken matches, and the entry is gone afterward", async () => {
    const created = await saveFriendTimetable({ ownerLabel: "재성", courses: [course("A1")] });
    if (created.outcome !== "created") {
      throw new Error("expected created");
    }

    const result = await deleteFriendTimetable(created.code, created.editToken);
    expect(result).toBe("deleted");
    expect(await getFriendTimetable(created.code)).toBeNull();
  });

  it("refuses to delete with a wrong editToken and leaves the entry intact", async () => {
    const created = await saveFriendTimetable({ ownerLabel: "재성", courses: [course("A1")] });
    if (created.outcome !== "created") {
      throw new Error("expected created");
    }

    const result = await deleteFriendTimetable(created.code, "wrong-token");
    expect(result).toBe("forbidden");
    expect(await getFriendTimetable(created.code)).not.toBeNull();
  });

  it("reports not_found for a code that doesn't exist", async () => {
    expect(await deleteFriendTimetable("NOPE0000", "whatever")).toBe("not_found");
  });
});

describe("isValidFriendCode", () => {
  it("accepts an 8-character code from the unambiguous alphabet", () => {
    expect(isValidFriendCode("23456789")).toBe(true);
  });

  it("rejects wrong length, lowercase, ambiguous characters, and path-traversal-like input", () => {
    expect(isValidFriendCode("2345678")).toBe(false); // too short
    expect(isValidFriendCode("234567890")).toBe(false); // too long
    expect(isValidFriendCode("abcdefgh")).toBe(false); // lowercase
    expect(isValidFriendCode("0OIL1234")).toBe(false); // ambiguous chars excluded from alphabet
    expect(isValidFriendCode("../secret")).toBe(false);
  });
});
