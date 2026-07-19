import { describe, expect, it } from "vitest";

import {
  addFriend,
  clearMySave,
  getFriendList,
  getMyEditToken,
  getMyLabel,
  getMyShareCode,
  parseFriendListRaw,
  removeFriend,
  setMySave,
} from "./friend-list-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe("my save (code/editToken/label)", () => {
  it("has no saved code before anything is stored", () => {
    const storage = fakeStorage();
    expect(getMyShareCode(storage)).toBeNull();
    expect(getMyEditToken(storage)).toBeNull();
    expect(getMyLabel(storage)).toBe("");
  });

  it("persists code/editToken/label together", () => {
    const storage = fakeStorage();
    setMySave(storage, { code: "ABCD1234", editToken: "token-1", label: "재성" });

    expect(getMyShareCode(storage)).toBe("ABCD1234");
    expect(getMyEditToken(storage)).toBe("token-1");
    expect(getMyLabel(storage)).toBe("재성");
  });

  it("clears the code and editToken but keeps the label for next time", () => {
    const storage = fakeStorage();
    setMySave(storage, { code: "ABCD1234", editToken: "token-1", label: "재성" });
    clearMySave(storage);

    expect(getMyShareCode(storage)).toBeNull();
    expect(getMyEditToken(storage)).toBeNull();
    expect(getMyLabel(storage)).toBe("재성");
  });
});

describe("friend list", () => {
  it("is empty before anything is added", () => {
    const storage = fakeStorage();
    expect(getFriendList(storage)).toEqual([]);
  });

  it("adds friends and preserves insertion order", () => {
    const storage = fakeStorage();
    addFriend(storage, { code: "AAAA1111", nickname: "가" });
    const after = addFriend(storage, { code: "BBBB2222", nickname: "나" });

    expect(after).toEqual([
      { code: "AAAA1111", nickname: "가" },
      { code: "BBBB2222", nickname: "나" },
    ]);
    expect(getFriendList(storage)).toEqual(after);
  });

  it("replaces the nickname instead of duplicating when the same code is added again", () => {
    const storage = fakeStorage();
    addFriend(storage, { code: "AAAA1111", nickname: "가" });
    const after = addFriend(storage, { code: "AAAA1111", nickname: "가나다" });

    expect(after).toEqual([{ code: "AAAA1111", nickname: "가나다" }]);
  });

  it("removes a friend by code", () => {
    const storage = fakeStorage();
    addFriend(storage, { code: "AAAA1111", nickname: "가" });
    addFriend(storage, { code: "BBBB2222", nickname: "나" });
    const after = removeFriend(storage, "AAAA1111");

    expect(after).toEqual([{ code: "BBBB2222", nickname: "나" }]);
  });

  it("ignores corrupted stored JSON instead of throwing", () => {
    expect(parseFriendListRaw("not json")).toEqual([]);
    expect(parseFriendListRaw('{"not":"an array"}')).toEqual([]);
    expect(parseFriendListRaw(null)).toEqual([]);
  });

  it("drops malformed entries but keeps well-formed ones", () => {
    const raw = JSON.stringify([
      { code: "AAAA1111", nickname: "가" },
      { code: "BBBB2222" }, // missing nickname
      "not an object",
      { code: "CCCC3333", nickname: "다" },
    ]);
    expect(parseFriendListRaw(raw)).toEqual([
      { code: "AAAA1111", nickname: "가" },
      { code: "CCCC3333", nickname: "다" },
    ]);
  });
});
