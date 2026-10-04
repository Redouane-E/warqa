"""The /tashkeel safety rules, tested with fake engines (no model needed)."""

from __future__ import annotations

from warqa_worker import tashkeel
from warqa_worker.arabic import strip_diacritics
from warqa_worker.tashkeel import diacritize_text

FATHA = "\u064e"
DAMMA = "\u064f"


class Fatha:
    """Puts a fatha on every letter; records what it was asked."""

    name = "fake"

    def __init__(self):
        self.calls: list[list[str]] = []

    def diacritize(self, texts):
        self.calls.append(list(texts))
        return ["".join(ch + FATHA if ch != " " else ch for ch in t) for t in texts]


class ChangesALetter(Fatha):
    def diacritize(self, texts):
        out = super().diacritize(texts)
        return [o.replace("ل", "ك", 1) for o in out]


class DropsAWord(Fatha):
    def diacritize(self, texts):
        return [" ".join(o.split()[1:]) for o in super().diacritize(texts)]


class WrongCount(Fatha):
    def diacritize(self, texts):
        return super().diacritize(texts)[:-1] if len(texts) > 1 else []


class Crashes(Fatha):
    def diacritize(self, texts):
        raise RuntimeError("model exploded")


class CollapsesSpaces(Fatha):
    def diacritize(self, texts):
        return [o.replace(" ", "") for o in super().diacritize(texts)]


def test_adds_diacritics_to_arabic_words_only():
    src = "نضيف 3 إلى x ثم نكتب: الناتج."
    eng = Fatha()
    out, name = diacritize_text(src, eng)
    assert name == "fake"
    assert strip_diacritics(out) == src
    assert "3" in out and " x " in out and out.endswith(".")
    assert out.split()[0] == "ن" + FATHA + "ض" + FATHA + "ي" + FATHA + "ف" + FATHA
    # the model only ever sees Arabic letters, chunked at sentence punctuation
    assert eng.calls == [["نضيف إلى ثم نكتب", "الناتج"]]


def test_keeps_words_the_author_already_diacritized():
    src = "كَتَبَ الولد"
    eng = Fatha()
    out, name = diacritize_text(src, eng)
    assert name == "fake"
    assert out.startswith("كَتَبَ ")
    assert out.split()[1] == "".join(ch + FATHA for ch in "الولد")
    assert eng.calls == [["كتب الولد"]]  # context still includes the diacritized word


def test_preserves_whitespace_and_line_breaks():
    src = "السلام  عليكم\nورحمة الله"
    out, _ = diacritize_text(src, Fatha())
    assert strip_diacritics(out) == src
    assert "  " in out and "\n" in out


def test_non_arabic_text_passes_through_without_calling_the_engine():
    eng = Fatha()
    assert diacritize_text("Bonjour 2 + 2 = 4", eng) == ("Bonjour 2 + 2 = 4", "none")
    assert eng.calls == []


def test_words_with_tatweel_or_foreign_letters_are_untouched():
    src = "كـتاب ڤيديو"
    eng = Fatha()
    out, name = diacritize_text(src, eng)
    assert (out, name) == (src, "none")
    assert eng.calls == []


def test_letter_change_returns_input_unchanged():
    src = "ذهب الولد إلى المدرسة"
    assert diacritize_text(src, ChangesALetter()) == (src, "none")


def test_dropped_word_returns_input_unchanged():
    src = "ذهب الولد إلى المدرسة"
    assert diacritize_text(src, DropsAWord()) == (src, "none")


def test_wrong_number_of_outputs_returns_input_unchanged():
    src = "ذهب الولد. ثم عاد."
    assert diacritize_text(src, WrongCount()) == (src, "none")


def test_engine_crash_returns_input_unchanged():
    src = "ذهب الولد"
    assert diacritize_text(src, Crashes()) == (src, "none")


def test_merged_words_return_input_unchanged():
    src = "ذهب الولد"
    assert diacritize_text(src, CollapsesSpaces()) == (src, "none")


def test_long_text_is_chunked():
    src = " ".join(["كلمة"] * 100)
    eng = Fatha()
    out, name = diacritize_text(src, eng)
    assert name == "fake"
    assert strip_diacritics(out) == src
    assert [len(t.split()) for t in eng.calls[0]] == [48, 48, 4]


def test_endpoint_with_fake_engine(client, monkeypatch):
    monkeypatch.setattr(tashkeel, "get_engine", lambda: Fatha())
    res = client.post("/tashkeel", json={"text": "ذهب الولد (x = 2)"})
    assert res.status_code == 200
    body = res.json()
    assert body["engine"] == "fake"
    assert strip_diacritics(body["text"]) == "ذهب الولد (x = 2)"
    assert body["text"].endswith("(x = 2)")


def test_endpoint_returns_none_when_validation_fails(client, monkeypatch):
    monkeypatch.setattr(tashkeel, "get_engine", lambda: ChangesALetter())
    res = client.post("/tashkeel", json={"text": "ذهب الولد"})
    assert res.json() == {"text": "ذهب الولد", "engine": "none"}
