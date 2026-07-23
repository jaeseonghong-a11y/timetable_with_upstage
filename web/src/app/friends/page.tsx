"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MergedTimetableView } from "@/components/MergedTimetableView";
import { PageReturnLink } from "@/components/PageReturnLink";
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
import type { MergedTimetableSource } from "@/lib/merged-timetable";
import type { Timetable } from "@/lib/timetable";
import { useLocalStorageItem } from "@/lib/use-local-storage-item";

import pageStyles from "../page.module.css";
import styles from "./page.module.css";

interface FriendView {
  status: "loading" | "error" | "ready";
  ownerLabel?: string;
  timetable?: Timetable;
  requiredCourseIds?: string[] | null;
  error?: string;
}

/** Reserved id for "내 시간표" in the merge-selection set — friend codes never collide with this
 * since they're always exactly 8 characters from a fixed alphabet (see friend-timetable-blob.ts). */
const ME_SOURCE_ID = "me";

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
  const [myView, setMyView] = useState<FriendView | undefined>(undefined);

  const [friendViews, setFriendViews] = useState<Record<string, FriendView>>({});
  const [selectedFriendCode, setSelectedFriendCode] = useState<string | null>(null);
  const [newNickname, setNewNickname] = useState("");
  const [newCode, setNewCode] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  function toggleSelected(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  const mergedSources = useMemo<MergedTimetableSource[]>(() => {
    const sources: MergedTimetableSource[] = [];
    if (selectedIds.has(ME_SOURCE_ID) && myView?.status === "ready" && myView.timetable) {
      sources.push({
        id: ME_SOURCE_ID,
        label: storedMyLabel || "나",
        timetable: myView.timetable,
      });
    }
    for (const friend of friends) {
      const view = friendViews[friend.code];
      if (selectedIds.has(friend.code) && view?.status === "ready" && view.timetable) {
        sources.push({
          id: friend.code,
          label: friend.nickname || view.ownerLabel || friend.code,
          timetable: view.timetable,
        });
      }
    }
    return sources;
  }, [friendViews, friends, myView, selectedIds, storedMyLabel]);

  async function fetchTimetableView(code: string): Promise<FriendView> {
    try {
      const response = await fetch(`/api/friend-timetable/${code}`);
      const payload: unknown = await response.json();
      if (!response.ok) {
        return { status: "error", error: readApiError(payload) };
      }
      const view = readFriendTimetableResponse(payload);
      if (!view) {
        return { status: "error", error: "응답 형식이 올바르지 않습니다." };
      }
      return {
        status: "ready",
        ownerLabel: view.ownerLabel,
        timetable: view.timetable,
        requiredCourseIds: view.requiredCourseIds,
      };
    } catch {
      return { status: "error", error: "불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }

  async function loadFriend(code: string): Promise<void> {
    const view = await fetchTimetableView(code);
    setFriendViews((current) => ({ ...current, [code]: view }));
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

  useEffect(() => {
    // Same "start fetch, only setState after it resolves" shape as the friends effect above —
    // myView stays undefined (rendered as loading) until fetchTimetableView's promise settles.
    if (myCode && myView === undefined) {
      void fetchTimetableView(myCode).then(setMyView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCode]);

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
      setSelectedFriendCode(code);
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
    setSelectedFriendCode((current) => (current === code ? null : current));
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
      setMyView(undefined);
    } catch {
      setDeleteMineError("삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsDeletingMine(false);
    }
  }

  const canStartRemix = Boolean(
    myView?.status === "ready" &&
      myView.timetable &&
      friends.some(
        (friend) =>
          friendViews[friend.code]?.status === "ready" && friendViews[friend.code]?.timetable,
      ),
  );
  const selectedFriend = selectedFriendCode
    ? friends.find((friend) => friend.code === selectedFriendCode) ?? friends[0] ?? null
    : friends[0] ?? null;
  const selectedFriendView = selectedFriend ? friendViews[selectedFriend.code] : undefined;

  return (
    <main className={pageStyles.page}>
      <PageReturnLink href="/" label="시간표 만들기로 돌아가기" />
      <section className={pageStyles.hero}>
        <p className={pageStyles.eyebrow}>SKKU-DULE</p>
        <h1>내 시간표·친구 시간표</h1>
        <p>로그인 없이 코드로 서로의 최신 시간표를 확인합니다.</p>
      </section>

      <section className={styles.timetableWorkspace}>
        <section className={styles.myCodeSection}>
          <div className={styles.sectionHeading}>
            <h2>내 시간표</h2>
            <span>내 코드</span>
          </div>
          {myCode ? (
            <>
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
              {!myView || myView.status === "loading" ? (
                <p className={styles.emptyHint}>불러오는 중…</p>
              ) : myView.status === "error" ? (
                <p className={styles.error}>{myView.error}</p>
              ) : myView.timetable ? (
                <>
                  <label className={styles.mergeCheckbox}>
                    <input
                      checked={selectedIds.has(ME_SOURCE_ID)}
                      type="checkbox"
                      onChange={() => toggleSelected(ME_SOURCE_ID)}
                    />
                    <span>겹쳐보기에 포함</span>
                  </label>
                  <ol className={`${timetableStyles.timetableList} ${styles.myTimetableList}`}>
                    <TimetableCard
                      extras={[]}
                      heading={storedMyLabel || "내 시간표"}
                      index={0}
                      requiredCourseIds={
                        myView.requiredCourseIds === null
                          ? undefined
                          : new Set(myView.requiredCourseIds ?? [])
                      }
                      timetable={myView.timetable}
                    />
                  </ol>
                </>
              ) : null}
            </>
          ) : (
            <p className={styles.emptyHint}>
              아직 저장한 시간표가 없어요. 시간표 카드의 &ldquo;코드로 공유&rdquo; 버튼을 먼저 눌러
              주세요. <Link href="/">메인으로 가기</Link>
            </p>
          )}
          {deleteMineError ? <p className={styles.error}>{deleteMineError}</p> : null}
        </section>

        <aside className={styles.friendSidebar}>
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
              <ol className={styles.friendList}>
                {friends.map((friend) => {
                  const view = friendViews[friend.code];
                  const isSelected = selectedFriend?.code === friend.code;
                  return (
                    <li className={styles.friendItem} key={friend.code}>
                      <button
                        aria-pressed={isSelected}
                        className={styles.friendSelectButton}
                        type="button"
                        onClick={() => setSelectedFriendCode(friend.code)}
                      >
                        <strong>{friend.nickname || view?.ownerLabel || friend.code}</strong>
                        <small>
                          {!view || view.status === "loading"
                            ? "불러오는 중…"
                            : view.status === "error"
                              ? "불러오지 못함"
                              : "시간표 보기"}
                        </small>
                      </button>
                      <button
                        aria-label={`${friend.nickname || friend.code} 목록에서 제거`}
                        className={styles.removeFriendButton}
                        type="button"
                        onClick={() => handleRemoveFriend(friend.code)}
                      >
                        삭제
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {selectedFriend ? (
            <section className={styles.selectedFriendSection}>
              <h2>{selectedFriend.nickname || selectedFriendView?.ownerLabel || "친구"}의 시간표</h2>
              {!selectedFriendView || selectedFriendView.status === "loading" ? (
                <p className={styles.emptyHint}>불러오는 중…</p>
              ) : selectedFriendView.status === "error" ? (
                <p className={styles.error}>{selectedFriendView.error}</p>
              ) : selectedFriendView.timetable ? (
                <>
                  <label className={styles.mergeCheckbox}>
                    <input
                      checked={selectedIds.has(selectedFriend.code)}
                      type="checkbox"
                      onChange={() => toggleSelected(selectedFriend.code)}
                    />
                    <span>겹쳐보기에 포함</span>
                  </label>
                  <TimetableCard
                    compact
                    extras={[]}
                    heading={selectedFriend.nickname || selectedFriendView.ownerLabel || "친구의 시간표"}
                    index={0}
                    timetable={selectedFriendView.timetable}
                  />
                </>
              ) : null}
            </section>
          ) : null}

          <section className={styles.remixSection}>
            <h2>시간표 리믹스</h2>
            <p className={styles.emptyHint}>
              {canStartRemix
                ? "내 시간표와 선택한 친구 시간표를 섞어 새 조합을 만들어 보세요."
                : "내 시간표와 친구 시간표를 각각 하나 이상 불러오면 리믹스할 수 있어요."}
            </p>
            <Link className={styles.remixButton} href="/friends/remix">
              리믹스 하러가기
            </Link>
          </section>
        </aside>
      </section>

      {mergedSources.length > 0 ? (
        <section className={styles.mergedSection}>
          <h2>겹쳐보기 ({mergedSources.length}명)</h2>
          <p className={styles.mergeHint}>
            색칠된 시간은 선택한 사람 중 누군가 수업이 있는 시간이에요. 흰 칸이 다같이 비는
            시간이에요. 같은 과목을 함께 듣는 경우엔 과목명이 그대로 표시돼요.
          </p>
          <MergedTimetableView sources={mergedSources} />
        </section>
      ) : null}

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
): { ownerLabel: string; timetable: Timetable; requiredCourseIds: string[] | null } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as { ownerLabel?: unknown; timetable?: unknown; requiredCourseIds?: unknown };
  if (typeof record.ownerLabel !== "string" || typeof record.timetable !== "object" || record.timetable === null) {
    return null;
  }
  const timetable = record.timetable as { courses?: unknown };
  if (!Array.isArray(timetable.courses)) {
    return null;
  }
  if (
    record.requiredCourseIds !== undefined &&
    record.requiredCourseIds !== null &&
    (!Array.isArray(record.requiredCourseIds) ||
      record.requiredCourseIds.some((courseId) => typeof courseId !== "string"))
  ) {
    return null;
  }
  const requiredCourseIds = Array.isArray(record.requiredCourseIds)
    ? record.requiredCourseIds.filter((courseId): courseId is string => typeof courseId === "string")
    : null;
  return {
    ownerLabel: record.ownerLabel,
    timetable: { courses: timetable.courses as Timetable["courses"], meetings: [], fixedEvents: [] },
    requiredCourseIds,
  };
}
