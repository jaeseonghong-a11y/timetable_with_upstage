import type { CourseCandidate, Meeting, Timetable, Weekday } from "../../../lib/timetable";
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  scoreTimetables,
  type RecommendationWeight,
  type ScoreBreakdown,
  type ScoredTimetable,
  type WeightId,
  type WeightImportance,
} from "../../../lib/timetable-scoring";
import { requestSolarCompletion, type SolarJsonSchema } from "../../../lib/upstage";

type ApiErrorCode = "invalid_request";

const MAX_RECOMMENDATIONS = 8;
const MAX_TIMETABLES = 500;
const MAX_CUSTOM_PREFERENCE_CHARACTERS = 500;

const WEEKDAY_SET = new Set<Weekday>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const WEIGHT_ID_SET = new Set<WeightId>([
  "free_days",
  "back_to_back",
  "lunch_break",
  "avoid_9am",
  "compact_days",
  "prefer_in_person",
  "prefer_online",
  "minimize_daily_span",
]);
const IMPORTANCE_SET = new Set<WeightImportance>(["low", "medium", "high"]);

interface RequirementSummary {
  scope: string;
  label: string;
  status: string;
  remainingCredits: number | null;
}

interface TimetableRecommendationItem {
  candidateId: string;
  rank: number;
  timetable: Timetable;
  scoreBreakdown: ScoreBreakdown[];
  reason: string | null;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

interface SolarExplanation {
  /** Resolved locally from Solar's 1-based `position`, never trusted from its own output. */
  candidateId: string;
  rank: number | null;
  reason: string;
  requirementContribution: string | null;
  customPreferenceNote: string | null;
}

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Ranks already-generated valid timetables against user-selected soft preferences
 * (deterministic) and, when Upstage is configured, asks Solar to explain the top
 * candidates and how they contribute to unmet graduation requirements. Solar failures
 * degrade gracefully to the deterministic ranking — they never fail the whole request.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_request", "JSON 본문이 필요합니다.");
  }
  if (!isRecord(body)) {
    return errorResponse(400, "invalid_request", "요청 형식이 올바르지 않습니다.");
  }

  const timetables = parseTimetables(body.timetables);
  if (!timetables) {
    return errorResponse(
      400,
      "invalid_request",
      `timetables는 1~${MAX_TIMETABLES}개의 유효한 시간표 배열이어야 합니다.`,
    );
  }
  const weights = parseWeights(body.weights);
  const unmetRequirements = parseRequirementSummaries(body.requirements).filter(
    (requirement) => requirement.status !== "satisfied",
  );
  const customPreference = parseCustomPreference(body.customPreference);

  const scored = scoreTimetables(timetables, weights).slice(0, MAX_RECOMMENDATIONS);

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey || scored.length === 0) {
    return Response.json({
      recommendations: toRecommendationList(scored),
      aiExplanationFailed: !apiKey && scored.length > 0,
    });
  }

  try {
    const explanations = await requestRecommendationExplanations(
      scored,
      unmetRequirements,
      customPreference,
      apiKey,
    );
    const ordered = customPreference
      ? (tryReorderByCustomPreference(scored, explanations) ?? scored)
      : scored;
    return Response.json({
      recommendations: ensureDistinctReasons(applyExplanations(ordered, explanations)),
      aiExplanationFailed: false,
    });
  } catch {
    return Response.json({
      recommendations: toRecommendationList(scored),
      aiExplanationFailed: true,
    });
  }
}

function toRecommendationList(scored: readonly ScoredTimetable[]): TimetableRecommendationItem[] {
  return scored.map((entry, index) => ({
    candidateId: entry.candidateId,
    rank: index + 1,
    timetable: entry.timetable,
    scoreBreakdown: entry.breakdown,
    reason: null,
    requirementContribution: null,
    customPreferenceNote: null,
  }));
}

function applyExplanations(
  scored: readonly ScoredTimetable[],
  explanations: readonly SolarExplanation[],
): TimetableRecommendationItem[] {
  const byId = new Map(explanations.map((item) => [item.candidateId, item]));
  return scored.map((entry, index) => {
    const explanation = byId.get(entry.candidateId);
    return {
      candidateId: entry.candidateId,
      rank: index + 1,
      timetable: entry.timetable,
      scoreBreakdown: entry.breakdown,
      reason: explanation?.reason ?? null,
      requirementContribution: explanation?.requirementContribution ?? null,
      customPreferenceNote: explanation?.customPreferenceNote ?? null,
    };
  });
}

/**
 * Solar sometimes writes byte-identical `reason` text for candidates that differ only by one
 * course's section/professor — even when explicitly told not to (verified live: it complies on
 * some calls and reverts on others). Rather than trust prompt compliance, this deterministically
 * guarantees no two recommendations ever show the exact same sentence: every repeat gets the
 * concrete course/professor difference from the first candidate that used that sentence appended,
 * computed straight from the timetables themselves — "계산은 코드로", not another model call.
 */
function ensureDistinctReasons(
  items: readonly TimetableRecommendationItem[],
): TimetableRecommendationItem[] {
  const firstByReason = new Map<string, TimetableRecommendationItem>();
  return items.map((item) => {
    if (!item.reason) {
      return item;
    }
    const first = firstByReason.get(item.reason);
    if (!first) {
      firstByReason.set(item.reason, item);
      return item;
    }
    const detail = describeDistinguishingDetail(item.timetable, first.timetable);
    return detail ? { ...item, reason: `${item.reason} ${detail}` } : item;
  });
}

/** Names the courses/professors that differ between two timetables, or null if none do. */
function describeDistinguishingDetail(timetable: Timetable, other: Timetable): string | null {
  const otherByTitle = new Map(other.courses.map((course) => [course.title, course.professor ?? null]));
  const notes: string[] = [];
  for (const course of timetable.courses) {
    if (!otherByTitle.has(course.title)) {
      notes.push(`${course.title} 포함`);
      continue;
    }
    const otherProfessor = otherByTitle.get(course.title);
    if (course.professor && otherProfessor && course.professor !== otherProfessor) {
      notes.push(`${course.title}이 ${course.professor} 분반`);
    }
  }
  const titles = new Set(timetable.courses.map((course) => course.title));
  for (const course of other.courses) {
    if (!titles.has(course.title)) {
      notes.push(`${course.title} 미포함`);
    }
  }
  if (notes.length === 0) {
    return null;
  }
  return `(다른 추천과 달리 ${notes.slice(0, 2).join(", ")}입니다.)`;
}

/** Only reorders when Solar returned a rank for every candidate forming a clean 1..N permutation. */
function tryReorderByCustomPreference(
  scored: readonly ScoredTimetable[],
  explanations: readonly SolarExplanation[],
): ScoredTimetable[] | null {
  if (explanations.length !== scored.length) {
    return null;
  }
  const rankById = new Map(explanations.map((item) => [item.candidateId, item.rank]));
  const ranks = scored.map((entry) => rankById.get(entry.candidateId));
  if (ranks.some((rank) => rank === null || rank === undefined)) {
    return null;
  }
  const sortedRanks = [...(ranks as number[])].sort((a, b) => a - b);
  const isCleanPermutation = sortedRanks.every((rank, index) => rank === index + 1);
  if (!isCleanPermutation) {
    return null;
  }
  return [...scored].sort(
    (a, b) => (rankById.get(a.candidateId) ?? 0) - (rankById.get(b.candidateId) ?? 0),
  );
}

/**
 * Strict response_format schema for the explanation call, mirroring the same reasoning as
 * academic-document.ts's ACADEMIC_EXTRACTION_SCHEMA: without it, Solar is free to add markdown
 * fences or prose around the array, and — more importantly — a bare top-level array isn't a valid
 * root type for structured JSON Schema output, so the object wrapper is required either way.
 *
 * Explanations are keyed by `position` (the candidate's 1-based index in the input array), not
 * candidateId. Live testing showed Solar reliably reproduces a small integer but silently drops
 * or garbles a subset of entries when asked to echo back the long, generated candidateId string
 * (course ids joined with "|", 60+ characters) across 8 candidates — every dropped/mismatched id
 * meant that candidate lost its explanation, and occasionally all of them mismatched at once,
 * which is what actually produced "Solar 추천 이유 생성에 실패" for users. Position never leaves
 * our own control, so it can't drift.
 */
const RECOMMENDATION_EXPLANATION_SCHEMA: SolarJsonSchema = {
  name: "timetable_recommendation_explanations",
  schema: {
    type: "object",
    properties: {
      explanations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            position: { type: "integer" },
            rank: { type: "integer" },
            reason: { type: "string" },
            requirementContribution: { type: ["string", "null"] },
            customPreferenceNote: { type: ["string", "null"] },
          },
          required: ["position", "rank", "reason", "requirementContribution", "customPreferenceNote"],
          additionalProperties: false,
        },
      },
    },
    required: ["explanations"],
    additionalProperties: false,
  },
};

async function requestRecommendationExplanations(
  scored: readonly ScoredTimetable[],
  unmetRequirements: readonly RequirementSummary[],
  customPreference: string | undefined,
  apiKey: string,
): Promise<SolarExplanation[]> {
  const systemPrompt = [
    "당신은 성균관대 시간표 추천 서비스의 설명 엔진입니다.",
    "이미 결정론적으로 정렬된 시간표 후보 목록과 학생의 졸업요건 미충족 현황이 주어집니다.",
    "각 후보에 대해 한국어 2~3문장으로 추천 이유를 작성하세요.",
    "아래 입력(courses, scoreHighlights, unmetRequirements, customPreference)에 실제로 존재하는",
    "정보만 근거로 쓰세요. 교수의 평판·경력·인기도·학생 선호도·강의평가처럼 입력에 없는 사실은",
    "단정적으로도 추측으로도 절대 언급하지 마세요.",
    "여러 후보가 필수과목 구성은 같고 과목 1개의 분반(교수)만 다른 경우, 그 후보들 사이의 실질적",
    "차이가 시간표 배치 외에는 없다는 것을 있는 그대로 말하되, 그 후보에서 어느 과목이 어느",
    "분반·교수인지는 반드시 구체적으로 밝혀서 문장 자체는 후보마다 다르게 쓰세요. 근거 없는",
    "차별점을 지어내지 마세요.",
    "서로 다른 candidates(position)에 같은 reason 문장을 그대로 반복하지 마세요. 모든 reason은",
    "그 후보의 실제 과목명·분반(교수)·요일·시간 중 최소 하나를 구체적으로 담아 다른 후보의",
    "reason과 문자 그대로 겹치지 않게 쓰세요.",
    '각 원소 형식: {"position": number, "rank": number, "reason": string, "requirementContribution": string 또는 null, "customPreferenceNote": string 또는 null}',
    "position은 입력 candidates 배열에서 그 후보의 1부터 시작하는 순번을 그대로 옮겨 적으세요. 절대 새로 만들지 마세요.",
    "rank는 1부터 후보 개수까지 각각 한 번씩만 사용하세요. customPreference가 없으면 position과 동일한 값을 rank로 사용하세요.",
    "customPreference가 있으면 그 조건에 더 부합하는 후보일수록 낮은 rank(더 상위)를 부여하고, customPreferenceNote에 그 이유를 설명하세요. 없으면 customPreferenceNote는 null로 두세요.",
    "reason에는 scoreHighlights / 사용자 선택 가중치가 실제로 어떻게 만족됐는지 쓰세요.",
    "공강은 그날 수업이 단 1개도 없는 날만 뜻합니다. 온라인 수업이 있는 날은 공강이 아닙니다.",
    "수업 사이 빈 시간이나 온라인만 있는 날을 공강이라고 쓰지 마세요.",
    "예: 수업이 하나도 없는 공강일 조건을 만족합니다. / 점심시간 확보 조건에 맞습니다.",
    "requirementContribution에는 교양 추천 과목이 미충족 졸업요건 중 어느 항목(영역) 충족에",
    "도움이 되는지 쓰세요. 예: 교양 추천 과목으로 사회/역사 영역 졸업요건 충족에 도움이 됩니다.",
    "해당사항이 없으면 requirementContribution은 null로 두세요.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    candidates: scored.map((entry, index) => ({
      position: index + 1,
      courses: entry.timetable.courses.map((course) => ({
        title: course.title,
        professor: course.professor ?? null,
        schedule: course.schedule,
        courseType: course.courseType ?? null,
      })),
      scoreHighlights: entry.breakdown
        .filter((item) => item.weightedScore !== 0)
        .map((item) => ({ weight: item.weightId, weightedScore: item.weightedScore })),
    })),
    unmetRequirements,
    customPreference: customPreference ?? null,
  });

  const content = await requestSolarCompletion(
    systemPrompt,
    userPrompt,
    apiKey,
    RECOMMENDATION_EXPLANATION_SCHEMA,
  );
  return parseSolarExplanations(content, scored);
}

function parseSolarExplanations(
  content: string,
  scored: readonly ScoredTimetable[],
): SolarExplanation[] {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("solar_response_not_json_object");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new Error("solar_response_invalid_json");
  }
  const parsed = isRecord(parsedBody) ? parsedBody.explanations : undefined;
  if (!Array.isArray(parsed)) {
    throw new Error("solar_response_not_array");
  }

  const explanations: SolarExplanation[] = [];
  const seenPositions = new Set<number>();
  for (const entry of parsed) {
    if (
      !isRecord(entry) ||
      typeof entry.position !== "number" ||
      !Number.isInteger(entry.position) ||
      entry.position < 1 ||
      entry.position > scored.length ||
      seenPositions.has(entry.position) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    ) {
      continue;
    }
    seenPositions.add(entry.position);
    explanations.push({
      candidateId: scored[entry.position - 1]!.candidateId,
      rank: typeof entry.rank === "number" && Number.isInteger(entry.rank) ? entry.rank : null,
      reason: entry.reason.trim(),
      requirementContribution:
        typeof entry.requirementContribution === "string" && entry.requirementContribution.trim()
          ? entry.requirementContribution.trim()
          : null,
      customPreferenceNote:
        typeof entry.customPreferenceNote === "string" && entry.customPreferenceNote.trim()
          ? entry.customPreferenceNote.trim()
          : null,
    });
  }
  if (explanations.length === 0) {
    throw new Error("solar_response_empty");
  }
  return explanations;
}

function parseTimetables(value: unknown): Timetable[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TIMETABLES) {
    return null;
  }
  const timetables: Timetable[] = [];
  for (const entry of value) {
    const timetable = parseTimetable(entry);
    if (!timetable) {
      return null;
    }
    timetables.push(timetable);
  }
  return timetables;
}

function parseTimetable(value: unknown): Timetable | null {
  if (!isRecord(value) || !Array.isArray(value.courses) || !Array.isArray(value.meetings)) {
    return null;
  }
  const courses: CourseCandidate[] = [];
  for (const courseValue of value.courses) {
    const course = parseCourseCandidate(courseValue);
    if (!course) {
      return null;
    }
    courses.push(course);
  }
  if (courses.length === 0) {
    return null;
  }
  const meetings: Meeting[] = [];
  for (const meetingValue of value.meetings) {
    const meeting = parseMeeting(meetingValue);
    if (!meeting) {
      return null;
    }
    meetings.push(meeting);
  }
  // Fixed events (알바 등) don't affect scoring/explanation, so they're not part of this wire format.
  return { courses, meetings, fixedEvents: [] };
}

function parseCourseCandidate(value: unknown): CourseCandidate | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.schedule !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    schedule: value.schedule,
    credits: typeof value.credits === "number" ? value.credits : undefined,
    section: typeof value.section === "string" ? value.section : undefined,
    professor: typeof value.professor === "string" ? value.professor : undefined,
    campus: typeof value.campus === "string" ? value.campus : undefined,
    courseType: typeof value.courseType === "string" ? value.courseType : undefined,
  };
}

function parseMeeting(value: unknown): Meeting | null {
  if (
    !isRecord(value) ||
    typeof value.day !== "string" ||
    !WEEKDAY_SET.has(value.day as Weekday) ||
    typeof value.startMinutes !== "number" ||
    typeof value.endMinutes !== "number"
  ) {
    return null;
  }
  return { day: value.day as Weekday, startMinutes: value.startMinutes, endMinutes: value.endMinutes };
}

function parseWeights(value: unknown): RecommendationWeight[] {
  if (!Array.isArray(value)) {
    return DEFAULT_RECOMMENDATION_WEIGHTS;
  }
  const weights: RecommendationWeight[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !WEIGHT_ID_SET.has(entry.id as WeightId) ||
      typeof entry.enabled !== "boolean" ||
      typeof entry.importance !== "string" ||
      !IMPORTANCE_SET.has(entry.importance as WeightImportance)
    ) {
      continue;
    }
    weights.push({
      id: entry.id as WeightId,
      enabled: entry.enabled,
      importance: entry.importance as WeightImportance,
      config: parseWeightConfig(entry.config),
    });
  }
  return weights.length > 0 ? weights : DEFAULT_RECOMMENDATION_WEIGHTS;
}

function parseWeightConfig(value: unknown): RecommendationWeight["config"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const thresholdMinutes = typeof value.thresholdMinutes === "number" ? value.thresholdMinutes : undefined;
  const direction = value.direction === "prefer" || value.direction === "avoid" ? value.direction : undefined;
  return thresholdMinutes === undefined && direction === undefined
    ? undefined
    : { thresholdMinutes, direction };
}

function parseRequirementSummaries(value: unknown): RequirementSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: RequirementSummary[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.label !== "string" || typeof entry.status !== "string") {
      continue;
    }
    summaries.push({
      scope: typeof entry.scope === "string" ? entry.scope : "other",
      label: entry.label,
      status: entry.status,
      remainingCredits: typeof entry.remainingCredits === "number" ? entry.remainingCredits : null,
    });
  }
  return summaries;
}

function parseCustomPreference(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().slice(0, MAX_CUSTOM_PREFERENCE_CHARACTERS);
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
