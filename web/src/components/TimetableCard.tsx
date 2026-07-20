"use client";

import { toPng } from "html-to-image";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { track } from "@/lib/analytics";
import {
  getMyEditToken,
  getMyShareCode,
  MY_LABEL_KEY,
  setMySave,
} from "@/lib/friend-list-storage";
import { SITE_URL } from "@/lib/site-config";
import { mergeMeetingsForDisplay, parseSchedule, type Timetable, type Weekday } from "@/lib/timetable";
import { encodeShareableTimetable } from "@/lib/timetable-share";
import { useLocalStorageItem } from "@/lib/use-local-storage-item";

import styles from "./TimetablePlanner.module.css";

export const DAYS: ReadonlyArray<{ id: Weekday; label: string }> = [
  { id: "mon", label: "월" },
  { id: "tue", label: "화" },
  { id: "wed", label: "수" },
  { id: "thu", label: "목" },
  { id: "fri", label: "금" },
];

// Exported so other weekly-grid views (e.g. MergedTimetableView) share the exact same coordinate
// system instead of redefining these magic numbers and risking drift.
export const TIMETABLE_START_MINUTES = 8 * 60;
export const TIMETABLE_END_MINUTES = 22 * 60;
export const PIXELS_PER_MINUTE = 0.8;

export interface TimetableExtra {
  groupTitle: string;
  title: string;
  classification: string;
}

export function TimetableCard({
  extras,
  footer,
  heading,
  index,
  timetable,
}: {
  extras: readonly TimetableExtra[];
  footer?: ReactNode;
  heading?: string;
  index: number;
  timetable: Timetable;
}) {
  const scheduledCourses = timetable.courses.flatMap((course, courseIndex) =>
    mergeMeetingsForDisplay(parseSchedule(course.schedule)).map((meeting) => ({
      course,
      courseIndex,
      meeting,
    })),
  );
  const unscheduledCourses = timetable.courses.filter(
    (course) => parseSchedule(course.schedule).length === 0,
  );
  const totalCredits = timetable.courses.reduce(
    (credits, course) => credits + (course.credits ?? 0),
    0,
  );
  const versionLabel = describeTimetableVersion(extras);
  const gridRef = useRef<HTMLDivElement>(null);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [saveImageError, setSaveImageError] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [isServerPanelOpen, setIsServerPanelOpen] = useState(false);
  // Seeded from this browser's last-used label (SSR-safe, see use-local-storage-item.ts), but
  // once the user types anything the draft takes over permanently — external syncing must never
  // clobber input the user is actively editing.
  const storedLabel = useLocalStorageItem(MY_LABEL_KEY) ?? "";
  const [ownerLabelDraft, setOwnerLabelDraft] = useState<string | null>(null);
  const ownerLabelInput = ownerLabelDraft ?? storedLabel;
  const [isSavingToServer, setIsSavingToServer] = useState(false);
  const [serverSaveError, setServerSaveError] = useState("");
  const [savedServerCode, setSavedServerCode] = useState<string | null>(null);
  const [serverCodeCopied, setServerCodeCopied] = useState(false);

  async function handleSaveImage(): Promise<void> {
    if (!gridRef.current || isSavingImage) {
      return;
    }
    setIsSavingImage(true);
    setSaveImageError("");
    try {
      const dataUrl = await toPng(gridRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${sanitizeFileName(heading ?? `시간표-조합${index + 1}`)}.png`;
      link.click();
      track("timetable_save");
    } catch {
      setSaveImageError("이미지 저장에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setIsSavingImage(false);
    }
  }

  function handleToggleShare(): void {
    if (!shareUrl) {
      const encoded = encodeShareableTimetable(timetable);
      setShareUrl(`${SITE_URL}/share/${encoded}`);
      track("share_link_created");
    }
    setIsShareOpen((open) => !open);
    setShareCopied(false);
  }

  async function handleCopyShareLink(): Promise<void> {
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
    } catch {
      setShareCopied(false);
    }
  }

  function handleToggleServerPanel(): void {
    setIsServerPanelOpen((open) => !open);
    setServerSaveError("");
  }

  /**
   * Saves this timetable to the server under a short code a friend can look up later — unlike
   * "1회용 링크로 공유"(URL 링크), this is a live pointer: whoever holds the code always sees the
   * latest save, not a frozen snapshot. If this browser already has a code from a previous save
   * (localStorage), it updates that same entry using its editToken instead of creating a new one.
   */
  async function handleSaveToServer(): Promise<void> {
    if (isSavingToServer) {
      return;
    }
    setIsSavingToServer(true);
    setServerSaveError("");
    try {
      const existingCode = getMyShareCode(window.localStorage) ?? undefined;
      const existingEditToken = getMyEditToken(window.localStorage) ?? undefined;
      const label = ownerLabelInput.trim() || "이름 없음";
      const response = await fetch("/api/friend-timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: existingCode,
          editToken: existingEditToken,
          ownerLabel: label,
          courses: timetable.courses,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(readServerSaveApiError(payload));
      }
      const result = readServerSaveResponse(payload);
      if (!result) {
        throw new Error("응답 형식이 올바르지 않습니다.");
      }
      setMySave(window.localStorage, {
        code: result.code,
        editToken: result.editToken ?? existingEditToken ?? "",
        label,
      });
      setSavedServerCode(result.code);
      setServerCodeCopied(false);
      track("friend_timetable_saved");
    } catch (error) {
      setServerSaveError(
        error instanceof Error ? error.message : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsSavingToServer(false);
    }
  }

  async function handleCopyServerCode(): Promise<void> {
    if (!savedServerCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(savedServerCode);
      setServerCodeCopied(true);
    } catch {
      setServerCodeCopied(false);
    }
  }

  return (
    <li className={styles.timetableCard}>
      <details open={index === 0}>
        <summary>
          <span>
            {heading ?? `조합 ${index + 1}`}
            {versionLabel ? <small className={styles.timetableVersion}>{versionLabel}</small> : null}
          </span>
          <small>
            {timetable.courses.length}과목 · {formatCredits(totalCredits)}학점 · 눌러서 시간표{" "}
            {index === 0 ? "접기" : "보기"}
          </small>
        </summary>
        {extras.length > 0 ? (
          <p className={styles.timetableExtras}>
            추가 과목:{" "}
            {extras
              .map((extra) => `${extra.groupTitle} · ${extra.title}(${extra.classification})`)
              .join(", ")}
          </p>
        ) : null}
        <div className={styles.weeklyViewport}>
          <div className={styles.weeklyTimetable} ref={gridRef}>
            <div className={styles.weekHeader}>
              <span aria-hidden="true" />
              {DAYS.map((day) => <strong key={day.id}>{day.label}</strong>)}
            </div>
            <div
              className={styles.weekBody}
              style={{
                height: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
              }}
            >
              {Array.from(
                { length: (TIMETABLE_END_MINUTES - TIMETABLE_START_MINUTES) / 60 + 1 },
                (_, hourIndex) => {
                  const minutes = TIMETABLE_START_MINUTES + hourIndex * 60;
                  const top = (minutes - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE;
                  return (
                    <div className={styles.hourLine} key={minutes} style={{ top }}>
                      <span>{formatMinutes(minutes)}</span>
                    </div>
                  );
                },
              )}
              <div className={styles.dayColumns}>
                {DAYS.map((day) => (
                  <div className={styles.dayColumn} key={day.id}>
                    {scheduledCourses
                      .filter(({ meeting }) => meeting.day === day.id)
                      .map(({ course, courseIndex, meeting }) => {
                        const visibleStart = Math.max(meeting.startMinutes, TIMETABLE_START_MINUTES);
                        const visibleEnd = Math.min(meeting.endMinutes, TIMETABLE_END_MINUTES);
                        if (visibleStart >= visibleEnd) {
                          return null;
                        }
                        return (
                          <div
                            className={styles.courseBlock}
                            data-color={courseIndex % 6}
                            key={`${course.id}-${meeting.startMinutes}`}
                            style={{
                              top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                              height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                            }}
                            title={[
                              course.title,
                              course.professor,
                              `${formatMinutes(meeting.startMinutes)}-${formatMinutes(meeting.endMinutes)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            <strong>{course.title}</strong>
                            {course.professor ? <small>{course.professor}</small> : null}
                            <small>{formatMinutes(meeting.startMinutes)}-{formatMinutes(meeting.endMinutes)}</small>
                          </div>
                        );
                      })}
                    {timetable.fixedEvents
                      .filter((event) => event.day === day.id)
                      .map((event) => {
                        const visibleStart = Math.max(event.startMinutes, TIMETABLE_START_MINUTES);
                        const visibleEnd = Math.min(event.endMinutes, TIMETABLE_END_MINUTES);
                        if (visibleStart >= visibleEnd) {
                          return null;
                        }
                        return (
                          <div
                            className={styles.fixedEventBlock}
                            key={event.id}
                            style={{
                              top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                              height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                            }}
                            title={`${event.label} · ${formatMinutes(event.startMinutes)}-${formatMinutes(event.endMinutes)}`}
                          >
                            <strong>{event.label}</strong>
                            <small>{formatMinutes(event.startMinutes)}-{formatMinutes(event.endMinutes)}</small>
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
            {unscheduledCourses.length > 0 ? (
              <div className={styles.unscheduledRow}>
                {/* 일자 그리드에 배치할 요일·시간이 없는 과목은 전부 I-Campus(자기주도학습형
                    온라인 트랙)라 애초에 시간표가 없다 — "온라인 · 시간 미정"이라고 하면 마치
                    시간이 정해질 수도 있는 것처럼 읽혀 실제와 다르다. */}
                <span className={styles.unscheduledLabel}>I-Campus</span>
                <div className={styles.unscheduledChips}>
                  {unscheduledCourses.map((course, courseIndex) => (
                    <span
                      className={styles.unscheduledChip}
                      data-color={courseIndex % 6}
                      key={course.id}
                    >
                      <strong>{course.title}</strong>
                      {course.professor ? <small>{course.professor}</small> : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className={styles.saveImageRow}>
          <button disabled={isSavingImage} onClick={() => void handleSaveImage()} type="button">
            {isSavingImage ? "저장 중…" : "이미지로 저장"}
          </button>
          <button onClick={handleToggleServerPanel} type="button">
            {isServerPanelOpen ? "코드 공유 닫기" : "코드로 공유(계속 최신 유지)"}
          </button>
          <button onClick={handleToggleShare} type="button">
            {isShareOpen ? "공유 링크 닫기" : "1회용 링크로 공유"}
          </button>
          {saveImageError ? <span className={styles.saveImageError}>{saveImageError}</span> : null}
        </div>
        {isServerPanelOpen ? (
          <div className={styles.sharePanel}>
            <p className={styles.sharePanelHint}>
              코드 하나로 언제든 최신 시간표를 확인할 수 있게 서버에 저장해요. 나중에 시간표를 바꾸고
              다시 저장해도 코드는 그대로라, 친구에게 코드를 다시 보낼 필요가 없어요. 로그인은 필요
              없어요.
            </p>
            <div className={styles.shareLinkRow}>
              <input
                className={styles.shareLinkInput}
                maxLength={24}
                placeholder="표시할 이름(예: 재성)"
                value={ownerLabelInput}
                onChange={(event) => setOwnerLabelDraft(event.target.value)}
              />
              <button disabled={isSavingToServer} onClick={() => void handleSaveToServer()} type="button">
                {isSavingToServer ? "저장 중…" : savedServerCode ? "다시 저장" : "저장"}
              </button>
            </div>
            {serverSaveError ? <p className={styles.saveImageError}>{serverSaveError}</p> : null}
            {savedServerCode ? (
              <div className={styles.shareLinkRow}>
                <input
                  className={styles.shareLinkInput}
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  type="text"
                  value={savedServerCode}
                />
                <button onClick={() => void handleCopyServerCode()} type="button">
                  {serverCodeCopied ? "복사됨" : "복사"}
                </button>
              </div>
            ) : null}
            {savedServerCode ? (
              <p className={styles.sharePanelHint}>
                이 코드를 친구에게 알려주세요. <Link href="/friends">친구 시간표 페이지</Link>에서 내
                저장을 관리하거나 친구 코드를 추가할 수 있어요.
              </p>
            ) : null}
          </div>
        ) : null}
        {isShareOpen && shareUrl ? (
          <div className={styles.sharePanel}>
            <p className={styles.sharePanelHint}>
              로그인 없이 이 링크(또는 QR)를 열면 지금 이 시간표를 그대로 볼 수 있어요. 이후에
              시간표를 바꿔도 이 링크는 갱신되지 않으니, 계속 최신 상태로 공유하려면 위의
              &ldquo;코드로 공유&rdquo;를 쓰세요.
            </p>
            <div className={styles.shareLinkRow}>
              <input
                className={styles.shareLinkInput}
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                type="text"
                value={shareUrl}
              />
              <button onClick={() => void handleCopyShareLink()} type="button">
                {shareCopied ? "복사됨" : "복사"}
              </button>
            </div>
            <div className={styles.shareQr}>
              <QRCodeSVG size={128} value={shareUrl} />
            </div>
          </div>
        ) : null}
        {footer}
      </details>
    </li>
  );
}

function describeTimetableVersion(extras: readonly TimetableExtra[]): string {
  if (extras.length === 0) {
    return "";
  }
  return [...new Set(extras.map((extra) => `${extra.groupTitle}: ${extra.title}`))].join(" · ");
}

export function formatCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : String(Number(credits.toFixed(1)));
}

export function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-").trim() || "timetable";
}

function readServerSaveApiError(payload: unknown): string {
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

function readServerSaveResponse(payload: unknown): { code: string; editToken?: string } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as { code?: unknown; editToken?: unknown };
  if (typeof record.code !== "string" || !record.code) {
    return null;
  }
  return {
    code: record.code,
    editToken: typeof record.editToken === "string" ? record.editToken : undefined,
  };
}
