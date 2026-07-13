# scraper/

성균관대 개설강좌 수집기. 서비스의 조연(시딩용) — 심장은 `web/`의 Upstage 파싱 파이프라인.

API 명세는 `../docs/02_기술검증_기록.md` 참조.

## 개발

```bash
pip install -e ".[dev]"
ruff check .
ruff format --check .
pytest
```
