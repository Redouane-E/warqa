"""POST /tts: local speech synthesis behind one small engine interface.

Engines (each optional, imported lazily):
  * piper  — piper-tts (OHF-Voice/piper1-gpl), **GPL-3.0-or-later**. Optional, never bundled.
             Voices are model names such as ar_JO-kareem-medium, downloaded on first use from
             huggingface.co/rhasspy/piper-voices into the worker cache (each voice has its own
             dataset licence; the MODEL_CARD is fetched and logged).
  * habibi — Habibi-TTS (code MIT) on F5-TTS (code MIT); voices habibi-MSA, habibi-MAR, …
             See tts_habibi.py for the weight-licence caveats.

Voice names: an engine's own voice id, optionally prefixed ("piper:…", "habibi:…"); or a language
code ("ar", "fr-FR", empty) → that language's default voice. Unknown voice → 404 with the list.
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass
from typing import Any, Protocol

from .errors import BadInput, NotInstalled, UnknownVoice
from .util import base_lang


@dataclass
class TtsResult:
    audio: bytes
    ext: str  # "wav" | "mp3"
    words: list[list[Any]] | None = None


class TtsEngine(Protocol):
    name: str
    licence: str

    def available(self) -> bool:
        """The engine's packages are importable."""
        ...

    def voices(self) -> list[str]:
        """Voices this engine can serve now (installed or downloadable on demand)."""
        ...

    def owns(self, voice: str) -> bool:
        """`voice` looks like one of this engine's voice ids (whether or not it exists)."""
        ...

    def default_voice(self, lang: str) -> str | None: ...

    def synth(self, text: str, voice: str, lang: str, speed: float) -> TtsResult:
        """Raise UnknownVoice if the voice does not exist."""
        ...


_RATE = re.compile(r"^([+-]?\d+(?:\.\d+)?)%$")


def rate_factor(rate: str | None) -> float:
    """Edge-style rate "+10%" / "-4%" → speed factor 1.10 / 0.96 (clamped to 0.5–2). 400 if malformed."""
    if rate is None or not str(rate).strip():
        return 1.0
    m = _RATE.match(str(rate).strip())
    if not m:
        raise BadInput(f'rate must look like "+10%" or "-5%", got "{rate}"')
    return max(0.5, min(2.0, 1 + float(m.group(1)) / 100))


_instances: list[TtsEngine] | None = None


def engines() -> list[TtsEngine]:
    """All known engines (installed or not), created once. Tests replace this."""
    global _instances
    if _instances is None:
        from .tts_habibi import Habibi
        from .tts_piper import Piper

        _instances = [Piper(), Habibi()]
    return _instances


def available() -> list[str]:
    return [e.name for e in engines() if e.available()]


def details() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for e in engines():
        if e.available():
            out[e.name] = {"licence": e.licence, "voices": e.voices()}
    return out


def all_voices(engs: list[TtsEngine]) -> list[str]:
    return [v for e in engs for v in e.voices()]


def _looks_like_lang(voice: str) -> bool:
    return bool(re.fullmatch(r"[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,4})?", voice))


def resolve(voice: str | None, lang: str) -> tuple[TtsEngine, str]:
    engs = engines()
    usable = [e for e in engs if e.available()]
    if not usable:
        raise NotInstalled(
            "no speech engine is installed: install the 'tts' extra (piper-tts, GPL-3.0) or the 'habibi' extra (Habibi-TTS/F5-TTS)"
        )
    v = (voice or "").strip()
    if ":" in v:
        prefix, rest = v.split(":", 1)
        for e in engs:
            if e.name == prefix.lower():
                if not e.available():
                    raise NotInstalled(f"voice engine '{e.name}' is not installed")
                return e, rest.strip()
        raise UnknownVoice(v, all_voices(usable))
    for e in engs:
        if v and e.owns(v):
            if not e.available():
                raise NotInstalled(f"voice '{v}' needs the '{e.name}' engine, which is not installed")
            return e, v
    if not v or _looks_like_lang(v):
        want = base_lang(v or lang)
        env = os.environ.get(f"WARQA_TTS_VOICE_{want.upper()}")
        if env and not _looks_like_lang(env):
            return resolve(env, lang)
        for e in usable:
            d = e.default_voice(want)
            if d:
                return e, d
    raise UnknownVoice(v or lang, all_voices(usable))


def tts(text: str, voice: str | None, lang: str, rate: str | None) -> dict[str, Any]:
    if not text or not text.strip():
        raise BadInput("text is empty")
    speed = rate_factor(rate)
    engine, v = resolve(voice, lang)
    r = engine.synth(text, v, lang, speed)
    return {
        "audio_base64": base64.b64encode(r.audio).decode("ascii"),
        "ext": r.ext,
        "words": r.words,
        "engine": engine.name,
    }


def pcm16_wav(samples: Any, sample_rate: int) -> bytes:
    """float [-1, 1] numpy array → 16-bit mono wav bytes."""
    import io
    import wave

    import numpy as np

    a = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes((a * 32767).astype("<i2").tobytes())
    return buf.getvalue()

