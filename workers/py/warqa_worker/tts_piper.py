"""Piper voices (piper-tts = OHF-Voice/piper1-gpl, GPL-3.0-or-later; optional, not bundled).

API used (piper-tts ≥ 1.3): PiperVoice.load(model, download_dir=…), SynthesisConfig(length_scale=…),
voice.synthesize_wav(text, wave_writer, syn_config=…). Arabic voices get diacritics from piper's own
built-in libtashkeel model (MIT) unless the text already has them.
"""

from __future__ import annotations

import io
import re
import threading
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any

from .errors import NotInstalled, UnknownVoice
from .tts import TtsResult
from .util import cache_dir, download, has_module, licence_notice, log, require

DEFAULT_VOICES = {
    "ar": "ar_JO-kareem-medium",
    "fr": "fr_FR-siwis-medium",
    "en": "en_US-lessac-medium",
}
VOICE_RE = re.compile(r"^(?P<family>[a-z]{2,3})_(?P<region>[A-Za-z]{2,3})-(?P<name>[^-/\s]+)-(?P<quality>x_low|low|medium|high)$")
BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"


class Piper:
    name = "piper"
    licence = "GPL-3.0-or-later (piper-tts / piper1-gpl engine); each voice has its own dataset licence (see its MODEL_CARD)"

    def __init__(self) -> None:
        self._voices: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._catalog: set[str] | None = None
        self._catalog_tried = False

    def available(self) -> bool:
        return has_module("piper") and has_module("onnxruntime")

    def _dir(self) -> Path:
        return cache_dir("piper")

    def downloaded(self) -> list[str]:
        d = self._dir()
        return sorted(p.name[: -len(".onnx")] for p in d.glob("*.onnx") if (d / f"{p.name}.json").exists())

    def voices(self) -> list[str]:
        return sorted(set(DEFAULT_VOICES.values()) | set(self.downloaded()))

    def owns(self, voice: str) -> bool:
        return VOICE_RE.match(voice) is not None

    def default_voice(self, lang: str) -> str | None:
        return DEFAULT_VOICES.get(lang)

    def catalog(self) -> set[str] | None:
        """Voice names from the piper-voices voices.json (cached on disk); None when offline."""
        if self._catalog is None and not self._catalog_tried:
            self._catalog_tried = True
            import json

            path = self._dir() / "voices.json"
            try:
                if not path.exists():
                    download(f"{BASE_URL}/voices.json?download=true", path, timeout=15)
                self._catalog = set(json.loads(path.read_text("utf-8")).keys())
            except Exception as e:
                log.info("piper voice catalog unavailable (%s); will try downloading voices directly", e)
        return self._catalog

    def _ensure(self, voice: str) -> Path:
        m = VOICE_RE.match(voice)
        if not m:
            raise UnknownVoice(voice, self.voices())
        d = self._dir()
        model, config = d / f"{voice}.onnx", d / f"{voice}.onnx.json"
        if model.exists() and model.stat().st_size and config.exists() and config.stat().st_size:
            return model
        cat = self.catalog()
        if cat is not None and voice not in cat:
            raise UnknownVoice(voice, self.voices())
        base = f"{BASE_URL}/{m['family']}/{m['family']}_{m['region']}/{m['name']}/{m['quality']}"
        card = ""
        try:
            with urllib.request.urlopen(f"{base}/MODEL_CARD", timeout=15) as res:  # noqa: S310
                card = res.read().decode("utf-8", "replace")
        except Exception:
            pass
        lic = next((ln.strip(" *") for ln in card.splitlines() if "licen" in ln.lower()), "see MODEL_CARD")
        licence_notice(f"Piper voice {voice}", f"dataset {lic}; engine piper-tts GPL-3.0", f"{base}/")
        try:
            download(f"{base}/{voice}.onnx.json?download=true", config)
            download(f"{base}/{voice}.onnx?download=true", model, timeout=600)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise UnknownVoice(voice, self.voices()) from e
            raise
        if card:
            (d / f"{voice}.MODEL_CARD").write_text(card, "utf-8")
        return model

    def _load(self, voice: str) -> Any:
        with self._lock:
            if voice not in self._voices:
                piper = require("piper", extra="tts", what="piper-tts (GPL-3.0)")
                model = self._ensure(voice)
                try:
                    self._voices[voice] = piper.PiperVoice.load(str(model), download_dir=str(self._dir()))
                except TypeError:  # older signature
                    self._voices[voice] = piper.PiperVoice.load(str(model))
            return self._voices[voice]

    def synth(self, text: str, voice: str, lang: str, speed: float) -> TtsResult:
        if not self.available():
            raise NotInstalled("piper-tts is not installed (the 'tts' extra; GPL-3.0)")
        pv = self._load(voice)
        piper = require("piper", extra="tts", what="piper-tts (GPL-3.0)")
        base_scale = getattr(pv.config, "length_scale", None) or 1.0
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            if hasattr(piper, "SynthesisConfig"):
                pv.synthesize_wav(text, wf, syn_config=piper.SynthesisConfig(length_scale=base_scale / speed))
            else:  # piper-tts < 1.3
                pv.synthesize(text, wf, length_scale=base_scale / speed)
        return TtsResult(buf.getvalue(), "wav", None)
