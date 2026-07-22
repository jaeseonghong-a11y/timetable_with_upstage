import type { RequirementScope } from "./academic-profile";

export interface GraduationRequirementTemplate {
  label: string;
  scope: RequirementScope;
}

/**
 * SKKU's common 교양/DS/균형교양 core-curriculum area names (live-observed 2026-07-23 from a real
 * 졸업요건충족현황 "영역별 학점취득/수강현황" table) plus the three 제1전공 rows that same table
 * always carries. Only the AREA NAMES are treated as stable enough to hard-code here — the credit
 * thresholds behind them vary by department/admission year, which is exactly why manual entry only
 * asks for 잔여학점 (the one number that's actually needed downstream) instead of also asking the
 * user to reconstruct a 기준학점/취득학점 breakdown we can't verify anyway.
 */
export const GRADUATION_REQUIREMENT_TEMPLATES: readonly GraduationRequirementTemplate[] = [
  { label: "제1전공 심화학점", scope: "primary_major" },
  { label: "제1전공 코어학점", scope: "primary_major" },
  { label: "제1전공 실험실습", scope: "primary_major" },
  { label: "의사소통", scope: "general" },
  { label: "창의", scope: "general" },
  { label: "글로벌(필수)", scope: "general" },
  { label: "글로벌", scope: "general" },
  { label: "인문사회과학/자연과학기반", scope: "general" },
  { label: "성균인성.리더십", scope: "general" },
  { label: "고전.명저", scope: "general" },
  { label: "DS기반(계열1)", scope: "ds" },
  { label: "DS기반(공통)", scope: "ds" },
  // 균형교양은 실제로는 "3개 영역 중 2개 이상에서 합계 6학점" 그룹 규칙이지만, 그 산술은
  // 문서 분석 경로(canonicalizeBalancedGeneralRequirements)에서만 쓰인다 — 수동 입력은 그
  // 그룹 판정을 재현하지 않고, 나머지 교양 영역과 동일하게 "이 영역에서 몇 학점 부족한지"만
  // 물어본다. 어차피 AI 추천이 실제로 쓰는 건 영역별 미충족 여부뿐이라, 영역을 나눠 각각
  // 잔여학점을 받는 쪽이 사용자가 아는 만큼만 입력할 수 있어 더 정직하다.
  { label: "균형교양 - 인간/문화", scope: "general" },
  { label: "균형교양 - 사회/역사", scope: "general" },
  { label: "균형교양 - 자연/과학/기술", scope: "general" },
];
