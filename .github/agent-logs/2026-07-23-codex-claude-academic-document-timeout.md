# 2026-07-23 — Claude 학사문서 장시간 분석 보강 인수·검증

## 반영한 변경

- 학사문서 분석 API에 `maxDuration = 300`을 선언해 큰 복수전공 수강/취득 문서의
  Document Parse·Solar 재시도 체인에 필요한 Vercel 함수 실행 한도를 명시했다.
- 첫 추출에서 수강 과목이 빠져 Solar 재시도할 때, Document Parse Markdown 전체 대신
  `<table>...</table>` 블록만 보내도록 했다. 과목 행을 보존하면서 긴 문서의 재시도 프롬프트와
  지연을 줄인다. HTML 표가 없는 pipe-markdown 형식은 원문 전체를 유지한다.
- 분석 중 화면에 긴 복수전공 문서는 수 분 걸릴 수 있다는 안내를 추가했다.

## 검증

- `npm.cmd run lint` 통과.
- `npm.cmd run typecheck` 통과.
- `npm.cmd run test` 통과: 28개 파일, 232개 테스트.
- `npm.cmd run build` 통과.

## 제외

- API 키·개인 문서 원본·전체 Parse Markdown을 저장하거나 반환하지 않았다.
- 실제 사용자 문서로 300초 한도를 재현하는 부하 테스트는 실행하지 않았다.
