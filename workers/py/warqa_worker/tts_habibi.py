"""Habibi-TTS voices (F5-TTS based Arabic: MSA and dialects). Optional; heavy (torch).

Code: habibi-tts (MIT) and f5-tts (MIT). Weights: the Habibi README says the *Specialized* MSA/MAR/
ALG/EGY/IRQ models are Apache-2.0 (Unified/SAU/UAE are CC-BY-NC-SA-4.0 and are NOT offered here), but
the Hugging Face repo metadata says cc-by-nc-sa-4.0 and the models are fine-tuned from F5-TTS base
weights whose licence is CC-BY-NC — treat commercial use as UNVERIFIED.

F5-TTS clones a reference voice, so each dialect needs a reference clip + its transcript:
  1. $WARQA_WORKER_CACHE/habibi/voices/<DIALECT>.(wav|mp3) + <DIALECT>.txt  (your own recording), else
  2. the clip bundled in the habibi_tts package (assets/) — those come from the ElevenLabs voice
     library / the Habibi benchmark; check their terms before publishing audio made with them.

The integration follows habibi_tts/infer/infer_cli.py (v0.1.1); it is written defensively and has not
been run end-to-end here (no weights were downloaded).
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any

from .errors import NotInstalled, UnknownVoice, WorkerError
from .tts import TtsResult, pcm16_wav
from .util import cache_dir, has_module, licence_notice, log, require

# dialect → checkpoint step of the Specialized model (huggingface.co/SWivid/Habibi-TTS)
DIALECTS = {"MSA": 200000, "MAR": 100000, "ALG": 100000, "EGY": 100000, "IRQ": 100000}
# bundled reference clips (habibi_tts/assets) and their transcripts (from assets/README.md)
BUNDLED_REFS = {
    "MSA": ("MSA.mp3", "كان اللعيب حاضرًا في العديد من الأنشطة والفعاليات المرتبطة بكأس العالم، مما سمح للجماهير بالتفاعل معه والتقاط الصور التذكارية."),
    "MAR": ("MAR.mp3", "إذا بغيتي شي صوت باللهجة المغربية للإعلانات ديالك هذا أحسن واحد غادي تلقاه."),
    "ALG": ("ALG.wav", "أنيا هكا باغية ناكل هكا أني ن نشوف فيها الحاجة هذيكا."),
    "EGY": ("EGY.mp3", "ايه الكلام. بقولك ايه. استخدم صوتي في المحادثات. استخدمه هيعجبك اوي."),
    "IRQ": ("IRQ.wav", "يعني ااا ما نقدر ناخذ وقت أكثر، ااا لأنه شروط كلش يحتاجلها وقت."),
}
VOICE_RE = re.compile(r"^habibi[-_]?(?P<d>[A-Za-z]{3})$", re.I)


class Habibi:
    name = "habibi"
    licence = (
        "code MIT (habibi-tts, f5-tts); Specialized weights Apache-2.0 per the Habibi README, but the HF repo "
        "metadata says CC-BY-NC-SA-4.0 and the F5-TTS base weights are CC-BY-NC: unverified for commercial use"
    )

    def __init__(self) -> None:
        self._models: dict[str, Any] = {}
        self._vocoder: Any = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        return has_module("habibi_tts") and has_module("f5_tts")

    def dialects(self) -> list[str]:
        env = os.environ.get("WARQA_HABIBI_DIALECTS", "MSA,MAR")
        return [d for d in (x.strip().upper() for x in env.split(",")) if d in DIALECTS]

    def voices(self) -> list[str]:
        return [f"habibi-{d}" for d in self.dialects()]

    def owns(self, voice: str) -> bool:
        return VOICE_RE.match(voice) is not None

    def default_voice(self, lang: str) -> str | None:
        base = lang.lower().split("-")[0]
        if base == "ary" or lang.lower() in ("ar-ma-darija", "ar-x-darija"):
            return "habibi-MAR" if "MAR" in self.dialects() else None
        return "habibi-MSA" if base == "ar" and "MSA" in self.dialects() else None

    def _dialect(self, voice: str) -> str:
        m = VOICE_RE.match(voice) or re.match(r"^(?P<d>[A-Za-z]{3})$", voice)
        d = m["d"].upper() if m else ""
        if d not in self.dialects():
            raise UnknownVoice(voice, self.voices())
        return d

    def _reference(self, d: str) -> tuple[str, str]:
        own = cache_dir("habibi", "voices")
        for ext in ("wav", "mp3", "flac"):
            audio, txt = own / f"{d}.{ext}", own / f"{d}.txt"
            if audio.exists() and txt.exists():
                return str(audio), txt.read_text("utf-8").strip()
        from importlib.resources import files

        name, text = BUNDLED_REFS[d]
        path = Path(str(files("habibi_tts").joinpath("assets", name)))
        if not path.exists():
            raise WorkerError(f"no reference clip for {d}: put {d}.wav and {d}.txt in {own}")
        log.warning("habibi %s: using the bundled reference clip %s (ElevenLabs voice library / Habibi benchmark; check its terms)", d, name)
        return str(path), text

    def _load(self, d: str) -> tuple[Any, Any, str]:
        with self._lock:
            require("habibi_tts", extra="habibi", what="Habibi-TTS")
            ui = require("f5_tts.infer.utils_infer", extra="habibi", what="F5-TTS")
            from importlib.resources import files

            from cached_path import cached_path
            from hydra.utils import get_class
            from omegaconf import OmegaConf

            cfg = OmegaConf.load(str(files("f5_tts").joinpath("configs/F5TTS_v1_Base.yaml")))
            mel = cfg.model.mel_spec.mel_spec_type
            device = require("habibi_tts.infer.utils_infer", extra="habibi", what="Habibi-TTS").device
            if d not in self._models:
                step = DIALECTS[d]
                repo = f"hf://SWivid/Habibi-TTS/Specialized/{d}"
                licence_notice(f"Habibi-TTS Specialized/{d} weights", "Apache-2.0 per Habibi README (unverified, see README)", repo)
                root = str(cache_dir("habibi", "hf"))
                ckpt = str(cached_path(f"{repo}/model_{step}.safetensors", cache_dir=root))
                vocab = str(cached_path(f"{repo}/vocab.txt", cache_dir=root))
                model_cls = get_class(f"f5_tts.model.{cfg.model.backbone}")
                self._models[d] = ui.load_model(model_cls, cfg.model.arch, ckpt, mel_spec_type=mel, vocab_file=vocab, device=device)
            if self._vocoder is None:
                licence_notice("Vocos mel-24kHz vocoder", "MIT", "hf://charactr/vocos-mel-24khz")
                self._vocoder = ui.load_vocoder(vocoder_name=mel, is_local=False, device=device)
            return self._models[d], self._vocoder, mel

    def synth(self, text: str, voice: str, lang: str, speed: float) -> TtsResult:
        if not self.available():
            raise NotInstalled("Habibi-TTS is not installed (the 'habibi' extra)")
        d = self._dialect(voice)
        model, vocoder, mel = self._load(d)
        ui = require("f5_tts.infer.utils_infer", extra="habibi", what="F5-TTS")
        hi = require("habibi_tts.infer.utils_infer", extra="habibi", what="Habibi-TTS")
        ref_audio, ref_text = self._reference(d)
        ref_audio, ref_text = ui.preprocess_ref_audio_text(ref_audio, ref_text)
        with self._lock:
            wav, sr, _ = hi.infer_process(
                ref_audio,
                ref_text,
                text,
                model,
                vocoder,
                mel_spec_type=mel,
                speed=speed,
                device=hi.device,
                dialect_id=None,  # Specialized models take no dialect tag
                show_info=log.info,
            )
        return TtsResult(pcm16_wav(wav, sr), "wav", None)
