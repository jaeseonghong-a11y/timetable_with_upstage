"use client";

import { useMemo, useState } from "react";

import {
  buildEverytimeReviewSearchUrl,
  isEverytimeConnectorAvailable,
  requestEverytimeReview,
  requestEverytimeReviewBatch,
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
      if (response.status === "direct") {
        setStatus("저장된 강의평을 열었어요.");
      } else if (response.status === "matching") {
        setStatus("과목·교수명으로 강의평을 찾는 중…");
      } else if (response.status === "needs-selection") {
        setStatus("에타 탭에서 맞는 강의를 한 번 선택해 주세요.");
      } else if (response.status === "not-found" || response.status === "failed") {
        setStatus(response.message ?? "자동 연결하지 못했어요. 에타 검색 결과를 확인해 주세요.");
      }
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

export function EverytimeReviewBatchButton({ courses }: { courses: readonly CourseCandidate[] }) {
  const [status, setStatus] = useState("");
  const uniqueCourses = useMemo(() => {
    const seen = new Set<string>();
    return courses
      .map(toEverytimeReviewCourse)
      .filter((course) => {
        const key = `${course.courseNumber}|${course.professor}`.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [courses]);

  function handleClick(): void {
    if (!isEverytimeConnectorAvailable()) {
      setStatus("자동 연결은 보조 확장프로그램 설치 후 사용할 수 있어요.");
      return;
    }
    if (uniqueCourses.length === 0) {
      setStatus("연결할 과목이 없습니다.");
      return;
    }
    setStatus(`${uniqueCourses.length}개 과목의 강의평 연결을 준비하는 중…`);
    requestEverytimeReviewBatch(uniqueCourses, (response) => {
      if (response.status === "complete" || response.status === "failed") {
        setStatus(response.message ?? "강의평 연결이 끝났어요.");
      } else if (response.status === "needs-selection") {
        setStatus("일부 과목은 에타 탭에서 교수명을 확인해 선택해 주세요.");
      }
    });
  }

  return (
    <span className={styles.wrapper}>
      <button className={styles.batchButton} disabled={uniqueCourses.length === 0} onClick={handleClick} type="button">
        담은 {uniqueCourses.length}개 과목 강의평 자동 연결
      </button>
      <span className={styles.batchHint}>확장프로그램이 없으면 각 과목의 에타 검색으로 열립니다.</span>
      {status ? <span className={styles.status} role="status">{status}</span> : null}
    </span>
  );
}
