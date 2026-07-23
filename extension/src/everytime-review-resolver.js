(() => {
  "use strict";

  const context = readContext();
  const matcher = globalThis.SkkuTimetableReviewMatch;
  if (!context || !matcher) {
    return;
  }

  let settled = false;
  let needsSelectionReported = false;
  let lastSignature = "";
  let stableReads = 0;
  let attempts = 0;
  const timeout = window.setInterval(() => {
    attempts += 1;
    const entries = collectEntries();
    const signature = entries.map((entry) => entry.id).join(",");
    stableReads = signature && signature === lastSignature ? stableReads + 1 : 0;
    lastSignature = signature;
    if (entries.length > 0 && stableReads >= 2) {
      window.clearInterval(timeout);
      resolve(entries);
    } else if (attempts >= 35) {
      window.clearInterval(timeout);
      finish("not-found", "에타 검색 결과를 찾지 못했어요. 로그인 상태를 확인해 주세요.");
    }
  }, 300);

  document.addEventListener(
    "click",
    (event) => {
      if (settled) {
        return;
      }
      const anchor = event.target instanceof Element
        ? event.target.closest('a[href*="/lecture/view/"]')
        : null;
      const entry = anchor ? toEntry(anchor) : null;
      if (!entry) {
        return;
      }
      finish("resolved", "선택한 강의평을 기억했어요.", entry);
    },
    true,
  );

  function resolve(entries) {
    const choice = matcher.chooseReviewAnchor(context.course, entries);
    if (choice.kind === "auto") {
      finish("resolved", "과목·교수명이 일치하는 강의평을 찾았어요.", choice.entry);
      window.location.replace(choice.entry.href);
      return;
    }
    if (choice.kind === "choose") {
      highlight(choice.entries);
      reportNeedsSelection("동일한 과목이 여러 개예요. 에타 탭에서 교수명을 확인해 선택해 주세요.");
      return;
    }
    finish("not-found", "과목·교수명이 일치하는 강의평을 찾지 못했어요.");
  }

  function collectEntries() {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="/lecture/view/"]'))
      .map(toEntry)
      .filter(Boolean)
      .filter((entry) => {
        if (seen.has(entry.id)) {
          return false;
        }
        seen.add(entry.id);
        return true;
      });
  }

  function toEntry(anchor) {
    const match = (anchor.getAttribute("href") || anchor.href || "").match(/\/lecture\/view\/(\d+)/);
    if (!match) {
      return null;
    }
    let container = anchor;
    let text = anchor.textContent || "";
    for (let level = 0; level < 4 && container.parentElement; level += 1) {
      const parent = container.parentElement;
      if (parent.querySelectorAll('a[href*="/lecture/view/"]').length > 1) {
        break;
      }
      container = parent;
      text = container.textContent || text;
    }
    return { id: match[1], href: anchor.href, text, anchor, container };
  }

  function highlight(entries) {
    const banner = document.createElement("aside");
    banner.textContent = "SKKU-DULE: 교수명·강의명을 확인해 맞는 항목을 선택하면 다음부터 바로 연결됩니다.";
    banner.setAttribute(
      "style",
      "position:sticky;top:8px;z-index:9999;margin:8px;padding:10px 12px;border:1px solid #2a7a5b;border-radius:8px;background:#edf8f2;color:#14543d;font-size:13px;font-weight:700;",
    );
    document.body.prepend(banner);
    entries.forEach((entry) => {
      entry.container.style.outline = "2px solid #2a7a5b";
      entry.container.style.outlineOffset = "2px";
    });
  }

  function finish(status, message, entry) {
    if (settled) {
      return;
    }
    settled = true;
    chrome.runtime.sendMessage({
      type: "skku-timetable:resolver-result",
      requestId: context.requestId,
      originTabId: context.originTabId,
      batchId: context.batchId,
      mapKey: context.mapKey,
      status,
      message,
      ...(entry ? { url: entry.href } : {}),
    });
  }

  function reportNeedsSelection(message) {
    if (settled || needsSelectionReported) {
      return;
    }
    // Do not mark the resolver settled here: the user's later click on one highlighted result
    // must still store its URL for future direct links.
    needsSelectionReported = true;
    chrome.runtime.sendMessage({
      type: "skku-timetable:resolver-result",
      requestId: context.requestId,
      originTabId: context.originTabId,
      batchId: context.batchId,
      mapKey: context.mapKey,
      status: "needs-selection",
      message,
    });
  }

  function readContext() {
    const encoded = new URLSearchParams(location.hash.slice(1)).get("skku-timetable");
    if (!encoded) {
      return null;
    }
    try {
      const value = JSON.parse(decodeURIComponent(encoded));
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.requestId !== "string" ||
        typeof value.originTabId !== "number" ||
        typeof value.mapKey !== "string" ||
        !value.course ||
        typeof value.course.courseName !== "string"
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }
})();
