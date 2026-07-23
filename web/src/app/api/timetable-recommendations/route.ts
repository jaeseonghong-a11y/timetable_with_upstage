import {
  parseCourseCandidate,
  type CourseCandidate,
  type FixedEvent,
  type Meeting,
  type Timetable,
  type Weekday,
} from "../../../lib/timetable";
import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  getFreeDayLabels,
  type RecommendationWeight,
  type ScoreBreakdown,
  type WeightId,
  type WeightImportance,
} from "../../../lib/timetable-scoring";
import { requestSolarCompletion, type SolarJsonSchema } from "../../../lib/upstage";
import {
  buildRecommendationCopy,
  rankValidTimetables,
  type GraduationConsiderationStrength,
  type RankedValidTimetable,
  type UnmetGraduationRequirement,
  type ValidTimetableRecommendationContext,
} from "../../../lib/valid-timetable-recommendation";

type ApiErrorCode = "invalid_request";

const MAX_RECOMMENDATIONS = 2;
const MAX_TIMETABLES = 500;
const MAX_CUSTOM_PREFERENCE_CHARACTERS = 500;

const WEEKDAY_SET = new Set<Weekday>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const WEIGHT_ID_SET = new Set<WeightId>([
  "free_days",
  "back_to_back",
  "lunch_break",
  "avoid_9am",
  "day_packing",
  "course_format",
]);
const IMPORTANCE_SET = new Set<WeightImportance>([1, 2, 3, 4, 5]);

interface TimetableRecommendationItem {
  candidateId: string;
  rank: number;
  name: string;
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
  name: string | null;
  reason: string;
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
  const contexts = parseRecommendationContexts(body.candidateContexts, timetables);
  const unmetRequirements = parseUnmetRequirements(body.unmetRequirements);
  const graduationStrength = parseGraduationStrength(body.graduationStrength);
  const customPreference = parseCustomPreference(body.customPreference);

  const scored = rankValidTimetables(
    timetables,
    weights,
    contexts,
    unmetRequirements,
    graduationStrength,
  ).slice(0, MAX_RECOMMENDATIONS);

  const apiKey = process.env.UPSTAGE_API_KEY;
  if (!apiKey || scored.length === 0) {
    return Response.json({
      recommendations: toRecommendationList(scored, weights, graduationStrength),
      aiExplanationFailed: !apiKey && scored.length > 0,
    });
  }

  try {
    const explanations = await requestRecommendationExplanations(
      scored,
      customPreference,
      apiKey,
    );
    return Response.json({
      recommendations: ensureDistinctReasons(
        applyExplanations(scored, explanations, weights, graduationStrength),
      ),
      aiExplanationFailed: false,
    });
  } catch {
    return Response.json({
      recommendations: toRecommendationList(scored, weights, graduationStrength),
      aiExplanationFailed: true,
    });
  }
}

function toRecommendationList(
  scored: readonly RankedValidTimetable[],
  weights: readonly RecommendationWeight[],
  graduationStrength: GraduationConsiderationStrength,
): TimetableRecommendationItem[] {
  return scored.map((entry, index) => ({
    candidateId: entry.candidateId,
    rank: index + 1,
    ...buildRecommendationCopy(entry, weights, graduationStrength),
    timetable: entry.timetable,
    scoreBreakdown: entry.breakdown,
    reason: null,
    requirementContribution: null,
    customPreferenceNote: null,
  }));
}

function applyExplanations(
  scored: readonly RankedValidTimetable[],
  explanations: readonly SolarExplanation[],
  weights: readonly RecommendationWeight[],
  graduationStrength: GraduationConsiderationStrength,
): TimetableRecommendationItem[] {
  const byId = new Map(explanations.map((item) => [item.candidateId, item]));
  return scored.map((entry, index) => {
    const explanation = byId.get(entry.candidateId);
    const fallback = buildRecommendationCopy(entry, weights, graduationStrength);
    return {
      candidateId: entry.candidateId,
      rank: index + 1,
      name: explanation?.name || fallback.name,
      timetable: entry.timetable,
      scoreBreakdown: entry.breakdown,
      reason: explanation?.reason ?? fallback.reason,
      // 졸업요건 기여도는 각 과목의 교양 영역을 아는 클라이언트가 결정론적으로 계산한다("계산은
      // 코드로") — Solar가 근거 없이 특정 영역(예: DS기반) 충족을 지어내던 문제를 원천 차단.
      requirementContribution: null,
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
            customPreferenceNote: { type: ["string", "null"] },
          },
          required: ["position", "rank", "reason", "customPreferenceNote"],
          additionalProperties: false,
        },
      },
    },
    required: ["explanations"],
    additionalProperties: false,
  },
};

async function requestRecommendationExplanations(
  scored: readonly RankedValidTimetable[],
  customPreference: string | undefined,
  apiKey: string,
): Promise<SolarExplanation[]> {
  const systemPrompt = [
    "You verify two already-valid timetables. Write a concise Korean recommendation reason using only optionalCourses, appliedFilters, graduationRequirementMatches, freeDays, and scoreHighlights supplied below.",
    "Never mention required courses. Do not claim a graduation requirement is completed; say it was considered only when graduationRequirementMatches is non-empty.",
    "당신은 성균관대 시간표 추천 서비스의 설명 엔진입니다.",
    "이미 결정론적으로 정렬된 시간표 후보 목록이 주어집니다.",
    "각 후보에 대해 한국어 2~3문장으로 추천 이유를 작성하세요.",
    "아래 입력(addedCourses, scoreHighlights, customPreference)에 실제로 존재하는",
    "정보만 근거로 쓰세요. 교수의 평판·경력·인기도·학생 선호도·강의평가처럼 입력에 없는 사실은",
    "단정적으로도 추측으로도 절대 언급하지 마세요.",
    "추천 이유(reason)는 학생이 이미 '필수'로 고정한 과목(requiredCourseTitles)이 아니라, 그 위에",
    "추가로 선택·보충된 과목(각 후보의 addedCourses)과 전체 시간표 배치(scoreHighlights: 공강·점심",
    "시간 등)가 왜 좋은지에 초점을 맞춰 쓰세요. 필수 과목 자체의 장단점은 언급하지 마세요.",
    "addedCourses가 비어 있는 후보는 시간표 배치(scoreHighlights)만으로 이유를 쓰세요.",
    "여러 후보가 addedCourses는 같고 과목 1개의 분반(교수)만 다른 경우, 그 후보들 사이의 실질적",
    "차이가 시간표 배치 외에는 없다는 것을 있는 그대로 말하되, 그 후보에서 어느 과목이 어느",
    "분반·교수인지는 반드시 구체적으로 밝혀서 문장 자체는 후보마다 다르게 쓰세요. 근거 없는",
    "차별점을 지어내지 마세요.",
    "서로 다른 candidates(position)에 같은 reason 문장을 그대로 반복하지 마세요. 모든 reason은",
    "그 후보의 실제 addedCourses 과목명·분반(교수)·요일·시간 또는 scoreHighlights 중 최소 하나를",
    "구체적으로 담아 다른 후보의 reason과 문자 그대로 겹치지 않게 쓰세요.",
    '각 원소 형식: {"position": number, "rank": number, "reason": string, "customPreferenceNote": string 또는 null}',
    "position은 입력 candidates 배열에서 그 후보의 1부터 시작하는 순번을 그대로 옮겨 적으세요. 절대 새로 만들지 마세요.",
    "rank는 1부터 후보 개수까지 각각 한 번씩만 사용하세요. customPreference가 없으면 position과 동일한 값을 rank로 사용하세요.",
    "customPreference가 있으면 그 조건에 더 부합하는 후보일수록 낮은 rank(더 상위)를 부여하고, customPreferenceNote에 그 이유를 설명하세요. 없으면 customPreferenceNote는 null로 두세요.",
    "reason에는 scoreHighlights / 사용자 선택 가중치가 실제로 어떻게 만족됐는지 쓰세요.",
    "공강 요일을 언급할 때는 반드시 그 후보의 freeDays 배열에 있는 요일만 말하세요.",
    "freeDays에 없는 요일은 공강이라고 절대 쓰지 마세요 — 그 요일에 수업이 없어 보여도",
    "고정 일정(알바 등)이 있어서 freeDays에서 빠졌을 수 있으니, 스스로 요일을 추론하지 말고",
    "freeDays 배열 값을 그대로만 사용하세요. freeDays가 빈 배열이면 공강 요일이 없다는",
    "뜻이니 공강을 언급하지 마세요.",
    "온라인 수업이 있는 날, 수업 사이 빈 시간, 고정 일정만 있는 날을 공강이라고 쓰지 마세요.",
    "예: freeDays가 [\"화요일\",\"목요일\"]이면 '화요일, 목요일에 공강이 있습니다'처럼 그 요일",
    "이름을 그대로 옮겨 쓰세요. freeDays에 없는 요일을 공강으로 지어내면 안 됩니다.",
    "졸업요건 기여도는 시스템이 따로 계산하므로 reason에 졸업요건 충족 여부는 쓰지 마세요.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    candidates: scored.map((entry, index) => ({
      position: index + 1,
      optionalCourses: entry.context.optionalCourses,
      graduationRequirementMatches: entry.matchedRequirementLabels,
      appliedFilters: entry.breakdown
        .filter((item) => item.weightedScore > 0)
        .map((item) => item.weightId),
      addedCourses: entry.context.optionalCourses,
      // 실제 공강 요일의 사실 근거 — Solar가 스스로 추론하다 틀리는 대신(수업만 없고 고정
      // 일정이 있는 요일을 공강으로 착각하는 등) 이 목록만 그대로 옮겨 쓰게 한다.
      freeDays: getFreeDayLabels(entry.timetable),
      scoreHighlights: entry.breakdown
        .filter((item) => item.weightedScore !== 0)
        .map((item) => ({ weight: item.weightId, weightedScore: item.weightedScore })),
    })),
    customPreference: customPreference ?? null,
  });

  const content = await requestSolarCompletion(
    systemPrompt,
    userPrompt,
    apiKey,
    RECOMMENDATION_EXPLANATION_SCHEMA,
  );
  const explanations = parseSolarExplanations(content, scored);
  // 프롬프트로 못 막은 나머지 경우를 대비한 안전망: 실제 freeDays에 없는 요일을 "공강"이라고
  // 언급한 문장이 나오면(위 지시를 어기고 스스로 추론해버린 경우) 통째로 코드가 만든 문장으로
  // 대체한다 — "그럴듯하지만 틀릴 수 있는 문장"보다 "덜 화려해도 항상 맞는 문장"을 우선한다.
  return sanitizeFreeDayClaims(explanations, scored);
}

const WEEKDAY_KOREAN_NAMES = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];

/** 실제로는 공강이 아닌 요일을 "공강"이라고 주장하는 reason이 있으면 코드가 만든 문장으로 교체. */
function sanitizeFreeDayClaims(
  explanations: readonly SolarExplanation[],
  scored: readonly RankedValidTimetable[],
): SolarExplanation[] {
  const byId = new Map(scored.map((entry) => [entry.candidateId, entry]));
  return explanations.map((explanation) => {
    const entry = byId.get(explanation.candidateId);
    if (!entry) {
      return explanation;
    }
    const freeDays = getFreeDayLabels(entry.timetable);
    if (!reasonClaimsWrongFreeDay(explanation.reason, freeDays)) {
      return explanation;
    }
    return { ...explanation, reason: buildFreeDayFallbackReason(freeDays) };
  });
}

function reasonClaimsWrongFreeDay(reason: string, actualFreeDays: readonly string[]): boolean {
  const freeDaySet = new Set(actualFreeDays);
  return WEEKDAY_KOREAN_NAMES.some((day) => {
    if (freeDaySet.has(day)) {
      return false;
    }
    const dayIndex = reason.indexOf(day);
    if (dayIndex === -1) {
      return false;
    }
    const window = reason.slice(Math.max(0, dayIndex - 12), dayIndex + day.length + 12);
    return window.includes("공강");
  });
}

function buildFreeDayFallbackReason(freeDays: readonly string[]): string {
  return freeDays.length > 0
    ? `${freeDays.join(", ")}에 공강이 있고, 선택하신 조건에 맞게 정렬된 시간표입니다.`
    : "선택하신 조건에 맞게 정렬된 시간표입니다.";
}

function parseSolarExplanations(
  content: string,
  scored: readonly RankedValidTimetable[],
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
      name: null,
      reason: entry.reason.trim(),
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
  // fixedEvents(알바 등 고정 일정)는 free_days/lunch_break/back_to_back/daily_span 채점에 실제로
  // 영향을 준다 — 수업이 없어도 고정 일정이 있으면 그 요일은 공강이 아니다(timetable-scoring.ts
  // 참고). 예전엔 "채점에 영향 없다"고 보고 빼버려서, 수업만 없고 실은 고정 일정이 있는 요일을
  // AI 추천 근거가 공강이라고 잘못 말하는 버그의 실제 원인이었다. 형식이 안 맞는 개별 항목만
  // 건너뛴다(fixedEvents 자체가 없는 요청도 계속 정상 동작해야 하므로 전체를 거부하지 않음).
  const fixedEvents: FixedEvent[] = Array.isArray(value.fixedEvents)
    ? value.fixedEvents.flatMap((entry) => {
        const parsed = parseFixedEvent(entry);
        return parsed ? [parsed] : [];
      })
    : [];
  return { courses, meetings, fixedEvents };
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

function parseFixedEvent(value: unknown): FixedEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.day !== "string" ||
    !WEEKDAY_SET.has(value.day as Weekday) ||
    typeof value.startMinutes !== "number" ||
    typeof value.endMinutes !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    day: value.day as Weekday,
    startMinutes: value.startMinutes,
    endMinutes: value.endMinutes,
  };
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
      typeof entry.importance !== "number" ||
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
  const lunchStartMinutes =
    typeof value.lunchStartMinutes === "number" ? value.lunchStartMinutes : undefined;
  const lunchEndMinutes =
    typeof value.lunchEndMinutes === "number" ? value.lunchEndMinutes : undefined;
  const format = value.format === "in_person" || value.format === "online" ? value.format : undefined;
  const packing = value.packing === "compact" || value.packing === "spread" ? value.packing : undefined;
  const preferredFreeDays = parsePreferredFreeDays(value.preferredFreeDays);
  if (
    thresholdMinutes === undefined &&
    direction === undefined &&
    lunchStartMinutes === undefined &&
    lunchEndMinutes === undefined &&
    format === undefined &&
    packing === undefined &&
    preferredFreeDays === undefined
  ) {
    return undefined;
  }
  return {
    thresholdMinutes,
    direction,
    lunchStartMinutes,
    lunchEndMinutes,
    format,
    packing,
    preferredFreeDays,
  };
}

function parsePreferredFreeDays(value: unknown): Weekday[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<Weekday>(["mon", "tue", "wed", "thu", "fri"]);
  const days = value.filter((entry): entry is Weekday =>
    typeof entry === "string" && allowed.has(entry as Weekday),
  );
  return days;
}

/** Accepts only metadata for candidate schedules supplied by the active browser session. */
function parseRecommendationContexts(
  value: unknown,
  timetables: readonly Timetable[],
): ValidTimetableRecommendationContext[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const knownCandidateIds = new Set(
    timetables.map((timetable) => timetable.courses.map((course) => course.id).sort().join("|")),
  );
  const contexts: ValidTimetableRecommendationContext[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.candidateId !== "string" || seen.has(entry.candidateId)) {
      continue;
    }
    if (!knownCandidateIds.has(entry.candidateId) || !Array.isArray(entry.optionalCourses)) {
      continue;
    }
    const optionalCourses = entry.optionalCourses.flatMap((course) => {
      if (
        !isRecord(course) ||
        typeof course.title !== "string" ||
        typeof course.classification !== "string" ||
        (course.scope !== "general" && course.scope !== "major")
      ) {
        return [];
      }
      return [{
        title: course.title.slice(0, 120),
        classification: course.classification.slice(0, 120),
        scope: course.scope as "general" | "major",
      }];
    });
    seen.add(entry.candidateId);
    contexts.push({ candidateId: entry.candidateId, optionalCourses });
  }
  return contexts;
}

function parseUnmetRequirements(value: unknown): UnmetGraduationRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedScopes = new Set([
    "primary_major",
    "secondary_major",
    "general",
    "ds",
    "university",
    "other",
  ]);
  const requirements: UnmetGraduationRequirement[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.scope !== "string" ||
      !allowedScopes.has(entry.scope) ||
      typeof entry.label !== "string"
    ) {
      continue;
    }
    const label = entry.label.trim().slice(0, 160);
    const key = `${entry.scope}:${label}`;
    if (!label || seen.has(key)) {
      continue;
    }
    seen.add(key);
    requirements.push({
      scope: entry.scope as UnmetGraduationRequirement["scope"],
      label,
    });
  }
  return requirements;
}

function parseGraduationStrength(value: unknown): GraduationConsiderationStrength {
  return value === "weak" || value === "strong" ? value : "none";
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
