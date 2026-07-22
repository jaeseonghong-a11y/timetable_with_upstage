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
- 커밋, push, Vercel 배포는 실행하지 않았다.
- 다른 도구가 병행 작업 중인 학사문서 수동입력 관련 미커밋 변경은 건드리지 않았다.
