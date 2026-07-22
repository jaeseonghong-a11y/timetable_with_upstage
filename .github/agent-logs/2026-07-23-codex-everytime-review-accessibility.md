# 2026-07-23 — 에타 강의평 검색 우선순위·시간표 접근성 보강

## 구현

- 웹 폴백과 확장프로그램 resolver 모두 교수명이 공백이 아니면
  `keyword={교수명}&condition=professor`, 아니면 기존 과목명 검색
  `keyword={과목명}&condition=name`을 사용하게 했다.
- 검색 결과 매처는 그대로 과목명과 교수명을 모두 대조한다. 교수 한 명이 여러 과목을 맡은 검색
  결과에서는 목표 과목 하나만 자동 선택하고, 같은 과목·교수가 여러 개면 기존처럼
  `needs-selection`으로 사용자에게 선택을 맡긴다.
- “담은 과목 확인”의 강의평 버튼을 접히는 분반 설정 바깥으로 옮겨, 카드가 접혀 있어도 항상
  보이게 했다.
- 생성 시간표의 수업 블록과 I-Campus 칩을 실제 `button`으로 바꿨다. 클릭하면 기존 강의평
  버튼과 같은 브리지 경로(확장프로그램이 있으면 로컬 매칭, 없으면 에타 검색 새 탭)를 사용하고,
  결과 상태는 강의평 영역에 표시한다.

## 검증

- `extension`: `npm.cmd test` 6개 통과. 교수명/과목명 URL 분기, resolver hash 보존, 교수 검색
  결과의 단일 목표 자동 선택과 중복 목표 `needs-selection`을 검증했다.
- `extension`: 모든 스크립트 `node --check`, Manifest JSON 파싱 통과.
- `web`: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test`(28개 파일/230개),
  `npm.cmd run build` 모두 통과.
- 로컬 production 서버는 정상 기동·종료했다. Chromium을 별도 임시 프로필로 기동해
  압축해제 확장프로그램 런타임을 확인하려 했지만, 이 자동화 환경이 Chrome `Start-Process`를
  정책상 차단했다. 기존 Chrome도 DevTools 원격 디버그 포트를 열고 있지 않아 로그인된 사용자
  세션을 안전하게 자동 조작할 수 없었다.

## 의도적으로 제외

- 에타 비공개 API, 로그인 쿠키, 강의평 본문·별점·댓글의 호출·수집·저장·캐싱은 추가하지 않았다.
- 커밋, push, Vercel 배포는 하지 않았다.
