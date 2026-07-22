# Timetable review access cleanup — 2026-07-23

## 이번에 한 일

- `TimetableCard`의 캘린더 아래 과목별 강의평 버튼 모음을 제거했다.
- 캘린더 바로 위에 과목 블록을 누르면 에브리타임 강의평이 열린다는 짧은 안내를 추가했다.
- 기존 캘린더 과목 블록과 I-Campus 과목 칩의 클릭 연결 및 상태 메시지는 유지했다.

## 검증 결과

- `cd web && npm.cmd run lint && npm.cmd run typecheck && npm.cmd run test && npm.cmd run build` 통과.
- Vitest: 29개 테스트 파일, 237개 테스트 통과.

## 의도적으로 하지 않은 것

- 강의평 검색·확장프로그램 매칭 로직과 시간표 조합 로직은 수정하지 않았다.
- 다른 도구가 병행 작업 중인 학사문서 수동입력 관련 미커밋 변경은 건드리지 않았다.

## 후속 배포 기록

- 사용자 요청으로 수동 졸업요건 입력 변경과 함께 `b8fcf5f`로 커밋해 `origin/main`에 푸시했다.
- 루트에서 `npx.cmd vercel deploy --prod --yes`를 실행했다. PowerShell 실행 정책 때문에
  `npx` 대신 `npx.cmd`를 사용했다.
- 배포 `dpl_5d3rHpDENJYBXaxBknGxDbE4t4Sr`는 `Ready`이며, 운영 주소는 HTTP 200으로 확인했다.
