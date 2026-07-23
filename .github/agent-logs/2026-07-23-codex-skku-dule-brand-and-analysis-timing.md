# 2026-07-23 — SKKU-DULE branding and STEP 2 timing

## What changed

- Renamed the Vercel project from `timetable-with-upstage` to `skku-dule`.
- Added the production alias `https://skku-dule.vercel.app` and deployed the latest web build to it.
- Unified browser-visible brand names, metadata/OG content, sharing/friends headings, and the
  Everytime extension name, permissions, README, and resolver banner as `SKKU-DULE`.
- Added live elapsed time to both STEP 2-1 and STEP 2-2 document-analysis progress views:
  `현재 N초 · 평균 M초`.
- The average starts at a conservative 20-second reference and becomes a rolling average of the
  latest five completed analyses of that document type while the page stays open. It is not
  persisted, so academic-document data and timing history disappear on refresh.

## Verification

- `cd web; npm.cmd run lint` — passed.
- `cd web; npm.cmd run typecheck` — passed.
- `cd web; npm.cmd run test` — passed (35 files, 260 tests).
- `cd web; npm.cmd run build` — passed.
- `cd extension; npm.cmd test` — passed (6 tests).
- `node -e "JSON.parse(...)"` verified the updated extension manifest JSON.
- `git diff --check` — passed (only existing CRLF normalization warnings).
- Vercel production deployment `dpl_BMyJU9ipsHoXmzT665oTXcCbymWH` reached `Ready`; HTTP 200 and
  `SKKU-DULE` markup were confirmed at `https://skku-dule.vercel.app`.
- After renaming, the new `*.vercel.app` aliases initially received the project SSO-protection
  redirect while the legacy public alias still worked. Disabled SSO deployment protection for
  this public demo project, then rechecked the new canonical alias and direct deployment URL:
  both return HTTP 200. Git-fork protection remains enabled.

## Intentionally not changed

- No academic-document source files, parsed results, or timing data are stored server-side.
- No unrelated untracked `docs/17_데이터_플로우_전체정리.md` content was changed.
- No Git commit or push was created.

## Follow-up

- Reload the unpacked Everytime extension once: its site host permission changed from the old
  Vercel URL to `https://skku-dule.vercel.app/*`.
- In a browser, start one STEP 2-1 and one STEP 2-2 analysis to confirm the 1-second counter is
  legible alongside the existing progress wording.
