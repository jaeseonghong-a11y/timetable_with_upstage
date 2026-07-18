"use client";

import { useState } from "react";
import type { CurriculumRoadmap } from "@/lib/curriculum-roadmap";
import { findSkkuDepartment } from "@/lib/skku-departments";
import { CurriculumRoadmapManager } from "./CurriculumRoadmapManager";
import styles from "./CurriculumRoadmapCollection.module.css";

interface Props {
  academicYear: number | null;
  programCodes: string[];
  currentGrade: number | null;
  semester: 1 | 2 | null;
  onChange: (roadmaps: CurriculumRoadmap[]) => void;
}

export const ROADMAP_COLORS = ["#f59f00", "#7048e8", "#0ca678", "#e64980", "#1971c2", "#e8590c"] as const;

export function CurriculumRoadmapCollection(props: Props) {
  const [roadmaps, setRoadmaps] = useState<Record<string, CurriculumRoadmap | null>>({});

  function publish(next: Record<string, CurriculumRoadmap | null>): void {
    setRoadmaps(next);
    props.onChange(props.programCodes.flatMap((code) => next[code] ? [next[code]!] : []));
  }

  return <section className={styles.collection}>
    <div className={styles.heading}>
      <div><p>복수 전공 로드맵</p><h2>STEP 1에서 선택한 전공별 로드맵을 등록하세요.</h2></div>
    </div>
    <div className={styles.legend}>{props.programCodes.map((code, index) => <span key={code}><i style={{ background: ROADMAP_COLORS[index % ROADMAP_COLORS.length] }} />{findSkkuDepartment(code)?.name ?? code}</span>)}</div>
    {props.programCodes.map((code, index) => <div className={styles.program} key={code} style={{ borderColor: ROADMAP_COLORS[index % ROADMAP_COLORS.length] }}>
      <div className={styles.programTitle}>
        <strong>{findSkkuDepartment(code)?.name ?? code}</strong>
        <span>{index === 0 ? "기본 전공" : `추가 전공 ${index}`}</span>
      </div>
      <CurriculumRoadmapManager
        academicYear={props.academicYear}
        currentGrade={props.currentGrade}
        programCode={code}
        semester={props.semester}
        onChange={(roadmap) => publish({ ...roadmaps, [code]: roadmap })}
      />
    </div>)}
  </section>;
}
