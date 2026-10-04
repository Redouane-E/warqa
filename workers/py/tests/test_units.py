"""Pure helpers: alignment word mapping, RTL reordering, OCR row assembly, base64, TTS voice routing."""

from __future__ import annotations

import base64

import pytest

from warqa_worker import tts
from warqa_worker.align import audio_kind, map_times, prepare_words
from warqa_worker.arabic import rtl_tokens_from_visual, strip_diacritics, visual_to_logical
from warqa_worker.errors import BadInput, UnknownVoice
from warqa_worker.ocr import Box, boxes_to_text, tesseract_langs, tesseract_text
from warqa_worker.util import base_lang, decode_b64

from .conftest import b64, tiny_wav

# ---------- arabic ----------


def test_strip_diacritics_and_tatweel():
    assert strip_diacritics("ذَهَبَ الوَلَدُ") == "ذهب الولد"
    assert strip_diacritics("رَحْمٰن") == "رحمن"  # dagger alef U+0670
    assert strip_diacritics("كـتـاب", tatweel=True) == "كتاب"
    assert strip_diacritics("كـتـاب") == "كـتـاب"


def test_visual_to_logical():
    assert visual_to_logical("ددعلا") == "العدد"
    # digits and Latin keep their own order inside the reversed line
    assert visual_to_logical("123 ددعلا") == "العدد 123"
    assert visual_to_logical("طقف (x + 1) نم") == "من (x + 1) فقط"


# ---------- ocr ----------


def test_rtl_row_is_joined_right_to_left():
    boxes = [Box("عالم", 0, 50, 10, 30), Box("مرحبا", 60, 120, 12, 31), Box("سطر ثان", 0, 120, 50, 70)]
    assert boxes_to_text(boxes, reorder_rtl=False) == "مرحبا عالم\nسطر ثان"


def test_ltr_row_is_joined_left_to_right():
    boxes = [Box("world", 60, 120, 10, 30), Box("hello", 0, 50, 10, 30)]
    assert boxes_to_text(boxes, reorder_rtl=True) == "hello world"


def test_visual_rtl_boxes_are_reordered_when_engine_does_not():
    boxes = [Box("ابحرم", 0, 50, 10, 30)]
    assert boxes_to_text(boxes, reorder_rtl=True) == "مرحبا"


def test_rtl_tokens_from_visual():
    # visual (left-to-right) word order as tesseract's boxes give it
    assert rtl_tokens_from_visual(["الطرفين", "إلى", "x", "+", "1", "نضيف"]) == ["نضيف", "x", "+", "1", "إلى", "الطرفين"]
    assert rtl_tokens_from_visual(["معرفة", "f(x)", "=", "2x", "الدالة"]) == ["الدالة", "f(x)", "=", "2x", "معرفة"]
    # digits only: bidi islands, read right to left ("2 + 3 = 5" is drawn as "5 = 3 + 2")
    assert rtl_tokens_from_visual(["الآن", "5", "=", "3", "+", "2", "نحسب"]) == ["نحسب", "2", "+", "3", "=", "5", "الآن"]
    # punctuation at the edge of a run stays with the Arabic flow
    assert rtl_tokens_from_visual([":", "x", "قيمة"]) == ["قيمة", "x", ":"]


def test_tesseract_text_rebuilds_rtl_lines_from_boxes():
    lrm, rlm = chr(0x200E), chr(0x200F)
    rows = [
        # block, par, line, word_num, left, text — tesseract's own order puts "1 + x"
        (1, 1, 1, 1, 1025, "نضيف"),
        (1, 1, 1, 2, 986, "1"),
        (1, 1, 1, 3, 947, "+"),
        (1, 1, 1, 4, 909, lrm + "x" + rlm),
        (1, 1, 1, 5, 847, "إلى"),
        (1, 1, 2, 1, 900, "سطر"),
        (2, 1, 1, 1, 10, "Hello"),
        (2, 1, 1, 2, 80, "world"),
        (2, 1, 1, 3, 150, " "),
    ]
    data = {k: [r[i] for r in rows] for i, k in enumerate(["block_num", "par_num", "line_num", "word_num", "left", "text"])}
    assert tesseract_text(data) == "نضيف x + 1 إلى\nسطر\n\nHello world"


def test_tesseract_language_mapping():
    assert tesseract_langs("ar") == (["ara"], ["eng"])
    assert tesseract_langs("ar-MA") == (["ara"], ["eng"])
    assert tesseract_langs("fr") == (["fra"], [])
    assert tesseract_langs("en") == (["eng"], [])
    assert tesseract_langs("deu") == (["deu"], [])
    assert tesseract_langs("??") == ([], [])


# ---------- align ----------


def test_prepare_words_strips_tashkeel_and_keeps_originals():
    words, kept, aligned = prepare_words("ذَهَبَ  الوَلَدُ — إلى المدرسةِ")
    assert words == ["ذَهَبَ", "الوَلَدُ", "—", "إلى", "المدرسةِ"]
    assert kept == [0, 1, 2, 3, 4]
    assert aligned == "ذهب الولد — إلى المدرسة"
    words, kept, aligned = prepare_words("كَ ـ ب")
    assert kept == [0, 2] and aligned == "ك ب"


def test_map_times_by_index():
    words, kept, aligned = prepare_words("ذَهَبَ الوَلَدُ")
    out = map_times(words, kept, aligned, [(0.12, " ذهب"), (0.5, " الولد")])
    assert out == [[0.12, "ذَهَبَ"], [0.5, "الوَلَدُ"]]


def test_map_times_when_engine_splits_words_differently():
    words, kept, aligned = prepare_words("ab cd ef")
    out = map_times(words, kept, aligned, [(0.0, "ab"), (0.2, " c"), (0.3, "d"), (0.5, " ef")])
    assert out == [[0.0, "ab"], [0.2, "cd"], [0.5, "ef"]]


def test_map_times_fills_gaps_monotonically():
    words, kept, aligned = prepare_words("ab ـ cd ef")
    out = map_times(words, kept, aligned, [(0.4, "ab"), (0.3, "cdef")])
    assert [t for t, _ in out] == [0.4, 0.4, 0.4, 0.4]
    assert [w for _, w in out] == ["ab", "ـ", "cd", "ef"]


def test_audio_kind():
    assert audio_kind(tiny_wav()) == "wav"
    assert audio_kind(b"ID3\x04\x00" + b"\x00" * 20) == "mp3"
    assert audio_kind(b"\xff\xfb\x90\x00" + b"\x00" * 20) == "mp3"
    with pytest.raises(BadInput):
        audio_kind(b"OggS\x00\x00")


# ---------- util ----------


def test_decode_b64_variants():
    raw = bytes(range(256))
    assert decode_b64(b64(raw), "x") == raw
    assert decode_b64("data:image/png;base64," + b64(raw), "x") == raw
    assert decode_b64(base64.urlsafe_b64encode(raw).decode().rstrip("="), "x") == raw
    for bad in ("", "   ", "@@@", "abc$"):
        with pytest.raises(BadInput):
            decode_b64(bad, "x")


def test_base_lang():
    assert base_lang("ar-MA") == "ar"
    assert base_lang("fr_FR") == "fr"
    assert base_lang(None) == ""


# ---------- tts ----------


class FakeTts:
    name = "fake"
    licence = "test"

    def available(self):
        return True

    def voices(self):
        return ["fake-ar", "fake-fr"]

    def owns(self, voice):
        return voice.startswith("fake-")

    def default_voice(self, lang):
        return {"ar": "fake-ar", "fr": "fake-fr"}.get(lang)

    def synth(self, text, voice, lang, speed):
        if voice not in self.voices():
            raise UnknownVoice(voice, self.voices())
        return tts.TtsResult(b"RIFF0000WAVE", "wav", [[0.0, text.split()[0]]])


class MissingTts(FakeTts):
    name = "missing"

    def available(self):
        return False

    def owns(self, voice):
        return voice.startswith("missing-")


@pytest.fixture
def fake_tts(monkeypatch):
    monkeypatch.setattr(tts, "engines", lambda: [FakeTts(), MissingTts()])


def test_rate_factor():
    assert tts.rate_factor(None) == 1.0
    assert tts.rate_factor("+0%") == 1.0
    assert tts.rate_factor("-4%") == pytest.approx(0.96)
    assert tts.rate_factor("+500%") == 2.0
    with pytest.raises(BadInput):
        tts.rate_factor("fast")


def test_tts_voice_routing(client, fake_tts):
    ok = client.post("/tts", json={"text": "مرحبا بكم", "voice": "fake-ar", "lang": "ar", "rate": "-4%"})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["ext"] == "wav" and body["engine"] == "fake"
    assert base64.b64decode(body["audio_base64"]) == b"RIFF0000WAVE"
    assert body["words"] == [[0.0, "مرحبا"]]
    # a language code (what the TS client sends by default) → that language's default voice
    assert client.post("/tts", json={"text": "salut", "voice": "fr", "lang": "fr", "rate": None}).status_code == 200
    assert client.post("/tts", json={"text": "مرحبا", "lang": "ar-MA"}).status_code == 200
    assert client.post("/tts", json={"text": "salut", "voice": "fake:fake-fr", "lang": "fr"}).status_code == 200


def test_tts_unknown_voice_is_404_with_list(client, fake_tts):
    for voice in ("fake-de", "zz_ZZ-nobody-medium", "de"):
        res = client.post("/tts", json={"text": "hallo", "voice": voice, "lang": "de", "rate": None})
        assert res.status_code == 404, voice
        assert res.json()["voices"] == ["fake-ar", "fake-fr"]
        assert "fake-ar" in res.json()["error"]


def test_tts_engine_not_installed_is_501(client, fake_tts):
    res = client.post("/tts", json={"text": "x", "voice": "missing-voice", "lang": "en"})
    assert res.status_code == 501


def test_tts_bad_input(client, fake_tts):
    assert client.post("/tts", json={"text": "  ", "voice": "fake-ar", "lang": "ar"}).status_code == 400
    assert client.post("/tts", json={"text": "x", "voice": "fake-ar", "lang": "ar", "rate": "fast"}).status_code == 400


def test_real_engines_route_voice_names(no_engines):
    from warqa_worker.tts_habibi import Habibi
    from warqa_worker.tts_piper import Piper

    p, h = Piper(), Habibi()
    assert p.owns("ar_JO-kareem-medium") and p.owns("fr_FR-siwis-medium") and not p.owns("habibi-MSA")
    assert h.owns("habibi-MSA") and h.owns("habibi-mar") and not h.owns("en_US-lessac-medium")
    assert p.default_voice("ar") == "ar_JO-kareem-medium"
    assert h.default_voice("ar") == "habibi-MSA"
    assert h.default_voice("ary") == "habibi-MAR"  # Darija gets the Moroccan dialect model
    assert h.default_voice("fr") is None
    assert not p.available() and not h.available()
