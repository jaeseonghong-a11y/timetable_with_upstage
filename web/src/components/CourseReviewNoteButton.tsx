"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  getCourseReviewNote,
  setCourseReviewNote,
  subscribeCourseReviewNotes,
} from "@/lib/course-review-notes";
import type { CourseCandidate } from "@/lib/timetable";

import styles from "./CourseReviewNoteButton.module.css";

export function CourseReviewNoteButton({
  course,
  compact = false,
}: {
  course: CourseCandidate;
  compact?: boolean;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const storedNote = useSyncExternalStore(
    subscribeCourseReviewNotes,
    () => getCourseReviewNote(course),
    () => "",
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOpen(): void {
    if (!open) {
      setDraft(storedNote);
    }
    setOpen(!open);
  }

  function saveNote(): void {
    setCourseReviewNote(course, draft);
    setOpen(false);
  }

  const hasNote = storedNote.trim().length > 0;
  const courseLabel = course.courseName?.trim() || course.title;
  const professorLabel = course.professor?.trim() || "교수 미정";

  return (
    <span className={styles.wrapper} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={`${compact ? styles.compactButton : styles.button}${hasNote ? ` ${styles.hasNote}` : ""}`}
        type="button"
        onClick={toggleOpen}
      >
        {hasNote ? "메모됨" : "메모"}
      </button>
      {open ? (
        <div className={styles.panel} id={panelId} role="dialog" aria-label="강평 메모장">
          <p className={styles.panelHeading}>
            <strong>{courseLabel}</strong>
            <span>{professorLabel}</span>
          </p>
          <small className={styles.panelHint}>같은 과목·교수면 분반이 달라도 이 메모가 함께 보여요.</small>
          <textarea
            autoFocus
            maxLength={2000}
            placeholder="강의평 메모를 적어 두세요"
            rows={4}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.panelActions}>
            <button type="button" onClick={() => setOpen(false)}>
              닫기
            </button>
            <button data-primary="true" type="button" onClick={saveNote}>
              저장
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
