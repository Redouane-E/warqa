"""POST /ocr: page image → text, in logical (reading) order.

Engines, tried in order when installed (override with WARQA_OCR_ENGINES=rapidocr,tesseract):
  * tesseract — pytesseract + the system `tesseract` binary with ara/fra/eng traineddata
    (Apache-2.0). Arabic pages use `ara+eng` so Latin math survives. Words come back in logical
    order, but mixed runs in RTL lines are mis-ordered ("x + 1" → "1 + x"), so RTL lines are rebuilt
    from the word boxes (see tesseract_text). Small images are upscaled first.
  * rapidocr — RapidOCR (Apache-2.0) with PaddleOCR PP-OCRv5 recognition models (Apache-2.0),
    downloaded on first use. Recognition models emit right-to-left lines in visual (left-to-right)
    order. rapidocr ≥ 3.x reorders them itself with python-bidi; for older/legacy builds
    (rapidocr-onnxruntime) the worker reorders each RTL line (python-bidi's get_display when
    installed, else `arabic.visual_to_logical`). Boxes on the same row are joined right-to-left for
    RTL rows.
"""

from __future__ import annotations

import io
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .arabic import BIDI_MARKS_RE, is_rtl, rtl_tokens_from_visual, visual_to_logical
from .errors import BadInput, NotInstalled, WorkerError
from .util import base_lang, cache_dir, has_binary, has_module, licence_notice, log, require

# ---------- tesseract ----------

_TESS_LANG = {
    "ar": "ara",
    "fr": "fra",
    "en": "eng",
    "de": "deu",
    "es": "spa",
    "it": "ita",
    "pt": "por",
    "nl": "nld",
    "tr": "tur",
    "fa": "fas",
    "ur": "urd",
    "he": "heb",
    "ru": "rus",
    "zh": "chi_sim",
    "ja": "jpn",
    "ko": "kor",
}


def tesseract_langs(lang: str) -> tuple[list[str], list[str]]:
    """(required, optional) traineddata names for a page language. Arabic adds eng for Latin math."""
    b = base_lang(lang)
    code = _TESS_LANG.get(b) or (b if len(b) == 3 else "")
    if not code:
        return [], []
    if b == "ar":
        return ["ara"], ["eng"]
    return [code], []


class Engine(Protocol):
    name: str

    def available(self) -> bool: ...
    def supports(self, lang: str) -> bool: ...
    def run(self, image: bytes, lang: str) -> str: ...


class Tesseract:
    name = "tesseract"
    licence = "Apache-2.0 (tesseract, pytesseract)"

    def __init__(self) -> None:
        self._langs: set[str] | None = None
        self._lock = threading.Lock()

    def _cmd(self) -> str:
        return os.environ.get("TESSERACT_CMD", "tesseract")

    def available(self) -> bool:
        return has_module("pytesseract") and has_module("PIL") and has_binary(self._cmd()) and bool(self.installed_langs())

    def installed_langs(self) -> set[str]:
        if self._langs is None:
            with self._lock:
                if self._langs is None:
                    try:
                        pt = require("pytesseract", extra="ocr", what="tesseract OCR")
                        pt.pytesseract.tesseract_cmd = self._cmd()
                        self._langs = {lang for lang in pt.get_languages(config="") if lang != "osd"}
                    except Exception as e:  # binary missing or broken
                        log.info("tesseract unavailable: %s", e)
                        return set()
        return self._langs

    def supports(self, lang: str) -> bool:
        required, _ = tesseract_langs(lang)
        return bool(required) and set(required) <= self.installed_langs()

    def run(self, image: bytes, lang: str) -> str:
        pt = require("pytesseract", extra="ocr", what="tesseract OCR")
        pil = require("PIL.Image", extra="ocr", what="Pillow")
        pt.pytesseract.tesseract_cmd = self._cmd()
        required, optional = tesseract_langs(lang)
        langs = required + [o for o in optional if o in self.installed_langs()]
        # --psm 3 (automatic layout) handles columns and figures but sometimes drops whole lines of
        # Arabic + math; --psm 6 (one block) keeps every line. Run both and keep psm 6 only when it
        # clearly finds more words. WARQA_TESSERACT_CONFIG forces a single configuration.
        forced = os.environ.get("WARQA_TESSERACT_CONFIG")
        configs = [forced] if forced else ["--psm 3", "--psm 6"]
        with pil.open(io.BytesIO(image)) as src:
            img = src.convert("RGB") if src.mode not in ("RGB", "L") else src.copy()
        # tesseract reads best around 300 dpi: upscale small renders to ~WARQA_TESSERACT_MIN_SIDE pixels
        w, h = img.size
        scale = min(3.0, int(os.environ.get("WARQA_TESSERACT_MIN_SIDE", "2000")) / max(w, h, 1))
        if scale > 1.2:
            img = img.resize((round(w * scale), round(h * scale)), getattr(pil, "LANCZOS", 1))
        best: tuple[int, dict[str, list[Any]]] | None = None
        for config in configs:
            data = pt.image_to_data(img, lang="+".join(langs), config=config, output_type=pt.Output.DICT)
            n = confident_words(data)
            if best is None or n > best[0] * 1.15:
                best = (n, data)
        return tesseract_text(best[1]) if best else ""


def confident_words(data: dict[str, list[Any]], min_conf: float = 30) -> int:
    """Words tesseract is reasonably sure of (conf ≥ min_conf)."""
    n = 0
    for text, conf in zip(data.get("text", []), data.get("conf", [])):
        try:
            ok = float(conf) >= min_conf
        except (TypeError, ValueError):
            ok = False
        n += bool(ok and str(text or "").strip())
    return n


def tesseract_text(data: dict[str, list[Any]]) -> str:
    """Rebuild text from tesseract's word boxes (image_to_data).

    Tesseract returns Arabic words in logical order but orders mixed runs badly ("x + 1" comes out as
    "1 + x") and wraps Latin words in LRM/RLM marks. So RTL lines are rebuilt from the word positions
    (arabic.rtl_tokens_from_visual) and the invisible bidi marks are dropped. LTR lines keep tesseract's
    order. Lines are joined with newlines, paragraphs with a blank line.
    """
    lines: dict[tuple[int, int, int], list[tuple[int, float, str]]] = {}
    for i, raw in enumerate(data.get("text", [])):
        word = BIDI_MARKS_RE.sub("", str(raw or "")).strip()
        if not word:
            continue
        key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
        lines.setdefault(key, []).append((int(data["word_num"][i]), float(data["left"][i]), word))
    out: list[str] = []
    prev: tuple[int, int, int] | None = None
    for key, words in lines.items():
        words.sort()
        text = " ".join(w for _, _, w in words)
        if is_rtl(text):
            text = " ".join(rtl_tokens_from_visual([w for _, _, w in sorted(words, key=lambda x: x[1])]))
        if prev is not None and key[:2] != prev[:2]:
            out.append("")
        out.append(text)
        prev = key
    return "\n".join(out).strip()


# ---------- rapidocr ----------

# page language → RapidOCR recognition language (PP-OCRv5 mobile models exist for these)
_RAPID_LANG = {
    "ar": "arabic",
    "fa": "arabic",
    "ur": "arabic",
    "fr": "latin",
    "es": "latin",
    "it": "latin",
    "pt": "latin",
    "de": "latin",
    "nl": "latin",
    "tr": "latin",
    "en": "en",
    "ru": "cyrillic",
    "uk": "cyrillic",
    "bg": "cyrillic",
    "zh": "ch",
}


@dataclass
class Box:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float

    @property
    def yc(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def h(self) -> float:
        return max(1.0, self.y1 - self.y0)


def boxes_to_text(boxes: list[Box], *, reorder_rtl: bool) -> str:
    """Group boxes into rows (vertical overlap), order each row by reading direction, join rows."""
    rows: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: b.yc):
        if rows:
            row = rows[-1]
            ref = sum(x.yc for x in row) / len(row)
            if abs(b.yc - ref) < 0.5 * min(b.h, min(x.h for x in row)):
                row.append(b)
                continue
        rows.append([b])
    lines: list[str] = []
    for row in rows:
        texts = [visual_to_logical_line(b.text) if reorder_rtl and is_rtl(b.text) else b.text for b in row]
        rtl = is_rtl(" ".join(texts))
        order = sorted(range(len(row)), key=lambda i: (row[i].x0 + row[i].x1) / 2, reverse=rtl)
        line = " ".join(texts[i].strip() for i in order if texts[i].strip())
        if line:
            lines.append(line)
    return "\n".join(lines)


def visual_to_logical_line(text: str) -> str:
    """Visual → logical for one RTL line: python-bidi when installed (the bidi algorithm applied to
    visual text gives back logical order for single-level lines), else our own minimal reordering."""
    try:
        from bidi.algorithm import get_display  # python-bidi 0.4 API
    except ImportError:
        try:
            from bidi import get_display  # python-bidi ≥ 0.5
        except ImportError:
            return visual_to_logical(text)
    return get_display(text)


class RapidOcr:
    name = "rapidocr"
    licence = "Apache-2.0 (RapidOCR; PaddleOCR models)"

    def __init__(self) -> None:
        self._engines: dict[str, Any] = {}
        self._lock = threading.Lock()

    def flavour(self) -> str | None:
        if has_module("rapidocr") and has_module("onnxruntime"):
            return "rapidocr"
        if has_module("rapidocr_onnxruntime"):
            return "legacy"
        return None

    def available(self) -> bool:
        return self.flavour() is not None

    def supports(self, lang: str) -> bool:
        flavour = self.flavour()
        b = base_lang(lang)
        if flavour == "rapidocr":
            rec = _RAPID_LANG.get(b)
            # rapidocr 3.x needs python-bidi to reorder RTL output
            return rec is not None and (rec != "arabic" or has_module("bidi"))
        if flavour == "legacy":
            return b in {"en", "zh"}  # its bundled models are Chinese + English only
        return False

    def _engine(self, rec: str) -> tuple[Any, bool]:
        """(engine, already_logical) for a recognition language, created once."""
        with self._lock:
            if rec in self._engines:
                return self._engines[rec]
            if self.flavour() == "rapidocr":
                mod = require("rapidocr", extra="ocr", what="RapidOCR")
                params: dict[str, Any] = {}
                if rec != "ch":
                    params = {
                        "Rec.lang_type": mod.LangRec(rec),
                        "Rec.ocr_version": mod.OCRVersion.PPOCRV5,
                        "Rec.model_type": mod.ModelType.MOBILE,
                    }
                # models download next to the package by default; use the worker cache when that is
                # read-only (e.g. the Docker image runs as a non-root user)
                bundled = Path(mod.__file__).parent / "models"
                if not os.access(bundled, os.W_OK):
                    params["Global.model_root_dir"] = str(cache_dir("rapidocr"))
                licence_notice(f"RapidOCR {rec} recognition model (PP-OCRv5)", "Apache-2.0", "PaddleOCR via modelscope.cn/RapidAI")
                engine = mod.RapidOCR(params=params)
                # rapidocr ≥ 3.x reorders RTL lines with python-bidi itself
                try:
                    import rapidocr.utils.utils as ru

                    logical = hasattr(ru, "reorder_bidi_for_display")
                except ImportError:
                    logical = False
            else:
                mod = require("rapidocr_onnxruntime", extra="ocr", what="RapidOCR (legacy)")
                engine = mod.RapidOCR()
                logical = False
            self._engines[rec] = (engine, logical)
            return self._engines[rec]

    def run(self, image: bytes, lang: str) -> str:
        b = base_lang(lang)
        rec = _RAPID_LANG.get(b, "en") if self.flavour() == "rapidocr" else b
        engine, logical = self._engine(rec)
        out = engine(image)
        boxes: list[Box] = []
        if isinstance(out, tuple):  # legacy: (result list | None, elapse); result items = [box, text, score]
            for item in out[0] or []:
                pts, text = item[0], item[1]
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                boxes.append(Box(BIDI_MARKS_RE.sub("", str(text)), min(xs), max(xs), min(ys), max(ys)))
        else:
            txts = getattr(out, "txts", None) or ()
            pts_all = getattr(out, "boxes", None)
            for i, text in enumerate(txts):
                pts = pts_all[i] if pts_all is not None else [[0, i], [1, i], [1, i + 1], [0, i + 1]]
                xs, ys = [float(p[0]) for p in pts], [float(p[1]) for p in pts]
                boxes.append(Box(BIDI_MARKS_RE.sub("", str(text)), min(xs), max(xs), min(ys), max(ys)))
        return boxes_to_text(boxes, reorder_rtl=not logical)


# ---------- the endpoint ----------

ENGINES: dict[str, Engine] = {"tesseract": Tesseract(), "rapidocr": RapidOcr()}


def engine_order() -> list[str]:
    env = os.environ.get("WARQA_OCR_ENGINES")
    names = [n.strip() for n in env.split(",")] if env else ["tesseract", "rapidocr"]
    return [n for n in names if n in ENGINES]


def available() -> list[str]:
    return [n for n in engine_order() if ENGINES[n].available()]


def details() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for n in available():
        e = ENGINES[n]
        info: dict[str, Any] = {"licence": getattr(e, "licence", "")}
        if isinstance(e, Tesseract):
            info["languages"] = sorted(e.installed_langs())
        if isinstance(e, RapidOcr):
            info["flavour"] = e.flavour()
        out[n] = info
    return out


def _check_image(image: bytes) -> None:
    if has_module("PIL"):
        from PIL import Image, UnidentifiedImageError

        try:
            with Image.open(io.BytesIO(image)) as img:
                img.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as e:
            raise BadInput(f"image_base64 is not a readable image: {e}") from e


def ocr(image: bytes, lang: str) -> dict[str, str]:
    names = available()
    if not names:
        raise NotInstalled(
            "no OCR engine is installed: install the 'ocr' extra (pytesseract + the tesseract binary with "
            "ara/fra/eng traineddata, or rapidocr + onnxruntime)"
        )
    usable = [n for n in names if ENGINES[n].supports(lang)]
    if not usable:
        raise NotInstalled(f'no installed OCR engine reads "{lang}" (installed: {", ".join(names)}); for tesseract add the traineddata (e.g. tesseract-ocr-ara)')
    _check_image(image)
    errors: list[str] = []
    first_empty: str | None = None
    for n in usable:
        try:
            text = ENGINES[n].run(image, lang)
        except NotInstalled:
            raise
        except Exception as e:  # try the next engine
            log.warning("ocr engine %s failed: %s", n, e)
            errors.append(f"{n}: {e}")
            continue
        if text.strip():
            return {"text": text, "engine": n}
        first_empty = first_empty or n
    if first_empty:
        return {"text": "", "engine": first_empty}
    raise WorkerError("all OCR engines failed: " + "; ".join(errors))
