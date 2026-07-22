const REVIEW_MAP_KEY = "reviewLinkMap";
const BATCH_PREFIX = "reviewBatch:";
const MAX_BATCH_SIZE = 12;
const BATCH_DELAY_MS = 1_100;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "skku-timetable:request" || !sender.tab?.id) {
    return;
  }
  if (message.action === "open-review" && isCourse(message.course)) {
    sendResponse({ status: "accepted" });
    void openReview(message.requestId, sender.tab.id, message.course);
    return;
  }
  if (message.action === "resolve-review-batch" && Array.isArray(message.courses)) {
    const courses = message.courses.filter(isCourse).slice(0, MAX_BATCH_SIZE);
    if (courses.length === 0) {
      sendResponse({ status: "failed", message: "연결할 과목 정보가 없습니다." });
      return;
    }
    sendResponse({ status: "accepted" });
    void startBatch(message.requestId, sender.tab.id, courses);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "skku-timetable:resolver-result" || !sender.tab?.id) {
    return;
  }
  if (!isResolverResult(message)) {
    return;
  }
  void handleResolverResult(message, sender.tab.id);
});

async function openReview(requestId, originTabId, course) {
  const map = await readReviewMap();
  const url = map[courseKey(course)];
  if (url) {
    await chrome.tabs.create({ url, active: true });
    notify(originTabId, requestId, "direct", "저장된 에타 강의평을 열었어요.");
    return;
  }
  const searchUrl = makeResolverUrl(course, { requestId, originTabId });
  await chrome.tabs.create({ url: searchUrl, active: true });
  notify(originTabId, requestId, "matching", "에타에서 과목·교수명을 확인하는 중이에요.");
}

async function startBatch(requestId, originTabId, courses) {
  const map = await readReviewMap();
  const deduped = dedupeCourses(courses);
  const alreadyMapped = deduped.filter((course) => Boolean(map[courseKey(course)]));
  const queue = deduped.filter((course) => !map[courseKey(course)]);
  await chrome.storage.session.set({
    [batchStorageKey(requestId)]: {
      requestId,
      originTabId,
      queue,
      active: null,
      resolved: alreadyMapped.length,
      needsSelection: 0,
      notFound: 0,
    },
  });
  notify(originTabId, requestId, "matching", `${deduped.length}개 과목을 순서대로 연결하고 있어요.`);
  await processNextBatchItem(requestId);
}

async function processNextBatchItem(requestId) {
  const state = await readBatch(requestId);
  if (!state || state.active) {
    return;
  }
  const course = state.queue.shift();
  if (!course) {
    await chrome.storage.session.remove(batchStorageKey(requestId));
    const unresolved = state.needsSelection + state.notFound;
    const message = unresolved
      ? `자동 연결 ${state.resolved}개 완료 · ${unresolved}개는 에타 탭에서 확인해 주세요.`
      : `${state.resolved}개 과목의 강의평 연결을 마쳤어요.`;
    notify(state.originTabId, requestId, "complete", message);
    return;
  }
  const tab = await chrome.tabs.create({
    url: makeResolverUrl(course, { requestId, originTabId: state.originTabId, batchId: requestId }),
    active: false,
  });
  state.active = { course, tabId: tab.id };
  await writeBatch(state);
}

async function handleResolverResult(result, tabId) {
  if (result.status === "resolved" && result.url) {
    const map = await readReviewMap();
    map[result.mapKey] = result.url;
    await chrome.storage.local.set({ [REVIEW_MAP_KEY]: map });
  }

  if (!result.batchId) {
    notify(
      result.originTabId,
      result.requestId,
      result.status === "resolved" ? "direct" : result.status === "needs-selection" ? "needs-selection" : "not-found",
      result.message,
    );
    return;
  }

  const state = await readBatch(result.batchId);
  if (!state || !state.active || state.active.tabId !== tabId) {
    return;
  }
  if (result.status === "resolved") {
    state.resolved += 1;
    // Batch matching only prepares future direct links. Close an automatically resolved background
    // tab so one batch does not leave a dozen review tabs open.
    await chrome.tabs.remove(tabId).catch(() => undefined);
  } else if (result.status === "needs-selection") {
    state.needsSelection += 1;
  } else {
    state.notFound += 1;
  }
  state.active = null;
  await writeBatch(state);
  setTimeout(() => void processNextBatchItem(result.batchId), BATCH_DELAY_MS);
}

function makeResolverUrl(course, context) {
  const url = new URL("https://everytime.kr/lecture/search");
  url.searchParams.set("keyword", course.courseName);
  url.searchParams.set("condition", "name");
  url.hash = `skku-timetable=${encodeURIComponent(JSON.stringify({ ...context, course, mapKey: courseKey(course) }))}`;
  return url.toString();
}

async function readReviewMap() {
  const stored = await chrome.storage.local.get(REVIEW_MAP_KEY);
  return stored[REVIEW_MAP_KEY] && typeof stored[REVIEW_MAP_KEY] === "object" ? stored[REVIEW_MAP_KEY] : {};
}

async function readBatch(requestId) {
  const stored = await chrome.storage.session.get(batchStorageKey(requestId));
  const value = stored[batchStorageKey(requestId)];
  return value && typeof value === "object" ? value : null;
}

async function writeBatch(state) {
  await chrome.storage.session.set({ [batchStorageKey(state.requestId)]: state });
}

function batchStorageKey(requestId) {
  return `${BATCH_PREFIX}${requestId}`;
}

function courseKey(course) {
  const code = normalize(course.courseNumber) || normalize(course.courseName);
  return `${code}|${normalize(course.professor)}`;
}

function dedupeCourses(courses) {
  const seen = new Set();
  return courses.filter((course) => {
    const key = courseKey(course);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function isCourse(value) {
  return Boolean(value && typeof value === "object" && typeof value.courseName === "string" && value.courseName.trim());
}

function isResolverResult(value) {
  return (
    typeof value.requestId === "string" &&
    typeof value.originTabId === "number" &&
    typeof value.mapKey === "string" &&
    typeof value.status === "string" &&
    (!value.url || typeof value.url === "string")
  );
}

function notify(tabId, requestId, status, message) {
  void chrome.tabs.sendMessage(tabId, {
    type: "skku-timetable:status",
    requestId,
    status,
    ...(message ? { message } : {}),
  }).catch(() => undefined);
}
