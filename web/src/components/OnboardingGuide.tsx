"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { track } from "@/lib/analytics";
import { dismissOnboardingForToday, isOnboardingDismissedForToday } from "@/lib/onboarding-dismissal";

import styles from "./OnboardingGuide.module.css";

interface OnboardingStep {
  title: string;
  body: string;
  diagram: ReactNode;
}

const STEPS: readonly OnboardingStep[] = [
  {
    title: "1. 기본 정보 입력",
    body: "학과·학년·학기를 입력하면 그 조건에 맞는 개설강좌를 불러와요.",
    diagram: (
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <rect x="16" y="14" width="128" height="72" rx="10" className={styles.diagramCard} />
        <rect x="32" y="32" width="56" height="8" rx="4" className={styles.diagramBarStrong} />
        <rect x="32" y="48" width="96" height="8" rx="4" className={styles.diagramBar} />
        <rect x="32" y="64" width="72" height="8" rx="4" className={styles.diagramBar} />
      </svg>
    ),
  },
  {
    title: "2. 내 기록 적용하기 (선택)",
    body: "수강내역·졸업요건 문서를 올리면 Upstage AI가 자동으로 읽어서, 이미 들은 과목은 빼고 남은 졸업요건만 정리해줘요.",
    diagram: (
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <rect x="14" y="18" width="46" height="60" rx="6" className={styles.diagramCard} />
        <rect x="22" y="30" width="30" height="6" rx="3" className={styles.diagramBar} />
        <rect x="22" y="42" width="30" height="6" rx="3" className={styles.diagramBar} />
        <rect x="22" y="54" width="20" height="6" rx="3" className={styles.diagramBar} />
        <path
          d="M66 48h26"
          className={styles.diagramArrow}
          markerEnd="url(#onboarding-arrowhead)"
        />
        <circle cx="122" cy="48" r="28" className={styles.diagramAccentSoft} />
        <path
          d="M110 48l8 8 16-16"
          className={styles.diagramCheck}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <defs>
          <marker
            id="onboarding-arrowhead"
            markerWidth="8"
            markerHeight="8"
            refX="4"
            refY="4"
            orient="auto"
          >
            <path d="M0 0l8 4-8 4z" className={styles.diagramArrowHead} />
          </marker>
        </defs>
      </svg>
    ),
  },
  {
    title: "3. 과목 담기",
    body: "필수·선택 과목을 담으면 시간이 겹치지 않는 유효한 시간표 조합을 바로 확인할 수 있어요.",
    diagram: (
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <rect x="10" y="12" width="140" height="76" rx="8" className={styles.diagramCard} />
        {[0, 1, 2, 3, 4].map((col) => (
          <line
            key={col}
            x1={10 + ((col + 1) * 140) / 5}
            y1={12}
            x2={10 + ((col + 1) * 140) / 5}
            y2={88}
            className={styles.diagramGridLine}
          />
        ))}
        <rect x="16" y="22" width="22" height="20" rx="3" className={styles.diagramBlock1} />
        <rect x="72" y="34" width="22" height="28" rx="3" className={styles.diagramBlock2} />
        <rect x="100" y="20" width="22" height="16" rx="3" className={styles.diagramBlock3} />
        <rect x="44" y="56" width="22" height="22" rx="3" className={styles.diagramBlock1} />
        <rect x="128" y="50" width="16" height="30" rx="3" className={styles.diagramBlock2} />
      </svg>
    ),
  },
  {
    title: "4. AI 시간표 추천",
    body: "공강·연강·오전 수업 같은 원하는 조건을 고르면, AI가 상위 시간표와 추천 이유를 알려줘요.",
    diagram: (
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <path
          d="M40 14l4.5 10.5L55 29l-10.5 4.5L40 44l-4.5-10.5L25 29l10.5-4.5z"
          className={styles.diagramSparkle}
        />
        <rect x="14" y="52" width="132" height="16" rx="8" className={styles.diagramRankCardActive} />
        <rect x="14" y="72" width="132" height="16" rx="8" className={styles.diagramRankCard} />
        <circle cx="26" cy="60" r="6" className={styles.diagramRankBadgeActive} />
        <circle cx="26" cy="80" r="6" className={styles.diagramRankBadge} />
      </svg>
    ),
  },
];

export function OnboardingGuide() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowToday, setDontShowToday] = useState(false);

  // The <dialog> stays in the DOM unconditionally (closed = invisible either way, so this is
  // SSR-safe with no hydration mismatch) — only the imperative .showModal() call, a genuine
  // synchronization with the browser's own dialog API, is gated on the localStorage check.
  useEffect(() => {
    if (!isOnboardingDismissedForToday(window.localStorage, new Date())) {
      dialogRef.current?.showModal();
      track("onboarding_shown");
    }
  }, []);

  function handleDialogClose(): void {
    if (dontShowToday) {
      dismissOnboardingForToday(window.localStorage, new Date());
    }
    track("onboarding_dismissed", {
      last_step: stepIndex + 1,
      dont_show_today: dontShowToday ? "true" : "false",
    });
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>): void {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  }

  const step = STEPS[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="onboarding-title"
      className={styles.dialog}
      onClick={handleBackdropClick}
      onClose={handleDialogClose}
    >
      <div className={styles.panel}>
        <button
          aria-label="가이드 닫기"
          className={styles.closeButton}
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          ✕
        </button>

        <p className={styles.eyebrow}>
          시작 가이드 · {stepIndex + 1}/{STEPS.length}
        </p>
        <div className={styles.diagram}>{step.diagram}</div>
        <h2 className={styles.title} id="onboarding-title">
          {step.title}
        </h2>
        <p className={styles.body}>{step.body}</p>

        <div className={styles.dots} aria-hidden="true">
          {STEPS.map((dotStep, index) => (
            <span
              className={styles.dot}
              data-active={index === stepIndex}
              key={dotStep.title}
            />
          ))}
        </div>

        <div className={styles.nav}>
          <button
            className={styles.secondaryButton}
            disabled={isFirst}
            type="button"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            이전
          </button>
          {isLast ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              시작하기
            </button>
          ) : (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => setStepIndex((current) => Math.min(STEPS.length - 1, current + 1))}
            >
              다음
            </button>
          )}
        </div>

        <label className={styles.dontShowToday}>
          <input
            checked={dontShowToday}
            type="checkbox"
            onChange={(event) => setDontShowToday(event.target.checked)}
          />
          <span>오늘 하루 안 보기</span>
        </label>
      </div>
    </dialog>
  );
}
