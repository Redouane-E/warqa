"""POST /align: word start times for KNOWN text in an audio clip (forced alignment).

Engine: stable-ts (MIT) on OpenAI Whisper (MIT code and weights): `model.align(audio, text, language=…)`.
Arabic diacritics and tatweel are stripped before aligning (Whisper's tokenizer and training text are
mostly undiacritized); the times are mapped back to the ORIGINAL words by index, falling back to
character offsets when the engine splits words differently.

Not used: torchaudio's forced_align (removed in torchaudio 2.9).
Model: WARQA_ALIGN_MODEL (default "small"; multilingual Whisper names only), downloaded on first use.
"""

from __future__ import annotations

import os
import tempfile
import threading
import wave
from typing import Any

from .arabic import strip_diacritics
from .errors import BadInput, NotInstalled, WorkerError
from .util import base_lang, cache_dir, has_binary, has_module, licence_notice, log, require

ENGINE = "stable-ts"


def available() -> list[str]:
    return [ENGINE] if has_module("stable_whisper") else []


def details() -> dict[str, Any]:
    if not available():
        return {}
    return {
        ENGINE: {
            "licence": "MIT (stable-ts, openai-whisper code and weights)",
            "model": model_name(),
            "ffmpeg": has_binary("ffmpeg"),
        }
    }


def model_name() -> str:
    return os.environ.get("WARQA_ALIGN_MODEL", "small")


def audio_kind(data: bytes) -> str:
    """'wav' or 'mp3' from magic bytes; 400 otherwise."""
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "mp3"
    raise BadInput("audio_base64 must be an mp3 or wav file")


# ---------- word mapping (pure; unit-tested) ----------


def prepare_words(text: str) -> tuple[list[str], list[int], str]:
    """(original words, indices of words that survive stripping, text to align)."""
    words = text.split()
    kept: list[int] = []
    stripped: list[str] = []
    for i, w in enumerate(words):
        s = strip_diacritics(w, tatweel=True)
        if s:
            kept.append(i)
            stripped.append(s)
    return words, kept, " ".join(stripped)


def map_times(words: list[str], kept: list[int], aligned_text: str, timed: list[tuple[float, str]]) -> list[list[Any]]:
    """Give every original word a start time.

    `timed` are (start, text) pairs from the engine for `aligned_text`. When the engine returns one
    entry per kept word, map by index; otherwise locate each engine word in `aligned_text` by
    character offset and give each kept word the time of the first engine word overlapping it.
    Words with no time inherit their neighbour's, and times never go backwards.
    """
    times: list[float | None] = [None] * len(words)
    if len(timed) == len(kept):
        for (t, _), i in zip(timed, kept):
            times[i] = t
    else:
        # character span of each kept word inside aligned_text
        spans: list[tuple[int, int]] = []
        pos = 0
        for i in kept:
            w = strip_diacritics(words[i], tatweel=True)
            start = aligned_text.find(w, pos)
            if start < 0:
                start = pos
            spans.append((start, start + len(w)))
            pos = start + len(w)
        cursor = 0
        located: list[tuple[int, int, float]] = []
        for t, w in timed:
            w = w.strip()
            if not w:
                continue
            at = aligned_text.find(w, cursor)
            if at < 0:
                continue
            located.append((at, at + len(w), t))
            cursor = at + len(w)
        for (s, e), i in zip(spans, kept):
            for a, b, t in located:
                if a < e and b > s:
                    times[i] = t
                    break
    # fill gaps from the previous word (or the next one at the start), keep monotonic
    out: list[list[Any]] = []
    last: float | None = None
    nxt = next((t for t in times if t is not None), 0.0)
    for w, t in zip(words, times):
        if t is None:
            t = last if last is not None else nxt
        if last is not None and t < last:
            t = last
        last = t
        out.append([round(float(t), 3), w])
    return out


# ---------- engine ----------

_model: Any = None
_model_lock = threading.Lock()
_infer_lock = threading.Lock()


def _load_model() -> Any:
    global _model
    with _model_lock:
        if _model is None:
            sw = require("stable_whisper", extra="align", what="stable-ts (forced alignment)")
            name = model_name()
            root = cache_dir("whisper")
            licence_notice(f"Whisper '{name}' weights for alignment", "MIT (OpenAI Whisper)", "openaipublic.azureedge.net via openai-whisper")
            try:
                _model = sw.load_model(name, download_root=str(root))
            except TypeError:  # older/newer signature without download_root
                _model = sw.load_model(name)
        return _model


def _wav_to_16k_mono(data: bytes) -> Any:
    """Decode PCM wav without ffmpeg: float32 mono at 16 kHz (linear resampling)."""
    import io

    import numpy as np

    with wave.open(io.BytesIO(data)) as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width == 2:
        a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        a = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise BadInput(f"unsupported wav sample width: {width} bytes")
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    if rate != 16000 and len(a):
        dur = len(a) / rate
        t_new = np.arange(int(dur * 16000)) / 16000.0
        a = np.interp(t_new, np.arange(len(a)) / rate, a).astype(np.float32)
    return a


def align(audio: bytes, text: str, lang: str) -> dict[str, Any]:
    if not text or not text.strip():
        raise BadInput("text is empty")
    kind = audio_kind(audio)
    if not available():
        raise NotInstalled("forced alignment needs stable-ts (MIT): install the worker's 'align' extra (pulls in torch)")
    words, kept, aligned_text = prepare_words(text)
    if not kept:
        return {"words": [[0.0, w] for w in words], "engine": ENGINE}
    model = _load_model()
    language = base_lang(lang) or None
    tmp_path: str | None = None
    try:
        if has_binary("ffmpeg"):
            fd, tmp_path = tempfile.mkstemp(suffix=f".{kind}")
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            source: Any = tmp_path
        elif kind == "wav":
            source = _wav_to_16k_mono(audio)
        else:
            raise NotInstalled("decoding mp3 for alignment needs ffmpeg on PATH (or send wav)")
        with _infer_lock:
            result = model.align(source, aligned_text, language=language)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    if result is None:
        raise WorkerError("alignment failed (stable-ts returned nothing)")
    timed = [(float(w.start), str(w.word)) for w in result.all_words()]
    if not timed:
        raise WorkerError("alignment produced no words")
    log.debug("aligned %d engine words to %d text words", len(timed), len(words))
    return {"words": map_times(words, kept, aligned_text, timed), "engine": ENGINE}
