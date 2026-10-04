<div align="center">

# Warqa · ورقة

**Turn a PDF into an animated, narrated, interactive book — in Arabic, Darija, French and English, with any AI model.**

*ورقة* is Arabic for “a sheet of paper”.

[**Start here**](docs/en/start-here.md) · [ابدأ من هنا](docs/ar/start-here.md) · [Commencer ici](docs/fr/start-here.md) · [Try it in your browser](https://redouane-e.github.io/warqa/) · [Example lesson](https://redouane-e.github.io/warqa/demo/)

</div>

Warqa reads a book, plans a series of short lessons, and writes each one as a sequence of **beats**: narration
paired with visual changes that happen on the exact words that explain them. Quick checks and practice
happen *inside* the picture. Learners can watch, listen, pause, answer, and switch language mid-lesson. The
result is a small website that works offline: no server, no account.

```
PDF → read (Arabic repairs, OCR) → plan → storyboard → write beats → translate → narrate → QA → book
```

## For teachers and parents

You don't need to know how to program:

1. **In your browser:** open the [web app](https://redouane-e.github.io/warqa/), paste a key from an AI service
   (the guide shows the cheap and free ones), and drop a PDF. Nothing to install; your books and key stay
   on your computer.
2. **On your computer, every feature:** download Warqa and double-click the launcher for
   [Windows, Mac or Linux](launchers/README.md).

The [start-here guide](docs/en/start-here.md) walks you through your first book, in
[Arabic](docs/ar/start-here.md), [French](docs/fr/start-here.md) and English.

## What it does

- **Any model, your choice.** Claude, GPT, Gemini, Mistral, DeepSeek, Grok, anything on OpenRouter, any
  OpenAI-compatible server, or **fully local** with Ollama, LM Studio, llama.cpp or vLLM. Pick a model per
  role (planner, writer, translator, vision, judge).
  Models never write code or pixels: they fill a validated lesson format, problems go back to them for repair,
  and small models get a simpler format with cues placed automatically. → [models](docs/en/models.md)
- **Arabic first, Darija included.**
  - Layout: right to left, mirroring what should mirror and keeping what shouldn't (number lines, maps,
    math). Math is written left to right inside Arabic text, as in Moroccan textbooks.
  - Answers: Arabic-Indic digits and decimal commas are accepted.
  - PDFs: garbled Arabic text is repaired, or sent to OCR.
  - Darija (`ary`) is a full book language, with its own player interface. → [Arabic and Darija](docs/en/arabic.md)
- **Any-to-any translation with a memory.**
  - One lesson structure, one string table per language; translations keep every mark, answer box and formula.
  - A book-wide translation memory and glossary checks keep wording consistent across chapters.
  - Teachers review translations in the studio or in a spreadsheet, and their wording is never overwritten.
    → [translation](docs/en/translation.md)
- **Teaching, not slides.**
  - The scene persists across beats, and components are stateful: an equation morphs, a number line hops, a
    clock's hands turn, a map lights up a region.
  - Validators enforce pacing: a visual change per sentence, no empty openings, questions between ideas.
  - 25 components (math typeset with MathJax, maps down to the regions of a country, picture-book pages read
    word by word, timelines, concept maps…), plus [third-party packs](docs/en/component-packs.md).
    → [components](docs/en/components.md) · [maps and math](docs/en/maps-and-math.md)
- **Quality you can check.**
  - Headless QA of every beat.
  - A vision judge whose notes drive automatic rewrites (`warqa improve`).
  - Blind **teacher panels** whose scores go on the model leaderboard. → [quality](docs/en/quality.md)
- **Voices.**
  - Engines: Edge (free), Azure, OpenAI, ElevenLabs, Google, Gemini, or local voices through the optional
    Python worker.
  - Word times give exact cues and **read-along** highlighting. → [voices](docs/en/voices.md)
- **Open and portable.**
  - Apache-2.0. Books are folders of JSON you can diff and edit.
  - Exports: static site (installable, offline), zip, **SCORM 1.2** (Moodle…), **Anki**, CSV, **MP4 video**.
    → [exports](docs/en/exports.md)

## Try it as a developer

```bash
git clone https://github.com/Redouane-E/warqa && cd warqa
pnpm install && pnpm build
pnpm warqa preview examples/integers.warqa   # open http://127.0.0.1:8765/
pnpm studio                                  # the studio on http://127.0.0.1:5170/ (books in ./books)
```

Example books:

| Book | What it shows |
|---|---|
| [`examples/integers.warqa`](examples/integers.warqa) | A maths chapter in ar/fr/en with narration: equations, number lines, quick checks, practice |
| [`examples/fox.warqa`](examples/fox.warqa) | A picture book in Arabic, Darija, French and English, read word by word |
| [`examples/morocco.warqa`](examples/morocco.warqa) | Geography: Morocco's regions on maps, with a "click the region" question |
| [`examples/packs/clock`](examples/packs/clock) | A third-party component pack: an analogue clock for telling the time |

## Make your own book

```bash
pnpm warqa init my-book --pdf textbook.pdf --langs ar,fr,en --audience "collège, 1ère année"
cd my-book
cp ../.env.example .env        # add one API key (or use Ollama: --preset local)
warqa ingest                    # read the PDF (text, Arabic repairs, OCR fallback, chapters)
warqa plan                      # draft the book plan → review plan.json
warqa plan --approve
warqa estimate                  # what it will cost with your models
warqa build --chapter ch01      # storyboard → write → translate → narrate
warqa improve --chapter ch01    # optional: a vision model judges each picture; weak beats are rewritten
warqa qa --chapter ch01 --shots # headless checks + screenshots
warqa review --lang ar          # translation review (or --export review.csv for a spreadsheet)
warqa preview                   # watch it
warqa export --zip --scorm --anki ar
```

Other entry points:

- **Studio:** the same in a browser. Upload a PDF, choose models, review the plan, build chapters, edit beats
  with a live preview, review translations, narrate and export.
- **Coding agent:** Warqa is also an MCP server (`claude mcp add warqa -- node apps/mcp/dist/server.js`). An
  agent can run the pipeline, or write lessons itself while Warqa validates and renders them.
  → [agents](docs/en/agents.md)

| preset | what it uses |
| --- | --- |
| `best` | Claude Opus/Sonnet 5.5 to plan and write, Gemini Flash to read page images |
| `anthropic` · `openai` · `google` · `deepseek` · `mistral` · `xai` · `groq` | one provider for everything |
| `budget` | DeepSeek V4 Flash + Gemini Flash-Lite — a few cents per chapter |
| `openrouter` | one OpenRouter key for every role |
| `local` | Ollama (Qwen3 14B writes, Qwen2.5-VL reads pages) — nothing leaves your machine |

## Repository

```
packages/i18n       UI catalogs (ar/ary/fr/en), number parsing, Arabic normalization, bidi helpers
packages/lesson     lesson format (Zod), compiler, validators, grading, components, packs, and the player
packages/pipeline   PDF ingest, model layer, stages, translation memory, maps, math, speech, QA, panels, exports
apps/cli            the `warqa` command
apps/studio         the studio (Hono + React)
apps/web            the studio in the browser, with no server (GitHub Pages)
apps/mcp            MCP server for coding agents
workers/py          optional Python worker: OCR, forced alignment, Arabic diacritics, local voices
launchers           one-click start for Windows, Mac and Linux
e2e · evals         Playwright tests (Chromium, Firefox, WebKit) · model evaluations and the leaderboard
examples            example books and a component pack
```

Development: `pnpm build`, `pnpm test`, `pnpm e2e`, `pnpm lint`.

## Contributing

Contributions are welcome: code, translations of the interface, new components and packs, example books, bug
reports from teachers. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the
[Code of Conduct](CODE_OF_CONDUCT.md), and see [SUPPORT.md](SUPPORT.md) for questions. The
[status page](docs/en/roadmap.md) lists known limits and ideas.

## Credits and licence

Warqa is licensed under the [Apache License 2.0](LICENSE). It builds on ideas and code from
[Papermorph](https://github.com/DozenTwelve/Papermorph) (MIT): beats paired with narration marks, in-picture
questions, first-try scoring and the delivery checks. Math is typeset with MathJax; maps use Natural Earth and
geoBoundaries data. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Fonts are under the SIL Open Font
License. The books you make are yours; respect the rights of the PDFs you use.
