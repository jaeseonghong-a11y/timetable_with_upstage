# CURRENT_STATE.md — 세션 인수인계 상태판

> **이 파일은 Codex ↔ Claude Code 가 서로에게 넘기는 "인수인계 메모"다.**
> 한 도구가 작업을 멈출 때 이 파일을 최신화하고, 다른 도구는 이 파일 + git diff 를 읽고 이어받는다.
> 두 도구의 대화 세션은 서로 독립적이므로, **맥락은 대화가 아니라 이 파일로 전달된다.**
>
> ⚠️ 규칙: 작업을 멈추는 도구가 **반드시** 이 파일을 갱신하고 멈춘다. 갱신 없이 멈추면 다음 도구가 길을 잃는다.

---

## 📌 지금 상태 (마지막 갱신: 2026-07-13 / 갱신한 도구: Claude Code)

### 프로젝트 한 줄
성균관대 시간표 조합 추천 서비스. Upstage Document Builders Challenge 출품작 (데모데이 2026-07-25).
강의계획서 PDF를 Upstage Parse로 읽어 "학기 부담까지 예측하는" 시간표 추천이 핵심 차별점.

### 지금 어느 단계인가
**현재 작업:** Phase 2(수집기 구현) 핵심 로직 완료 — SSV 파서·학과코드·API 클라이언트 전부 라이브
검증까지 통과 (경영학과 실데이터 수신 확인). P3-a 블로커 해소. `models.py`(데이터클래스)와 실제
수집→저장 스크립트는 아직 없음.

- 개발 순서(확정): Phase 1 스캐폴딩 → Phase 2 수집기 → Phase 3 Upstage 파싱 파이프라인
  → Phase 4 조합로직 → Phase 5 Solar 추천사유 → Phase 6 UI → Phase 7 통합·배포 → Phase 8 데모준비

---

## ✅ 방금 세션에서 한 일
> 이번에 작업한 도구가 채운다. 무엇을 만들었/고쳤는지 구체적으로.

- (Phase 0) Upstage 필연성 방향(P0) 결정: 옵션A(강의계획서 파싱 중심 재설계) 채택 확정
- (Phase 0) 정량지표(P0) 확정: 시간제약 + Upstage파생 부담도(과제비중·시험집중도·수업형태)
- (Phase 0) 평점 데이터 소스(P1) 결정: v1은 평점 제외(옵션C). v2 확장후보로 보존
- (Phase 0) `docs/01_의사결정_로그.md`에 D-12 추가, `docs/00`·`docs/05` 최신화. 12일 개발계획(Phase 0~8) 승인받음
- (Phase 1) 이 머신에 Node.js가 없어서 winget으로 Node.js LTS 설치 (v24.18.0)
- (Phase 1) `scraper/` Python 패키지 스캐폴딩: `pyproject.toml`(ruff/pytest 설정, requests 의존성),
  `skku_scraper/__init__.py`, 스모크 테스트. `pip install -e ".[dev]"` 후 ruff check/format/pytest 전부 통과 확인
- (Phase 1) `web/` Next.js 16 + TypeScript + ESLint 스캐폴딩 (`create-next-app --app --src-dir --import-alias "@/*"`).
  vitest 추가, `package.json`에 `typecheck`(tsc --noEmit)·`test`(vitest run) 스크립트 신설.
  `npm run lint/typecheck/test` 전부 통과 확인
- (Phase 1) `python -m pre_commit run --all-files`로 전체 게이트(ruff/ruff-format/web eslint/web typecheck) 실통과 검증
- (Phase 2) `scraper/skku_scraper/ssv.py` SSV 파서 구현 (RS=0x1e/US=0x1f 분리, 컬럼명 타입접미사 스트립)
- (Phase 2) `scraper/skku_scraper/codes.py`: TERM·CAMPUS_GB 상수, `docs/성대_학과코드_전체.txt`를
  런타임에 파싱해 HakgwaCode 리스트로 로드
- (Phase 2) `scraper/skku_scraper/client.py`: `fetch_major_courses`/`fetch_elective_courses` 구현,
  목(mock) 단위테스트 10개 전부 통과
- (Phase 2) ★ 라이브 호출로 검증하며 발견·해결한 것들 (여러 라운드):
  1. (해결) 기본 python-requests UA로는 404/커넥션리셋 → 브라우저 UA·Referer·Origin 헤더 필요.
  2. (해결) ssv.py 파서: 컬럼명에 ":string(4000)" 같은 타입접미사가 붙는다는 걸 실서버 응답으로 확인,
     파서에 스트립 로직 반영.
  3. (★해결, P3-a) selectMain.do가 세션을 맞춰도 계속 0행이던 진짜 원인 = 요청 바디 맨 앞에
     "SSV:utf-8" 레코드가 빠져있었던 것. `X-NX-Content-Type: 2` 헤더는 처음부터 정상 전송 중이었음
     (prepared request 덤프로 확인). `_ALL_OUT_DS_NM` 파라미터는 불필요했음(있으나 없으나 동일).
     `_build_ssv_body`가 이제 리딩 마커를 자동으로 붙임 — 회귀 방지 테스트도 추가.
  4. 라이브 최종 검증: 경영학과(316901) TERM=10/CAMPUS_GB=1 → 103행(42행에 INTRO_URL 채워짐,
     lcms.skku.edu/em/... 형태), TERM=20 → 107행. ⚠️ 문서의 "TERM=20→214행" 기록과는 불일치
     (내 실측 107행은 오히려 02 문서 section2의 더 이전 실측과 일치) — 원인 불명, 수집기 동작
     자체엔 지장 없으나 총 개설강좌 수 정확도가 중요해지면 재확인 필요.

## 📂 변경한 파일
> 이번 세션에서 건드린 파일 목록. `git diff --name-only` 결과를 붙여도 됨.

- `docs/01_의사결정_로그.md`, `docs/00_프로젝트_현황_요약.md`, `docs/05_미해결_과제.md`, `CURRENT_STATE.md`
- `scraper/` 전체 신설 (pyproject.toml, skku_scraper/{ssv,codes,client}.py, tests/, data/, README.md)
- `web/` 전체 신설 (Next.js 표준 구조 + src/lib/version.ts,.test.ts)

## 💻 실행한 명령어
> 다음 도구가 재현할 수 있게. 특히 설치·마이그레이션 등.

- `winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements`
- `cd scraper && python -m venv .venv && pip install -e ".[dev]"`
- `cd web && npx create-next-app@latest web --typescript --eslint --app --src-dir --import-alias "@/*" --use-npm --no-tailwind`
- `cd web && npm install -D vitest`
- `python -m pre_commit run --all-files` (루트에서)
- ⚠️ 참고: `web/AGENTS.md`는 create-next-app이 자동 생성한 파일 — "이 Next.js 버전은 학습데이터와 다를 수 있으니
  `node_modules/next/dist/docs/`를 먼저 확인하라"는 경고. Next 16.2.10 API 작업 시 유효한 경고이므로 유지함.

## ⚠️ 남은 문제 / 막힌 곳
> 해결 못 한 것, 에러, 판단이 필요한 지점. 없으면 "없음".

- P2(Upstage 콘솔 실검증)는 아직 미검증. Phase 3 착수 즉시 최우선 처리 예정.
- P6(강의계획서 PDF 접근성)는 아직 미검증이지만, 실제 테스트용 URL은 이미 확보됨
  (예: https://lcms.skku.edu/em/67b55bfa1ec82). Phase 3에서 바로 GET 테스트 가능.
- TERM=20 행수(107 vs 문서상 214) 불일치 — 원인 불명, 수집기 동작엔 지장 없음(위 참조).
- scraper/venv(.venv/)는 gitignore 대상이라 커밋 안 됨. 다음 세션에서 재현하려면 위 명령어로 재설치 필요.
- `scraper/skku_scraper/models.py`(Course 데이터클래스)와 실제 수집→저장 스크립트는 아직 미작성.
- P5(교양 2단계 조회)는 아직 실호출로 확인 안 됨 — `fetch_elective_courses`는 구현·목테스트만 됨.

## ▶️ Recommended Next Step (다음 도구가 이어서 할 일)

1. **Phase 2 마무리**: `fetch_elective_courses`를 교양 영역코드(GEDG001 등)로 실호출해 P5 확인.
   `scraper/skku_scraper/models.py`(Course 데이터클래스)와 여러 학과를 순회하며 JSON으로 저장하는
   수집 스크립트 작성. `docs/성대_학과코드_전체.txt`가 126개뿐이라는 점(02 문서 참조, 실시간
   selectBizType04.do 호출을 진실의 원천으로 삼으라고 되어있음) 감안해서 설계.
2. **Phase 3 착수**: P2(Upstage 콘솔 실검증)부터. 이미 확보한 실제 INTRO_URL로 P6(PDF 접근성)도
   바로 검증 가능.

---

## 🔒 절대 잊지 말 규칙 (매 세션 상기)
- Upstage(Parse/Extract/Solar)가 **서비스의 심장**. 크롤링은 조연. (대회 필수 요건)
- API 키는 환경변수로만. 코드·커밋에 절대 넣지 않는다.
- 커밋 전 품질 게이트(lint/typecheck/test) 통과 필수.
- 기존 구현을 함부로 되돌리지 않는다. 이어서 작업한다.
- 상세 규칙은 `AGENTS.md`.

---

## 📖 참조 (막히면 여기부터)
- `AGENTS.md` — 전체 규칙·워크플로우
- `docs/00_프로젝트_현황_요약.md` — 프로젝트 큰 그림
- `docs/02_기술검증_기록.md` — 성대 API 완전 명세 (수집기 구현 필수)
- `docs/05_미해결_과제.md` — 열린 과제
- `WORKFLOW.md` — 두 도구 넘나드는 법
