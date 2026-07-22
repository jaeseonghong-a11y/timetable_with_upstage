# Friend remix course color contrast — 2026-07-23

## 이번에 한 일

- 어두운 녹흑색 배경과 대비되도록 리믹스 과목 출처 색을 민트/청록빛 파랑/올리브-골드로
  명확히 분리했다.
- 범례와 실제 시간표 블록에 동일한 배경색을 쓰고, 범례 칸의 크기와 테두리 대비를 높였다.

## 검증 결과

- `cd web && npm.cmd run lint && npm.cmd run typecheck && npm.cmd run test && npm.cmd run build` 통과.
- Vitest: 30개 테스트 파일, 241개 테스트 통과.

## 의도적으로 하지 않은 것

- 과목 출처 판정·조합·점수 계산 로직은 변경하지 않았다.
- 이 수정은 아직 커밋, push, Vercel 배포하지 않았다.
