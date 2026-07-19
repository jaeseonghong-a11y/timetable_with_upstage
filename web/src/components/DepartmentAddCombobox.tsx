"use client";

import { type FocusEvent, useState } from "react";

import {
  filterSkkuDepartments,
  groupSkkuDepartments,
  type SkkuDepartment,
} from "@/lib/skku-departments";

import styles from "./DepartmentAddCombobox.module.css";

interface Props {
  id: string;
  placeholder: string;
  /** Department codes to hide from the results (already selected elsewhere). */
  excludeCodes: readonly string[];
  onSelect: (department: SkkuDepartment) => void;
}

/**
 * Search-and-add department picker: type to filter, click a result to add it. Shared by the
 * "복수전공·연계전공·트랙 추가" field in StudentProfileForm (step 1) and the "다른 전공 과목
 * 찾기" field in TimetablePlanner (step 3) so both look and behave identically.
 */
export function DepartmentAddCombobox({ id, placeholder, excludeCodes, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const groups = groupSkkuDepartments(
    filterSkkuDepartments(search).filter((department) => !excludeCodes.includes(department.code)),
  );

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsOpen(false);
    }
  }

  return (
    <div className={styles.picker} onBlur={handleBlur}>
      <div className={styles.control}>
        <input
          id={id}
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={isOpen}
          autoComplete="off"
          placeholder={placeholder}
          role="combobox"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
        />
        <button
          aria-label={isOpen ? "학과 목록 닫기" : "학과 목록 열기"}
          className={styles.toggle}
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          onMouseDown={(event) => event.preventDefault()}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {isOpen ? (
        <div id={`${id}-options`} aria-label="학과 목록" className={styles.dropdown} role="listbox">
          {groups.length > 0 ? (
            groups.map((group) => (
              <div className={styles.group} key={group.college} role="group">
                <div className={styles.groupLabel}>{group.college}</div>
                {group.departments.map((department) => (
                  <button
                    aria-selected={false}
                    className={styles.option}
                    key={department.code}
                    role="option"
                    type="button"
                    onClick={() => {
                      onSelect(department);
                      setSearch("");
                      setIsOpen(false);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <span>{department.name}</span>
                    <small>{department.code}</small>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <p className={styles.empty}>일치하는 학과가 없습니다.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
