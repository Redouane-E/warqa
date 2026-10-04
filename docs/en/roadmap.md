# Status

## What Warqa does today

- **Lesson format** (`warqa.lesson/1`):
  - 25 components in six packs: core, STEM, humanities, any document, children's books, plus an experimental
    sandboxed `widget`.
  - 7 question kinds, semantic validators with fix-it messages, and a deterministic, seekable compiler.
  - **Third-party component packs:** one plain script, `warqa pack add` ([component-packs.md](component-packs.md)).
- **Math:**
  - The `equation` component morphs token rows; its steps can be written TeX-style.
  - The `math` component typesets anything TeX can write with MathJax 4 at export (fractions, roots, matrices,
    sums, chemistry, aligned derivations), with named parts to point at ([maps-and-math.md](maps-and-math.md)).
- **Maps:**
  - Natural Earth countries at 1:110m and 1:50m (for zoomed-in maps).
  - **Regions of any country** from geoBoundaries (`warqa geo add MAR`), with the data credited on screen.
  - Pick questions on regions; labels that avoid each other.
- **Player:**
  - RTL-aware chalkboard player: keyboard first, captions, transcript, first-try scoring.
  - Language switch mid-lesson; offline (`file://` and an installable PWA).
  - **Read-along:** the word being read is highlighted in picture books and captions.
  - **Rating mode** for teachers. Tested in Chromium, Firefox and WebKit, axe-clean.
- **Pipeline:**
  - PDF ingest, with Arabic repairs and OCR fallback.
  - Plan → storyboard → write (validated and repaired) → translate → narrate (8 engines, word times) → QA → exports
    (site, zip, SCORM 1.2, Anki, CSV, MP4).
- **Translation:**
  - A book-wide **translation memory**, glossary checks, and a **review queue** with spreadsheet round trip.
  - Wording a person approved is never overwritten ([translation.md](translation.md)).
- **Quality** ([quality.md](quality.md)):
  - Headless checks.
  - **Judge in the loop:** `warqa improve` rewrites the beats a vision model scores low and judges again.
  - **Teacher panels:** blind kits, ratings files, and scores on the leaderboard.
- **Languages:** Arabic, French and English everywhere; **Darija** (`ary`) as a full book language with its own
  player interface; any other language for lessons.
- **Any model:** 13 providers including local servers; presets, per-role overrides, a capability catalog,
  tiers, a cache, a cost ledger and a budget.
- **Ways to use it:**
  - the **web app** (nothing to install, keys stay in the browser)
  - one-click launchers
  - the desktop studio
  - the CLI
  - an MCP server for coding agents
  - Docker

## Known limits

- **Web app:** it has no Edge voices, local voices, visual QA, MathJax typesetting, component packs or video.
  These need the desktop studio or the CLI. Math shows as plain text there.
- **Darija voices:** the Microsoft voices read Darija with a Moroccan Arabic voice, not a native Darija one. The
  open Darija model (Habibi-TTS MAR) runs in the Python worker, but its licence is unclear: treat it as
  non-commercial until its authors confirm.
- **Region boundaries:** each downloaded layer has its own licence; check it before publishing (often ODbL,
  credited automatically).
- **Teacher panels:** the scores mean something only when real teachers take part. Warqa provides the kit and
  the scoring, not the panel.

## Ideas for contributors

These are not promises. They are places where help is welcome; see [CONTRIBUTING.md](../../CONTRIBUTING.md).

- More component packs: chemistry lab bench, musical staff, physics simulations, Quran-style recitation
  highlighting, sign-language video.
- More languages for the player interface: Amazigh (Tifinagh), Spanish, Turkish, Urdu.
- Native open Darija and Amazigh voices with clear licences.
- Typesetting math in the web app (MathJax in a worker with on-demand fonts).
- Running component packs safely in the web app (a sandboxed iframe for pack views).
