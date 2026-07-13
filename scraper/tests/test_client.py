from unittest.mock import patch

import pytest

from skku_scraper import client


def _fake_ssv_response(dataset_name: str) -> str:
    return "\x1e".join(
        [
            "SSV:UTF-8",
            "ErrorCode:int=0",
            "ErrorMsg:string=SUCCESS",
            f"Dataset:{dataset_name}",
            "\x1f".join(["_RowType_", "GWAMOK_NAME", "PER_NAME"]),
            "\x1f".join(["N", "경영정보시스템", "홍길동"]),
        ]
    )


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        pass


def test_fetch_major_courses_parses_rows():
    fake_response = _FakeResponse(_fake_ssv_response("dsGrdMain"))
    with patch.object(client.requests, "post", return_value=fake_response) as post:
        rows = client.fetch_major_courses(2026, 10, "316901", 1, request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    called_kwargs = post.call_args.kwargs
    assert called_kwargs["headers"]["Content-Type"] == "text/xml"
    body = called_kwargs["data"].decode("utf-8")
    assert "HAKGWA_CD=316901" in body
    assert "_TRANSACTION_ID=selectMain" in body


def test_fetch_elective_courses_parses_rows():
    with patch.object(
        client.requests, "post", return_value=_FakeResponse(_fake_ssv_response("dsGrdMain03"))
    ) as post:
        rows = client.fetch_elective_courses(2026, 10, "GEDG001", 2, request_interval=0)

    assert rows == [{"GWAMOK_NAME": "경영정보시스템", "PER_NAME": "홍길동"}]
    body = post.call_args.kwargs["data"].decode("utf-8")
    assert "HAKSU_NO=GEDG001" in body


def test_error_code_raises():
    error_text = "\x1e".join(["SSV:UTF-8", "ErrorCode:int=-1", "ErrorMsg:string=FAIL"])
    with (
        patch.object(client.requests, "post", return_value=_FakeResponse(error_text)),
        pytest.raises(client.SkkuApiError),
    ):
        client.fetch_major_courses(2026, 10, "316901", 1, request_interval=0)
