import pathlib

import pytest

from voices import MAX_TEXT, SPEEDS, VOICES, check_request

ROOT = pathlib.Path(__file__).parent
APP_IDS = ["f_us_bright", "f_us_clear", "f_us_calm", "f_us_warm", "f_ca_lively", "f_gb_calm", "f_gb_bright",
           "m_us_deep", "m_ca_warm", "m_gb_calm", "m_gb_warm", "m_gb_bright", "m_gb_gentle"]


def test_same_ids_as_the_app():
    assert list(VOICES) == APP_IDS
    app = (ROOT.parent / "src/lib/voice/choices.ts").read_text()
    for voice_id in APP_IDS:
        assert f'id: "{voice_id}"' in app


def test_models_and_reference_files():
    assert VOICES["f_us_bright"] == ("turbo", None)
    assert {m for m, _ in VOICES.values()} == {"turbo", "nano"}
    assert [v for v, (m, _) in VOICES.items() if m == "nano"] == ["m_gb_calm", "m_gb_warm", "m_gb_bright", "m_gb_gentle"]
    for _, ref in VOICES.values():
        if ref:
            assert (ROOT / "refs" / f"{ref}.wav").is_file()


def test_check_request():
    assert check_request({"text": " Hello ", "voice": "m_gb_gentle", "speed": 0.85}) == ("Hello", "m_gb_gentle", 0.85)
    assert check_request({"text": "Hi", "voice": "f_us_bright", "speed": 1}) == ("Hi", "f_us_bright", 1.0)
    assert SPEEDS == (0.85, 1.0, 1.15)
    for bad in [{}, {"text": "", "voice": "f_us_bright", "speed": 1}, {"text": "x" * (MAX_TEXT + 1), "voice": "f_us_bright", "speed": 1},
                {"text": "Hi", "voice": "af_heart", "speed": 1}, {"text": "Hi", "voice": "f_us_bright", "speed": 2}, {"text": 5, "voice": "f_us_bright", "speed": 1}]:
        with pytest.raises(ValueError):
            check_request(bad)
