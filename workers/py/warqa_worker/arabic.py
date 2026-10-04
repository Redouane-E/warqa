"""Arabic text helpers shared by OCR, alignment and diacritization (no dependencies)."""

from __future__ import annotations

import re
import unicodedata

# Harakat, tanwin, shadda, sukun, maddah/hamza marks, etc. (U+064B–U+065F) and the superscript
# (dagger) alef U+0670. These are the marks that /tashkeel may add and /align strips.
DIACRITICS_RE = re.compile("[\u064b-\u065f\u0670]")
TATWEEL = "\u0640"
TATWEEL_RE = re.compile(TATWEEL)

# An Arabic "word": letters (incl. extended letters used for Maghrebi/Persian/Urdu) with their marks
# and tatweel. Excludes Arabic punctuation (، ؛ ؟ ۔), Arabic-Indic digits and the percent/decimal signs.
ARABIC_WORD_RE = re.compile("[\u0621-\u065f\u066e-\u06d3\u06fa-\u06fc]+")
# Letters the CATT model knows (hamza … ghain, feh … yeh); anything else is passed through untouched.
CATT_LETTERS_RE = re.compile("^[\u0621-\u063a\u0641-\u064a]+$")

# invisible bidi controls OCR engines insert around Latin words (LRM, RLM, ALM, embeddings, isolates)
BIDI_MARKS_RE = re.compile("[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]")

_RTL_CHAR = re.compile("[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]")
_LTR_CHAR = re.compile("[A-Za-z\u00c0-\u024f]")


def strip_diacritics(text: str, *, tatweel: bool = False) -> str:
    """Remove harakat (and the dagger alef); with tatweel=True also remove kashida."""
    out = DIACRITICS_RE.sub("", text)
    return TATWEEL_RE.sub("", out) if tatweel else out


def has_diacritics(text: str) -> bool:
    return DIACRITICS_RE.search(text) is not None


def has_arabic(text: str) -> bool:
    return ARABIC_WORD_RE.search(text) is not None


def is_rtl(text: str) -> bool:
    """Mostly right-to-left letters (Arabic/Hebrew/Syriac/Thaana) rather than Latin letters."""
    rtl = len(_RTL_CHAR.findall(text))
    ltr = len(_LTR_CHAR.findall(text))
    return rtl > 0 and rtl >= ltr


def _is_rtl_char(ch: str) -> bool:
    return unicodedata.bidirectional(ch) in {"R", "AL"}


def _is_ltr_char(ch: str) -> bool:
    return unicodedata.bidirectional(ch) in {"L", "EN", "AN"}


_MIRROR = str.maketrans("()[]{}<>«»", ")(][}{><»«")


def visual_to_logical(line: str) -> str:
    """Turn a single right-to-left line given in visual (left-to-right) order into logical order.

    Minimal one-level bidi: reverse the whole line, then restore the reading order of each run of
    left-to-right material (Latin words, digits) inside it, so "123" and "x + 1" read correctly.
    Brackets outside those runs are mirrored, since OCR reports the glyph it sees, not the code point.
    Used when python-bidi is not installed; python-bidi's get_display is preferred when available.
    """
    rev = line[::-1]
    out: list[str] = []
    i = 0
    n = len(rev)
    while i < n:
        if _is_ltr_char(rev[i]):
            # extend the LTR run over neutrals that sit between LTR characters (spaces, + = . , etc.)
            j = i + 1
            last_strong = i
            while j < n and not _is_rtl_char(rev[j]):
                if _is_ltr_char(rev[j]):
                    last_strong = j
                j += 1
            out.append(rev[i : last_strong + 1][::-1])
            i = last_strong + 1
        else:
            out.append(rev[i].translate(_MIRROR))
            i += 1
    return "".join(out)


def _token_kind(token: str) -> str:
    """R (right-to-left letters), L (left-to-right letters), N (digits) or O (punctuation/operators)."""
    kinds = {unicodedata.bidirectional(c) for c in token}
    if kinds & {"R", "AL"}:
        return "R"
    if "L" in kinds:
        return "L"
    if kinds & {"EN", "AN"}:
        return "N"
    return "O"


def rtl_tokens_from_visual(tokens: list[str]) -> list[str]:
    """Logical order for the words of a right-to-left line, given in visual (left-to-right) order.

    Words are read right to left. A run of non-Arabic words that contains a Latin letter ("x + 1",
    "f(x) = 2x") keeps its left-to-right reading, which is how it reads on the page. A run of digits
    and operators only ("2 + 3 = 5") follows the bidi algorithm: each number is an island read right to
    left, which is what produced that picture from logical text. Each word's own characters must already
    be in logical order (tesseract's are).
    """
    r = tokens[::-1]
    out: list[str] = []
    i = 0
    while i < len(r):
        if _token_kind(r[i]) in ("L", "N"):
            j, last, latin = i, i, False
            while j < len(r) and _token_kind(r[j]) != "R":
                kind = _token_kind(r[j])
                if kind in ("L", "N"):
                    last = j
                latin = latin or kind == "L"
                j += 1
            run = r[i : last + 1]
            out.extend(run[::-1] if latin else run)
            i = last + 1
        else:
            out.append(r[i])
            i += 1
    return out
