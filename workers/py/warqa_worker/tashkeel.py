"""POST /tashkeel: add Arabic diacritics (harakat) for better pronunciation.

Engine: CATT — Character-based Arabic Tashkeel Transformer (Apache-2.0), PyPI `catt-tashkeel`,
import `catt_tashkeel` (CATTEncoderDecoder / CATTEncoderOnly, ONNX). Mishkal is GPL and never used.

Safety rules (the model may only ADD diacritics):
  * Only Arabic words made of letters CATT knows are sent; Latin, digits, punctuation, spacing and
    words with letters outside that set pass through untouched.
  * Words that already carry diacritics are kept as written (the author's choice wins); their letters
    still go to the model as context.
  * The engine's output must have the same words with the same letters. If anything differs, or if
    stripping the diacritics from the final text does not give back the input exactly, the input is
    returned unchanged with engine "none".
"""

from __future__ import annotations

import os
import re
import threading
import zipfile
from pathlib import Path
from typing import Any, Protocol

from .arabic import ARABIC_WORD_RE, CATT_LETTERS_RE, TATWEEL, has_diacritics, strip_diacritics
from .errors import BadInput, NotInstalled
from .util import cache_dir, download, has_module, licence_notice, log, require

MAX_CHARS = 200_000
CHUNK_WORDS = 48
# text between two words that ends a chunk (sentence punctuation or a line break)
_BREAK = re.compile(r"[.!?\u061f\u061b;:\n\u06d4]")


class TashkeelEngine(Protocol):
    name: str

    def diacritize(self, texts: list[str]) -> list[str]:
        """Diacritize plain Arabic texts (words separated by single spaces); one output per input."""
        ...


# ---------- CATT ----------

_CATT_URLS = {
    "ed": "https://github.com/abjadai/catt/releases/download/v2/ed_model_onnx.zip",
    "eo": "https://github.com/abjadai/catt/releases/download/v2/eo_model_onnx.zip",
}


class Catt:
    name = "catt"
    licence = "Apache-2.0 (CATT code and models, abjadai/catt)"

    def __init__(self, kind: str | None = None) -> None:
        # ed = encoder-decoder (more accurate, default), eo = encoder-only (faster)
        self.kind = (kind or os.environ.get("WARQA_CATT_MODEL", "ed")).lower()
        if self.kind not in _CATT_URLS:
            self.kind = "ed"
        self._model: Any = None
        self._lock = threading.Lock()

    def _model_paths(self) -> tuple[Path, Path] | None:
        """Download the ONNX models into the worker cache (not site-packages); None → let CATT do it."""
        d = cache_dir("catt", f"{self.kind}_model")
        enc, dec = d / "encoder.onnx", d / "decoder.onnx"
        if enc.exists() and dec.exists():
            return enc, dec
        licence_notice(f"CATT {self.kind.upper()} ONNX model", "Apache-2.0", _CATT_URLS[self.kind])
        try:
            z = download(_CATT_URLS[self.kind], d / "model.zip", timeout=300)
            with zipfile.ZipFile(z) as zf:
                zf.extractall(d)
            z.unlink()
            for name, target in (("encoder.onnx", enc), ("decoder.onnx", dec)):
                if not target.exists():  # the zip may nest the files in a folder
                    found = next(d.rglob(name), None)
                    if found:
                        found.replace(target)
            if enc.exists() and dec.exists():
                return enc, dec
        except Exception as e:
            log.warning("CATT model download into %s failed (%s); falling back to the package's own download", d, e)
        return None

    def _load(self) -> Any:
        with self._lock:
            if self._model is None:
                mod = require("catt_tashkeel", extra="tashkeel", what="CATT (catt-tashkeel)")
                cls = mod.CATTEncoderDecoder if self.kind == "ed" else mod.CATTEncoderOnly
                paths = self._model_paths()
                self._model = cls(encoder_path=str(paths[0]), decoder_path=str(paths[1])) if paths else cls()
            return self._model

    def diacritize(self, texts: list[str]) -> list[str]:
        model = self._load()
        with self._lock:  # one inference at a time per model
            return list(model.do_tashkeel_batch(texts, batch_size=16, verbose=False))


# ---------- engine selection ----------

_engine: TashkeelEngine | None = None


def available() -> list[str]:
    return ["catt"] if has_module("catt_tashkeel") and has_module("onnxruntime") else []


def details() -> dict[str, Any]:
    if not available():
        return {}
    return {"catt": {"licence": Catt.licence, "model": os.environ.get("WARQA_CATT_MODEL", "ed")}}


def get_engine() -> TashkeelEngine:
    global _engine
    if not available():
        raise NotInstalled("Arabic diacritization needs CATT (Apache-2.0): install the worker's 'tashkeel' extra (catt-tashkeel + onnxruntime)")
    if _engine is None:
        _engine = Catt()
    return _engine


# ---------- the safe merge (pure; unit-tested with fake engines) ----------


def diacritize_text(text: str, engine: TashkeelEngine) -> tuple[str, str]:
    """(text with diacritics, engine name) or (text unchanged, "none")."""
    matches = list(ARABIC_WORD_RE.finditer(text))
    # words the model may see (letters only) and which of them it may change
    context: list[int] = []  # indices into matches
    for k, m in enumerate(matches):
        w = m.group()
        if TATWEEL in w:
            continue
        if CATT_LETTERS_RE.match(strip_diacritics(w)):
            context.append(k)
    eligible = {k for k in context if not has_diacritics(matches[k].group())}
    if not eligible:
        return text, "none"

    # chunk at sentence breaks so the model sees sentence-sized inputs
    chunks: list[list[int]] = []
    for k in context:
        if chunks and len(chunks[-1]) < CHUNK_WORDS:
            prev = matches[chunks[-1][-1]]
            gap = text[prev.end() : matches[k].start()]
            if not _BREAK.search(gap):
                chunks[-1].append(k)
                continue
        chunks.append([k])
    # chunks with nothing to change are not sent
    chunks = [c for c in chunks if any(k in eligible for k in c)]
    inputs = [" ".join(strip_diacritics(matches[k].group()) for k in c) for c in chunks]

    try:
        outputs = engine.diacritize(inputs)
    except NotInstalled:
        raise
    except Exception as e:
        log.warning("tashkeel engine %s failed: %s", getattr(engine, "name", "?"), e)
        return text, "none"
    if not isinstance(outputs, list) or len(outputs) != len(inputs):
        return text, "none"

    replacement: dict[int, str] = {}
    for c, src, out in zip(chunks, inputs, outputs):
        out_words = str(out).split()
        src_words = src.split(" ")
        if len(out_words) != len(src_words):
            return text, "none"
        for k, sw, ow in zip(c, src_words, out_words):
            if strip_diacritics(ow) != sw:
                return text, "none"
            if k in eligible:
                replacement[k] = ow

    parts: list[str] = []
    pos = 0
    for k, m in enumerate(matches):
        if k in replacement:
            parts.append(text[pos : m.start()])
            parts.append(replacement[k])
            pos = m.end()
    parts.append(text[pos:])
    result = "".join(parts)
    if strip_diacritics(result) != strip_diacritics(text):
        return text, "none"
    return result, getattr(engine, "name", "unknown")


def tashkeel(text: str) -> dict[str, str]:
    if not isinstance(text, str):
        raise BadInput("text must be a string")
    if len(text) > MAX_CHARS:
        raise BadInput(f"text is too long ({len(text)} characters; max {MAX_CHARS})")
    engine = get_engine()
    out, name = diacritize_text(text, engine)
    return {"text": out, "engine": name}
