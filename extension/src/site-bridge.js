(() => {
  "use strict";

  const REQUEST_EVENT = "skku-timetable:connector-request";
  const RESPONSE_EVENT = "skku-timetable:connector-response";
  const READY_ATTRIBUTE = "data-skku-timetable-connector";
  const MAX_BATCH_SIZE = 12;

  document.documentElement.setAttribute(READY_ATTRIBUTE, "ready");

  window.addEventListener(REQUEST_EVENT, (event) => {
    const request = sanitizeRequest(event.detail);
    if (!request) {
      return;
    }
    chrome.runtime.sendMessage({ type: "skku-timetable:request", ...request }, (response) => {
      if (chrome.runtime.lastError) {
        dispatchStatus(request.requestId, "failed", "확장프로그램에 연결하지 못했어요.");
        return;
      }
      if (response && typeof response.status === "string") {
        dispatchStatus(request.requestId, response.status, response.message);
      }
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "skku-timetable:status") {
      return;
    }
    dispatchStatus(message.requestId, message.status, message.message);
  });

  function dispatchStatus(requestId, status, message) {
    if (typeof requestId !== "string" || typeof status !== "string") {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, { detail: { requestId, status, ...(message ? { message } : {}) } }),
    );
  }

  function sanitizeRequest(value) {
    if (!value || typeof value !== "object" || value.version !== 1 || typeof value.requestId !== "string") {
      return null;
    }
    if (value.type === "open-review") {
      const course = sanitizeCourse(value.course);
      return course ? { requestId: value.requestId, action: "open-review", course } : null;
    }
    if (value.type === "resolve-review-batch" && Array.isArray(value.courses)) {
      const courses = value.courses.map(sanitizeCourse).filter(Boolean).slice(0, MAX_BATCH_SIZE);
      return courses.length ? { requestId: value.requestId, action: "resolve-review-batch", courses } : null;
    }
    return null;
  }

  function sanitizeCourse(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const read = (key) => (typeof value[key] === "string" ? value[key].trim().slice(0, 120) : "");
    const courseName = read("courseName");
    if (!courseName) {
      return null;
    }
    return {
      courseNumber: read("courseNumber"),
      courseName,
      professor: read("professor"),
      section: read("section"),
    };
  }
})();
