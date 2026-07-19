"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { TimetableCard } from "@/components/TimetableCard";
import timetableStyles from "@/components/TimetablePlanner.module.css";
import {
  addFriend,
  clearMySave,
  FRIEND_LIST_KEY,
  getMyEditToken,
  MY_CODE_KEY,
  MY_LABEL_KEY,
  parseFriendListRaw,
  removeFriend,
  type FriendEntry,
} from "@/lib/friend-list-storage";
import { SITE_NAME } from "@/lib/site-config";
import type { Timetable } from "@/lib/timetable";
import { useLocalStorageItem } from "@/lib/use-local-storage-item";

import pageStyles from "../page.module.css";
import styles from "./page.module.css";

interface FriendView {
  status: "loading" | "error" | "ready";
  ownerLabel?: string;
  timetable?: Timetable;
  error?: string;
}

export default function FriendsPage() {
  // SSR/hydration-safe reads of this browser's localStorage — see use-local-storage-item.ts for
  // why this isn't a plain useState+useEffect (that pattern trips the "no setState in an effect
  // body" lint rule and risks a hydration mismatch).
  const storedMyCode = useLocalStorageItem(MY_CODE_KEY);
  const storedMyLabel = useLocalStorageItem(MY_LABEL_KEY) ?? "";
  const friendListRaw = useLocalStorageItem(FRIEND_LIST_KEY);
  const storedFriends = useMemo(() => parseFriendListRaw(friendListRaw), [friendListRaw]);

  // Local overrides for actions taken on THIS page (delete my save / add / remove a friend) —
  // once set, they take priority over the externally-synced value above for the rest of this
  // page's lifetime, since the write to localStorage already happened by the time these are set.
  const [myCodeDeleted, setMyCodeDeleted] = useState(false);
  const [friendListOverride, setFriendListOverride] = useState<FriendEntry[] | null>(null);
  const myCode = myCodeDeleted ? null : storedMyCode;
  const friends = friendListOverride ?? storedFriends;

  const [isDeletingMine, setIsDeletingMine] = useState(false);
  const [deleteMineError, setDeleteMineError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [friendViews, setFriendViews] = useState<Record<string, FriendView>>({});
  const [newNickname, setNewNickname] = useState("");
  const [newCode, setNewCode] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function loadFriend(code: string): Promise<void> {
    try {
      const response = await fetch(`/api/friend-timetable/${code}`);
      const payload: unknown = await response.json();
      if (!response.ok) {
        setFriendViews((current) => ({
          ...current,
          [code]: { status: "error", error: readApiError(payload) },
        }));
        return;
      }
      const view = readFriendTimetableResponse(payload);
      if (!view) {
        setFriendViews((current) => ({
          ...current,
          [code]: { status: "error", error: "응답 형식이 올바르지 않습니다." },
        }));
        return;
      }
      setFriendViews((current) => ({
        ...current,
        [code]: { status: "ready", ownerLabel: view.ownerLabel, timetable: view.timetable },
      }));
    } catch {
      setFriendViews((current) => ({
        ...current,
        [code]: { status: "error", error: "불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      }));
    }
  }

  useEffect(() => {
    // Only *starts* fetches here (no synchronous setState) — each entry's status stays "not yet
    // in friendViews" (rendered as loading, see below) until loadFriend's fetch actually resolves.
    friends.forEach((friend) => {
      if (!(friend.code in friendViews)) {
        void loadFriend(friend.code);
      }
    });
    // Intentionally re-runs whenever the friend list changes; already-loaded/loading entries are
    // skipped via the friendViews membership check above rather than being listed as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends]);

  async function handleAddFriend(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const code = newCode.trim().toUpperCase();
    const nickname = newNickname.trim();
    if (!code) {
      setAddError("코드를 입력해 주세요.");
      return;
    }
    if (friends.some((friend) => friend.code === code)) {
      setAddError("이미 추가한 코드입니다.");
      return;
    }
    setIsAdding(true);
    setAddError("");
    try {
      const response = await fetch(`/api/friend-timetable/${code}`);
      const payload: unknown = await response.json();
      if (!response.ok) {
        setAddError(readApiError(payload));
        return;
      }
      const view = readFriendTimetableResponse(payload);
      if (!view) {
        setAddError("응답 형식이 올바르지 않습니다.");
        return;
      }
      const entry: FriendEntry = { code, nickname: nickname || view.ownerLabel };
      setFriendListOverride(addFriend(window.localStorage, entry));
      setFriendViews((current) => ({
        ...current,
        [code]: { status: "ready", ownerLabel: view.ownerLabel, timetable: view.timetable },
      }));
      setNewNickname("");
      setNewCode("");
    } catch {
      setAddError("코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsAdding(false);
    }
  }

  function handleRemoveFriend(code: string): void {
    setFriendListOverride(removeFriend(window.localStorage, code));
    setFriendViews((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
  }

  async function handleCopyMyCode(): Promise<void> {
    if (!myCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(myCode);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      setCopyFeedback(false);
    }
  }

  async function handleDeleteMine(): Promise<void> {
    const editToken = getMyEditToken(window.localStorage);
    if (!myCode || !editToken) {
      return;
    }
    setIsDeletingMine(true);
    setDeleteMineError("");
    try {
      const response = await fetch(`/api/friend-timetable/${myCode}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editToken }),
      });
      if (!response.ok && response.status !== 404) {
        const payload: unknown = await response.json();
        setDeleteMineError(readApiError(payload));
        return;
      }
      clearMySave(window.localStorage);
      setMyCodeDeleted(true);
    } catch {
      setDeleteMineError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsDeletingMine(false);
    }
  }

  return (
    <main className={pageStyles.page}>
      <section className={pageStyles.hero}>
        <p className={pageStyles.eyebrow}>SKKU TIMETABLE</p>
        <h1>친구 시간표</h1>
        <p>로그인 없이 코드로 서로의 최신 시간표를 확인합니다.</p>
      </section>

      <section className={styles.myCodeSection}>
        <h2>내 코드</h2>
        {myCode ? (
          <div className={styles.myCodeCard}>
            <div>
              <span className={styles.myCodeValue}>{myCode}</span>
              {storedMyLabel ? <small>{storedMyLabel}</small> : null}
            </div>
            <div className={styles.myCodeActions}>
              <button type="button" onClick={() => void handleCopyMyCode()}>
                {copyFeedback ? "복사됨" : "코드 복사"}
              </button>
              <button
                className={styles.dangerButton}
                disabled={isDeletingMine}
                type="button"
                onClick={() => void handleDeleteMine()}
              >
                {isDeletingMine ? "삭제 중…" : "저장 삭제"}
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.emptyHint}>
            아직 저장한 시간표가 없어요. 시간표 카드의 &ldquo;친구에게 서버로 공유&rdquo; 버튼을 먼저
            눌러 주세요. <Link href="/">메인으로 가기</Link>
          </p>
        )}
        {deleteMineError ? <p className={styles.error}>{deleteMineError}</p> : null}
      </section>

      <section className={styles.addFriendSection}>
        <h2>친구 시간표 추가</h2>
        <form className={styles.addFriendForm} onSubmit={(event) => void handleAddFriend(event)}>
          <label>
            <span>닉네임(선택)</span>
            <input
              maxLength={24}
              placeholder="예: 재성"
              value={newNickname}
              onChange={(event) => setNewNickname(event.target.value)}
            />
          </label>
          <label>
            <span>코드</span>
            <input
              maxLength={8}
              placeholder="8자리 코드"
              value={newCode}
              onChange={(event) => setNewCode(event.target.value)}
            />
          </label>
          <button disabled={isAdding} type="submit">
            {isAdding ? "확인 중…" : "추가"}
          </button>
        </form>
        {addError ? <p className={styles.error}>{addError}</p> : null}
      </section>

      <section className={styles.friendListSection}>
        <h2>친구 목록 {friends.length > 0 ? `(${friends.length})` : ""}</h2>
        {friends.length === 0 ? (
          <p className={styles.emptyHint}>아직 추가한 친구가 없어요.</p>
        ) : (
          <ol className={`${timetableStyles.timetableList} ${styles.friendList}`}>
            {friends.map((friend) => {
              const view = friendViews[friend.code];
              return (
                <li className={styles.friendItem} key={friend.code}>
                  <div className={styles.friendItemHeading}>
                    <strong>{friend.nickname || view?.ownerLabel || friend.code}</strong>
                    <button type="button" onClick={() => handleRemoveFriend(friend.code)}>
                      목록에서 제거
                    </button>
                  </div>
                  {!view || view.status === "loading" ? (
                    <p className={styles.emptyHint}>불러오는 중…</p>
                  ) : view.status === "error" ? (
                    <p className={styles.error}>{view.error}</p>
                  ) : view.timetable ? (
                    <TimetableCard
                      extras={[]}
                      heading={friend.nickname || view.ownerLabel || "친구의 시간표"}
                      index={0}
                      timetable={view.timetable}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <footer className={pageStyles.footer}>
        <Link href="/">{SITE_NAME}으로 돌아가기</Link>
      </footer>
    </main>
  );
}

function readApiError(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error?: unknown }).error !== null
  ) {
    const message = (payload as { error: { message?: unknown } }).error.message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return "요청을 처리하지 못했습니다.";
}

function readFriendTimetableResponse(
  payload: unknown,
): { ownerLabel: string; timetable: Timetable } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as { ownerLabel?: unknown; timetable?: unknown };
  if (typeof record.ownerLabel !== "string" || typeof record.timetable !== "object" || record.timetable === null) {
    return null;
  }
  const timetable = record.timetable as { courses?: unknown };
  if (!Array.isArray(timetable.courses)) {
    return null;
  }
  return {
    ownerLabel: record.ownerLabel,
    timetable: { courses: timetable.courses as Timetable["courses"], meetings: [], fixedEvents: [] },
  };
}
