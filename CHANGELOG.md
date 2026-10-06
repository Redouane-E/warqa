# Changelog

All notable changes to Warqa are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor version may change the
lesson format; such changes are marked **Breaking** with a migration note.

The section of a version becomes the text of its GitHub Release (see [docs/en/release.md](docs/en/release.md)).

## [Unreleased]

### Added

- **Learning on your own** (backend): `warqa learn <pdf> --lang <code> --level beginner|some|advanced` and a
  `learn` job in the studio and the web app. In one go it reads the PDF, plans it at your level (approved
  automatically) and makes chapter 1, narrated when a voice is available; run it again for the next
  chapter. It shows the time and cost first, keeps a $1 spending limit by default (`--limit` changes it),
  reads scanned pages with the vision model only for the chapter being made (a scanned book's first pages
  before its plan), and keeps what is finished when stopped. Books record it in an optional
  `learn: { level }` field of `warqa.json`.
- **`@warqa/brand`**, the design system package: colour, type, space and motion tokens (TypeScript, and CSS
  variables for light and dark), the bundled fonts, the mark and the icons.

### Changed

- **A new look, first step (redesign phase 1, "Cahier", a Moroccan school notebook).** The studio, the web
  app and the launcher page now use royal-blue ink on cool paper, a single red margin line (on the right in
  Arabic), navy in dark mode, and the highlighter yellow on the current step and the selected beat. Screens
  keep their layout for now.
  - New logo: a sheet with its top-left corner folded down, showing a yellow underside. It never mirrors.
    It replaces the ∞ in exported books (the finish card, "Made with Warqa"), the favicons and the app
    icons. The studio and the web app can be installed (manifest and icons).
  - Fonts: Readex Pro is now the variable font with its width axis (wide titles), joined by Playpen Sans
    Arabic (for the teacher's red-pen notes, later) and Geist Mono (numbers, money, times). An exported
    book's fonts grow from 362 KB to 467 KB.
  - One set of icons (a 24 grid, a 1.75 stroke); back and next point the other way in Arabic.
  - Exported books: new icons (including a maskable icon and an Apple touch icon) and the brand's colours
    in the manifest and `theme-color`. The lesson player itself keeps its chalkboard look until the next
    phase.
- **The player and the exported book, redesigned (redesign phase 2).**
  - **Themes:** lessons show on the white Sheet (ruled paper with the red margin line, on the right in
    Arabic) or the navy Board. Learners switch in the player's strip and the choice is remembered;
    `?theme=sheet|board` in the address chooses too. Lessons keep naming their colours (chalk, sky,
    coral…), so every lesson works in both.
  - **Migration:** new books default to `"theme": "sheet"`. Books saved before this version have
    `"theme": "chalk"` in `warqa.json` (the old default) and open on the navy Board, the chalkboard's
    successor; set `"theme": "sheet"` there for the paper look. The example books now use the Sheet.
  - **The page around the stage:** a strip with All lessons, the title, the language, Sheet or Board, the
    transcript and full screen; captions under the stage (never on the picture) that read along with the
    highlighter; a bar with a large play button, a timeline whose question steps are diamonds, the step's
    name, speed (0.75× to 1.5×, remembered) and captions; the transcript opens beside the stage and pushes
    it instead of covering it.
  - **States:** pausing leaves the picture bright (no dark veil); the finish card's mark turns its corner
    once; question cards and feedback ("Not quite." with its hint) use the new colours, with key hints in
    Geist Mono.
  - **Phones:** the stage on top, then the words and the controls; question cards move under the picture at
    full size; the transcript is a bottom sheet.
  - **The book's home:** a cover with Continue (or Start), the contents with each chapter's state (done
    with its first-try score, last opened with progress, not opened yet), language buttons, the theme
    switch and "Install for offline use" where the browser offers it.
  - `warqa qa --theme sheet,board` checks and photographs a lesson in either theme; the video export and
    QA shots use the bare stage (`?bare`), and the studio's preview hides the player's strip.
- **The studio's frame (redesign phase 3).** The studio and the web app share a new way of moving around:
  places stack, tools slide in from the side, work sinks to a tray, and only money and loss interrupt.
  - **Top bar:** the mark (Your books), Go to, the open book's spending, "AI and voices" (a new address,
    `/ai`; `/settings` still works), a language menu and one Sheet/Board button. Strips above the page show
    where you are (Your books, then the book and its step) and replace the breadcrumbs; Alt+↑ goes back up.
  - **Go to** (⌘K on a Mac, Ctrl+K elsewhere, with any keyboard layout): find a book, step, chapter, beat
    or setting, or start Read, Plan, Make (with its estimated cost), Check or Export. Nothing starts until
    you choose it. Esc closes whatever tool is on top.
  - **Unsaved work asks first:** leaving a lesson, a plan or a book's settings with unsaved changes (by a
    link, the strips, Alt+↑ or Go to) asks whether to stay or leave without saving.
  - **The tray:** running work (reading, planning, making, exporting…) shows at the bottom of the window and
    stays with you from screen to screen. Hide folds it into a small pill with the progress and the cost;
    when the work ends a message offers to open it again. It replaces the activity board, so a book's page
    is now the steps and one sheet.
  - **Six steps:** Check is its own step (quality check, improving and rating, which used to sit under
    Export). It is optional. The last step is now called Share; old `?step=export` links still work.
  - **Dialogs and messages:** the browser's confirm boxes are replaced by the studio's own dialogs, which
    focus the safe choice and name the action ("Make it again", "Delete the book"). Results such as
    "Saved" appear as short messages in the corner.
  - **Web app:** the banner and warning bars become one quiet line in the top bar ("Runs in this browser ·
    Your data"), with warnings in its menu; "Your data" opens as a side sheet (a bottom sheet on phones).
  - **Lesson editor:** the preview can fill the whole window (Esc or Close returns to the same step), and
    a link with `?beat=3` opens the third beat.
- **Learning on your own, in the studio and the web app (redesign 4a2).**
  - **First visit:** a welcome page (what Warqa does, drop a PDF, see a finished book), then the start guide,
    which first asks **How will you use Warqa?** Teachers go on as before (AI model, PDF, languages, spending
    limit). The desktop version now has the guide too.
  - **I'm learning for myself:** drop a PDF, pick the language Warqa teaches you in (it says which language the
    PDF is in) and your level (Beginner, I know some, Advanced), connect an AI service if none is, then see the
    time and cost before **Teach me**. Warqa reads, plans and makes chapter 1 in one go, showing the chapters
    it finds and the steps as they are written; **Stop** keeps what is done. Chapter 1 then opens by itself.
  - **The end of a chapter** asks **How was this chapter?** (too easy or too hard moves the level of the next
    chapters), offers **Review what you missed**, and **Make chapter N · about $x**, made only when you ask.
  - **What I'm learning** lists your courses with Continue, the next chapter and its cost, and **Open as a
    teacher** to edit a course like any book.
  - **Your books:** search and sort (last changed, title, spent), a new-book tile, and New book in a side
    sheet.
  - The README and the start-here guides say who Warqa is for (teachers, students, and anyone learning on
    their own), explain learning on your own, and note that lessons made from a PDF are for your own use unless
    you have the right to share them.
- **Read and Plan, redesigned (redesign 4b).**
  - **Read** shows what Warqa found: pages, main languages, chapters and pages repaired, then every page as a
    tile coloured by how it was read (text layer, vision model, OCR worker, no text), filling in while the PDF
    is read. **Read again** takes several page ranges ("3-8, 31-38") and keeps the pages read before; the next
    step, Draft the plan, shows its cost.
  - **Plan** reads like a book's table of contents: units, numbered chapters with their titles, objectives,
    pages, minutes and cost; changed chapters are highlighted and left-out ones struck through. A bar at the
    bottom adds up what making the ticked chapters costs as you tick, next to Save and Approve; approving can
    be undone.
  - The reading progress now counts the pages asked for (a range of pages 31–38 showed "31 of 8").
- **Make, redesigned, and the tray while lessons are made (redesign 4c).**
  - **Make** is its own card: each chapter of the plan with what it should cost beside **Make**, a made
    lesson's beats, problems, languages and what it cost (now kept per chapter in the cost ledger), and
    **Make the 2 left** with their total. Making a lesson again asks first, saying how many beats it writes
    again and what it costs.
  - The tray follows the chapter being made: its stages, the beats as they are written (with their titles)
    and the money spent against the chapter's estimate and the book's limit. The pill says "Making ch. 2 ·
    45 %"; when the chapter is made, a toast offers to open it in the editor. On a phone the tray is a
    bottom sheet that folds to a peek bar.
  - **Stop** takes effect after the beat being written instead of once all the chapter's beats are written,
    and **Make the rest** goes on from the last written beat. A chapter stopped partway says so on the Make
    step, even after a restart.
- **The beat inspector, generated from the lesson format (redesign 4d2).** The parts on a beat's stage each open a
  form built from their component's definition (lists fold to a line per item, translated fields say so, problems
  show on their field), and new parts come from the catalog; renaming a part carries its cues and questions along.
  The cues of each mark open an editor (when, on which part, the action with its own settings, the duration), and
  each question kind has its form. Edit as JSON stays as the escape hatch. Pack components get a form too.
- **The lesson editor, redesigned (redesign 4d1).** The beats hang on the notebook's margin, the current one on
  the highlighter (a diamond for a beat with questions). The stage is the lesson's own player drawing the beat
  being edited, with "Play this beat" and a clock; **Preview** grows that same player to the whole window with
  its bar, and closing goes back to the beat it reached. The narration sits under the stage, and the beat's
  details (title, teaching move, what each mark does, problems, Regenerate, Edit as JSON) open in a side sheet
  beside it. Beats can be added, duplicated and deleted (with Undo); J and K move between them; a save can be
  undone from its toast. The preview language menu also lists the languages not translated yet.
- Cost estimates no longer ask for a translator model when a book has a single language.

### Fixed

- A lesson made again over an existing one (`--force write`, or "Make again" stopped and then finished) now
  gets its translations made again instead of keeping the strings of the old beats, even when it was stopped
  between two languages; a storyboard made again no longer reuses beats written for the old one.
- The spending limit now also covers reading scanned pages with the vision model: a run stops at the limit
  instead of reading past it, and `ingest` no longer skips pages silently once the limit is reached.
- `warqa init` no longer fails on folder names longer than 32 characters or with accents: the book id is
  shortened and the accents dropped.

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
