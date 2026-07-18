# 2026-07-18 — UI/UX 개선 (로컬 `uiux-redesign`)

> 이 세션에서 사용자가 요청·반영한 UI 변경 요약.  
> 관련 커밋: `f02a32f` → `61ddeaa` → `501244f` (기준: `origin/main` 위 3커밋)

## 환경·동기화

- 로컬이 GitHub `main`보다 뒤처져 있어 AI 추천 UI가 안 보이던 문제 → `git pull`로 동기화
- PowerShell 실행 정책 때문에 `npm`이 막히던 문제 → `CurrentUser`를 `RemoteSigned`로 설정
- `web/`에서 `npm install` 후 로컬 개발 서버로 확인

## 기능·UI 변경

### 1. 시간표에 교수명 표시 (`f02a32f`)
- `TimetableCard` 과목 블록·시간 미정 목록에 교수 성함 표시
- AI 추천 시간표·일반 유효 시간표·공유 페이지에 공통 적용

### 2. 분반 전체 선택 (`f02a32f`)
- 카탈로그 분반 목록 / 담은 과목 상세에 **분반 전체 선택** 버튼 추가
- `selection-plan.ts`에 `getAllSectionIds` 헬퍼·테스트 추가

### 3. 5단계 슬라이드형 플로우 (`61ddeaa`)
스크롤 나열 → 단계 전환 UI로 변경. 로직/API는 유지하고 표시만 분리.

| 단계 | 내용 |
|---|---|
| 1 | 기본 정보 입력 |
| 2 | 학사문서 읽기 |
| 3 | 과목 담기 (+ 유효 시간표) |
| 4 | AI 시간표 추천 |
| 5 | 강의계획서 평가 방식 확인 |

- `PlanningWorkspace`: 진행률 바·단계 버튼·이전/다음
- `TimetablePlanner`: `view` prop으로 화면 분리
- `SyllabusUploader`를 5단계로 이동 (`page.tsx`에서 직접 렌더 제거)
- 1단계는 기본정보 적용 후에만 다음 가능 / 2단계 학사문서는 스킵 가능

### 4. 3단계 이름
- `넣을 과목 넣기` → **과목 담기**

### 5. 3단계 A/B 분리 (`501244f`)
한 화면이 너무 길어 피로 → 3단계를 두 장으로 분할.

| 서브 | 제목 | 보이는 것 |
|---|---|---|
| 3-A | 과목 담기 (1/2) | 과목·분반·선택 그룹 |
| 3-B | 유효 시간표 확인 (2/2) | 요일·학점·시작시간 + 결과 |

- `view`: `"select" | "results" | "ai"`
- A↔B↔4 사이에서 `TimetablePlanner` 마운트 유지 → 담은 과목 상태 보존
- A에서 다음 버튼 문구: **유효 시간표 보기**

## 아직 손대지 않은 UX 이슈 (논의만)

3단계 남은 문제점으로 정리해 둔 것 (미구현):

1. 전체 `3/5`와 내부 `(1/2)` 진행 표시가 겹쳐 헷갈림
2. 3-A 안에도 카탈로그+선택그룹+분반이 한꺼번에 있어 밀도 높음
3. 필수/선택 그룹/분반 용어 학습 비용
4. 담은 과목 수·학점 합 같은 진행 피드백 부족
5. A↔B 왕복 시 “왜 조합 0개인지” 진단이 약함
6. 실패 메시지가 추상적
7. primary action 시각 위계가 약함

## 변경 파일 (main 대비)

- `web/src/components/PlanningWorkspace.tsx` (+ `PlanningWorkspace.module.css`)
- `web/src/components/TimetablePlanner.tsx` (+ module CSS)
- `web/src/components/TimetableCard.tsx`
- `web/src/lib/selection-plan.ts` / `selection-plan.test.ts`
- `web/src/app/page.tsx`

## 확인 방법

```powershell
cd web
npm run dev
```

브라우저에서 1→5 단계 이동, 3-A에서 과목 담기 → 유효 시간표 보기 → AI 추천까지 흐름 확인.
