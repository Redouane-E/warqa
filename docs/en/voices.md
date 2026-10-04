# Voices (speech synthesis)

Set the engine in `warqa.json` → `pipeline.tts.provider`, voices per language in `pipeline.tts.voices`, the rate in `pipeline.tts.rate` (e.g. `"-4%"`).

| engine | word timing | needs | notes |
| --- | --- | --- | --- |
| `edge` | yes | `uv` (or `pip install edge-tts`), network | Free Microsoft Edge read-aloud voices through the unofficial `edge-tts` package. Good for trying; for published books prefer Azure. Defaults: `ar-MA-MounaNeural`, `fr-FR-DeniseNeural`, `en-US-AndrewMultilingualNeural`. |
| `azure` | sentence-level | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Official Azure AI Speech, same voices, free monthly tier. |
| `openai` | sentence-level | `OPENAI_API_KEY` | `gpt-4o-mini-tts` (override with `WARQA_OPENAI_TTS_MODEL`). |
| `elevenlabs` | yes (characters) | `ELEVENLABS_API_KEY` | Multilingual voices; the voice is a voice id. |
| `google` | sentence-level | `GOOGLE_TTS_API_KEY` | Cloud Text-to-Speech (WaveNet voices, `ar-XA-*`). |
| `gemini` | sentence-level | `GEMINI_API_KEY` | Gemini speech generation; output WAV. |
| `worker` | depends | the Python worker | Local voices (Piper, Habibi-TTS…), see `workers/py`. |
| `none` | — | — | No audio: synthetic timings; the lesson plays silently with captions. |

**Sentence-level engines** synthesize each sentence separately, so sentence starts are exact and marks inside a sentence are placed proportionally. If the worker is configured, Warqa asks it for **forced alignment** to get exact word times from any audio.

## Read-along

Warqa stores the time of every word with the audio (`timings.<lang>.json` → `words`), not only the times of
the marks. Picture-book pages (`storypage`) highlight the word being read, and captions do the same for every
lesson. Engines with word boundaries (Edge, ElevenLabs) give exact times; with sentence-level engines the words
are spread over each sentence. Lessons without audio still get word times from the reading speed. Books
narrated before this existed need `warqa narrate --force` to get word times (Edge is free).

The page text and the spoken text may differ a little (for example numbers spelled out for speech): words are
matched in order, after normalisation (diacritics and letter variants ignored).

## Darija

Darija (`ary`, Moroccan Arabic written in Arabic script) is a full book language. No Microsoft voice speaks it,
so Edge and Azure use the Moroccan Arabic voice `ar-MA-JamalNeural`. It reads Arabic-script Darija acceptably,
with a Moroccan accent but standard pronunciation of some words. Open Moroccan voices (Habibi-TTS `MAR`)
run in the Python worker (`"provider": "worker"`, default voice `habibi-MAR` for `ary`). Check their licence
first (see below).

Narration is cached per beat by (engine, voice, rate, text): changing one beat re-synthesizes only that beat; moving marks re-derives timings without new audio.

Licences: check your engine's terms. The Edge route is unofficial. Local models have their own licences: Piper's current release (piper1-gpl) is GPL-3.0 and several of its voices (including `ar_JO-kareem` and `fr_FR-siwis`) are fine-tuned from research-only data; Habibi-TTS weights carry conflicting licence information (Apache-2.0 in the README, CC-BY-NC-SA on Hugging Face) on top of non-commercial F5-TTS base weights. Treat local Arabic voices as **non-commercial until verified**. See `workers/py/README.md`.
