"use client";

import { type FocusEvent, type KeyboardEvent, useMemo, useRef, useState } from "react";

import {
  getCourseQueryLabel,
  getStudentProfileError,
  type StudentPlanningProfile,
} from "@/lib/planning-profile";
import {
  filterSkkuDepartments,
  findSkkuDepartment,
  groupSkkuDepartments,
  SKKU_DEPARTMENTS,
  type SkkuDepartment,
} from "@/lib/skku-departments";
import type { SkkuTerm } from "@/lib/skku-course-api";

import styles from "./StudentProfileForm.module.css";

interface Props {
  profile: StudentPlanningProfile;
  appliedProfile: StudentPlanningProfile | null;
  onChange: (profile: StudentPlanningProfile) => void;
  onApply: (profile: StudentPlanningProfile) => void;
}

const TERMS: ReadonlyArray<{ value: SkkuTerm; label: string }> = [
  { value: 10, label: "1학기" },
  { value: 15, label: "여름학기" },
  { value: 20, label: "2학기" },
  { value: 25, label: "겨울학기" },
];
const ADMISSION_YEAR_PRESETS = Array.from(
  { length: 2026 - 2018 + 1 },
  (_, index) => 2026 - index,
);

export function StudentProfileForm({ profile, appliedProfile, onChange, onApply }: Props) {
  const departmentInputRef = useRef<HTMLInputElement>(null);
  const [departmentSearch, setDepartmentSearch] = useState(
    () => findSkkuDepartment(profile.departmentCode)?.name ?? "",
  );
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [isDepartmentListOpen, setIsDepartmentListOpen] = useState(false);
  const [activeDepartmentCode, setActiveDepartmentCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visibleDepartments = useMemo(
    () => filterSkkuDepartments(departmentFilter),
    [departmentFilter],
  );
  const departmentGroups = useMemo(
    () => groupSkkuDepartments(visibleDepartments),
    [visibleDepartments],
  );
  const selectedDepartment = findSkkuDepartment(profile.departmentCode);

  function applyProfile(): void {
    const nextError = getStudentProfileError(profile);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError("");
    onApply(profile);
  }

  function changeDepartment(value: string): void {
    setDepartmentSearch(value);
    setDepartmentFilter(value);
    setActiveDepartmentCode(null);
    const normalized = value.trim();
    const selected = SKKU_DEPARTMENTS.find(
      (department) =>
        department.code === normalized ||
        department.name === normalized,
    );
    onChange({
      ...profile,
      departmentCode: selected?.code ?? (/^\d{6}$/.test(normalized) ? normalized : ""),
    });
  }

  function selectDepartment(department: SkkuDepartment): void {
    setDepartmentSearch(department.name);
    setDepartmentFilter("");
    setActiveDepartmentCode(department.code);
    setIsDepartmentListOpen(false);
    onChange({ ...profile, departmentCode: department.code });
  }

  function moveActiveDepartment(direction: 1 | -1): void {
    if (visibleDepartments.length === 0) {
      return;
    }

    const currentIndex = visibleDepartments.findIndex(
      (department) => department.code === activeDepartmentCode,
    );
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : visibleDepartments.length - 1
      : (currentIndex + direction + visibleDepartments.length) % visibleDepartments.length;
    const nextDepartment = visibleDepartments[nextIndex];
    setActiveDepartmentCode(nextDepartment.code);

    requestAnimationFrame(() => {
      document.getElementById(`department-option-${nextDepartment.code}`)?.scrollIntoView({
        block: "nearest",
      });
    });
  }

  function handleDepartmentKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsDepartmentListOpen(true);
      moveActiveDepartment(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" && isDepartmentListOpen && activeDepartmentCode) {
      const activeDepartment = visibleDepartments.find(
        (department) => department.code === activeDepartmentCode,
      );
      if (activeDepartment) {
        event.preventDefault();
        selectDepartment(activeDepartment);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsDepartmentListOpen(false);
      setActiveDepartmentCode(null);
    }
  }

  function handleDepartmentBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDepartmentListOpen(false);
      setActiveDepartmentCode(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="student-profile-heading">
      <div className={styles.heading}>
        <div>
          <p>STEP 1 · 기본 정보</p>
          <h2 id="student-profile-heading">어떤 강좌를 찾을지 먼저 알려 주세요.</h2>
        </div>
        {appliedProfile ? (
          <span className={styles.appliedBadge}>{getCourseQueryLabel(appliedProfile)} 적용됨</span>
        ) : null}
      </div>

      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.departmentField}`}>
          <label className={styles.fieldLabel} htmlFor="student-department-search">
            소속 학과·전공·트랙
          </label>
          <div className={styles.departmentPicker} onBlur={handleDepartmentBlur}>
            <div className={styles.departmentControl}>
              <input
                ref={departmentInputRef}
                id="student-department-search"
                aria-activedescendant={
                  activeDepartmentCode ? `department-option-${activeDepartmentCode}` : undefined
                }
                aria-autocomplete="list"
                aria-controls="skku-department-options"
                aria-expanded={isDepartmentListOpen}
                autoComplete="off"
                placeholder="학과명·전공명·트랙명 또는 6자리 코드 검색"
                role="combobox"
                type="search"
                value={departmentSearch}
                onChange={(event) => {
                  changeDepartment(event.target.value);
                  setIsDepartmentListOpen(true);
                }}
                onFocus={() => {
                  if (selectedDepartment) {
                    setDepartmentFilter("");
                  }
                  setIsDepartmentListOpen(true);
                }}
                onKeyDown={handleDepartmentKeyDown}
              />
              <button
                aria-label={isDepartmentListOpen ? "소속 목록 닫기" : "소속 목록 열기"}
                className={styles.departmentToggle}
                type="button"
                onClick={() => {
                  const nextOpen = !isDepartmentListOpen;
                  if (nextOpen) {
                    setDepartmentFilter("");
                  }
                  setIsDepartmentListOpen(nextOpen);
                  departmentInputRef.current?.focus();
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <span aria-hidden="true">⌄</span>
              </button>
            </div>

            {isDepartmentListOpen ? (
              <div
                id="skku-department-options"
                aria-label="대학·학부별 소속 목록"
                className={styles.departmentDropdown}
                role="listbox"
              >
                {departmentGroups.length > 0 ? departmentGroups.map((group) => {
                  const groupId = `department-group-${group.departments[0].code}`;
                  return (
                    <div
                      key={group.college}
                      aria-labelledby={groupId}
                      className={styles.departmentGroup}
                      role="group"
                    >
                      <div id={groupId} className={styles.departmentGroupLabel}>
                        {group.college}
                      </div>
                      {group.departments.map((department) => {
                        const isActive = department.code === activeDepartmentCode;
                        const isSelected = department.code === profile.departmentCode;
                        return (
                          <button
                            key={department.code}
                            id={`department-option-${department.code}`}
                            aria-selected={isSelected}
                            className={[
                              styles.departmentOption,
                              isActive ? styles.departmentOptionActive : "",
                              isSelected ? styles.departmentOptionSelected : "",
                            ].filter(Boolean).join(" ")}
                            role="option"
                            tabIndex={-1}
                            type="button"
                            onClick={() => selectDepartment(department)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveDepartmentCode(department.code)}
                          >
                            <span>{department.name}</span>
                            <small>{department.code}</small>
                          </button>
                        );
                      })}
                    </div>
                  );
                }) : (
                  <p className={styles.departmentEmpty}>일치하는 소속이 없습니다.</p>
                )}
              </div>
            ) : null}
          </div>
          <small className={styles.departmentHint}>
            {selectedDepartment
              ? `${selectedDepartment.college} · ${selectedDepartment.name} · ${selectedDepartment.code}`
              : profile.departmentCode
                ? `입력 코드 ${profile.departmentCode}`
              : "검색 결과에서 소속을 선택하세요. 목록에 없으면 6자리 코드를 입력할 수 있습니다."}
          </small>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="student-admission-year">
            입학연도
          </label>
          <input
            id="student-admission-year"
            autoComplete="off"
            inputMode="numeric"
            list="student-admission-year-options"
            max={profile.courseYear}
            min="2000"
            placeholder="입력 또는 선택"
            type="number"
            value={profile.admissionYear ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                admissionYear: event.target.value ? event.target.valueAsNumber : null,
              })
            }
          />
          <datalist id="student-admission-year-options">
            {ADMISSION_YEAR_PRESETS.map((year) => (
              <option key={year} value={year}>{year}년</option>
            ))}
          </datalist>
          <small className={styles.admissionYearHint}>
            2018~2026년은 목록에서 고르거나 다른 연도를 바로 입력하세요.
          </small>
        </div>

        <label className={styles.field}>
          <span>현재 학년</span>
          <select
            value={profile.currentGrade ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                currentGrade: event.target.value ? Number(event.target.value) : null,
              })
            }
          >
            <option value="">학년 선택</option>
            {[1, 2, 3, 4, 5, 6].map((grade) => (
              <option key={grade} value={grade}>{grade}학년</option>
            ))}
            <option value="7">초과학기</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>주 캠퍼스</span>
          <select
            value={profile.primaryCampus ?? ""}
            onChange={(event) =>
              onChange({
                ...profile,
                primaryCampus: event.target.value
                  ? (event.target.value as StudentPlanningProfile["primaryCampus"])
                  : null,
              })
            }
          >
            <option value="">캠퍼스 선택</option>
            <option value="humanities">인문사회과학캠퍼스</option>
            <option value="natural_sciences">자연과학캠퍼스</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>조회 학년도</span>
          <input
            max="2100"
            min="2020"
            type="number"
            value={profile.courseYear}
            onChange={(event) =>
              onChange({ ...profile, courseYear: event.target.valueAsNumber || 2026 })
            }
          />
        </label>

        <label className={styles.field}>
          <span>조회 학기</span>
          <select
            value={profile.courseTerm}
            onChange={(event) =>
              onChange({ ...profile, courseTerm: Number(event.target.value) as SkkuTerm })
            }
          >
            {TERMS.map((term) => (
              <option key={term.value} value={term.value}>{term.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.actions}>
        <p>이름과 전체 학번은 받지 않습니다. 선택한 학과 범위만 성대 공개 API에서 조회합니다.</p>
        <button type="button" onClick={applyProfile}>이 조건으로 전공·교양 개설강좌 조회</button>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
