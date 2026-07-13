"""성대 개설강좌 API 조회에 쓰이는 코드 상수.

명세 출처: ../../docs/02_기술검증_기록.md, ../../docs/성대_학과코드_전체.txt
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# TERM 코드 (2026학년도 경영학과 실측 기준, ../../docs/02_기술검증_기록.md 참조)
TERM_1ST_SEMESTER = 10
TERM_SUMMER = 15
TERM_2ND_SEMESTER = 20
TERM_WINTER = 25  # 겨울학기는 미개설(0개) 확인됨

# CAMPUS_GB 코드
CAMPUS_HUMANITIES = 1  # 인문사회캠퍼스
CAMPUS_NATURAL_SCIENCE = 2  # 자연과학캠퍼스

_HAKGWA_CODES_PATH = Path(__file__).resolve().parents[2] / "docs" / "성대_학과코드_전체.txt"


@dataclass(frozen=True)
class HakgwaCode:
    code: str
    name: str
    college: str
    college_code: str


def load_hakgwa_codes(path: Path = _HAKGWA_CODES_PATH) -> list[HakgwaCode]:
    """탭 구분 학과코드 목록 파일을 읽어 HakgwaCode 리스트로 반환한다.

    데이터 행은 "학과코드\\t학과명\\t소속대학\\t대학코드" 형태만 골라낸다
    (그 외 안내문 줄은 탭 3개 구조가 아니므로 자동으로 걸러진다).
    """
    codes: list[HakgwaCode] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        code, name, college, college_code = parts
        if not code.isdigit():
            continue
        codes.append(HakgwaCode(code=code, name=name, college=college, college_code=college_code))
    return codes
