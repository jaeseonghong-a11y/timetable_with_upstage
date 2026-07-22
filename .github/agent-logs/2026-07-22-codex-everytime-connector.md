# 2026-07-22 — 에타 강의평 Connector 확장프로그램

## 구현

- `extension/`에 Manifest V3 기반 Chromium 보조 확장프로그램을 추가했다.
- 웹앱의 과목 분반·선택 과목·생성 시간표에 `에타 강의평 보기`를 연결했다.
- 확장프로그램이 있을 때만 과목명·학수번호·교수명으로 에타 검색 결과의 `lecture/view/{id}`
  이동 URL을 로컬 캐시한다. 다음 클릭은 캐시된 URL을 바로 연다.
- 여러 후보가 나오면 추측하지 않고 에타 페이지에서 사용자가 선택하게 하며, 그 선택만 기억한다.
- 사용자가 담은 과목은 최대 12개를 순차 연결할 수 있다. 강의평 본문·별점·댓글·로그인 쿠키와
  비공개 API에는 접근하지 않고, 매핑은 서버로 보내지 않는다.

## 검증

- `extension`: `npm.cmd test` 3개 통과, `node --check` 및 매니페스트 JSON 파싱 통과.
- `web`: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test`(28 files/229 tests),
  `npm.cmd run build` 모두 통과.
- 확장프로그램을 로드한 Chrome 런타임 실측은 이 자동화 환경이 `Start-Process`로 새 Chrome을
  실행하는 것을 차단해 수행하지 못했다. 실제 Chrome/Edge/Whale에서 압축해제 로드 후 에타
  로그인 상태로 확인해야 한다.

## 의도적 제외

- GLS 책가방 쓰기·에타 시간표 내보내기는 구현하지 않았다. 인증 뒤 시스템을 자동 조작하거나
  비공개 API를 쓰는 범위라 별도 정책·실사용 검증이 필요하다.
