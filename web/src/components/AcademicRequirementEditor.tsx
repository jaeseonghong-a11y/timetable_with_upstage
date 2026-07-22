"use client";

import { useState } from "react";

import type {
  AcademicProfile,
  Requirement,
  RequirementRule,
} from "@/lib/academic-profile";
import { isNonBlockingRequirementReview } from "@/lib/academic-profile-client";
import { GRADUATION_REQUIREMENT_TEMPLATES } from "@/lib/graduation-requirement-templates";

import styles from "./AcademicDocumentManager.module.css";

interface Props {
  profile: AcademicProfile;
  onChange: (profile: AcademicProfile) => void;
}

export function AcademicRequirementEditor({ profile, onChange }: Props) {
  const sourceDocumentId = profile.sourceDocuments[0]?.id;

  // 졸업요건은 수강내역과 달리 이수구분 같은 분류 기준이 없어 그룹으로 나누기 어려우므로,
  // 목록 전체를 하나의 단위로만 접고 편다 (개별 요건 접기는 없음). 수강내역 편집기와 같은
  // 이유로, 새 분석 결과가 들어올 때(sourceDocumentId 변경)마다 접힌 상태로 시작한다.
  const [isListCollapsed, setIsListCollapsed] = useState(true);
  const [showUnmetOnly, setShowUnmetOnly] = useState(false);
  const [lastSourceDocumentId, setLastSourceDocumentId] = useState(sourceDocumentId);
  if (sourceDocumentId !== lastSourceDocumentId) {
    setLastSourceDocumentId(sourceDocumentId);
    setIsListCollapsed(true);
    setShowUnmetOnly(false);
  }

  // 수동 추가 시 실제로 필요한 건 "어떤 영역에서 몇 학점이 부족한가"뿐이다 — 기준학점/취득학점은
  // 학과·입학년도마다 달라 우리가 대신 채워줄 수 없고, 어차피 다운스트림(AI 추천)은 영역명과
  // 미충족 여부만 본다. 그래서 목록에서 영역을 고르고 잔여학점만 입력하면 나머지 필드는
  // 자동으로 채운다.
  const [isAddingRequirement, setIsAddingRequirement] = useState(false);
  const [templateChoice, setTemplateChoice] = useState("");
  const [customLabelDraft, setCustomLabelDraft] = useState("");
  const [remainingCreditsDraft, setRemainingCreditsDraft] = useState("");
  const [addRequirementError, setAddRequirementError] = useState("");
  const addedRequirementLabels = new Set(profile.requirements.map((requirement) => requirement.label));
  const availableRequirementTemplates = GRADUATION_REQUIREMENT_TEMPLATES.filter(
    (template) => !addedRequirementLabels.has(template.label),
  );

  function isUnmetRequirement(requirement: Requirement): boolean {
    return requirement.status === "unmet";
  }

  const visibleRequirements = profile.requirements
    .map((requirement, index) => ({ requirement, index }))
    .filter(({ requirement }) => !showUnmetOnly || isUnmetRequirement(requirement));
  const unmetCount = profile.requirements.filter(isUnmetRequirement).length;
  const needsReviewCount = profile.requirements.filter((requirement) =>
    requirement.reviewReasons.some((reason) => !isNonBlockingRequirementReview(requirement, reason)),
  ).length;

  function updateRequirement(index: number, requirement: Requirement): void {
    onChange({
      ...profile,
      requirements: profile.requirements.map((current, currentIndex) =>
        currentIndex === index ? requirement : current,
      ),
    });
  }

  function updateRequirementRule(index: number, rule: RequirementRule): void {
    const previousRule = profile.requirements[index]?.rule;
    if (previousRule?.kind === "distribution_minimum" && rule.kind === "distribution_minimum") {
      onChange({
        ...profile,
        requirements: profile.requirements.map((requirement) =>
          requirement.rule.kind === "distribution_minimum" &&
          requirement.rule.groupId === previousRule.groupId
            ? { ...requirement, rule }
            : requirement,
        ),
      });
      return;
    }
    const requirement = profile.requirements[index];
    if (requirement) {
      updateRequirement(index, { ...requirement, rule });
    }
  }

  const CUSTOM_TEMPLATE_VALUE = "__custom__";

  function addTemplatedRequirement(): void {
    const sourceDocumentIdForNewRow = profile.sourceDocuments[0]?.id;
    if (!sourceDocumentIdForNewRow) {
      return;
    }
    const isCustom = templateChoice === CUSTOM_TEMPLATE_VALUE;
    const label = (isCustom ? customLabelDraft : templateChoice).trim();
    const scope: Requirement["scope"] = isCustom
      ? "other"
      : (GRADUATION_REQUIREMENT_TEMPLATES.find((template) => template.label === templateChoice)
          ?.scope ?? "other");
    const remainingCredits = remainingCreditsDraft === "" ? NaN : Number(remainingCreditsDraft);
    if (!label) {
      setAddRequirementError("추가할 요건을 선택하거나 이름을 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(remainingCredits) || remainingCredits < 0) {
      setAddRequirementError("잔여학점을 0 이상 숫자로 입력해 주세요.");
      return;
    }
    onChange({
      ...profile,
      requirements: [
        ...profile.requirements,
        {
          requirementId: crypto.randomUUID(),
          scope,
          label,
          rule: { kind: "manual", rawText: label },
          earnedCredits: null,
          inProgressCredits: { spring: 0, summer: 0, fall: 0, winter: 0, total: 0 },
          remainingCredits,
          status: remainingCredits > 0 ? "unmet" : "satisfied",
          rawValues: {},
          sourceDocumentId: sourceDocumentIdForNewRow,
          reviewReasons: [],
        },
      ],
    });
    setTemplateChoice("");
    setCustomLabelDraft("");
    setRemainingCreditsDraft("");
    setAddRequirementError("");
    setIsAddingRequirement(false);
  }

  function deleteRequirement(index: number): void {
    onChange({
      ...profile,
      requirements: profile.requirements.filter((_, currentIndex) => currentIndex !== index),
    });
  }

  return (
    <div className={styles.dataSection}>
      <div className={styles.sectionHeading}>
        <div>
          <p>졸업요건</p>
          <h3>
            {showUnmetOnly
              ? `미충족 ${visibleRequirements.length}개 / 전체 ${profile.requirements.length}개`
              : `${profile.requirements.length}개`}
          </h3>
        </div>
        <div className={styles.sectionControls}>
          <label className={styles.unmetOnlyToggle}>
            <input
              checked={showUnmetOnly}
              type="checkbox"
              onChange={(event) => {
                setShowUnmetOnly(event.target.checked);
                if (event.target.checked) {
                  setIsListCollapsed(false);
                }
              }}
            />
            <span>
              미충족 요건만 보기
              {unmetCount > 0 ? ` (${unmetCount})` : ""}
            </span>
          </label>
          {needsReviewCount > 0 ? (
            <span className={styles.needsReviewBadge}>확인 필요 {needsReviewCount}</span>
          ) : null}
          <button type="button" onClick={() => setIsListCollapsed(true)}>
            전체 접기
          </button>
          <button type="button" onClick={() => setIsListCollapsed(false)}>
            전체 펼치기
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => {
              setIsAddingRequirement((current) => !current);
              setAddRequirementError("");
            }}
          >
            {isAddingRequirement ? "요건 추가 취소" : "+ 요건 수동 추가"}
          </button>
        </div>
      </div>

      {isAddingRequirement ? (
        <div className={styles.manualRequirementForm}>
          <label className={styles.field}>
            <span>요건 영역</span>
            <select
              value={templateChoice}
              onChange={(event) => setTemplateChoice(event.target.value)}
            >
              <option value="">영역을 선택하세요</option>
              {availableRequirementTemplates.map((template) => (
                <option key={template.label} value={template.label}>
                  {template.label}
                </option>
              ))}
              <option value={CUSTOM_TEMPLATE_VALUE}>기타(목록에 없는 요건 직접 입력)</option>
            </select>
          </label>
          {templateChoice === CUSTOM_TEMPLATE_VALUE ? (
            <label className={styles.field}>
              <span>요건명</span>
              <input
                value={customLabelDraft}
                onChange={(event) => setCustomLabelDraft(event.target.value)}
              />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>잔여학점</span>
            <input
              min="0"
              step="0.5"
              type="number"
              value={remainingCreditsDraft}
              onChange={(event) => setRemainingCreditsDraft(event.target.value)}
            />
          </label>
          {addRequirementError ? <p className={styles.error}>{addRequirementError}</p> : null}
          <button className={styles.secondaryButton} type="button" onClick={addTemplatedRequirement}>
            이 요건 추가하기
          </button>
        </div>
      ) : null}

      {profile.requirements.length === 0 ? (
        <p className={styles.dataEmpty}>추출된 요건이 없습니다. 필요하면 수동으로 추가해 주세요.</p>
      ) : isListCollapsed ? (
        <button
          aria-expanded={false}
          className={styles.courseGroupHeading}
          type="button"
          onClick={() => setIsListCollapsed(false)}
        >
          <span>▶ 접힘</span>
          {needsReviewCount > 0 ? (
            <span className={styles.needsReviewBadge}>확인 필요 {needsReviewCount}</span>
          ) : (
            <span>펼치려면 클릭</span>
          )}
        </button>
      ) : visibleRequirements.length === 0 ? (
        <p className={styles.dataEmpty}>미충족 요건이 없습니다.</p>
      ) : (
        <ol className={styles.courseCardGrid}>
          {visibleRequirements.map(({ requirement, index }) => {
            const blockingReviewReasonCount = requirement.reviewReasons.filter(
              (reason) => !isNonBlockingRequirementReview(requirement, reason),
            ).length;
            return (
            <li
              className={`${styles.dataCard} ${styles.requirementCard}`}
              key={requirement.requirementId}
            >
              <div className={styles.cardTopline}>
                <div className={styles.cardIdentity}>
                  <strong>요건 {index + 1}</strong>
                  <span>{requirement.label || "요건명 미입력"}</span>
                </div>
                <div className={styles.cardActions}>
                  {blockingReviewReasonCount > 0 ? (
                    <span className={styles.needsReviewBadge}>
                      확인 필요 {blockingReviewReasonCount}
                    </span>
                  ) : null}
                  <button
                    className={styles.deleteButton}
                    type="button"
                    onClick={() => deleteRequirement(index)}
                  >
                    삭제
                  </button>
                </div>
              </div>

              <div className={styles.cardBody}>
                <div className={`${styles.fieldGrid} ${styles.courseFieldGrid}`}>
                  <label className={styles.field}>
                    <span>요건명</span>
                    <input
                      value={requirement.label}
                      onChange={(event) =>
                        updateRequirement(index, { ...requirement, label: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>범위</span>
                    <select
                      value={requirement.scope}
                      onChange={(event) =>
                        updateRequirement(index, {
                          ...requirement,
                          scope: event.target.value as Requirement["scope"],
                        })
                      }
                    >
                      <option value="primary_major">제1전공</option>
                      <option value="secondary_major">제2·3전공</option>
                      <option value="general">교양</option>
                      <option value="ds">DS</option>
                      <option value="university">대학 공통</option>
                      <option value="other">기타</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>상태</span>
                    <select
                      value={requirement.status}
                      onChange={(event) =>
                        updateRequirement(index, {
                          ...requirement,
                          status: event.target.value as Requirement["status"],
                        })
                      }
                    >
                      <option value="satisfied">충족</option>
                      <option value="in_progress">수강 중</option>
                      <option value="unmet">미충족</option>
                      <option value="review">확인 필요</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>취득학점</span>
                    <input
                      min="0"
                      step="0.5"
                      type="number"
                      value={nullableNumberInputValue(requirement.earnedCredits)}
                      onChange={(event) =>
                        updateRequirement(index, {
                          ...requirement,
                          earnedCredits: readNullableNumber(
                            event.target.value,
                            event.target.valueAsNumber,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>잔여학점</span>
                    <input
                      min="0"
                      step="0.5"
                      type="number"
                      value={nullableNumberInputValue(requirement.remainingCredits)}
                      onChange={(event) =>
                        updateRequirement(index, {
                          ...requirement,
                          remainingCredits: readNullableNumber(
                            event.target.value,
                            event.target.valueAsNumber,
                          ),
                        })
                      }
                    />
                  </label>
                </div>

                <RequirementRuleEditor
                  rule={requirement.rule}
                  onChange={(rule) => updateRequirementRule(index, rule)}
                />

                {Object.keys(requirement.rawValues).length > 0 ? (
                  <details className={styles.rawValues}>
                    <summary>원본 셀 값 확인</summary>
                    <dl>
                      {Object.entries(requirement.rawValues).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
            </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function RequirementRuleEditor({
  rule,
  onChange,
}: {
  rule: RequirementRule;
  onChange: (rule: RequirementRule) => void;
}) {
  function changeKind(kind: RequirementRule["kind"]): void {
    if (kind === "credit_minimum") {
      onChange({ kind, credits: 0 });
    } else if (kind === "distribution_minimum") {
      onChange({
        kind,
        groupId: crypto.randomUUID(),
        totalAreas: 1,
        minimumAreas: 1,
        totalCredits: 0,
        rawText: "",
      });
    } else {
      onChange({ kind, rawText: "" });
    }
  }

  return (
    <div
      className={`${styles.ruleEditor} ${rule.kind === "distribution_minimum" ? styles.distributionRuleEditor : ""}`}
    >
      <label className={styles.field}>
        <span>요건 규칙</span>
        <select value={rule.kind} onChange={(event) => changeKind(event.target.value as RequirementRule["kind"])}>
          <option value="credit_minimum">최소 학점</option>
          <option value="distribution_minimum">공동 영역 분배</option>
          <option value="completion">이수 여부</option>
          <option value="manual">수동 확인</option>
        </select>
      </label>

      {rule.kind === "credit_minimum" ? (
        <label className={styles.field}>
          <span>기준학점</span>
          <input
            min="0"
            step="0.5"
            type="number"
            value={numberInputValue(rule.credits)}
            onChange={(event) => onChange({ ...rule, credits: event.target.valueAsNumber })}
          />
        </label>
      ) : null}

      {rule.kind === "distribution_minimum" ? (
        <>
          <label className={styles.field}>
            <span>전체 영역</span>
            <input
              min="1"
              step="1"
              type="number"
              value={numberInputValue(rule.totalAreas)}
              onChange={(event) => onChange({ ...rule, totalAreas: event.target.valueAsNumber })}
            />
          </label>
          <label className={styles.field}>
            <span>최소 영역</span>
            <input
              min="1"
              step="1"
              type="number"
              value={numberInputValue(rule.minimumAreas)}
              onChange={(event) => onChange({ ...rule, minimumAreas: event.target.valueAsNumber })}
            />
          </label>
          <label className={styles.field}>
            <span>합계 기준</span>
            <input
              min="0"
              step="0.5"
              type="number"
              value={numberInputValue(rule.totalCredits)}
              onChange={(event) => onChange({ ...rule, totalCredits: event.target.valueAsNumber })}
            />
          </label>
          <p className={styles.ruleExplanation}>
            공동 규칙 · {rule.totalAreas}개 중 최소 {rule.minimumAreas}개 영역 · 영역 합계
            {rule.totalCredits}학점 이상 · 각 영역별 {rule.totalCredits}학점이 아님
          </p>
          <details className={styles.ruleDetails}>
            <summary>규칙 원문 수정</summary>
            <input
              aria-label="규칙 원문"
              value={rule.rawText}
              onChange={(event) => onChange({ ...rule, rawText: event.target.value })}
            />
          </details>
        </>
      ) : null}

      {rule.kind !== "credit_minimum" && rule.kind !== "distribution_minimum" ? (
        <label className={`${styles.field} ${styles.ruleText}`}>
          <span>규칙 원문</span>
          <input value={rule.rawText} onChange={(event) => onChange({ ...rule, rawText: event.target.value })} />
        </label>
      ) : null}
    </div>
  );
}

function readNullableNumber(rawValue: string, numberValue: number): number | null {
  return rawValue ? numberValue : null;
}

function nullableNumberInputValue(value: number | null): number | "" {
  return value === null || !Number.isFinite(value) ? "" : value;
}

function numberInputValue(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}
