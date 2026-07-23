# 2026-07-23 Codex — 친구 시간표 리믹스 응답 형식 오류 수정

## 문제 상황

- 친구 시간표 리믹스 화면에서 내 시간표와 친구 시간표를 불러올 때 `시간표 응답 형식이 올바르지 않습니다.`가 반복 표시됐다.

## 원인과 해결

- 기존 공유 시간표는 필수 과목 메타데이터가 도입되기 전에 생성돼 API가 `requiredCourseIds: null`을 반환한다.
- 이는 서버가 의도한 정상 레거시 응답이지만, 리믹스 전용 파서가 `null`을 배열이 아닌 잘못된 형식으로 판정해 거부하고 있었다.
- `friend-remix-data.ts`가 `null`과 누락 값을 정상 레거시 상태로 읽도록 수정했다.
- 실제 배열이면서 문자열 이외의 값을 포함하는 경우는 계속 거부한다.
- 레거시 공유본은 이제 화면에 정상 표시되며, 리믹스를 만들 때만 필수 과목 기준이 없다는 안내와 재저장 안내가 나타난다.

## 변경 파일

- `web/src/lib/friend-remix-data.ts`
- `web/src/lib/friend-remix-data.test.ts`

## 검증

- `cd web; npm.cmd run lint`
- `cd web; npm.cmd run typecheck`
- `cd web; npm.cmd run test` — 35 files, 260 tests passed
- `cd web; npm.cmd run build`
- `git diff --check`

## 의도적으로 하지 않은 것

- 기존 공유 시간표 데이터를 서버에서 변경하거나, 서버 저장 구조를 새 버전으로 마이그레이션하지 않았다.
- 커밋·푸시·배포는 하지 않았다.
