"""성대 개설강좌 API 클라이언트 (전공/교양).

명세 출처: ../../docs/02_기술검증_기록.md "방법 A: 순수 API 직접호출".
요청 간격을 두어 서버 부담을 줄인다 (../../docs/04_규칙과_지켜야할것.md 데이터 안전선).

⚠️ 2026-07-13 실측 메모 (docs/05_미해결_과제.md 참조):
- 기본 User-Agent(python-requests)로는 404/커넥션리셋 → 브라우저 User-Agent·Referer·Origin
  헤더를 붙여야 200을 받는다 (아래 _HEADERS에 반영 완료).
- 단, "KEY=VALUE"·"KEY:string=VALUE" 두 인코딩 모두 ErrorCode:int=0(성공)은 받지만
  데이터 행이 0개로 돌아옴 → 파라미터 인코딩 자체가 아직 완전히 맞지 않는 것으로 추정.
  실제 넥사크로 엔진이 보내는 바이트를 다시 캡처(브라우저 네트워크 후킹)해서 재검증 필요.
"""

from __future__ import annotations

import time

import requests

from skku_scraper.ssv import SSVError, SSVResponse, parse_ssv

BASE_URL = "https://kingoinfo.skku.edu/gaia"
MAJOR_ENDPOINT = f"{BASE_URL}/E_NHSSU900020M/selectMain.do"
ELECTIVE_ENDPOINT = f"{BASE_URL}/E_NHSSU900010M/selectMain03.do"

_HEADERS = {
    "Content-Type": "text/xml",
    "Accept": "application/xml, text/xml, */*",
    "X-Requested-With": "XMLHttpRequest",
    "X-NX-Content-Type": "2",
    "Cache-Control": "no-cache",
    # 기본 python-requests UA는 서버가 404/커넥션리셋으로 거부함 (2026-07-13 실측).
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://kingoinfo.skku.edu/gaia/nxui/outdex.html?language=KO&menuId=NHSSU030840M",
    "Origin": "https://kingoinfo.skku.edu",
}

DEFAULT_REQUEST_INTERVAL_SECONDS = 0.5


class SkkuApiError(Exception):
    """성대 API가 ErrorCode!=0을 반환했을 때."""


def _build_ssv_body(**params: str) -> str:
    """Nexacro SSV 요청 바디를 만든다. 각 파라미터를 'KEY=VALUE' 레코드로 직렬화."""
    records = [f"{key}={value}" for key, value in params.items()]
    return "\x1e".join(records) + "\x1e"


def _post(endpoint: str, **params: str) -> SSVResponse:
    body = _build_ssv_body(**params)
    resp = requests.post(endpoint, headers=_HEADERS, data=body.encode("utf-8"), timeout=10)
    resp.raise_for_status()
    try:
        parsed = parse_ssv(resp.text)
    except SSVError as exc:
        raise SkkuApiError(f"SSV 파싱 실패: {exc}") from exc
    if not parsed.ok:
        raise SkkuApiError(f"성대 API 오류 (ErrorCode={parsed.error_code}): {parsed.error_msg}")
    return parsed


def fetch_major_courses(
    year: int,
    term: int,
    hakgwa_cd: str,
    campus_gb: int,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, str]]:
    """전공과목을 조회한다. 응답 데이터셋명은 dsGrdMain."""
    time.sleep(request_interval)
    result = _post(
        MAJOR_ENDPOINT,
        YEAR=str(year),
        TERM=str(term),
        HAKGWA_CD=hakgwa_cd,
        CAMPUS_GB=str(campus_gb),
        ROAD_MAP="%",
        HAK_JIBJUNG="0",
        _FIRST_OUT_DS_NM="dsGrdMain",
        _TRANSACTION_ID="selectMain",
    )
    return result.datasets.get("dsGrdMain", [])


def fetch_elective_courses(
    year: int,
    term: int,
    haksu_no: str,
    campus_gb: int,
    *,
    request_interval: float = DEFAULT_REQUEST_INTERVAL_SECONDS,
) -> list[dict[str, str]]:
    """교양과목을 영역코드(haksu_no)로 조회한다. 응답 데이터셋명은 dsGrdMain03."""
    time.sleep(request_interval)
    result = _post(
        ELECTIVE_ENDPOINT,
        YEAR=str(year),
        TERM=str(term),
        HAKSU_NO=haksu_no,
        CAMPUS_GB=str(campus_gb),
        ROAD_MAP="%",
        HAK_JIBJUNG="0",
        _FIRST_OUT_DS_NM="dsGrdMain03",
        _TRANSACTION_ID="selectMain03",
    )
    return result.datasets.get("dsGrdMain03", [])
