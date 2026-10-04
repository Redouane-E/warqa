# Changelog

All notable changes to Warqa are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version may change the
lesson format; such changes are marked **Breaking** with a migration note.

The section of a version becomes the text of its GitHub Release (see [docs/en/release.md](docs/en/release.md)).

## [Unreleased]

## [0.1.0] - 2026-10-04

The first public release: turn a PDF into animated, narrated, interactive lessons in Arabic, French and
English, with any AI model.

### Added

- **Lesson format `warqa.lesson/1`**: lessons are JSON validated by Zod. A lesson is a series of beats:
  narration with `[[marks]]` paired with visual changes (cues) on the exact words that explain them, a
  persistent scene, and questions inside the picture. One language-neutral structure plus a string table
  per language.
- **25 components in six packs** (core, STEM, humanities, any document, children's books, and an
  experimental sandboxed `widget`): equations that change step by step (TeX-style steps), display math
  typeset with MathJax 4 (`math`: fractions, roots, matrices, chemistry, aligned derivations, named parts),
  number lines, counters, balance scales, fraction bars, area grids, coordinate planes, bar charts,
  timelines, concept maps, maps (Natural Earth countries at 1:110m and 1:50m, and the regions of any
  country from geoBoundaries with `warqa geo add`), picture-book pages, tables, flows and more. Reference:
  [docs/en/components.md](docs/en/components.md), [maps and math](docs/en/maps-and-math.md).
- **Third-party component packs**: one plain script that runs in Node and in the player; `warqa pack add`
  copies it into the book. Example: an analogue clock (`examples/packs/clock`).
- **Read-along**: word times are stored with the audio; picture books and captions highlight the word being
  read.
- **Darija** (`ary`) as a full book language: writing rules for the models, a Darija player interface,
  Moroccan voices.
- **Translation memory and review**: a book-wide memory reuses and aligns wording across chapters, the
  glossary is checked after translating, and a review queue (CLI, studio, spreadsheet round trip) tracks
  what a person approved — approved wording is never overwritten by a model.
- **Judge in the loop**: `warqa improve` renders every beat, asks a vision model to score it, rewrites the
  weak beats with its notes and judges again.
- **Teacher panels**: a rating mode in the player (★, key R), blind review kits (`warqa panel kit`), and
  scores added to the model leaderboard (`warqa panel results`).
- **7 question kinds** (choice, blanks, numeric, grid, order, pick, text) with exact number answers,
  tolerances and word answers; first-try scoring kept across revisits.
- **Validators with fix-it messages**: marks, cue targets on the live scene, answers, translations,
  pacing (a visual change per sentence, no empty openings, questions between ideas).
- **Player**: a right-to-left aware chalkboard player that mirrors what should mirror and keeps
  mathematical orientation; keyboard first; captions, transcript, help, finish card; language switch in the
  middle of a lesson; reduced motion; works offline from `file://` and as an installable web app; DOM events
  for embedding and LMSs. Tested in Chromium, Firefox and WebKit, with axe accessibility checks.
- **Arabic first**: Arabic PDF repairs (presentation forms, reversed lines) with OCR fallback; math in
  Latin notation inside Arabic text; Arabic-Indic digits and decimal commas accepted in answers; Moroccan
  voices with word timing.
- **Pipeline**: PDF ingest (reading order, chapters from bookmarks or headings) → plan → storyboard →
  write (each beat validated against the scene and repaired by the model) → translate (marks, answer
  boxes and math kept) → narrate → QA (headless checks, contact sheets, optional vision judge).
- **Any model**: 13 providers (Anthropic, OpenAI, Google Gemini, Mistral, DeepSeek, Groq, xAI, OpenRouter,
  Ollama, LM Studio, llama.cpp, vLLM, any OpenAI-compatible endpoint); presets (`best`, `budget`,
  `google`, `deepseek`, `openrouter`, `local`…); a model per role; tiers so small local models can help;
  `warqa models probe`; prices and capabilities from models.dev.
- **Costs under control**: every call cached by content (re-runs are free), a cost ledger, `warqa estimate`,
  and a spending limit per book (`pipeline.budget.usd`, or *Settings → Budget and tools* in the studio).
- **Voices**: Microsoft Edge (free, unofficial), Azure, OpenAI, ElevenLabs, Google, Gemini, local voices
  through the worker, or none; word timings or sentence-level fallback with forced alignment.
- **Exports**: offline static site, zip, SCORM 1.2 (Moodle, Chamilo, Canvas…), Anki and CSV flashcards,
  MP4 video per lesson.
- **Interfaces**: the web app — the whole studio in the browser with no server, keys kept in the browser
  (GitHub Pages); the `warqa` CLI; the desktop studio (upload a PDF, choose models, review the plan, build,
  edit beats with a live preview, translate, narrate, export) with an Arabic, French and English interface;
  an MCP server so coding agents can make and check lessons; a Docker image and `docker compose` setup.
- **Optional Python worker**: OCR (Tesseract, RapidOCR), forced alignment, Arabic diacritics (CATT) and
  local voices over HTTP.
- **Example books**: a chapter on subtracting integers (ar/fr/en), a picture book read word by word
  (ar/ary/fr/en), and a geography lesson on Morocco's regions (ar/fr/en), all narrated.
- **Sample PDFs** to try Warqa without your own (`examples/pdfs/`): an Arabic maths chapter, a French
  science chapter and an Arabic picture book (CC BY 4.0).
- **Chapter detection** keeps a short PDF's one or two named chapters ("Chapitre 3", "الفصل الأول") whole
  instead of cutting at numbered subsections.
- **Set up for AI coding agents**: `AGENTS.md` (root and per folder), task procedures in the open Agent
  Skills format (`.agents/skills/`), and configuration for Claude Code, Codex, Cursor, Copilot and Gemini CLI.
- **Project**: Apache-2.0 licence; contributing guide, code of conduct, issue forms in three languages,
  CI (build, lint, typecheck, unit, end-to-end and worker tests), release and GitHub Pages workflows,
  one-click launchers for Windows, macOS and Linux, and start-here guides for teachers and parents.

[Unreleased]: https://github.com/Redouane-E/warqa/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Redouane-E/warqa/releases/tag/v0.1.0
