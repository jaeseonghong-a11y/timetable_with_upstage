/* global globalThis */
// This file deliberately handles only navigation metadata (course title, professor and a
// /lecture/view/{id} anchor). It never reads a review's body, rating or comments.
(function attachReviewMatcher(root) {
  "use strict";

  function normalize(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function primaryProfessor(value) {
    return normalize(String(value || "").split(/[,/·]/)[0]);
  }

  function chooseReviewAnchor(course, entries) {
    const title = normalize(course.courseName);
    const professor = primaryProfessor(course.professor);
    const scored = entries
      .map((entry) => {
        const text = normalize(entry.text);
        const titleMatches = Boolean(title) && text.includes(title);
        const professorMatches = Boolean(professor) && text.includes(professor);
        return {
          ...entry,
          titleMatches,
          professorMatches,
          score: (titleMatches ? 10 : 0) + (professorMatches ? 20 : 0),
        };
      })
      .filter((entry) => entry.titleMatches || entry.professorMatches);

    const exact = scored.filter((entry) => entry.titleMatches && entry.professorMatches);
    if (exact.length === 1) {
      return { kind: "auto", entry: exact[0] };
    }

    // When SKKU did not provide a professor, title-only matching is allowed only if there is a
    // single candidate. Guessing between two same-titled lectures is worse than asking once.
    const titleOnly = scored.filter((entry) => entry.titleMatches);
    if (!professor && titleOnly.length === 1) {
      return { kind: "auto", entry: titleOnly[0] };
    }

    const candidates = exact.length > 1 ? exact : titleOnly.length > 0 ? titleOnly : scored;
    if (candidates.length > 0) {
      return { kind: "choose", entries: candidates };
    }
    return { kind: "none", entries: [] };
  }

  root.SkkuTimetableReviewMatch = { chooseReviewAnchor, normalize, primaryProfessor };
})(globalThis);
