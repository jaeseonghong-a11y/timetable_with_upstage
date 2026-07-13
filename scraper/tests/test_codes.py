from skku_scraper.codes import HakgwaCode, load_hakgwa_codes


def test_loads_known_departments():
    codes = load_hakgwa_codes()

    assert len(codes) > 100
    biz = HakgwaCode(code="316901", name="경영학과", college="경영대학", college_code="3169")
    arch = HakgwaCode(code="316307", name="건축학과", college="공과대학", college_code="3163")
    assert biz in codes
    assert arch in codes


def test_all_entries_have_digit_codes():
    codes = load_hakgwa_codes()

    assert all(c.code.isdigit() for c in codes)
