# 2026-07-23 — Friend timetable remix

## Implemented

- Added the independent `/friends/remix` route. It reads the already-saved local friend-code
  pointers through `friend-list-storage`, then fetches only the existing
  `/api/friend-timetable/[code]` endpoint in the browser.
- Added a dark, visually separate remix UI with friend target, together/opposite mode,
  general-only/general+major scope, and strong/weak strength controls.
- Strength is disabled without a confirmed graduation-requirements profile. A small module-memory
  bridge receives only `{ scope, status, label }`; it uses neither `localStorage` nor
  `sessionStorage`, so a browser reload clears it with the wizard state.
- Reused the existing pure selection-plan generator. A remix plan uses the viewer's course count
  and the union of both schedules; same course number with different sections is represented as
  one subject with alternative sections.
- Added isolated scoring for together/opposite × strong/weak. Matching is exact normalized
  `courseNumber`, which intentionally treats different sections as the same course. Weak scoring
  reuses `areaMatchesUnmetLabels` for unmet-area matching.
- Reused the existing `/friends` navigation gate: the remix link appears only after both the
  viewer timetable and at least one friend timetable are loaded.
- Preserved the existing manual graduation-requirement flow. Its requirement-name input is needed
  for a manually added row to be confirmable and for the in-memory summary to carry a useful area
  label.

## Deliberately not done

- No new API route, no server persistence, no server-side timetable fetch, and no modification to
  recommendation scoring, `ai-filler-selection.ts`, `selection-plan.ts`, or the timetable
  recommendation API route.
- No commit, push, or deployment command was run by this session. During parallel worktree sync,
  the core feature appeared as commit `56ac4ac`; this log and `CURRENT_STATE.md` remain
  uncommitted.
- The remix does not claim to be an AI recommendation; it is a local, deterministic, playful
  variation based on two already shared timetables.

## Verification

- `web`: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test`, and `npm.cmd run build`
  all passed (29 test files / 237 tests). Production build contains `/friends/remix`.
- Local production server: `npm.cmd run start -- -p 3001`; `/friends/remix` returned HTTP 200.
- Chrome DevTools / local production verification used test-only intercepted responses for the
  already-existing friend timetable GET endpoint; no test data reached the real service.
  - Confirmed a manual `균형교양` unmet requirement through STEP 2-2, navigated via the actual
    `/friends` link, then via the gated remix link. The strength fieldset was enabled (`0`
    disabled fieldsets) and showed “미충족 영역 1개”; a physical click on “시간표 만들기” rendered
    four valid result cards with no error.
  - In 430px mobile emulation without a confirmed profile, the strength fieldset was disabled
    (`1` disabled fieldset). A physical click still rendered four result cards, and the page width
    remained `430/430px`; the wide timetable grid stayed inside its own horizontal viewport.

## Worktree note

- A parallel worktree reset removed the first uncommitted copy of the new remix files while this
  task was being verified. The core task files were then present in `56ac4ac`; the final quality
  gate was rerun against that state without touching parallel planner work.
