# Getting started

## Requirements

- **Node 22+** and **pnpm** (`corepack enable`).
- For narration with the free Edge voices: **uv** (or `pip install edge-tts`) and network access.
- For QA screenshots and video: Playwright Chromium (`npx playwright install chromium`) and, for video, **ffmpeg**.
- At least one model: an API key (Anthropic, OpenAI, Google Gemini, Mistral, DeepSeek, Groq, xAI or OpenRouter) **or** a local server (Ollama, LM Studio, llama.cpp, vLLM).

`warqa doctor` checks all of this.

## Install

```bash
git clone https://github.com/<you>/warqa && cd warqa
pnpm install
pnpm build
pnpm link --global ./apps/cli   # optional: makes `warqa` available everywhere
```

Put your keys in `.env` (see `.env.example`). Keys stay on your machine; they are never written into book projects or exports.

## A book, step by step

```bash
warqa init physics.warqa --pdf physique-1bac.pdf --langs ar,fr --default ar --audience "lycée, 1ère année bac"
cd physics.warqa
warqa ingest
```

`ingest` reads every page: the text layer in reading order (right-to-left lines for Arabic), Arabic repairs (presentation forms, reversed text), and OCR for scanned or broken pages with your vision model or the worker. It finds chapters from the PDF bookmarks, or from headings ("الفصل", "Chapitre", "Chapter", "الدرس"…). The result is `source/document.json`.

```bash
warqa plan            # drafts plan.json: chapters, objectives, minutes, glossary per language
```

Open `plan.json` (or the studio's Plan tab): set `include` to false for chapters you don't want, fix titles, add glossary terms. Then:

```bash
warqa plan --approve
warqa estimate
warqa build --chapter ch01
```

`build` runs, for each chapter: **storyboard** (beats with teaching moves) → **write** (each beat validated against the scene left by the previous one; problems go back to the model) → **translate** (for each other language) → **narrate** (audio + timed marks). Every step is saved; run it again to resume, `--force write` to redo a step. Calls are cached, so a rerun costs nothing.

```bash
warqa validate               # schema, marks, cue targets, answers, translations, pacing
warqa qa --chapter ch01 --shots
warqa preview
```

## Editing by hand

Everything is JSON in `lessons/<chapter>/`:

- `lesson.json` — the structure (beats, nodes, cues, questions) with text in the author language.
- `strings.<lang>.json` — the other languages, key by key.
- `timings.<lang>.json` and `audio/<lang>/` — narration.

Change narration text, then `warqa narrate --chapter ch01 --lang ar` re-synthesizes only the beats that changed. Ask for a different version of one beat: `warqa rewrite -c ch01 -b rule -i "use a balance scale instead"`.

## Exporting

```bash
warqa export                 # dist/: open dist/index.html, even without a server
warqa export --zip           # one file to share
warqa export --scorm         # SCORM 1.2 for Moodle: completion + score are reported
warqa export --anki ar       # flashcards from the questions and glossary
warqa export --video ar      # MP4 per lesson (needs ffmpeg)
```
