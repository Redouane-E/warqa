# Warqa worker (optional Python sidecar)

Warqa's TypeScript core does everything it needs on its own. This worker adds **local** engines that
only exist in Python: OCR for scanned or broken Arabic text layers, forced alignment (word times for
narration audio), Arabic diacritization (tashkeel) before speech, and local voices.

The core never imports it. It calls it over HTTP when `pipeline.worker` is set in `warqa.json`:

```json
{
  "pipeline": {
    "worker": "http://localhost:8790",
    "tts": { "provider": "worker", "tashkeel": true }
  }
}
```

- `pipeline.worker` alone: alignment for engines without word times (`/align`), OCR fallback (`/ocr`), and
  diacritics before synthesis when `pipeline.tts.tashkeel` is true (`/tashkeel`).
- `"tts": { "provider": "worker" }`: narration is synthesized by the worker (`/tts`).

Everything is optional. The server starts with only FastAPI, uvicorn and pydantic. Each engine is an
extra that is imported only when it is used. `/health` reports what is installed. Calling an endpoint
whose engine is missing returns **501**.

## Running it

```sh
cd workers/py
uv sync --extra ocr --extra tashkeel        # choose the extras you want (see the matrix below)
uv run python -m warqa_worker --port 8790   # binds 127.0.0.1 by default; --host 0.0.0.0 to expose
curl localhost:8790/health
```

With Docker (tesseract ara/fra/eng, RapidOCR and CATT by default):

```sh
docker build -t warqa-worker workers/py
docker run --rm -p 8790:8790 -v warqa-models:/cache warqa-worker
# add capabilities: --build-arg WITH_ALIGN=1  --build-arg WITH_TTS=1 (GPL)  --build-arg WITH_HABIBI=1
```

No model weights are baked into the image or the package. They download on first use into the cache
(`$WARQA_WORKER_CACHE`, default `~/.cache/warqa-worker`; `/cache` in Docker). Each download logs a line
that names the model, its licence and where it comes from:

```
WARNING warqa_worker: [licence] CATT ED ONNX model: Apache-2.0 (source: https://github.com/abjadai/catt/releases/...)
```

## Endpoints

All bodies are JSON. Errors are always `{"error": "..."}` with status **400** (bad input: invalid base64,
empty text, unreadable image, malformed rate), **404** (unknown voice; the body also has `"voices": [...]`),
**413** (body over ~30 MB), **501** (the capability is not installed) or **500** (anything else). CORS
allows `http://localhost:*`, `http://127.0.0.1:*` and `http://[::1]:*`, so the studio can call the
worker from the browser.

| Endpoint | Request | Response |
|---|---|---|
| `GET /health` | – | `{ "ok": true, "version": "0.1.0", "capabilities": { "ocr": [...], "align": [...], "tashkeel": [...], "tts": [...] }, "engines": {...details, licences, voices} }` |
| `POST /ocr` | `{ "image_base64": PNG, "lang": "ar" \| "fr" \| "en" \| ... }` | `{ "text": str, "engine": "tesseract" \| "rapidocr" }` |
| `POST /align` | `{ "audio_base64": mp3 \| wav, "text": str, "lang": str }` | `{ "words": [[start_seconds, word], ...], "engine": "stable-ts" }` |
| `POST /tashkeel` | `{ "text": str }` | `{ "text": str, "engine": "catt" \| "none" }` |
| `POST /tts` | `{ "text": str, "voice": str, "lang": str, "rate": "+10%" \| null }` | `{ "audio_base64": str, "ext": "wav", "words": null, "engine": "piper" \| "habibi" }` |

`/health` lists only what can actually run. An OCR engine counts only when its packages import and, for
tesseract, the binary and at least one traineddata are present.

### `/ocr`

Engines are tried in order: `tesseract`, then `rapidocr`. Set `WARQA_OCR_ENGINES=rapidocr,tesseract` to
change the order. An engine is used only if it can read the language. The first non-empty result wins.

- **tesseract**: the language maps to traineddata: `ar` → `ara+eng` (so the Latin and the math on Arabic
  pages survive; `+eng` only if installed), `fr` → `fra`, `en` → `eng`. Other common codes, or a 3-letter
  tesseract code, are passed through. Three adjustments, each found by running it on Arabic pages with math:
  - Images whose longest side is under `WARQA_TESSERACT_MIN_SIDE` (2000 px) are upscaled first (×3 at most).
  - `--psm 3` (automatic layout) sometimes drops whole lines of Arabic mixed with math; `--psm 6` keeps them
    but ignores columns. Both are run, and the `--psm 6` result is used only when it has at least 15% more
    confident words. Set `WARQA_TESSERACT_CONFIG` to use a single configuration instead.
  - Tesseract returns each word in logical order, but it orders mixed runs in RTL lines wrongly (`x + 1`
    comes out as `1 + x`) and wraps Latin words in LRM/RLM marks. So the worker rebuilds RTL lines from
    the word boxes (`image_to_data`): words are read right to left, and a run of non-Arabic words that
    contains a Latin letter keeps its on-page left-to-right order (`x + 1`, `f(x) = 2x`). A run of digits
    only (`2 + 3 = 5`) follows the bidi algorithm. Invisible bidi marks are removed.
- **rapidocr**: RapidOCR 3.x with PP-OCRv5 mobile recognition models (Arabic, Latin, English, Cyrillic...).
  These models read right-to-left lines in **visual** (left-to-right) order. What the worker does about it:
  - rapidocr ≥ 3.x reorders RTL lines itself with python-bidi (`reorder_bidi_for_display`). The worker
    detects that and trusts it.
  - For builds that don't (older 3.x, or the legacy `rapidocr-onnxruntime`), the worker turns each RTL
    box from visual into logical order itself. It uses python-bidi's `get_display` when installed: for a
    single-level line, applying the bidi algorithm to visual text gives back the logical order.
    Otherwise it uses its own minimal reordering (`arabic.visual_to_logical`): reverse the line, keep the
    internal order of runs of Latin and digits, and mirror brackets.
  - Boxes are grouped into rows by vertical overlap. RTL rows are joined **right-to-left** (token order
    reversed compared with the engine's left-to-right box order), LTR rows left-to-right.
  - The legacy `rapidocr-onnxruntime` package (Python < 3.13 only, Chinese+English models) is accepted
    if it is installed, but only for `en`/`zh`.
  - RapidOCR's Arabic model does not read Latin letters (`x`, `f(x)` are lost). This is why tesseract
    comes first for Arabic pages with math.

### `/align`

This is forced alignment of **known** text with stable-ts:
`stable_whisper.load_model(name).align(audio, text, language=lang)`. Arabic diacritics (U+064B–U+065F,
U+0670) and tatweel (U+0640) are stripped before aligning. The times are then mapped back to the
**original** whitespace-separated words: by index when the engine returns one word per input word,
otherwise by character offsets. Words without a time (punctuation such as `—`) take their neighbour's
time, and times never go backwards. The Whisper model comes from `WARQA_ALIGN_MODEL` (default `small`;
use a multilingual name, not `*.en`). mp3 needs `ffmpeg` on PATH. Without ffmpeg, PCM wav is decoded
in Python. torchaudio's `forced_align` is not used: it was removed in torchaudio 2.9.

### `/tashkeel`

This adds diacritics with CATT (`catt_tashkeel.CATTEncoderDecoder`, or `CATTEncoderOnly` with
`WARQA_CATT_MODEL=eo` for speed). The model may only **add** diacritics:

- Only Arabic words made of letters CATT knows are sent, chunked at sentence punctuation (48 words at
  most per chunk). Latin text, digits, punctuation, spacing, line breaks, words with tatweel and words
  with letters outside CATT's set (e.g. ڤ) are left exactly as they are.
- Words that already carry diacritics are kept as written. Their letters are still sent as context.
- If the engine changes, merges or drops a letter or word, or if stripping the diacritics from the final
  text does not give back the input exactly, the **input is returned unchanged with `"engine": "none"`**.
  The TypeScript side checks the same thing again before using the result.
- Mishkal is never used (GPL).

### `/tts`

How the `voice` is chosen:

- An engine's own voice id: a Piper model name such as `ar_JO-kareem-medium`, `fr_FR-siwis-medium` or
  `en_US-lessac-medium` (any voice in the [piper-voices catalogue](https://huggingface.co/rhasspy/piper-voices)),
  or a Habibi voice `habibi-MSA` / `habibi-MAR`. An engine prefix also works: `piper:...`, `habibi:...`.
- A language code (`ar`, `fr-FR`; what the TypeScript client sends by default) or an empty voice: that
  language's default voice. The defaults are Piper `ar_JO-kareem-medium` / `fr_FR-siwis-medium` /
  `en_US-lessac-medium`, then `habibi-MSA` for Arabic. Override them with `WARQA_TTS_VOICE_AR=habibi-MAR`
  (any language: `WARQA_TTS_VOICE_<LANG>`).
- An unknown voice gets **404** with the list of available voices. A voice whose engine is not installed
  gets **501**.

`rate` follows the Edge style (`"-4%"`, `"+10%"`). It sets Piper's `length_scale` (voice default ÷ factor)
or F5's `speed`. The output is 16-bit wav. `words` is `null` because neither engine reports word times;
Warqa then calls `/align`.

**Engine interface.** `warqa_worker/tts.py` defines `TtsEngine` (`available`, `voices`, `owns`,
`default_voice`, `synth`). Adding an engine means adding a class to `engines()`.

- **piper** (`tts_piper.py`): voices download on first use (`.onnx` + `.onnx.json` + `MODEL_CARD`) into
  `$WARQA_WORKER_CACHE/piper/`. Piper adds Arabic diacritics itself with its bundled libtashkeel model
  (MIT) when the text has none.
- **habibi** (`tts_habibi.py`): Habibi-TTS *Specialized* F5 models (MSA, MAR; also ALG, EGY and IRQ via
  `WARQA_HABIBI_DIALECTS`). F5 clones a reference voice. Put your own clip and its exact transcript at
  `$WARQA_WORKER_CACHE/habibi/voices/MSA.wav` + `MSA.txt`. Otherwise the clip bundled in the
  `habibi_tts` package is used, and a warning is logged because those clips come from the ElevenLabs
  voice library / Habibi benchmark.

## Install matrix

| Extra | Python packages | System needs | Downloaded on first use |
|---|---|---|---|
| *(core)* | fastapi, uvicorn, pydantic | – | – |
| `ocr` | pytesseract, pillow, rapidocr ≥ 3.4, onnxruntime, python-bidi | `tesseract` + `tesseract-ocr-ara`, `-fra`, `-eng` (apt) / `brew install tesseract tesseract-lang` | RapidOCR PP-OCRv5 recognition models (a few MB each) |
| `align` | stable-ts (pulls torch, openai-whisper) | `ffmpeg` for mp3 | Whisper weights (`small` ≈ 460 MB) |
| `tashkeel` | catt-tashkeel, onnxruntime | – | CATT ONNX zip (ED ≈ 86 MB, EO ≈ 72 MB) |
| `tts` | piper-tts (**GPL-3.0**) | – | each Piper voice (≈ 60 MB for *medium*) |
| `habibi` | habibi-tts (pulls f5-tts, torch < 2.9) | `ffmpeg` | Habibi Specialized checkpoint (≈ 1.35 GB per dialect) + Vocos vocoder |
| `all` | ocr + align + tashkeel + tts (so it includes GPL piper-tts; not habibi) | | |

Install with `uv sync --extra ocr --extra align` (or `pip install ".[ocr,align]"`).

`catt-tashkeel` declares a dependency on `onnxruntime-gpu`. That package has no macOS wheels and
conflicts with `onnxruntime`. `pyproject.toml` drops it for uv (`tool.uv.override-dependencies`), and the
Dockerfile does the same with `--overrides`. With plain pip on macOS, install it with
`pip install --no-deps catt-tashkeel` after the other packages. The legacy `rapidocr-onnxruntime` package
is replaced by `rapidocr` 3.x because it is capped at Python < 3.13 and has no Arabic model.

## Licences

The worker itself is **Apache-2.0**, like the rest of Warqa. The engines are optional. Nothing below is
bundled in the package or baked into the Docker image except what the Docker build installs from the
distributions (tesseract and its traineddata, and the Python packages of the chosen extras).

| Component | Licence | Notes |
|---|---|---|
| FastAPI / uvicorn / pydantic | MIT / BSD-3 / MIT | core |
| Tesseract + tessdata | **Apache-2.0** | system package |
| pytesseract | Apache-2.0 | |
| RapidOCR (`rapidocr`) + PaddleOCR models | Apache-2.0 | models from modelscope.cn/RapidAI |
| onnxruntime / opencv-python / Pillow | MIT / Apache-2.0 / MIT-CMU | |
| python-bidi | **LGPL-3.0** | imported, unmodified (RTL reordering) |
| stable-ts | **MIT** | |
| openai-whisper (code and weights) | MIT | |
| CATT (`catt-tashkeel`, code and models) | **Apache-2.0** | relicensed from CC-BY-NC to Apache-2.0 by its authors (see the CATT README) |
| piper-tts (`OHF-Voice/piper1-gpl`) + embedded espeak-ng | **GPL-3.0-or-later** | **optional, not bundled, off in the default Docker image**; installing it is your decision |
| Piper voices | per voice: see each `MODEL_CARD` | `en_US-lessac` uses the Blizzard 2013 Lessac data, whose licence is **research-only**. Many voices are fine-tuned from lessac, including `ar_JO-kareem` and `fr_FR-siwis` per their model cards. Check before commercial use. |
| Habibi-TTS code / F5-TTS code | MIT / MIT | |
| Habibi-TTS Specialized weights (MSA, MAR, ALG, EGY, IRQ) | Apache-2.0 **per the Habibi README** | The Hugging Face repo metadata says `cc-by-nc-sa-4.0`, and the models are fine-tuned from F5-TTS base weights, which the F5-TTS README licenses CC-BY-NC. **Unverified**: don't assume commercial use is allowed. Unified/SAU/UAE weights are CC-BY-NC-SA-4.0 and are not offered. |
| Vocos mel-24kHz vocoder | MIT | used by F5 |

**Not used:**
- Mishkal (GPL)
- MMS-TTS (CC-BY-NC-4.0, non-commercial)
- XTTS (Coqui Public Model License, non-commercial)
- torchaudio `forced_align` (removed in 2.9)

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WARQA_WORKER_HOST` / `WARQA_WORKER_PORT` | `127.0.0.1` / `8790` | bind address (same as `--host` / `--port`) |
| `WARQA_WORKER_CACHE` | `~/.cache/warqa-worker` | model cache |
| `WARQA_WORKER_MAX_BYTES` | 31457280 (30 MB) | request size limit |
| `WARQA_WORKER_CORS` | localhost regex | allowed browser origins (a regex) |
| `WARQA_OCR_ENGINES` | `tesseract,rapidocr` | OCR order |
| `TESSERACT_CMD` | `tesseract` | tesseract binary |
| `WARQA_TESSERACT_CONFIG` | – (runs `--psm 3` and `--psm 6`) | a single tesseract configuration instead |
| `WARQA_TESSERACT_MIN_SIDE` | `2000` | upscale smaller images to about this size |
| `WARQA_ALIGN_MODEL` | `small` | Whisper model for alignment |
| `WARQA_CATT_MODEL` | `ed` | `ed` (more accurate) or `eo` (faster) |
| `WARQA_TTS_VOICE_<LANG>` | – | default voice per language, e.g. `WARQA_TTS_VOICE_AR=habibi-MAR` |
| `WARQA_HABIBI_DIALECTS` | `MSA,MAR` | which Habibi voices to offer |

## Development

```sh
cd workers/py
uv run pytest            # or: uv run --with pytest --with httpx pytest -q
```

The tests need only the core dependencies. They simulate missing packages (each capability → 501),
check that bad base64 → 400, and test the tashkeel validation rules, the alignment word mapping, RTL
reordering and voice routing with fake engines.

## What is verified and what is not

The engine APIs were checked against the published packages: catt-tashkeel 1.0.2 (import `catt_tashkeel`),
piper-tts 1.8.0 (`PiperVoice.load`, `SynthesisConfig`, `synthesize_wav`), rapidocr 3.9.2 (`LangRec.ARABIC`,
PP-OCRv5, its own bidi reordering), stable-ts 2.19.1 (`load_model(..., download_root=)`,
`model.align(audio, text, language=)`, `result.all_words()`) and habibi-tts 0.1.1 (`infer_process`,
Specialized checkpoints on Hugging Face).

Run for real (in the default Docker image, on synthetic Arabic and French pages): `/health`, and
`/ocr` with tesseract 5 (ara/fra/eng) and with RapidOCR 3.9 (Arabic PP-OCRv5).

Not run end to end, because their weights were not downloaded: CATT (`/tashkeel`), stable-ts
(`/align`), Piper and Habibi (`/tts`). Their behaviour around the model (routing, validation, word
mapping, errors) is covered by the unit tests with fake engines. The Habibi integration follows the
package's own CLI and should be treated as experimental. The code is defensive: an engine failure becomes a JSON 500 (or, for
tashkeel, the unchanged input) and never takes the server down.
