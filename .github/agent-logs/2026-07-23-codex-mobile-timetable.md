# 2026-07-23 — 모바일 완성 시간표·진행바 대응 보강

## 이번에 한 일

- 작업 전 `git log --oneline -5`로 에타 강의평 수업 블록 클릭 기능이 이미
  `41be4b8 feat: improve Everytime review navigation`에 포함된 것을 확인했다. 그 기능의 클릭
  로직은 건드리지 않고, 모바일에서 그 버튼 블록을 더 읽기 쉽고 누르기 쉽게 만드는 CSS만 추가했다.
- `TimetablePlanner.module.css`에 `max-width: 480px` 전용 규칙을 추가했다.
  - 캘린더는 가로 스크롤을 유지한다. 최소 폭은 620px에서 560px으로, 시간축은 48px에서 40px으로
    조정했고 각 요일 열은 최소 104px을 보장한다.
  - 스크롤 컨테이너에는 `scroll-snap-type: x mandatory`, 실제 요일 열에는
    `scroll-snap-align: start`와 `scroll-snap-stop: always`를 적용했다. `scroll-padding-left: 40px`으로
    스냅해도 시간축이 보이게 했다.
  - 모바일 전용 안내 문구 "옆으로 밀어서 다른 요일도 보세요"를 시간표 바로 위에 표시했다.
  - 강의평으로 연결되는 수업 블록의 최소 높이를 44px으로 키우고, 과목명과 시간 글자를 11px으로
    맞췄다. 공간이 좁은 모바일에서는 교수명만 숨기며, 과목명과 수업 시간은 유지한다.
- `PlanningWorkspace.module.css`에 별도 `max-width: 480px` 규칙을 추가해 6개 단계 진행바 원을
  34px로 복원했다. 기존 640px 대응 규칙은 변경하지 않았다.
- `layout.tsx`의 Next viewport 설정에 `width: "device-width"`, `initialScale: 1`을 명시했다.

## 검증

- 품질 게이트: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run test`(28개 파일/232개),
  `npm.cmd run build` 모두 통과했다. `git diff --check`도 통과했다.
- 로컬 production 서버(`npm.cmd run start -- -p 3001`)에서 Chrome DevTools 원격 디버깅의 모바일
  기기 에뮬레이션으로 실제 렌더링을 확인했다. 테스트용 공유 시간표에는 요일별 긴 과목명과 시간,
  교수명을 넣어 좁은 칸의 표시를 점검했다.
  - **375px:** 문서 폭은 `375/375px`(scrollWidth/clientWidth)로 같아 body 가로 스크롤이 없었다.
    캘린더 내부는 `329px → 588px`으로만 가로 스크롤됐고, `scroll-snap-type: x mandatory`와 각
    `.dayColumn`의 `scroll-snap-align: start`를 실제 계산 스타일로 확인했다. 스크롤 요청은
    `0/55/100/145/185/235px`에서 각각 `14.55/14.55/118.18/118.18/222.73/222.73px`에 정착해
    약 104px(요일 열) 단위로 스냅했다. 수업 블록은 높이 약 60px, 과목명 11px, 교수명 숨김으로
    렌더링되어 과목명·시간을 읽을 수 있었다. 시작 화면의 가이드를 닫은 뒤 진행바도 직접 확인했고,
    6개 원은 모두 34px, 원과 라벨의 겹침은 없었으며 페이지 폭은 `375/375px`이었다.
  - **430px:** 문서 폭은 `430/430px`으로 body 가로 스크롤이 없었다. 캘린더 내부만
    `377px → 588px`으로 스크롤됐고, 스냅 후 `118.18px`에 정착했다. 모바일 안내 문구, 560px
    최소 그리드, 11px 과목명/시간, 숨긴 교수명이 모두 실제 계산 스타일과 화면에서 확인됐다.

## 의도적으로 하지 않은 것

- 시간표 과목 배치·충돌 처리·강의평 클릭 로직은 변경하지 않았다.
- 기존 STEP3의 760px/520px, 기본정보·학사문서 화면의 기존 반응형 규칙은 건드리지 않았다.
- 작업 종료 시 보인 `web/src/lib/academic-document.ts`와
  `web/src/lib/academic-document.test.ts`의 별도 미커밋 변경은 이 작업 범위 밖이므로 읽거나
  수정하지 않았다.
- 커밋, push, Vercel 배포는 사용자 지시대로 실행하지 않았다.
