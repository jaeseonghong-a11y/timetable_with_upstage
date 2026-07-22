"use client";

import { useMemo, useState } from "react";

import {
  buildEverytimeReviewSearchUrl,
  describeEverytimeReviewResponse,
  isEverytimeConnectorAvailable,
  requestEverytimeReview,
  toEverytimeReviewCourse,
} from "@/lib/everytime-review-bridge";
import type { CourseCandidate } from "@/lib/timetable";

import styles from "./EverytimeReviewButton.module.css";

export function EverytimeReviewButton({
  course,
  compact = false,
  label,
}: {
  course: CourseCandidate;
  compact?: boolean;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  const reviewCourse = useMemo(() => toEverytimeReviewCourse(course), [course]);

  function handleClick(): void {
    if (!isEverytimeConnectorAvailable()) {
      window.open(buildEverytimeReviewSearchUrl(reviewCourse), "_blank", "noopener,noreferrer");
      setStatus("에타 검색 결과를 열었어요.");
      return;
    }
    setStatus("에타 강의평을 연결하는 중…");
    requestEverytimeReview(reviewCourse, (response) => {
      setStatus(describeEverytimeReviewResponse(response));
    });
  }

  return (
    <span className={styles.wrapper}>
      <button
        className={compact ? styles.compactButton : styles.button}
        onClick={handleClick}
        type="button"
      >
        {label ?? (compact ? "강의평" : "에타 강의평 보기")}
      </button>
      {status ? <span className={styles.status} role="status">{status}</span> : null}
    </span>
  );
}
