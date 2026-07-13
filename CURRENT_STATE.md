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
**현재 작업:** Phase 2(수집기 구현) 부분 완료 — SSV 파서·학과코드·API 클라이언트 코드는 완성했으나
**요청 바디 인코딩이 아직 실제 서버에서 0건 응답 → 블로커 상태** (`docs/05_미해결_과제.md` P3-a 참조).

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
- (Phase 2) ★ 라이브 호출로 검증 중 발견 (여러 라운드):
  1. (해결) 기본 python-requests UA로는 404/커넥션리셋 → 브라우저 UA·Referer·Origin 헤더 필요.
  2. (해결) ssv.py 파서: 컬럼명에 ":string(4000)" 같은 타입접미사가 붙는다는 걸 실서버 응답으로 확인,
     파서에 스트립 로직 반영.
  3. (미해결·블로커, P3-a) `docs/02_기술검증_기록.md`가 제시한 두 가지 수정을 모두 적용했으나
     여전히 경영학과(316901)+TERM=20+CAMPUS_GB=1 라이브 호출이 214행이 아니라 0행(806바이트,
     컬럼 스키마만)이다:
     - raw UTF-8 bytes 전송(%가 %25로 안 깨짐) — 이미 처음부터 이렇게 구현돼 있었음
     - `requests.Session()` + `sessionLogin.do` 선호출 — `client.py`에 구현 완료.
       세션 자체는 진짜로 성립됨을 확인함(로그인 응답이 실제 gdsUser/gdsMsg 데이터 포함,
       이후 요청에 동일 JSESSIONID 쿠키가 계속 전송되는 것도 확인).
     - 그래도 안 돼서 문서에 언급된 전체 호출 순서(sessionLogin→refreshSession→selectMenutree→
       selectMain)까지 그대로 재현했지만 결과는 동일(0행).
     - 즉 "세션 없음"이 유일한 원인은 아닌 것으로 보임. 브라우저 fetch로 성공했다는 것과
       Python/curl 재현이 계속 어긋나는 원인은 아직 못 찾음(TLS/HTTP2 핑거프린트, 헤더
       순서/대소문자, 또는 sessionLogin 응답 안의 어떤 토큰을 놓치고 있을 가능성).
     - 이 세션에서 실서버에 상당히 많은 라이브 요청을 이미 보냈음 — 추가 블라인드 시도는
       자제하고, 사용자가 가진 실제 브라우저 요청/응답 원본(HAR 등)을 받아서 diff하는 쪽을 권장.

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

- ★ **P3-a (블로커, 신규)**: `client.py`의 selectMain.do 요청이 ErrorCode:int=0(성공)은 받는데 행이 0개.
  요청 바디 인코딩이 아직 정확하지 않음. 이 세션엔 브라우저 자동화 도구가 없어 실제 바이트 재캡처
  불가 → 브라우저 MCP(Claude-in-Chrome 등) 있는 세션에서 `docs/02_기술검증_기록.md` "방법C"를
  다시 수행해 정확한 요청 바디를 재확보해야 함. 상세: `docs/05_미해결_과제.md` P3-a.
- P2(Upstage 콘솔 실검증)·P6(강의계획서 PDF 접근성)는 아직 미검증. Phase 3 착수 즉시 최우선 처리 예정.
  결과에 따라 Phase 3~4 설계가 바뀔 수 있는 최대 리스크 지점.
- scraper/venv(.venv/)는 gitignore 대상이라 커밋 안 됨. 다음 세션에서 재현하려면 위 명령어로 재설치 필요.

## ▶️ Recommended Next Step (다음 도구가 이어서 할 일)

1. **Phase 2 블로커부터 해결**: 브라우저 자동화 도구(Claude-in-Chrome MCP 등)가 있는 세션에서
   `docs/02_기술검증_기록.md` "방법C"(넥사크로 엔진 통신 후킹)를 다시 수행해 selectMain.do의
   정확한 요청 바이트를 재캡처. `scraper/skku_scraper/client.py`의 `_build_ssv_body`를 그에
   맞게 수정. (지금은 ErrorCode:0인데 행이 0개로 돌아오는 상태 — `docs/05` P3-a 참조)
2. **Phase 2 마무리**: 위 수정 후 학과 1~2개 실호출 → 실제 행이 나오는지, JSON 저장까지 확인.
   P5(교양 2단계 조회)도 이 시점에 함께 실호출로 확인. `scraper/skku_scraper/models.py`(Course 데이터클래스)와
   실제 수집→저장 스크립트는 아직 미작성 — 요청 인코딩 해결 후 추가.
3. **Phase 3 착수 직전**: P2(Upstage 콘솔 실검증)·P6(강의계획서 PDF 접근성)를 최우선으로 실제 검증부터.

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
