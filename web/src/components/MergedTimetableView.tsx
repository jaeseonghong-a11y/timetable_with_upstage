"use client";

import { useMemo } from "react";

import {
  computeMergedTimetable,
  type MergedSharedBlock,
  type MergedTimetableSource,
} from "@/lib/merged-timetable";

import {
  DAYS,
  formatMinutes,
  PIXELS_PER_MINUTE,
  TIMETABLE_END_MINUTES,
  TIMETABLE_START_MINUTES,
} from "./TimetableCard";
import styles from "./TimetablePlanner.module.css";

interface LanedBlock {
  block: MergedSharedBlock;
  lane: number;
  laneCount: number;
}

/**
 * Same-time shared blocks are rare but possible (e.g. two different pairs of people each share a
 * different class at the same hour) — assigns each a horizontal lane so they sit side by side
 * instead of drawing directly on top of each other. Lane count is computed per day, not per
 * exact overlap cluster, which is a simplification but keeps the layout stable and easy to reason
 * about for the handful of blocks this view ever has to show at once.
 */
function assignLanes(blocks: readonly MergedSharedBlock[]): LanedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const laneEnds: number[] = [];
  const withLane = sorted.map((block) => {
    let lane = laneEnds.findIndex((end) => end <= block.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinutes);
    } else {
      laneEnds[lane] = block.endMinutes;
    }
    return { block, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return withLane.map(({ block, lane }) => ({ block, lane, laneCount }));
}

export function MergedTimetableView({
  sources,
}: {
  sources: readonly MergedTimetableSource[];
}) {
  const { busyBlocks, sharedBlocks } = useMemo(
    () => computeMergedTimetable(sources),
    [sources],
  );

  return (
    <div className={styles.weeklyViewport}>
      <div className={styles.weeklyTimetable}>
        <div className={styles.weekHeader}>
          <span aria-hidden="true" />
          {DAYS.map((day) => (
            <strong key={day.id}>{day.label}</strong>
          ))}
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
            {DAYS.map((day) => {
              const dayBusy = busyBlocks.filter((block) => block.day === day.id);
              const dayShared = assignLanes(
                sharedBlocks.filter((block) => block.day === day.id),
              );
              return (
                <div className={styles.dayColumn} key={day.id}>
                  {dayBusy.map((block) => {
                    const visibleStart = Math.max(block.startMinutes, TIMETABLE_START_MINUTES);
                    const visibleEnd = Math.min(block.endMinutes, TIMETABLE_END_MINUTES);
                    if (visibleStart >= visibleEnd) {
                      return null;
                    }
                    return (
                      <div
                        className={styles.busyBlock}
                        key={`busy-${block.startMinutes}`}
                        style={{
                          top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                          height: Math.max(20, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                        }}
                        title={`누군가 일정 있음 · ${formatMinutes(block.startMinutes)}-${formatMinutes(block.endMinutes)}`}
                      />
                    );
                  })}
                  {dayShared.map(({ block, lane, laneCount }, index) => {
                    const visibleStart = Math.max(block.startMinutes, TIMETABLE_START_MINUTES);
                    const visibleEnd = Math.min(block.endMinutes, TIMETABLE_END_MINUTES);
                    if (visibleStart >= visibleEnd) {
                      return null;
                    }
                    return (
                      <div
                        className={styles.courseBlock}
                        data-color={index % 6}
                        key={`shared-${block.title}-${block.startMinutes}`}
                        style={{
                          top: (visibleStart - TIMETABLE_START_MINUTES) * PIXELS_PER_MINUTE,
                          height: Math.max(28, (visibleEnd - visibleStart) * PIXELS_PER_MINUTE),
                          left: `${(lane / laneCount) * 100}%`,
                          right: "auto",
                          width: `calc(${(1 / laneCount) * 100}% - 3px)`,
                        }}
                        title={[
                          block.title,
                          block.sourceLabels.join(", "),
                          `${formatMinutes(block.startMinutes)}-${formatMinutes(block.endMinutes)}`,
                        ].join(" · ")}
                      >
                        <strong>{block.title}</strong>
                        <small>{block.sourceLabels.join(", ")}</small>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
