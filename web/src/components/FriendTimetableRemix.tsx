"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  useConfirmedGraduationRequirementSummaries,
} from "@/lib/graduation-requirements-bridge";
import {
  getFriendList,
  getMyLabel,
  getMyShareCode,
} from "@/lib/friend-list-storage";
import {
  loadFriendRemixSources,
  type FriendRemixSource,
} from "@/lib/friend-remix-data";
import { getFriendRemixCourseOrigins } from "@/lib/friend-remix-course-origin";
import { createFriendRemixSelectionPlan } from "@/lib/friend-remix-plan";
import {
  scoreFriendRemixTimetables,
  type FriendRemixMode,
  type FriendRemixScope,
  type FriendRemixStrength,
  type ScoredFriendRemixTimetable,
} from "@/lib/friend-remix-scoring";
import { SelectionPlanLimitError, generateTimetablesForSelectionPlan } from "@/lib/selection-plan";
import { CombinationLimitError } from "@/lib/timetable";

import { TimetableCard } from "./TimetableCard";
import { PageReturnLink } from "./PageReturnLink";
import styles from "./FriendTimetableRemix.module.css";

interface SourceState {
  status: "loading" | "ready" | "error";
  mine: FriendRemixSource | null;
  friends: FriendRemixSource[];
  errors: string[];
}

const INITIAL_SOURCE_STATE: SourceState = {
  status: "loading",
  mine: null,
  friends: [],
  errors: [],
};

const LEGACY_REQUIRED_COURSE_ERROR = "이 시간표는 필수 과목 정보가 없는 이전 저장본입니다.";

export function FriendTimetableRemix() {
  const [sourceState, setSourceState] = useState<SourceState>(INITIAL_SOURCE_STATE);
  const [selectedFriendCode, setSelectedFriendCode] = useState("");
  const [mode, setMode] = useState<FriendRemixMode>("together");
  const [scope, setScope] = useState<FriendRemixScope>("general_and_major");
  const [strength, setStrength] = useState<FriendRemixStrength>("strong");
  const [results, setResults] = useState<ScoredFriendRemixTimetable[]>([]);
  const [generationError, setGenerationError] = useState("");
  const requirementSummaries = useConfirmedGraduationRequirementSummaries();

  useEffect(() => {
    let isCurrent = true;
    const storage = window.localStorage;
    void loadFriendRemixSources({
      myCode: getMyShareCode(storage),
      myLabel: getMyLabel(storage),
      friends: getFriendList(storage),
    }).then((loaded) => {
      if (!isCurrent) {
        return;
      }
      setSourceState({
        status: loaded.mine && loaded.friends.length > 0 ? "ready" : "error",
        ...loaded,
      });
      setSelectedFriendCode((current) => current || loaded.friends[0]?.code || "");
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedFriend = sourceState.friends.find((friend) => friend.code === selectedFriendCode) ?? null;
  const myRequiredCourses = useMemo(
    () =>
      sourceState.mine?.requiredCourseIds
        ? sourceState.mine.timetable.courses.filter((course) =>
            sourceState.mine?.requiredCourseIds?.includes(course.id),
          )
        : [],
    [sourceState.mine],
  );
  const courseColorsById = useMemo(
    () =>
      sourceState.mine && selectedFriend
        ? getFriendRemixCourseOrigins(myRequiredCourses, selectedFriend.timetable.courses)
        : new Map(),
    [myRequiredCourses, selectedFriend, sourceState.mine],
  );
  const strengthAvailable = requirementSummaries !== null && requirementSummaries.length > 0;
  const unmetRequirementLabels = useMemo(
    () =>
      (requirementSummaries ?? [])
        .filter((requirement) => requirement.status !== "satisfied")
        .map((requirement) => requirement.label)
        .filter(Boolean),
    [requirementSummaries],
  );

  function makeRemix(): void {
    if (!sourceState.mine || !selectedFriend) {
      return;
    }
    if (sourceState.mine.requiredCourseIds === null) {
      setGenerationError(
        LEGACY_REQUIRED_COURSE_ERROR,
      );
      setResults([]);
      return;
    }
    const plan = createFriendRemixSelectionPlan(
      sourceState.mine.timetable,
      selectedFriend.timetable,
      sourceState.mine.requiredCourseIds,
    );
    if (!plan) {
      setGenerationError("섞을 수업이 없습니다. 두 시간표에 수업이 있는지 확인해 주세요.");
      setResults([]);
      return;
    }

    try {
      const candidates = generateTimetablesForSelectionPlan(
        plan,
        { fixedEvents: sourceState.mine.timetable.fixedEvents },
      );
      const scored = scoreFriendRemixTimetables(candidates, {
        friendCourses: selectedFriend.timetable.courses,
        mode,
        scope,
        strength,
        unmetRequirementLabels,
      });
      setResults(scored.slice(0, 5));
      setGenerationError("");
    } catch (error) {
      if (error instanceof SelectionPlanLimitError || error instanceof CombinationLimitError) {
        setGenerationError("섞을 수 있는 경우가 너무 많습니다. 다른 친구 시간표로 다시 시도해 주세요.");
      } else {
        setGenerationError("시간표를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      setResults([]);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.returnLinks}>
        <PageReturnLink href="/friends" label="친구 시간표로 돌아가기" tone="dark" width="compact" />
        <PageReturnLink href="/" label="메인 화면으로 돌아가기" tone="dark" width="compact" />
      </div>
      <section className={styles.hero}>
        <p>FRIEND REMIX LAB</p>
        <h1>친구 시간표 기반 리믹스</h1>
        <span>같이 들을 핑계, 혹은 완벽하게 피할 이유.</span>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p>01 · 대상 선택</p>
            <h2>누구의 시간표를 기준으로 할까요?</h2>
          </div>
        </div>

        {sourceState.status === "loading" ? <p className={styles.status}>시간표를 불러오는 중…</p> : null}
        {sourceState.status === "error" ? (
          <p className={styles.status}>
            내 시간표와 친구 시간표를 각각 하나 이상 불러와야 리믹스할 수 있어요.
          </p>
        ) : null}
        {sourceState.errors.length > 0 ? (
          <p className={styles.error}>{sourceState.errors.join(" ")}</p>
        ) : null}

        {sourceState.status === "ready" ? (
          <label className={styles.friendSelect}>
            <span>대상 친구</span>
            <select value={selectedFriendCode} onChange={(event) => setSelectedFriendCode(event.target.value)}>
              {sourceState.friends.map((friend) => (
                <option key={friend.code} value={friend.code}>{friend.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <p>02 · 리믹스 규칙</p>
            <h2>같이 들을까요, 살짝 피할까요?</h2>
          </div>
        </div>

        <fieldset className={styles.optionGroup}>
          <legend>모드</legend>
          <label>
            <input checked={mode === "together"} name="mode" type="radio" value="together" onChange={() => setMode("together")} />
            비슷하게
          </label>
          <label>
            <input checked={mode === "opposite"} name="mode" type="radio" value="opposite" onChange={() => setMode("opposite")} />
            반대로
          </label>
        </fieldset>

        <fieldset className={styles.optionGroup}>
          <legend>범위</legend>
          <label>
            <input checked={scope === "general_only"} name="scope" type="radio" value="general_only" onChange={() => setScope("general_only")} />
            {mode === "together" ? "교양만 같이 듣기" : "교양만 피하기"}
          </label>
          <label>
            <input checked={scope === "major_only"} name="scope" type="radio" value="major_only" onChange={() => setScope("major_only")} />
            {mode === "together" ? "전공만 같이 듣기" : "전공만 피하기"}
          </label>
          <label>
            <input checked={scope === "general_and_major"} name="scope" type="radio" value="general_and_major" onChange={() => setScope("general_and_major")} />
            {mode === "together" ? "교양+전공 같이 듣기" : "교양+전공 피하기"}
          </label>
        </fieldset>

        <fieldset className={`${styles.optionGroup} ${!strengthAvailable ? styles.disabledGroup : ""}`} disabled={!strengthAvailable}>
          <legend>강도</legend>
          <label>
            <input checked={strength === "strong"} name="strength" type="radio" value="strong" onChange={() => setStrength("strong")} />
            강하게
          </label>
          <label>
            <input checked={strength === "weak"} name="strength" type="radio" value="weak" onChange={() => setStrength("weak")} />
            약하게 · 미충족 요건 영역 우선
          </label>
        </fieldset>
        {!strengthAvailable ? (
          <div className={styles.requirementNotice}>
            <p className={styles.mutedHint}>졸업요건 문서를 등록하면 강도를 조절할 수 있어요.</p>
            <Link className={styles.requirementLink} href="/?step=graduation-requirements">
              졸업요건충족현황 입력하러 가기
            </Link>
          </div>
        ) : (
          <p className={styles.mutedHint}>확정한 졸업요건 기준 미충족 영역 {unmetRequirementLabels.length}개를 반영합니다.</p>
        )}

        <button
          className={styles.generateButton}
          disabled={sourceState.status !== "ready" || !selectedFriend}
          type="button"
          onClick={makeRemix}
        >
          시간표 만들기
        </button>
        <p className={styles.ruleHint}>
          기본은 교양+전공을 모두 보고, 비슷하게는 친구 과목이 포함된 유효 조합을 먼저 보여줘요.
          두 시간표에 이미 있는 과목·분반만 섞고 새 과목을 찾거나 서버에 저장하지 않아요.
        </p>
      </section>

      {generationError ? (
        <p className={styles.error} role="alert">
          {generationError}
          {generationError === LEGACY_REQUIRED_COURSE_ERROR ? (
            <>
              {" "}
              <Link className={styles.resaveLink} href="/friends">
                내 시간표 다시 저장하기
              </Link>
              {" 후 다시 시도해 주세요."}
            </>
          ) : null}
        </p>
      ) : null}
      {results.length > 0 ? (
        <section className={styles.results}>
          <div className={styles.resultHeading}>
            <p>TOP 5 REMIXES</p>
            <h2>내 기준 결과</h2>
          </div>
          <div className={styles.courseLegend} aria-label="리믹스 과목 색상 구분">
            <span><i className={styles.sharedCourse} aria-hidden="true" />대상 친구와 겹치는 과목</span>
            <span><i className={styles.friendOnlyCourse} aria-hidden="true" />친구만 듣는 과목</span>
            <span><i className={styles.myOnlyCourse} aria-hidden="true" />나만 듣는 과목</span>
          </div>
          <ol>
            {results.map((result, index) => (
              <li key={result.candidateId}>
                <div className={styles.scoreLine}>
                  <span>#{index + 1}</span>
                  <strong>{result.totalScore >= 0 ? "+" : ""}{result.totalScore} remix point</strong>
                  <small>점수에 반영된 친구 과목 {result.matchedCourseCount}개</small>
                </div>
                <TimetableCard
                  courseColorsById={courseColorsById}
                  extras={[]}
                  heading={`${index + 1}번 리믹스`}
                  index={index}
                  timetable={result.timetable}
                  tone="remix"
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
