# CURRENT_STATE.md — 세션 인수인계 상태판

> **이 파일은 Codex ↔ Claude Code 가 서로에게 넘기는 "인수인계 메모"다.**
> 한 도구가 작업을 멈출 때 이 파일을 최신화하고, 다른 도구는 이 파일 + git diff 를 읽고 이어받는다.
> 두 도구의 대화 세션은 서로 독립적이므로, **맥락은 대화가 아니라 이 파일로 전달된다.**
>
> ⚠️ 규칙: 작업을 멈추는 도구가 **반드시** 이 파일을 갱신하고 멈춘다. 갱신 없이 멈추면 다음 도구가 길을 잃는다.

---

## 📌 지금 상태 (마지막 갱신: 2026-07-14 / 갱신한 도구: Claude Code)

### 프로젝트 한 줄
성균관대 시간표 조합 추천 서비스. Upstage Document Builders Challenge 출품작 (데모데이 2026-07-25).
강의계획서 PDF를 Upstage Parse로 읽어 "학기 부담까지 예측하는" 시간표 추천이 핵심 차별점.

### 지금 어느 단계인가
**현재 작업:** 기본정보→전공·교양 개설강좌 자동조회→검토 중 기수강 제외→시각 시간표까지 연결 완료.
PDF/PNG/JPG를 Document Parse와 Solar로 정리한 뒤 기수강/졸업요건을 수정·추가·삭제하고, 재수강과
검토 항목을 확인해야 `confirmed`로 전환할 수 있다. 확정 후 수정하면 자동으로 `draft`로 돌아간다.
졸업요건 캡처는 파일 선택과 페이지 `Ctrl+V` 붙여넣기를 모두 지원한다.
Solar가 숫자문자열·한글 키·숫자형 원문 값을 반환해도 요건 행을 보존하며, `6 / 0` 같은 복합값만
행 단위 확인 대상으로 남기도록 서버 정규화를 보강했다. Solar가 일부 행만 반환할 때는 Document Parse
표에서 누락 행을 원래 순서대로 보완한다.
기본정보의 학과·캠퍼스·학기를 Next 서버 API로 전달하며, 사용자는 더 이상 scraper JSON 파일을
선택하지 않는다. 교양은 인사캠·자과캠·I-CAMPUS를 따로 고른 뒤 해당 캠퍼스의 전체·글로벌·소통과사고
등 공식 영역으로 목록을 좁혀 검색하고, 과목 선택 시 분반을 조회해 전공 후보와 합친다. 여러 캠퍼스
과목의 동시 선택은 허용하고
캠퍼스 이동 제한은 추후 추천 단계에서 적용한다.
다음 단계는 시각 고정일정 편집 UI와 졸업요건 기반 탐색 연결이다.
**서비스는 Vercel 프로덕션에 실배포돼 있다**: https://timetable-with-upstage.vercel.app
(최신 배포 `dpl_7VZhoiHD6vAcGwG9LrpKQtQcAVtD`, 커밋 `8e56bb5`). 강의 형식 필터·동적 공강일
필터·학사문서 카드 압축·Solar 추출 재시도·필터-선택 상태 분리 버그 수정에 더해, 교양과목
인메모리 TTL 캐싱과 AI 시간표 추천(가중치 스코어러 + Solar 설명, D-20)까지 전부 반영·배포된
상태다. AI 추천 결과는 텍스트 나열이 아니라 직접 만든 조합과 동일한 주간 그리드
`TimetableCard`로 표시되며, 추가 과목(`extras`)·Solar 이유·졸업요건 기여도가 카드 하단에
붙는다(커밋 `206c464`). AI 추천은 이제 사용자가 담은 필수/선택 과목은 그대로 두고 부족한
학점만큼 졸업요건 미충족 교양 영역을 우선으로 자동 보충하며(기수강 제외), 원하는 학점
범위 기본 최솟값은 12로 낮췄다(커밋 `8e56bb5`, 로직은 `web/src/lib/ai-filler-selection.ts`).

- 개발 순서(확정): Phase 1 스캐폴딩 → Phase 2 수집기 → Phase 3 Upstage 파싱 파이프라인
  → Phase 4 조합로직 → Phase 5 Solar 추천사유 → Phase 6 UI → Phase 7 통합·배포 → Phase 8 데모준비
- (과거 이력) 첫 세션 커밋 범위: `487e1a8` → `5791499` → `3dcfea8` → `5b34586`(P3-a 최종 해결).
- (최신) 이번 인수인계 시점 커밋 범위: `8b50ffc` → `de0b7cb` → `16d450c` → `04adf84`.
  전부 품질게이트 통과 후 커밋 + 사용자 확인 후 Vercel 프로덕션 배포까지 완료.

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
- (Phase 2 마무리) 교양 `fetch_elective_courses` 라이브 검증: 2026-1학기 자연과학캠퍼스에서
  `GEDG001` 41건, `GEDG002` 14건 수신. 선택 영역을 JSON으로 저장하는 CLI도 `GEDG001` 41건으로
  끝까지 검증했다.
- (Phase 2 마무리) `models.py`에 시간표·Upstage 파싱에 필요한 최소 `Course` 모델을 추가하고,
  `python -m skku_scraper.collect`로 사용자가 지정한 학과/교양 영역만 수집·저장하게 했다.
  원본 API 행 전체를 저장하지 않고, 출력 파일을 명시하도록 해 상시 전체 미러링을 방지한다.
- (Phase 2 마무리) `fetch_department_codes`·`load_departments()` 추가. 문서의 22개 대학코드를
  0.5초 간격으로 순차 조회해 최신 학과목록을 구성하며, 2026-1학기 라이브 결과 132개·경영학과·
  건축학과 포함을 확인했다. 참고 파일 126개는 오프라인 시드·대학명 참고로만 유지한다.
- (Phase 3) P6 검증: 경영학과 강의계획서 URL `https://lcms.skku.edu/em/67b55bfa1ec82`는 HTTP 200이나
  PDF 대신 "이 콘텐츠는 사용자에 의해 시청이 제한되었습니다." HTML(1,119 bytes)을 반환. 자동 URL
  수집을 포기하고 사용자 PDF 업로드를 MVP 입력 경로로 확정했다.
- (Phase 3) `web/src/app/api/parse-syllabus/route.ts` 구현. multipart PDF(최대 50MB)를 검증한 뒤
  서버에서만 Upstage `POST /v1/document-digitization`에 `model=document-parse`로 전달한다.
  `UPSTAGE_API_KEY` 미설정, 비PDF, Upstage 연결/요청 오류를 구조화된 오류로 처리하며 키를 반환·
  로그에 남기지 않는다. 라우트 테스트 3개 추가.
- (Phase 3) 공식 Upstage Console 예시로 동기 Parse 엔드포인트·Bearer 인증·모델명 및
  `content.html`/`content.markdown` 응답 구조를 확인. `web/.env.local`의 키로 공개 1쪽 PDF를
  로컬 `/api/parse-syllabus`에 실제 업로드해 HTTP 200·API 2.0·HTML·Markdown·elements(1개)를 확인했다.
  키를 출력·로그·커밋하지 않았다.
- (Phase 3 마무리) 공개 성균관대 School of Business 강의계획서 PDF(79,626 bytes)를 실업로드해
  Parse 품질을 확인: HTTP 200·레이아웃 요소 11개, Grading·Quiz·Midterm·Final·Presentation 키워드
  전부 검출. `web/src/lib/syllabus.ts`가 평가 5개 항목을 보수적으로 정규화해 과제 10%·퀴즈 10%·
  발표 60%·참여 30%, 중간/기말 존재를 반환함을 라이브 검증했다.
- (Phase 4a) `web/src/lib/timetable.ts` 구현: `GYOSI_NAME`의 `화12:00-13:15` 형식을 요일·분 단위
  회의 구간으로 파싱하고, 겹치는 수업을 제거한다. 불가 요일과 최소 시작 시간 사용자 제약도 적용한다.
  유효 조합은 전부 반환하며, 기본 안전 한도(500)를 넘으면 일부 결과를 반환하지 않고 오류를 낸다.
- (Phase 4a) D-13: 부담도 기반 점수·정렬·상위 N 추천은 사용자 지시로 보류. `timetable.test.ts`에
  실제 형식 파싱·인접 수업·충돌·제약·미정 시간·안전 한도 테스트 5개 추가.
- (Phase 6) 기본 Next.js 화면을 시간표 조합 UI로 교체. `TimetablePlanner`에서 데모 분반 후보 포함
  여부, 불가 요일, 최소 시작 시간을 조절하면 `timetable.ts`의 결과가 순위 없이 모두 표시된다.
  조합이 없거나 안전 한도를 넘는 경우의 안내도 포함했다. 실제 성대 수집 데이터 연결은 아직 없다.
- (Phase 6a/P10) `course-candidates.ts`가 scraper의 `courses` JSON을 과목번호별 분반 후보로 변환.
  UI의 JSON 파일 선택으로 이 데이터를 브라우저 메모리에서만 불러오며, 실제 수집 범위를 시간표
  조합에 바로 사용한다. 잘못된 JSON은 스키마 오류로 안내하고, 중복 course_id는 제거한다.
- (Phase 6b/P11) `SyllabusUploader`가 PDF 크기·형식을 먼저 확인한 뒤 사용자 동작으로만 분석을 요청한다.
  응답 검증 유틸리티가 정규화된 평가 항목/시험 표기만 렌더링하고, 원문은 안전한 Markdown 텍스트
  미리보기로 제한한다. 추천 점수나 순위에는 연결하지 않는다.
- (Phase 4b/P12) `selection-plan.ts`에 필수과목, 책가방별 최소·최대 선택 수, 기수강 제외를 구현했다.
  같은 과목의 여러 분반은 한 과목 내부에 보존하고, 과목이 여러 책가방에 중복되면 오류를 내 누락·
  중복 선택을 방지한다. 구조와 전체 제품 흐름은 `docs/06_제품_플로우_및_조합모델.md`에 기록했다.
- (P13) `scraper/skku_scraper/curriculum.py`가 성대 대표 홈페이지 중앙 검색과 교육과정 팝업을 읽는다.
  기본 10개 페이징 누락을 `pagerLimit=1000`으로 방지했으며 라이브 결과는 경영학과 141과목,
  첨단반도체 융합트랙 36과목, 과학기술정책인재양성 융합트랙 20과목이다.
- (P14) 사용자 제공 수강/취득과목 PDF를 키·원문·개인식별자를 출력하지 않고 실제 Document Parse했다.
  HTTP 200·Markdown 약 3.7KB·요소 8개였고 표 헤더/과목행을 인식했으나 셀 이동·과목 병합·합계행
  혼입이 확인됐다. `docs/07_학사문서_데이터_스키마.md`와 AcademicProfile JSON Schema에 검증·
  사용자 승인·재수강 토글·개인정보 최소화 규칙을 확정했다.
- (P14 API) `POST /api/parse-academic-document` 추가. PDF/PNG/JPG(최대 50MB)와 문서 종류를 받아
  Document Parse→`solar-pro3`를 서버에서만 호출하고, 런타임 검증된 AcademicProfile `draft`만 반환한다.
  형식 오류 행은 자동 반영하지 않고 review issue로 남기며, 임의 Solar 필드와 원본 Parse 결과는 버린다.
- Upstage 공통 호출을 `web/src/lib/upstage.ts`로 분리해 기존 강의계획서 API도 같은 서버 전용 경로를
  사용하게 했다. 합성 데이터 Solar 실호출은 HTTP 200, 실제 응답 모델 `solar-pro3-260323`,
  고정 JSON 파싱 성공이었다. 개인 문서는 이 Solar 실검증에 사용하지 않았다.
- (P14 UI) `AcademicDocumentManager`를 첫 화면 시간표보다 앞에 배치했다. 두 문서 초안을 독립적으로
  브라우저 메모리에 보존하며, 모든 기수강/졸업요건 필드 수정, 행 수동 추가·삭제, 재수강 토글,
  문서/행 검토 사유별 체크와 confirmed 전환을 지원한다.
- 브라우저 응답을 `academic-profile-client.ts`에서 재검증한다. 잘못된 학수번호·학점·연도·요건 규칙은
  확정을 차단하고, 확정된 값을 수정하면 즉시 draft로 되돌리며 기존 검토 체크도 초기화한다.
- 졸업요건 탭에서 캡처 PNG/JPG를 `Ctrl+V`로 붙여넣는 입력을 추가했다. 페이지 어디서나 동작하지만
  텍스트 편집 입력칸의 붙여넣기는 가로채지 않으며, 사용자가 분석 버튼을 눌러야 API를 호출한다.
- 졸업요건 캡처에서 Solar가 16개 행을 인식했지만 엄격한 타입 검사 때문에 전부 폐기되던 회귀를 수정했다.
  안전한 숫자문자열·한글 학기 키·숫자형 `rawValues`·생략된 빈 `reviewReasons`를 정규화하고, 복합값은
  행을 버리지 않은 채 `review`로 보존한다. 16개 행 보존 및 복합값 회귀 테스트를 추가했다.
- 후속 실사용에서 Solar가 제1전공 3개 행만 반환한 누락도 수정했다. 프롬프트에 전체 표 행 감사를
  강제하고, Markdown/HTML(rowspan 포함) Document Parse 표를 결정론적 안전망으로 사용해 Solar 누락
  행을 원래 순서대로 보완한다. 의사소통·창의·글로벌·DS·균형교양을 포함한 15행 회귀 테스트를 추가했다.
- 균형교양 세 행을 각각 6학점 요건으로 오해하지 않도록 동일 `groupId`의 공동 영역분배 규칙으로
  정규화했다. 의미는 3개 영역 중 서로 다른 최소 2개 영역에서 합계 6학점 이상이며, `[6,0,0]`은
  불충족이고 `[3,3,0]`·`[1,5,0]`은 충족이다. UI에도 이 설명과 전체/최소 영역 수를 표시한다.
- 졸업요건 카드의 여백·입력 높이·간격을 줄이고, 접힌 상태에서도 요건명·범위·상태·취득/잔여학점이
  보이는 개별 접기/펼치기와 전체 접기/펼치기를 추가했다. 문서 결과 전체도 축소할 수 있으며,
  `검토한 내용 확정하기` 성공 시 편집/검토 영역을 자동으로 접어 한 줄 요약만 남긴다.
- 요건 편집 화면에서 `수강 중 학점` 입력란은 제거하되 원본 구조에는 보존했다. 펼친 카드도 데스크톱에서
  요건명·범위·상태·취득·잔여를 한 줄로 배치하고, 공동 규칙은 한 줄 요약, 규칙 원문은 접힌 상세로
  바꿨다. Document Parse 표의 확정적인 0값을 우선해 행마다 반복되던 수강학점 경고를 제거하고,
  동일 영역분배 그룹의 같은 검토 사유는 한 항목으로 묶었다.
- 반복 검토 20개의 근본 원인을 제거했다. 사용하지 않는 수강중 학점 누락은 0으로 보존하되 검토를
  만들지 않고, 숫자 기준학점이 있는 `manual` DS 규칙은 최소학점 규칙으로 자동 변환한다. 알려진 DS
  중복 안내는 비차단 정보로 처리하며, 이전 응답에 남은 같은 문구도 클라이언트 체크리스트에서 거른다.
  실제 확인 항목이 0개면 노란 자동 추출 검토 패널 자체를 렌더링하지 않는다.
- Solar가 `기준학점 미달`·`취득학점 미달`을 추출 오류처럼 반환하던 문제를 수정했다. 이 문구는 검토
  사유에서 제거하고 숫자형 요건은 잔여학점 0이면 `satisfied`, 0보다 크면 `unmet`으로 서버가 직접
  판정한다. 따라서 의사소통 4/4/잔여0은 충족이며, 실제 미충족도 체크박스가 아닌 상태로만 표시된다.
- 사용자 제공 수강/취득과목 원본 PDF의 전 행을 실제 API로 재검증했다. 정상 학수번호의 숫자 3자리와
  `1학기/2학기/여름학/겨울학` 한글 표기가 기존 엄격 검증에서 탈락하던 원인을 수정했으며, 열 경계에서
  `2 | 학기`처럼 분리된 표기도 복원한다. Document Parse의 코드·과목명 쌍을 결정론적 기준으로 삼아
  Solar 누락을 보완하고, 한 셀에 합쳐진 서로 다른 두 과목도 분리한다. 누락 재추출은 한 번만 수행하며
  실패해도 첫 결과를 버리지 않는다. 최종 실측은 HTTP 200·기수강 33개·학기 33개·잘못된 행 0개·
  전역/과목별 검토 사유 0개다. 원본·전체 Parse/Solar 응답·개인식별자·성적은 저장/출력/커밋하지 않았다.
- (P10 자동연결) `StudentProfileForm`과 `PlanningWorkspace`를 추가해 소속·입학연도·학년·주 캠퍼스·
  조회 학년도·학기를 상위 브라우저 세션에서 관리한다. `POST /api/skku-courses`는 브라우저 대신 성대
  세션을 성립하고 SSV 전공 강좌를 조회해 최소 Course 필드만 반환한다. 개발용 scraper JSON 버튼과
  데모 후보를 제거했으며 과목명·학수번호·이수구분 검색을 추가했다.
- 확정된 수강/취득과목의 `earned + exclude` 학수번호는 실제 조회 후보에서 자동 제외하고 `retake`는
  보존한다. 라이브 경영학과 2026-2학기/인문사회캠퍼스 조회는 HTTP 200·107분반·60과목·시간표 107건.
  교양 API는 `%` 전체 조회가 0건이므로 영역/과목코드 선택 UI를 붙이는 후속 작업으로 분리했다.
- (P10 교양 자동연결) 성대 공식 교양 화면의 3단계 API를 복원했다. `selectMain01`에서 14개 영역별
  개설 수를 받고, `selectMain02`에서 선택 영역의 교과목 목록, `selectMain03`에서 선택 교과목의 분반을
  조회한다. 전공/교양 탭과 영역·과목 검색을 추가하고 선택한 교양 분반을 기존 충돌 제거 엔진에 합쳤다.
  라이브 2026-2학기 인문캠퍼스에서 영역 14개·글로벌 11과목·영어쓰기 44분반을 확인했다.
- 시간표 결과의 과목별 텍스트 나열을 월~금 08:00~22:00 주간표로 교체했다. 실제 시작·종료 시각에
  맞춘 색상 블록과 과목명·시간을 표시하고 조합별 접기/펼치기를 지원한다. 모바일 390px에서는 페이지
  전체가 넘치지 않고 주간표 내부만 가로 스크롤한다.
- 학과 입력을 학과명·전공명·트랙명·6자리 코드 검색으로 바꾸고, 학년을 1~6학년과 `초과학기`까지
  확장했다. 현재 공개 교과과정 데이터에는 학년별 로드맵 필드가 없어 동일 학년 우선 정렬은 보류했다.
- 기수강/졸업요건의 자동 추출 검토에 `전체 확인/전체 해제`를 추가했다. C/L 중복, 범위·교양·DS
  결정론적 분류, 기준 초과, 균형교양 공동규칙처럼 사용자가 수정할 추출 오류가 아닌 문구는 체크리스트에서
  제거했다. 균형교양 `6/0, 6/3, 6/3`은 영역 취득학점 `0,3,3`으로 복구해 공동요건 충족을 판정한다.
- 기수강 제외가 별도의 최종 확정 버튼을 누른 뒤에만 반영되던 버그를 수정했다. 수강/취득과목 분석 직후
  현재 검토 초안을 과목 선택과 연결하고, `earned + exclude` 학수번호는 즉시 숨긴다. 재수강 예정에
  체크한 `retake`만 다시 표시한다. 실제 원본의 기본설계2 `ADD2003`·디지털모델링 `ADD2021` 코드와
  상태를 재확인했고, 학수번호 공백·대소문자 차이도 정규화하는 회귀 테스트를 추가했다.
- 소속 학과·전공·트랙의 브라우저 기본 `datalist`를 검색 가능한 그룹형 선택창으로 교체했다. 목록은
  20개 대학·학부 대분류 제목 아래에 같은 소속들을 묶어 표시하며, 선택값에는 소속명만 남긴다.
  대학·학부명·소속명·6자리 코드 검색, 키보드 위/아래·Enter·Escape, 선택 후 전체 목록 다시 열기를
  지원한다. 모바일 390px에서도 페이지 가로 넘침 없이 선택창이 화면 안에 들어오는 것을 확인했다.
- 수강/취득과목과 졸업요건 두 문서의 검토 항목을 한 번에 동의하거나 해제하는 전체 동의 버튼을
  문서 탭 위에 추가했다. 현재 문서만 일괄 동의하는 버튼도 함께 유지하며 전체·미동의 수를 표시한다.
- 한 과목의 같은 요일 연속 교시가 여러 조각으로 표시되던 시간표를 정리했다. 겹치거나 간격이 15분
  이하인 연속 구간은 표시 단계에서 하나의 시작~종료 블록으로 합치며, 조합의 충돌 판정 원본은 바꾸지
  않는다. 서로 다른 요일이나 실제 공강이 있는 구간은 별도 블록으로 유지한다.
- 교양 선택을 캠퍼스별 전체 목록과 영역 필터 방식으로 개편했다. 사용자가 인사캠·자과캠·I-CAMPUS를
  바꾸면 그 캠퍼스의 14개 영역 과목을 한 번에 불러오고, 전체·글로벌·소통과사고·창의 등 공식 영역으로
  좁혀 검색할 수 있다. 여러 캠퍼스 선택 결과를 동시에
  시간표에 넣을 수 있다. 캠퍼스가 같은 학수번호도 선택 상태가 충돌하지 않으며, 기수강 비재수강 과목은
  전체 교양 목록에서도 계속 제외한다. 기본정보 외 문서 편집 시 조회 조건 객체가 바뀌어 선택 과목이
  초기화되던 문제도 `courseQuery` 메모이제이션으로 방지했다.
- 필수과목·선택 그룹 UI를 실제 조합 엔진에 연결했다. 새로 체크한 과목은 기본적으로 `선택 그룹 1`의
  후보가 되고 이 그룹은 정확히 1과목을 고르므로, 여러 과목을 체크해도 전부 필수로 들어가지 않는다.
  그룹을 여러 개 만들고 이름과 최소·최대 선택 수를 정하거나 과목을 그룹 사이에 옮길 수 있다.
- 같은 학수번호의 분반은 과목 안에 계속 묶되, 선택된 과목 이름을 펼치면 분반별 교수·시간·캠퍼스·
  수업형태를 보고 허용 분반을 개별 선택할 수 있다. 과목 조합→분반 조합→시간 충돌 제거 순서로 모든
  유효 조합을 만들며, 전체 500개 안전 한도를 넘으면 일부만 자르지 않고 조건 축소를 요청한다.
- 과목을 처음 선택할 때 모든 분반이 자동 활성화되어 같은 형태의 시간표가 한꺼번에 생성되던 문제를
  수정했다. 처음에는 API 순서상 첫 분반 하나만 활성화하고, 사용자가 과목 상세를 펼쳐 다른 분반을
  추가하거나 기존 분반을 해제할 수 있다. UI 표시·토글·조합 계산의 기본값도 같은 규칙을 공유한다.
- 전공 과목 목록에 `분반별 교수·수업 방식` 접기/펼치기를 추가해 각 분반의 교수명과 오프라인·
  온라인[사전제작]·플립러닝·PBL 등 성대 `SUUP_TYPE_NM` 값을 확인할 수 있다. 교양은 과목 선택 시
  분반 API를 호출한 뒤 같은 정보를 표시하며, 형식이 빈 I-CAMPUS 분반은 온라인으로 안내한다.
  분반이 한 개인 과목은 별도 클릭 없이 분반·교수·수업 방식을 바로 표시하고, 두 개 이상일 때만
  접기/펼치기를 사용한다. 교양은 화면에 실제 보이는 과목만 분반 정보를 한 번에 하나씩 미리 조회해
  미선택 단일 분반도 자동 표시한다. 복수 분반은 미선택 상태에서 개수만 보이고 과목을 선택한 뒤에만
  상세를 표시하며, 전공도 같은 공개 규칙을 사용한다.
- 원하는 총 학점 범위를 사용자가 입력할 수 있게 했고 기본값은 15~18학점이다. 성대의 `3(3)` 같은
  학점 표기에서 앞의 신청학점을 읽어 과목당 한 번만 합산하며, 여러 분반을 허용해도 학점을 중복
  계산하지 않는다. 범위 밖 과목 조합은 시간 충돌 계산 전에 제외하고 결과 카드에도 총 학점을 표시한다.
- 선택된 과목 상세에 `이 과목 선택 해제`를 추가했다. 전공은 선택 ID·소속·분반 설정을 제거하고,
  교양은 여기에 더해 불러온 분반 그룹도 제거하므로 원래 과목 목록의 체크가 즉시 풀린다. 선택 그룹을
  삭제할 때도 그 그룹 소속 과목과 분반 설정을 모두 해제하며 더 이상 필수 과목으로 자동 이동하지 않는다.
- 기본정보의 입학연도를 선택과 입력이 합쳐진 한 칸으로 바꿨다. 2018~2026년은 추천 목록에서
  빠르게 고를 수 있고 목록을 거치지 않고 다른 연도를 바로 타이핑할 수도 있다. 입력값은 기존처럼
  졸업요건 분기와 학사 프로필에 그대로 전달한다.

## 📂 변경한 파일
> 이번 세션에서 건드린 파일 목록. `git diff --name-only` 결과를 붙여도 됨.

- `docs/01_의사결정_로그.md`, `docs/00_프로젝트_현황_요약.md`, `docs/05_미해결_과제.md`, `CURRENT_STATE.md`
- `scraper/skku_scraper/{models,collect}.py`, `scraper/skku_scraper/{codes,client}.py`,
  `scraper/tests/{test_models,test_collect,test_codes,test_client}.py`, `scraper/README.md`
- `web/.env.example`, `web/src/app/api/parse-syllabus/{route,route.test}.ts`, `web/README.md`
- `web/src/lib/syllabus.{ts,test.ts}`
- `web/src/lib/timetable.{ts,test.ts}`
- `web/src/components/TimetablePlanner.{tsx,module.css}`, `web/src/app/{page.tsx,page.module.css,globals.css,layout.tsx}`
- `web/src/lib/course-candidates.{ts,test.ts}`
- `web/src/lib/parse-syllabus-response.{ts,test.ts}`, `web/src/components/SyllabusUploader.{tsx,module.css}`
- `web/src/lib/selection-plan.{ts,test.ts}`
- `scraper/skku_scraper/curriculum.py`, `scraper/tests/test_curriculum.py`
- `docs/06_제품_플로우_및_조합모델.md`
- `docs/07_학사문서_데이터_스키마.md`, `docs/schemas/academic-profile.schema.json`
- `web/src/lib/upstage.ts`, `web/src/lib/academic-document.{ts,test.ts}`
- `web/src/app/api/parse-academic-document/{route,route.test}.ts`
- `web/src/lib/academic-profile.ts`, `web/src/lib/academic-profile-client.{ts,test.ts}`
- `web/src/lib/academic-document-file.{ts,test.ts}`
- `web/src/lib/skku-course-api.{ts,test.ts}`, `web/src/lib/skku-departments.ts`,
  `web/src/lib/planning-profile.{ts,test.ts}`
- `web/src/app/api/skku-courses/{route,route.test}.ts`
- `web/src/app/api/skku-electives/{route,route.test}.ts`
- `web/src/components/{PlanningWorkspace,StudentProfileForm,TimetablePlanner}*`
- `web/src/components/Academic{DocumentManager,CourseEditor,RequirementEditor}*`
- `web/src/lib/timetable.{ts,test.ts}`, `web/src/lib/skku-course-api.{ts,test.ts}`
- `web/src/app/api/skku-electives/{route,route.test}.ts`
- `.gitignore` (개인 학사문서 원본 보호 패턴)
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
- `cd scraper && .venv\\Scripts\\ruff check . && .venv\\Scripts\\ruff format --check . && .venv\\Scripts\\pytest`
  → ruff 통과, pytest 19개 통과.
- `python -m skku_scraper.collect --year 2026 --term 10 --campus 2 --elective-area GEDG001 ...`
  → 임시 JSON 41개 강좌로 저장·스키마 확인 후 삭제.
- `load_departments(2026, 10)` → 22개 대학코드 순차 라이브 조회, 132개 학과 확인.
- `cd web && npm run lint && npm run typecheck && npm run test` → 전부 통과(ESLint·tsc·Vitest 1개).
  이 PowerShell 세션은 Node 설치 경로가 PATH에 빠져 있어, 실행 전
  `$env:Path = 'C:\Program Files\nodejs;' + $env:Path`를 임시 적용했다.
- Phase 3 후 동일한 web 품질 게이트 재실행 → ESLint·tsc 통과, Vitest 2개 파일·4개 테스트 통과.
- Phase 3 정규화 추가 후 web 품질 게이트 재실행 → ESLint·tsc 통과, Vitest 3개 파일·7개 테스트 통과.
- Phase 4a 추가 후 web 품질 게이트 재실행 → ESLint·tsc 통과, Vitest 4개 파일·12개 테스트 통과.
- Phase 6 UI 추가 후 web lint·typecheck·Vitest 12개 테스트·production build 통과.
- P10 데이터 연결 후 web lint·typecheck·Vitest 14개 테스트·production build 통과.
- P11 PDF 분석 UI 후 web lint·typecheck·Vitest 16개 테스트·production build 통과.
- P12/P13 후 scraper ruff·format·pytest 22개 통과, web lint·typecheck·Vitest 21개·production build 통과.
- 교과과정 공개 경로 라이브 검증: 경영학과 이름 검색, 연계전공 13개 검색, 학과·융합트랙 3개 코드의
  전체 교과목 조회 성공. 실제 출력 파일은 만들거나 커밋하지 않았다.
- 사용자 제공 학사 PDF 실제 Document Parse 성공. 원본·전체 결과를 저장/커밋하지 않았고 JSON Schema는
  PowerShell `ConvertFrom-Json`으로 문법 검증했다.
- P14 API 후 web 품질 게이트 재실행 → ESLint·TypeScript·Vitest 9개 파일/29개 테스트·production build 통과.
  합성 데이터 Solar 실호출 → HTTP 200, `solar-pro3-260323`, 고정 JSON 응답 확인. 키는 출력하지 않았다.
- P14 확인 UI 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 10개 파일/33개 테스트·production build 통과.
  Edge 헤드리스로 1440px/모바일 폭 렌더링을 확인했고, 모바일 실제 scrollWidth가 clientWidth와 같아
  새 학사문서 패널에 가로 오버플로가 없음을 확인했다.
- 졸업요건 캡처 붙여넣기 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 11개 파일/36개 테스트·
  production build 통과. 프로덕션 Edge에서 졸업요건 탭, 붙여넣기 영역, PNG 선택 상태를 재현했다.
- 졸업요건 행 정규화 보강 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 11개 파일/38개 테스트·
  production build 통과. 새 빌드로 로컬 production 서버를 재시작하고 HTTP 200을 확인했다.
- Solar 부분행 누락 보완 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 11개 파일/41개 테스트·
  production build 통과. 새 빌드로 로컬 production 서버를 다시 시작하고 HTTP 200을 확인했다.
- 균형교양 공동 규칙 반영 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 12개 파일/44개 테스트·
  production build 및 AcademicProfile JSON Schema 문법 검사 통과.
- 졸업요건 압축/접기 UI 반영 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 12개 파일/44개 테스트·
  production build 통과.
- 졸업요건 5열 압축 편집·수강중 입력 제거·검토 사유 정리 후 web 게이트 재실행 →
  ESLint·TypeScript·Vitest 12개 파일/45개 테스트·production build 통과.
- 반복 자동검토 비차단 처리 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 12개 파일/47개 테스트·
  production build 통과.
- 숫자형 졸업요건 충족 판정 보정 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 12개 파일/48개
  테스트·production build 통과.
- 수강/취득과목 원본 정규화·Document Parse 표 보완 후 web 게이트 재실행 → ESLint·TypeScript·
  Vitest 12개 파일/54개 테스트·production build 통과. 새 production 서버에서 원본 PDF를 서비스 API로
  재분석해 33과목·33학기·검토 사유 0건을 확인했다.
- 전공 개설강좌 자동연결 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 15개 파일/62개 테스트·
  production build 통과. 로컬 production `/api/skku-courses` 실호출에서 2026-2 경영학과 107분반·
  60과목을 확인하고 원본 응답은 저장하지 않았다.
- 교양 자동연결·시각 시간표·기본정보/검토 UI 보강 후 web 게이트 재실행 → ESLint·TypeScript·
  Vitest 16개 파일/68개 테스트·production build 통과. production `/api/skku-electives` 실호출에서
  14영역·글로벌 11과목·GEDG001 44분반을 확인했고, 브라우저 시각표 블록 위치와 모바일 390px
  `document.scrollWidth=390`을 확인했다.
- 검토 중 기수강 즉시 제외 수정 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 16개 파일/68개
  테스트·production build 통과. `ADD2003`·`ADD2021` 제외 및 재수강 과목 보존 회귀 테스트 포함.
- 소속 선택 그룹화 후 web 게이트 재실행 → ESLint·TypeScript·Vitest 17개 파일/70개 테스트·production
  build 통과. production 브라우저에서 20개 그룹, 선택/닫힘/재열기, 390px 가로 넘침 없음을 확인했다.
- 문서 검토 전체 동의·연속 교시 블록 병합·캠퍼스별 전체 교양 조회 후 web 게이트 재실행 →
  ESLint 경고 0개·TypeScript·Vitest 17개 파일/73개 테스트·production build 통과. 새 production
  서버의 `/api/skku-electives` 실호출에서 2026-2학기 인사캠 14영역/204과목, 자과캠 14영역/151과목을
  확인했고, 자과캠 `GEDC010` 선택 시 13개 분반과 시간 데이터가 반환되는 것까지 확인했다.
- I-CAMPUS와 공식 교양 영역 필터 추가 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·Vitest
  17개 파일/73개 테스트·production build 통과. 공식 화면과 API에서 `CAMPUS_GB=3`, 미래(SW/AI)의
  영역 코드 `A7`을 확인했다. production 실호출에서 2026-2학기 I-CAMPUS 14영역/30과목,
  `GEDI010` 1개 온라인 분반(`CAMPUS_NM=i-Campus`, 고정 시간 없음)을 확인했다.
- 필수/선택 그룹과 분반 선택 UI 연결 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·Vitest
  17개 파일/75개 테스트·production build 통과. `1개 × 1개 × 2개`인 3개 선택 그룹에서 12개 과목
  조합이 빠짐없이 생성되는 회귀 테스트와 사용자가 허용한 분반만 생성되는 테스트를 포함했다.
- 선택 과목·그룹 삭제 상태 정리 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·Vitest
  17개 파일/76개 테스트·production build 통과. 그룹 삭제 시 소속 과목 ID·소속·분반 설정이 함께
  제거되고 다른 그룹 과목은 보존되는 회귀 테스트를 추가했다.
- 입학연도 선택/직접 입력 UI 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·Vitest
  17개 파일/77개 테스트·production build 통과. 새 production 서버의 HTTP 200과 렌더링 HTML에서
  단일 직접 입력칸, 2018~2026년 전체 추천 옵션, 별도 `직접 입력` 단계 제거를 확인했다.
- 과목 최초 선택 분반 기본값 수정 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·Vitest
  17개 파일/78개 테스트·production build 통과. 분반 3개 과목도 첫 분반 1개만 활성화되는 회귀
  테스트를 추가했고, 새 production 서버 HTTP 200을 확인했다.
- 분반별 교수·수업 방식과 학점 범위 제약 추가 후 web 게이트 재실행 → ESLint 경고 0개·TypeScript·
  Vitest 17개 파일/82개 테스트·production build 통과. 라이브 2026-2학기 경영학과 응답에서 오프라인·
  온라인[사전제작]·플립러닝·PBL 수업형태와 `3(3)` 학점을 확인했고, 15~18 기본값 렌더링 및 HTTP 200을
  확인했다.
- 단일 분반 즉시 표시/복수 분반 접기 UI 분기 후 동일 web 게이트 재실행 → ESLint 경고 0개·
  TypeScript·Vitest 17개 파일/83개 테스트·production build 및 새 서버 HTTP 200 통과. 교양의 화면 내
  자동 미리조회는 서버 부담을 피하도록 순차 큐로 제한했다. Edge 자동조작 검증은 개발자 도구 연결이
  시간 초과되어 완료하지 못했으며 임시 브라우저는 정리했다. 표시 규칙 회귀 테스트와 빌드는 통과했다.

- Vercel 배포 준비 → Function 고정 payload 4.5MB 한도에 multipart overhead가 남도록 학사문서·
  강의계획서 업로드 한도를 4MB로 통일했다. 강의계획서 API는 전체 Parse 응답 대신 1,200자
  markdown 미리보기와 정규화된 syllabus만 브라우저로 반환하게 경량화했다. ESLint·TypeScript·
  Vitest 17개 파일/84개 테스트·production build를 모두 통과했고, `.env.local`은 Git 미추적을
  재확인했다. `https://timetable-with-upstage.vercel.app/`에 실제 배포했고 홈페이지 HTTP 200,
  전공 107분반, I-CAMPUS 교양 14영역, 서버 환경변수 적용을 스모크 테스트했다.
- 선택 전 복수 분반 정보 표시 → 과목을 체크하지 않아도 `분반별 교수·수업 방식` 접기/펼치기를
  누를 수 있게 표시 조건을 변경했다. 단일 분반은 기존처럼 즉시 표시하며, 선택·조합 로직은
  변경하지 않았다. ESLint·TypeScript·Vitest 17개 파일/84개 테스트·production build가 모두 통과했다.
- 기본정보 선택창 시각 통일 → 소속 학과·전공·트랙 검색 UI는 변경하지 않고, 입학연도·현재 학년·
  주 캠퍼스·조회 학년도·조회 학기를 동일한 녹색 포인트·둥근 테두리·맞춤 목록 스타일로
  통일했다. 입학연도는 직접 입력을 유지하면서 브라우저 datalist를 제거해 `2022년`이 한 번만
  표시되게 했다. 닫힌·열림 화면과 목록 상태를 헤드리스 Edge로 확인했고, ESLint·TypeScript·
  Vitest 18개 파일/86개 테스트·production build가 모두 통과했다.
- 분반 목록 직접 선택 → 복수 분반 과목의 `분반별 교수·수업 방식` 행을 체크박스로 연결했다.
  과목 체크 시 맨 위 분반 1개만 기본 선택되고, 사용자는 분반을 추가하거나 기존 분반을 해제해
  바꿀 수 있다. 선택하지 않은 과목의 특정 분반을 바로 누르면 해당 과목도 같이 선택된다.
  선택 과목에 허용 분반이 0개가 되지 않도록 마지막 1개 해제를 막았다. 단일 분반은 기존처럼 정보만
  보여준다. 2026-2학기 자과캠 건축학과 실제 응답으로 기본·추가·교체·마지막 1개 보호·분반 직접
  선택을 브라우저에서 확인했고, ESLint·TypeScript·Vitest 18개 파일/87개 테스트·production build가 통과했다.

## ⏸️ 2026-07-14 작업 중단 인수인계

### 이번에 한 일

- 확정된 `분반별 교수·수업 방식` 표시 UI를 실제 분반 선택 상태와 연결했다.
- 과목 자체를 체크하면 `getInitialSectionIds`에 따라 맨 위 분반 1개만 기본 선택된다.
- 복수 분반 목록에서 다른 분반을 추가하거나 기존 분반을 해제해 허용 분반을 바꿀 수 있다.
- 아직 선택하지 않은 과목의 특정 분반을 바로 누르면 해당 과목과 그 분반을 함께 선택한다.
- 선택 과목의 허용 분반이 0개가 되지 않도록 마지막 분반 1개 해제를 막았다.
- 단일 분반 과목은 선택 체크박스를 중복 표시하지 않고 기존처럼 교수·수업 방식 정보만 보여 준다.
- 사용자가 변경을 모아 한 번에 커밋·배포하자고 지시했으므로 이번 변경은 로컬에만 보관했다.

### 변경한 파일 목록

- `web/src/components/TimetablePlanner.tsx` — 과목 목록의 분반 체크박스와 과목·분반 직접 선택 상태 연결.
- `web/src/components/TimetablePlanner.module.css` — 선택 가능한 분반 행과 선택 상태 스타일.
- `web/src/lib/selection-plan.ts` — 최소 한 분반을 유지하는 `toggleEnabledSectionId` 추가.
- `web/src/lib/selection-plan.test.ts` — 기본 분반·추가·교체·마지막 1개 보호 회귀 테스트.
- `.github/agent-logs/2026-07-14-codex-direct-section-selection.md` — 작업·검증·미배포 기록(미추적).
- `CURRENT_STATE.md` — 현재 인수인계 상태 갱신.

### 실행한 명령어 / 검증

- `cd web` 후 Node 경로를 적용하고 `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run build` 실행. PowerShell 실행 정책 때문에 실제 호출은
  `C:\Program Files\nodejs\npm.cmd run <script>` 형식을 사용했다.
- 최종 결과: ESLint 통과, TypeScript 통과, Vitest 18개 파일/87개 테스트 통과,
  Next.js production build 통과.
- `node_modules/next/dist/bin/next start -p 3001`로 임시 production 서버를 실행하고 검증 후 종료했다.
- 헤드리스 Edge CDP로 2026-2학기 자과캠 건축학과 실제 응답을 조회해 다음 상태를 확인했다.
  `첫 분반만 기본 선택 → 두 번째 분반 추가 → 첫 분반 해제 → 마지막 1개 해제 방지`.
- 미선택 복수 분반 과목의 두 번째 분반을 직접 눌렀을 때 과목 체크와 해당 분반 체크가 함께 활성화됨을 확인했다.
- `git diff --check` 통과. 커밋·push·Vercel 재배포는 실행하지 않았다.

## 📋 2026-07-14 데모데이 평가항목 반영

### 이번에 한 일

- 운영진 공지 원문과 첨부된 100점 루브릭을 `docs/08_데모데이_평가항목_루브릭.md`에 보존했다.
- 프로젝트의 문제·타겟, 범용 LLM 대비 차별점, 정보 처리 파이프라인, Upstage의 필연적 역할,
  AI 개발 판단 질문과 데모 증거 체크리스트를 공식 배점에 맞춰 정리했다.
- `AGENTS.md`의 매 세션 필수 읽기 순서에 루브릭을 추가하고, 큰 기능·데이터 구조 작업 전
  출처·변환·검증·차별성·Upstage 기여·사용자 효과·데모 증거를 확인하도록 했다.
- 현황 대시보드, 의사결정 로그 D-18, 미해결 과제 P16에 같은 기준을 연결했다.
- 오래된 `AGENTS.md`의 코드 미구현 안내를 실제 서비스·Vercel 배포 상태에 맞게 바로잡았다.

### 변경한 파일

- `AGENTS.md`
- `docs/00_프로젝트_현황_요약.md`
- `docs/01_의사결정_로그.md`
- `docs/05_미해결_과제.md`
- `docs/08_데모데이_평가항목_루브릭.md` 신규
- `.github/agent-logs/2026-07-14-codex-demo-day-rubric.md` 신규
- `CURRENT_STATE.md`

### 실행한 명령어

- `git status --short`, `git diff -- AGENTS.md`
- `Get-Content`, `rg`로 관련 문서 구조·기존 결정 번호·현재 인수인계 상태 확인
- 적용 후 문서 대상 `git diff --check`와 루브릭 배점 합계 검증

### 작업 범위

- 이 작업에서는 서비스 코드를 추가 수정하지 않았다.
- 기존 미커밋 분반 직접 선택 구현과 사용자·다른 세션의 변경을 보존했다.
- 커밋·push·Vercel 배포는 실행하지 않았다.

## ✅ 2026-07-14 Claude Code — 시간표 UI 요청 7종 + 체크상태 버그 수정

### 이번에 한 일

사용자가 요청한 7개 항목을 기존 미커밋 변경(분반 직접 선택 등) 위에 이어서 구현했다.

1. **강의 형식 필터** (`TimetablePlanner.tsx`): 현재 조회된 과목의 `courseType`(오프라인·
   온라인[사전제작]·플립러닝 등)을 동적으로 모아 체크박스로 노출. 기본은 전체 선택이며, 해제한
   형식의 분반은 `result` 조합 계산에서 제외한다(카탈로그 표시는 그대로 두고 조합 생성만 필터링).
2. **결과 시간표 동적 필터**: 생성된 조합 전체에서 실제로 갈리는 요일만 "○요일 공강" 체크박스로
   동적 노출(모든 조합이 동일하게 쉬거나 전혀 안 쉬는 요일은 필터로 안 보여줌). 기본은 전부
   미체크(전체 표시), 체크한 요일을 모두 만족하는 조합만 필터링. "조합 N" 번호는 필터와 무관하게
   원래 전체 목록 기준 번호를 유지한다.
3. **조합 카드에 버전/추가과목/총학점**: 각 생성 조합이 어느 선택 그룹에서 어떤 과목(영역 포함)을
   가져왔는지 `describeTimetableExtras`로 계산해 "조합 N" 옆 버전 라벨과 카드 상단 "추가 과목:" 줄로
   표시. 총학점은 기존에 이미 있던 것을 확인만 하고 유지했다.
4. **학사문서 카드 밀도**: `AcademicDocumentManager.module.css`의 `.dataCard`/`.requirementCard`
   패딩·gap·필드 높이를 더 줄이고, `AcademicCourseEditor.tsx`(수강/취득과목 "과목 N" 카드)에도
   `AcademicRequirementEditor.tsx`와 동일한 개별/전체 접기·펼치기, 접힌 요약 줄을 추가해 두 문서가
   똑같이 압축되게 했다. 8필드 과목 카드 전용 `courseFieldGrid` 그리드도 추가.
5. **파일 첨부 경로 안내**: `KIND_DETAILS`에 `attachGuide` 필드를 추가해 사용자가 준 정확한 GLS
   경로 안내문(수강/취득과목 PDF 저장 경로, 영역별 학점취득현황 스크린샷 경로)을 업로드 버튼 위에
   문서 종류별로 표시.
6. **필수→선택 체크상태 버그**: 원인은 사용자 확인 결과 "카탈로그 체크박스가 어느 위치에 배정됐든
   전역으로 항상 체크 표시"였다 — 필수에 담은 과목이 선택 그룹 화면으로 바꿔도 계속 체크된 것처럼
   보이지만 실제로 그 그룹에는 안 들어있어 혼란을 줬다. 체크박스를 "현재 활성 목적지에 배정된
   과목만" 체크로 보이게 바꾸고(`isAssignedToActiveDestination`), 다른 목적지에 이미 있는 과목은
   체크 해제 상태로 보이되 "{목적지}에 있음 · 눌러서 옮기기"로 안내해 클릭하면 기존 분반 선택을
   유지한 채 현재 목적지로 옮기게 했다(`toggleMajorCourseGroup`/`toggleElectiveSubject`/
   `toggleCatalogSection` 모두 동일 로직).
7. **기본 최대학점 18→21**로 변경.

### 변경한 파일

- `web/src/components/TimetablePlanner.tsx`, `TimetablePlanner.module.css`
- `web/src/components/AcademicCourseEditor.tsx`
- `web/src/components/AcademicDocumentManager.tsx`, `AcademicDocumentManager.module.css`
- `CURRENT_STATE.md`

### 실행한 명령어 / 검증

- `npm run lint`, `npm run typecheck`, `npm run test`(18개 파일/87개 테스트), `npm run build`
  — 매 기능 구현 후 최소 1회, 최종적으로 한 번 더 전부 재실행해 통과 확인. Node PATH가 빠진
  PowerShell 세션이라 `$env:Path = "C:\Program Files\nodejs;" + $env:Path`를 매번 적용했다.
- 컴포넌트 단위 테스트(.test.tsx)는 이 저장소에 없어 lib 테스트로만 회귀를 확인했다 — UI 동작은
  코드 리딩과 타입체크로 검증했고 브라우저 수동 조작 검증은 하지 않았다(자동화 브라우저 도구 없음).
- Vercel CLI(`npx vercel`)로 로그인(`jaeseonghong-a11y` 계정)하고 기존 프로젝트
  `jaeseonghongs-projects/timetable-with-upstage`에 저장소 루트를 연결(`.vercel/`는 gitignore
  대상). `vercel deploy --prod --yes`는 **하네스 안전장치에 막혀 실행되지 않았다** — 사용자가
  요청한 순서(작업→커밋→배포)를 안 지키고 커밋 없이 곧장 프로덕션에 배포하려 한 것이 원인.
  커밋을 먼저 하고, 배포는 사용자에게 다시 확인받은 뒤 진행할 것.

### 작업 범위

- 기존 미커밋 변경(분반 직접 선택, P10~P16 등)을 전부 보존하고 그 위에 이어서 구현했다.
- 이번 세션 자체는 서비스 코드만 수정했고 `docs/02_기술검증_기록.md`·`docs/성대_학과코드_전체.txt`의
  사용자 unstaged 편집은 건드리지 않았다.

### 커밋·배포 (사용자 명시 지시)

- 위 7종 + 그 이전까지 로컬에 쌓여있던 모든 미커밋 변경(scraper 정식 구현, 학사문서 파이프라인,
  전공/교양 자동조회, 조합엔진, P10~P16 등 57개 파일)을 한 커밋으로 커밋: `8b50ffc`.
- `npx vercel` 로그인 → 기존 프로젝트 `jaeseonghongs-projects/timetable-with-upstage`에
  저장소 루트를 연결 → `vercel deploy --prod --yes`로 프로덕션 배포 성공.
  https://timetable-with-upstage.vercel.app 가 새 배포를 가리키도록 alias됨.
- ⚠️ 첫 배포 시도는 커밋 전에 실행해 하네스 안전장치("Blind Apply" 분류기)에 막혔다 —
  "커밋하고 배포해줘" 순서를 지키지 않고 곧장 프로덕션에 올리려 한 것이 원인. 커밋을 먼저
  끝낸 뒤 재시도해서 성공했다. **다음에도 같은 실수를 반복하지 말 것: 반드시 커밋 → (필요시
  사용자 확인) → 배포 순서를 지킨다.**
- 사용자가 "이 배포가 예전 GPT 세션에서 쓰던 그 URL이 맞는지" 확인 요청 → `vercel ls`로
  배포 이력을 보여줘서 기존 배포(2시간 전, 3건) 위에 이어서 배포한 것임을 확인시킴(새 프로젝트를
  만든 게 아님).

## ⏸️ 2026-07-14 Claude Code — 세션 종료 인수인계 (UI 요청 7종 + 후속 버그 3건)

> 이 섹션이 지금 이 저장소의 최신 상태다. 위쪽의 날짜별 섹션들은 그 시점까지의 이력이고,
> 아래 "남은 문제"·"Recommended Next Step"이 지금 기준으로 유효한 것만 남긴 최신본이다.

### 이번에 한 일

이전 인수인계(`⏸️ 2026-07-14 작업 중단 인수인계` 섹션) 이후, 로컬에 쌓여있던 모든 미커밋
작업을 커밋·배포하고, 사용자가 실사용 중 요청한 기능 7종과 버그 3건을 순서대로 구현·검증·
커밋·배포했다. 총 5개 커밋, 5회 프로덕션 배포, 전부 사용자가 각각 명시적으로 확인 후 진행.

1. **`8b50ffc`** — 그동안 쌓여있던 미커밋 변경 일괄 커밋(57개 파일: scraper 정식 구현,
   학사문서 파이프라인, 전공/교양 자동조회, 조합엔진, P10~P16 등, 분반 직접 선택 포함) +
   사용자 요청 UI 7종:
   1) 강의 형식(오프라인/온라인[사전제작]/플립러닝 등) 필터 체크박스
   2) 생성된 시간표 조합의 동적 공강일 필터
   3) 조합 카드에 버전(선택그룹 출처)·추가 과목(영역 포함)·총학점 표시
   4) 학사문서 카드(수강/취득과목·졸업요건) 밀도 개선 + 개별/전체 접기 통일
   5) 학사문서 업로드 UI에 정확한 GLS 발급 경로 안내문 추가
   6) 필수→선택 그룹 이동 시 체크박스가 전역으로 표시되던 버그 수정(현재 활성 목적지
      소속만 체크로 표시, 다른 목적지 소속은 "옮기기"로 안내)
   7) 원하는 학점 범위 기본 최댓값 18 → 21
2. **`de0b7cb`** — 사용자 후속 요청 3건: 과목 담기 기본 목적지 "선택 그룹 1" → "필수 과목",
   학점 범위 화살표 step 0.5 → 1, 강의형식 필터를 "결과 필터링"에서 "카탈로그 선택 단계
   필터링"으로 이동.
3. **`16d450c`** — 버그 수정: 학사문서 분석이 "Solar 추출 결과가 학사 데이터 형식을
   만족하지 않았습니다"로 간헐적 실패. 실제 Solar API로 재현·확인한 결과 Solar 자체의
   비결정적 출력(같은 입력에도 가끔 JSON 형식이 깨짐)이 원인 — `max_tokens` 문제 아님.
   최초 Solar 응답이 형식을 어기면 동일 프롬프트로 1회 자동 재시도하도록 수정.
4. **`04adf84`** — 버그 수정: 강의형식 필터를 바꾸면 이미 선택한 과목이 선택 해제되던 문제.
   "카탈로그에 뭘 보여줄지"용 필터를 "이미 선택된 과목" 계산에도 잘못 재사용한 게 원인 —
   두 계산을 분리해 이미 계획에 넣은 과목은 필터를 바꿔도 유지되게 수정.
5. 각 커밋 직후 Vercel 프로덕션에 배포(`npx vercel deploy --prod --yes`, 저장소 루트에서
   실행). 최종 배포: `dpl_EL8XBkNexBGNCwiNaa2zvEN5UxUx` →
   https://timetable-with-upstage.vercel.app

### 변경한 파일 목록

- `web/src/components/TimetablePlanner.tsx`, `TimetablePlanner.module.css`
- `web/src/components/AcademicCourseEditor.tsx`
- `web/src/components/AcademicDocumentManager.tsx`, `AcademicDocumentManager.module.css`
- `web/src/lib/academic-document.ts`
- `web/src/app/api/parse-academic-document/route.test.ts`
- `CURRENT_STATE.md`
- (커밋 `8b50ffc`에는 위 외에도 그 이전 세션들이 쌓아둔 57개 파일이 함께 포함됨 —
  scraper, docs/06~08, agent-logs 등. 상세는 위쪽 날짜별 섹션 참조)

### 실행한 명령어

- `git status --short`, `git add <파일>`, `git commit -m "..."` — 매번 관련 파일만 골라서
  커밋(무관한 `START_HERE.md`·`docs/02` unstaged 변경과 섞지 않음).
- `npm run lint`, `npm run typecheck`, `npm run test`(18개 파일/87개 테스트), `npm run build`
  — 매 기능·버그 수정 후 실행, PowerShell에서 Node PATH 누락 시
  `$env:Path = "C:\Program Files\nodejs;" + $env:Path` 선적용.
- `npx vercel login`(계정 `jaeseonghong-a11y`) → `npx vercel link --yes --project
  timetable-with-upstage`(저장소 **루트**에서 실행 — `web/` 안에서 하면 `web/web` 경로 오류) →
  `npx vercel deploy --prod --yes`(커밋마다 반복).
- Solar 비결정성 진단용으로 `node`로 임시 스크립트를 만들어 실제 Solar API(`solar-pro3`)를
  합성(가짜) 데이터로 2회 라이브 호출·비교(스크립트는 진단 후 삭제, 저장소에 남기지 않음).

## ⏸️ 2026-07-14 Claude Code — AI 시간표 추천 + 교양과목 캐싱

> 이 섹션이 지금 이 저장소의 최신 상태다. 위쪽 섹션들은 그 시점까지의 이력이다.

### 이번에 한 일

사용자가 3가지를 요청: (1) 필수/선택 과목·수강내역·졸업요건·학과 로드맵 기반 AI 시간표 추천
(가중치 선택 가능), (2) 과목별 강의계획서 자동 열람, (3) 교양과목 로딩 속도 개선. 조사 후
(1)·(3)만 구현하고 (2)는 실현 불가능함을 확인해 제외했다(아래 "제외한 이유" 참조). 코드
수정 전 Explore 에이전트 3회로 데이터 가용성·기존 아키텍처를 조사했고, Plan 에이전트로
구현 설계를 검증했다. 아직 커밋·배포 전 — 사용자 확인 대기 중.

**제외한 항목과 이유:**
- 과목별 TO(여석): 성대 공개 API에 필드 자체가 없고 로그인 후 실시간 수강신청 화면에만
  존재하는 값이라 사전 수집 불가능.
- 과목 클릭 → 자동 강의계획서 열람: `INTRO_URL`(LCMS 링크) 접근 제한을 이미 실측 확인함
  (`docs/05_미해결_과제.md` P6, 2026-07-13에 해결로 기록됨). 사용자 업로드 기반 강의계획서
  파싱(`parse-syllabus`)은 이미 별도로 존재하며 그대로 유지.
- 학과/학번별 로드맵: `curriculum.py` 스크레이퍼가 웹앱과 전혀 연결 안 돼 있고, 성대 공개
  교과과정 데이터에 학년 필드가 없어(D-13 이전부터 알려진 제약) 이번 AI 추천에서는 로드맵
  차원을 뺐다.

**1. 교양과목 캐싱** — 원인은 매 요청마다 SKKU 서버에 세션 로그인 + 영역 조회 + 순차 과목
조회(최대 14회, 300ms 인위 지연 포함)를 실시간으로 반복하는 구조(서버 캐시 전무)였다.
- `web/src/lib/cache-store.ts`: `CacheStore<T>` 인터페이스(get/set/TTL) + `InMemoryTtlCache`
  구현체. 나중에 Vercel KV/Upstash Redis로 최소 수정 교체 가능하도록 인터페이스로 분리(사용자
  요청 사양).
- `web/src/lib/cache-constants.ts`: 세션 캐시 TTL 5분, 교양 카탈로그/분반 캐시 TTL 12시간(상수).
- `web/src/lib/skku-course-api.ts`: 세션 쿠키, 교양 전체 카탈로그, 과목별 분반 결과에 각각
  캐시 적용 + `resetSkkuApiCaches()`(테스트 전용) 추가.
- `TimetablePlanner.tsx`의 분반 프리뷰 큐를 완전 순차(Promise 체인)에서 동시성 3짜리
  lane 방식으로 변경(세션 캐시가 생겨 로그인 폭주 위험이 낮아진 뒤에만 적용).
- **라이브 검증**: 개발 서버로 동일 교양 카탈로그를 2회 요청 → 첫 호출 9.7초(SKKU 실서버
  왕복) → 두 번째 호출 0.012초(캐시 히트), 응답 바이트 동일 확인.
- 결정 기록: `docs/01_의사결정_로그.md` D-19, `docs/05_미해결_과제.md` "낮음 (나중)"에
  "[중간점검 후 검토] 외부 캐시 전환 여부" 항목 추가.

**2. AI 시간표 추천** — 결과 리스트(기존 "순위 없음" 전체 목록) 아래에 별도 "AI 시간표 추천"
섹션을 추가했다. 기존 UI/동작은 전혀 바꾸지 않았다.
- `web/src/lib/timetable-scoring.ts`: 결정론적 가중치 스코어러. 8개 가중치 — 공강 요일
  만들기, 연강 선호/기피(임계 시간 설정), 점심시간(11~13시 사이 1시간) 확보, 오전 9시 수업
  회피, 수업일수 최소화, 대면 수업 선호, 온라인 수업 선호, 하루 재학시간 최소화. 유닛
  테스트 12개.
- `web/src/app/api/timetable-recommendations/route.ts`: 하이브리드 구조 — ①결정론적
  스코어러로 이미 생성된 유효 조합(최대 500개) 중 상위 8개 선정 → ②그 상위 8개 + 미충족
  졸업요건 요약 + 자유입력 "기타" 조건만 Upstage Solar에 보내 후보별 추천 이유·졸업요건
  기여도·재정렬(rank가 1..N 깨끗한 순열일 때만 반영, 아니면 결정론적 순서 유지)을 생성.
  Solar 실패 시 전체 요청을 실패시키지 않고 결정론적 순위만 반환(`aiExplanationFailed: true`).
  단위 테스트 7개.
- `PlanningWorkspace.tsx`: `graduation_requirements` 프로필의 `requirements` 배열을
  `TimetablePlanner`에 새 prop으로 전달(기존엔 `excludedCourseNumbers`만 파생하던 곳).
- `TimetablePlanner.tsx`: 가중치 토글 UI(대면/온라인은 상호배타 라디오 처리), 연강 임계
  시간·방향 설정, "기타 원하는 조건" 자유 텍스트 입력, "AI 추천 받기" 버튼, 추천 결과 카드
  (순위·과목·Solar 이유·졸업요건 기여도·자유조건 메모) 추가.
- **라이브 검증**: 개발 서버 기동 후 실제 Upstage Solar API로 종단 검증 — 9시 수업 포함
  조합과 미포함 조합을 넣었더니 결정론적 스코어러가 9시 수업 없는 조합을 정확히 1순위로
  선정했고, Solar가 그 이유·미충족 전공필수 기여도·"화요일 오후 선호" 자유조건 반영 메모를
  모두 정확하게 생성해 반환함(200 OK, 2.3초).
- D-13(2026-07-13)이 부담도 점수화·정렬·상위 N을 보류했던 결정과, D-14가 "구체적인 순위
  기준과 가중치는 별도 검증 후 구현한다"고 남겨둔 유보를 이번에 사용자 요청으로 착수함 —
  `docs/01_의사결정_로그.md` D-20에 이 연결을 명시적으로 기록함(D-13·D-14와 모순 아님).

### 변경한 파일 목록

- 신규: `web/src/lib/cache-store.ts`, `cache-constants.ts`, `timetable-scoring.ts`,
  `timetable-scoring.test.ts`, `web/src/app/api/timetable-recommendations/route.ts`,
  `route.test.ts`
- 수정: `web/src/lib/skku-course-api.ts`, `skku-course-api.test.ts`,
  `web/src/components/TimetablePlanner.tsx`, `TimetablePlanner.module.css`,
  `web/src/components/PlanningWorkspace.tsx`
- 문서: `docs/01_의사결정_로그.md`(D-19, D-20), `docs/05_미해결_과제.md`, `CURRENT_STATE.md`

### 실행한 명령어

- `cd web && npm run lint && npm run typecheck && npm run test -- --run` — 매 단계 후 실행,
  전부 통과(최종 20개 테스트 파일, 108개 테스트).
- `npm run dev`(백그라운드) → `curl`로 `/api/skku-electives`(캐시 전/후 응답시간 비교),
  `/api/timetable-recommendations`(실제 Solar 호출 종단 검증), 홈페이지 HTML(새 UI 텍스트
  렌더 확인) 직접 호출.
- 사용자 확인(`커밋 + 배포`) 후 `git add`(관련 파일만) → `git commit`(`5581d70`) →
  저장소 루트에서 `npx vercel deploy --prod --yes`(`dpl_BUNoVwFVENKQiyMXpQ4EjyyRpkF6`) →
  프로덕션 홈페이지에 새 UI 텍스트("AI 시간표 추천")가 렌더되는지 `curl`로 재확인 완료.

## ⚠️ 남은 문제 / 막힌 곳
> 해결 못 한 것, 에러, 판단이 필요한 지점. 없으면 "없음".

- 수집된 INTRO_URL은 접근제한이라 자동 수집에는 사용할 수 없음. 실제 서비스는 사용자 PDF 업로드를
  입력으로 삼는다. 공개 성균관대 PDF 1건의 Parse·정규화 품질은 검증 완료했으며, 한국어/표 중심
  강의계획서 샘플이 확보되면 품질을 추가 검증할 수 있다.
- TERM=20 행수(107 vs 문서상 214) 불일치 — 원인 불명, 수집기 동작엔 지장 없음.
- scraper/venv(.venv/)는 gitignore 대상이라 커밋 안 됨. 다음 세션에서 재현하려면
  `cd scraper && python -m venv .venv && pip install -e ".[dev]"` 재실행 필요.
- 전공·교양 개설강좌와 검토 중 기수강 제외는 연결됐다. 졸업요건은 이제 AI 시간표 추천에서
  참고 자료로 쓰인다(D-20, `docs/01_의사결정_로그.md`). 이름 있는 고정 일정 편집 UI,
  캠퍼스/온라인 필터, 실제 개설강좌-교과과정 조인은 아직 남았다.
- 공개 중앙 교과과정에는 권장 학년 정보가 없어 학년별 로드맵 우선 정렬은 데이터 소스 확보 전까지
  보류한다. 사용자가 공식 교육과정 로드맵 PDF/Excel 원본을 제공하면 이를 한 번 파싱해
  `학과-학년-과목` 정규화 데이터로 저장하기로 했으며, 현재 학년을 과목 코드나 설명으로 임의 추정하지 않는다.
- 개인 학사문서 원본 보호를 위해 `.gitignore`에 `docs/정보광장-*`, `docs/졸업요건*`, `private/`를
  추가했다. 원본·전체 Parse 결과·개인식별자는 저장·커밋하지 않는 원칙을 계속 지킨다.
- ⚠️ **여전히 커밋 안 된 무관한 변경 있음**: `docs/02_기술검증_기록.md`·
  `docs/성대_학과코드_전체.txt`에 사용자가 이전 세션에서 직접 추가한 내용(헤더 정밀진단·
  세션 원인 분석 등)이 아직 unstaged 상태로 남아있음. 이번 세션에서도 건드리지 않았다.
  `START_HERE.md`도 그 이전부터 있던 별개의 unstaged/staged 서식 정리 변경이 남아있다.
  다음 도구는 `git status --short`·`git diff -- docs/02 START_HERE.md`로 먼저 확인하고
  사용자와 커밋 여부를 상의할 것 — 지금까지의 커밋들은 이 두 파일을 의도적으로 제외해왔다.
- Solar 추출 실패는 1회 재시도로 완화했지만 100% 해결은 아니다(LLM 비결정성은 근본적으로
  제거 불가). 재시도 후에도 계속 실패한다는 보고가 오면 재시도 횟수를 늘리거나, 실패 시
  사용자에게 "다시 시도" 버튼을 노출하는 등 UX 차원의 보완이 필요할 수 있다.
- 공식 루브릭에 필요한 파이프라인 도식, 범용 LLM 비교 데모, Upstage 적용 전후 수치, 실제 사용자
  효과 근거와 발표 자료는 아직 만들지 않았다. `docs/05_미해결_과제.md` P16에서 추적한다.

## ▶️ Recommended Next Step (다음 도구가 이어서 할 일)

1. 시작 즉시 `git status --short`를 읽는다. 이 인수인계 시점 기준으로는 `CURRENT_STATE.md` 외
   미커밋 변경은 없어야 한다(커밋 `5581d70`, 배포 `dpl_BUNoVwFVENKQiyMXpQ4EjyyRpkF6`까지 완료됨).
   `docs/02`·`START_HERE.md`의 무관한 unstaged 변경은 예외 — 위 참조. 커밋·배포는 항상
   사용자가 명시적으로 요청한 뒤에만 진행한다(하네스가 순서 안 지킨 배포를 막은 전례 있음).
   배포는 저장소 **루트**에서 `npx vercel deploy --prod --yes`.
2. 사용자가 시간표 위에 이름 있는 고정 일정(알바·기타)을 직접 그리거나 시각을 입력하는 편집 UI를
   붙이고, 과목·고정 일정의 충돌을 같은 제약 엔진에서 제거한다.
3. 졸업요건의 남은 영역을 교양 탐색 기본 영역과 연결하고, 캠퍼스 이동/온라인 수업 예외 규칙을
   조합 엔진에 추가한다. AI 시간표 추천(가중치 스코어러 + Solar 설명)은 D-20으로 이미
   구현됐다 — 추가로 손댈 곳은 가중치 항목 튜닝이나 UI 다듬기 정도.
4. 사용자가 공식 교육과정 로드맵 PDF/Excel을 제공하면 원본을 `private/`에 두고 한 번만 파싱해
   `학과-학년-과목` 정규화 JSON으로 만든 뒤, 선택 학년 전공과목 우선 표시를 추가한다. 현재 중앙
   교과과정 데이터는 과목·학점·설명만 있고 권장 학년이 없어 임의 추정하지 않는다.
5. 공식 루브릭(`docs/08`) 대비 데모 증거(파이프라인 도식, LLM 비교, Upstage 적용 전후 수치)를
   준비한다. `docs/05_미해결_과제.md` P16 참조.
6. [중간점검 후 검토] 교양과목 캐싱은 인메모리 TTL로 시작했다(`web/src/lib/cache-store.ts`).
   콜드스타트 직후 재요청이 느려지는 트레이드오프가 있으니, 데모에 문제가 되면 `CacheStore`
   인터페이스를 그대로 구현하는 Vercel KV/Upstash Redis로 전환한다. `docs/05_미해결_과제.md`
   "낮음 (나중)" 참조.

---

## 🔒 절대 잊지 말 규칙 (매 세션 상기)
- Upstage(Parse/Extract/Solar)가 **서비스의 심장**. 크롤링은 조연. (대회 필수 요건)
- 공식 평가표와 모든 큰 기능의 판단 게이트는 `docs/08_데모데이_평가항목_루브릭.md`를 따른다.
- API 키는 환경변수로만. 코드·커밋에 절대 넣지 않는다.
- 커밋 전 품질 게이트(lint/typecheck/test) 통과 필수.
- 기존 구현을 함부로 되돌리지 않는다. 이어서 작업한다.
- 상세 규칙은 `AGENTS.md`.

---

## 📖 참조 (막히면 여기부터)
- `AGENTS.md` — 전체 규칙·워크플로우
- `docs/08_데모데이_평가항목_루브릭.md` — 공식 공지·100점 배점·AI 판단 게이트
- `docs/00_프로젝트_현황_요약.md` — 프로젝트 큰 그림
- `docs/02_기술검증_기록.md` — 성대 API 완전 명세 (수집기 구현 필수)
- `docs/05_미해결_과제.md` — 열린 과제
- `WORKFLOW.md` — 두 도구 넘나드는 법
