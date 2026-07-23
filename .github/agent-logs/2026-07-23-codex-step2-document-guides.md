# 2026-07-23 — STEP 2 문서 안내·예시 정리

## 이번에 한 일

- STEP 2-1 수강/취득과목과 STEP 2-2 졸업요건충족현황에 공통으로 쓰는 접기/펼치기 패널을 추가했다.
  - `개인정보 수집 및 이용 동의`: 기본적으로 닫혀 있고, 열면 기존 수집 목적·항목·보유 기간·거부권 및 동의 체크박스가 보인다.
  - `어디서 받나요?`: GLS 발급 경로, GLS 바로가기, 제공받은 안내 PDF의 작은 미리보기와 새 창으로 크게 보는 링크를 보인다.
  - `예시 이미지 보기`: 제공받은 예시 PDF를 280px 이하(모바일 220px)의 작은 미리보기로 보이고, 크게 보는 링크를 제공한다.
- 제공받은 원본 PDF 4개를 수정하지 않고 `web/public/step2-guides/`에 앱 정적 자산으로 복사했다.
  - 수강/취득과목: `course-history-guide.pdf`, `course-history-example.pdf`
  - 졸업요건충족현황: `graduation-requirements-guide.pdf`, `graduation-requirements-example.pdf`
- 아코디언은 한 번에 하나만 열리므로 처음 화면은 밀집되어 보이고, 다른 문서 종류 탭으로 바꾸면 열린 패널도 닫힌다. 개인정보 동의 상태 자체는 유지된다.

## 검증

- `cd web && npm.cmd run lint` 통과
- `cd web && npm.cmd run typecheck` 통과
- `cd web && npm.cmd run test` 통과 — 32개 테스트 파일, 249개 테스트
- `cd web && npm.cmd run build` 통과
- 로컬 production 서버(`npm.cmd run start -- --hostname 127.0.0.1 --port 3012`)에서 아래 4개 자산이 모두 `200 OK`, `Content-Type: application/pdf`로 제공되는 것을 확인했다.
  - `/step2-guides/course-history-guide.pdf`
  - `/step2-guides/course-history-example.pdf`
  - `/step2-guides/graduation-requirements-guide.pdf`
  - `/step2-guides/graduation-requirements-example.pdf`

## 의도적으로 하지 않은 것

- 학사문서 업로드·Document Parse·Solar 분석 API 및 개인정보 처리 흐름은 변경하지 않았다.
- 제공받은 PDF를 외부 서비스에 업로드하거나 이미지로 재가공하지 않았다.
- 기존 미커밋 변경을 커밋·푸시·배포하지 않았다.
