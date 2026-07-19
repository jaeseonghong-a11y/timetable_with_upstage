/**
 * Browser-local state for the no-login friend-timetable feature: "내 코드/토큰" (this browser's
 * own saved entry) and "친구 목록" (codes the user has chosen to follow). The actual timetable
 * data always lives server-side (see friend-timetable-blob.ts) — only these small pointers are
 * kept locally, so returning to this browser instantly shows the same list without re-entering
 * codes, while every view still fetches the friend's *current* data, never a stale snapshot.
 */

type StorageRW = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Exported so render-time reads can go through useLocalStorageItem(KEY) (see
// use-local-storage-item.ts) instead of the getX(storage) helpers below, which are meant for
// event-handler-time reads/writes, not for driving React state during render.
export const MY_CODE_KEY = "skku-timetable:my-code";
export const MY_EDIT_TOKEN_KEY = "skku-timetable:my-edit-token";
export const MY_LABEL_KEY = "skku-timetable:my-label";
export const FRIEND_LIST_KEY = "skku-timetable:friend-list";

export interface FriendEntry {
  code: string;
  nickname: string;
}

export function getMyShareCode(storage: Pick<Storage, "getItem">): string | null {
  return storage.getItem(MY_CODE_KEY);
}

export function getMyEditToken(storage: Pick<Storage, "getItem">): string | null {
  return storage.getItem(MY_EDIT_TOKEN_KEY);
}

export function getMyLabel(storage: Pick<Storage, "getItem">): string {
  return storage.getItem(MY_LABEL_KEY) ?? "";
}

export function setMySave(
  storage: Pick<Storage, "setItem">,
  save: { code: string; editToken: string; label: string },
): void {
  storage.setItem(MY_CODE_KEY, save.code);
  storage.setItem(MY_EDIT_TOKEN_KEY, save.editToken);
  storage.setItem(MY_LABEL_KEY, save.label);
}

export function clearMySave(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(MY_CODE_KEY);
  storage.removeItem(MY_EDIT_TOKEN_KEY);
}

/** Pure parse, reusable wherever the raw JSON string is already in hand (e.g. from
 * useLocalStorageItem(FRIEND_LIST_KEY) during render) without needing a Storage object. */
export function parseFriendListRaw(raw: string | null): FriendEntry[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => (isFriendEntry(entry) ? [entry] : []));
  } catch {
    return [];
  }
}

export function getFriendList(storage: Pick<Storage, "getItem">): FriendEntry[] {
  return parseFriendListRaw(storage.getItem(FRIEND_LIST_KEY));
}

/** Adds (or, if the code is already followed, renames) a friend entry. */
export function addFriend(storage: StorageRW, entry: FriendEntry): FriendEntry[] {
  const current = getFriendList(storage).filter((existing) => existing.code !== entry.code);
  const next = [...current, entry];
  storage.setItem(FRIEND_LIST_KEY, JSON.stringify(next));
  return next;
}

export function removeFriend(storage: StorageRW, code: string): FriendEntry[] {
  const next = getFriendList(storage).filter((entry) => entry.code !== code);
  storage.setItem(FRIEND_LIST_KEY, JSON.stringify(next));
  return next;
}

function isFriendEntry(value: unknown): value is FriendEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === "string" &&
    typeof (value as Record<string, unknown>).nickname === "string"
  );
}
