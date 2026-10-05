# Warqa redesign ("Cahier"): implementation plan

This file is the hand-off to any coding session (Claude Code or another agent) that implements the new
design. Read it after `AGENTS.md` / `CLAUDE.md`.

**The session changes the code itself and works directly on `master`, with no branches.** Take the next
unticked phase, implement it, check it, commit it to `master`, tick it here, and continue to the next phase
if there is room in the session.

Warqa serves **three audiences**:
- **teachers and parents** who make lessons;
- **pupils** who use those lessons;
- **people learning on their own**, who drop a PDF they want to understand and want to be taught (see
  [Self-learners](#self-learners-phases-4a1-and-4a2)).

## Status

- [x] Phase 0: decisions (recommended defaults adopted on 2026-10-04; see the Decisions log, the user can
  change any of them)
- [x] Phase 1: foundation (tokens, fonts, logo, icons)
- [x] Phase 2: the player and the exported book
- [x] Phase 3: the studio's frame (interaction system)
- [ ] Phase 4: the studio's screens
  - [x] 4a1 the `learn` job and `warqa learn` (backend for self-learners)
  - [ ] 4a2 first visit (I teach / I'm learning for myself), the learner path, What I'm learning, Your
    books, docs
  - [ ] 4b Read, Plan
  - [ ] 4c Make and the tray
  - [ ] 4d lesson editor: [ ] 4d1 layout and Preview · [ ] 4d2 structured inspector · [ ] 4d3 marks and cue
    threads
  - [ ] 4e Translate & narrate
  - [ ] 4f Check, Share
  - [ ] 4g AI and voices, Book settings
  - [ ] 4h states
- [ ] Phase 5: phones, gestures and keys
- [ ] Phase 6: tests, docs and release
- [ ] Vision backlog (each item gets its own design session first)

## How to run a phase in a new session

1. Paste the prompt from [Session prompts](#session-prompts), usually "Build the next phase". Don't stop for
   plan approval: make a short working plan for yourself (a todo list), then implement it.
2. Read the phase's **canvas artboards** (the visual spec) with the Artifact tool:
   `Artifact action=read url=https://claude.ai/artifact/De7DLKWiThxySQTppVhrcW path=project/<File>.dc.html`.
   They hold the exact colours, spacing, copy and markup. Translate them into the app's TypeScript, React
   and CSS; never paste canvas HTML into the app.
   - If the Artifact tool is not available, ask the user to open the canvas and describe or export what
     you need.
3. Read the phase's files listed under **Where**, and follow the decisions in the
   [Decisions log](#decisions-log). Only ask the user when something is truly theirs to decide and not
   covered there; otherwise pick the option closest to the canvas and log it.
4. Implement directly on `master`.
   - Make sure the working tree is clean before starting. The one exception is `REDESIGN.md` itself: if it
     is untracked or modified, include it in your first commit. For any other uncommitted change, ask the
     user what to do with it instead of mixing it in.
   - No branches, no worktrees.
5. Check:
   - `/verify` for the build order, tests, lint and typecheck;
   - `/visual-qa` for screenshots in Arabic and a left-to-right language, at 1280 px and 390 px, in Sheet
     and Board;
   - `/ui-strings` for every new string;
   - `/review-change` before committing.
   Fix what they find. Never commit with failing checks; if something can't be fixed, stop and report it
   with the command output.
6. Commit to `master`.
   - Use one commit per phase, or per sub-phase in Phase 4, with the message
     `Redesign phase <n>: <what changed>`. Run `/verify` right before the commit.
   - In the same commit, tick the phase in [Status](#status) and add a line to the Decisions log for any
     choice you made.
   - Do not push unless the user asks; pushing publishes to GitHub.
7. If the session still has room, continue with the next unticked phase from step 1.
8. End with a short report: what changed, the check results (commands and counts), the commit hash, and
   what is next.

Ground rules (from `AGENTS.md`, repeated because they bite):
- Never run commands that spend model credits. Use `FakeModel` and `?warqa-fake=1`.
- Never read `.env` or keys.
- Don't edit generated files: `docs/en/components.md`, `dist/`, books' `cache/`, `dist/`, `qa/`.
- Every interface string goes in every language: player en/fr/ar/ary, studio en/fr/ar.
- Mirror reading order, never values or geometry.
- Rebuild `@warqa/lesson` and `@warqa/i18n` before testing their dependants.
- The lesson format stays backward compatible. Any visible default change gets a CHANGELOG entry with a
  migration note.

## The source of truth: the design canvas

Canvas: <https://claude.ai/artifact/De7DLKWiThxySQTppVhrcW> (private to the owner). Its pages and artboard
files:

| Canvas page | Artboards (`project/<name>.dc.html`) | Used in |
|---|---|---|
| Vision | Vision, SnapPage, BackToPaper, ClassMode, ClassResults, Bridge, TeacherVoice, Access, Shelf, Carnet, AskLesson | Vision backlog |
| Brand | Main (identity), Kit (UI kit, light and dark) | 1 |
| App map and navigation | AppMap, NavModel | 3 |
| Where things open | Surfaces, SurfaceMap, PlayerSurfaces, SurfaceMatrix | 2, 3 |
| Motion | MotionTokens, MotionStudio, MotionPlayer | 1, 2, 3 |
| Makers | Welcome, Connect, Books, Read, Plan, Make, StudioPhone, Editor, EditorAr, Languages, Check, Share, Models | 4 |
| Learners | PlayerAr, QuestionFr, BookHome, StoryDarija, PhoneAr, PhoneFr, PhoneFinish | 2, 5 |
| Prototypes (clickable) | ProtoStudio, ProtoFirstRun, ProtoPlayer, ProtoPhone | 2, 3, 4 |
| Journeys and states | FlowFirstBook, FlowLearner, FlowFix, States, Keyboard | 3, 4, 5 |
| Self-learners | SelfChoice, SelfSetup, SelfMaking, SelfFinish, SelfHome, SelfPhone, ProtoSelf (clickable), FlowSelf | 4a1, 4a2 |

Some numbers and chapter titles on the canvas are illustrative (costs, the plan's chapters 1–7).

---

## Design system specification

> **Since Phase 1, the code wins over this section.** The values live in `packages/brand/src/tokens.ts`
> (the build writes `dist/tokens.css`), and the Decisions log records every change from the tables below:
> - three colours moved slightly to pass contrast (`text-3` light, the dark input border, Sheet coral text);
> - the easing variables are `--wq-ease-settle/lift/ink`, because `--wq-ink` is the colour.
>
> Use the tokens and icons from `@warqa/brand`; never copy hex values from these tables into new code.

### Idea

A Moroccan school notebook:
- royal-blue ink;
- cool paper;
- Seyès ruling;
- the red margin line: on the **right** in Arabic and Darija, on the left in French and English;
- a yellow **highlighter** on the word being said.

The highlighter is the one signature. Use it only for:
- the spoken word;
- the current step or beat;
- marks in the editor.

Never use it as a background, a button colour or decoration.

### Interface colours

| Token | Light (Sheet) | Dark (Board) | Use |
|---|---|---|---|
| `--wq-ground` | `#F4F6FA` | `#0E1226` | page / desk |
| `--wq-sheet` | `#FFFFFF` | `#171C36` | cards, sheets, stage |
| `--wq-raised` | `#FFFFFF` | `#20264A` | menus, dialogs |
| `--wq-text` | `#13172E` | `#EEF0FA` | text |
| `--wq-text-2` | `#4A5170` | `#B4BAD8` | secondary text |
| `--wq-text-3` | `#687091` | `#8A91B4` | captions, words still to come |
| `--wq-ink` | `#2A3CD1` | `#8C9BFF` | primary buttons, links, brand |
| `--wq-ink-hover` | `#1E2C9E` | `#B9C2FF` | |
| `--wq-on-ink` | `#FFFFFF` | `#0E1226` | text on ink buttons |
| `--wq-ink-tint` | `#EEF0FD` | `#232A55` | selected rows and chips |
| `--wq-line` | `#DCE2F2` | `#2C3360` | card borders |
| `--wq-seyes` | `#D6DEF3` | `#1E2444` | ruling, hairlines |
| `--wq-control-border` | `#B9C6EA` | `#3A4278` | secondary buttons |
| `--wq-input-border` | `#7F8AB0` | `#5A6396` | inputs (3:1 against the sheet) |
| `--wq-margin` | `#E0454F` | `#FF7A82` | the margin rule |
| `--wq-pen` | `#C22A35` | `#FF7A82` | errors, red-pen notes |
| `--wq-pen-tint` | `#FDECEE` | `#3A1E2C` | error notices |
| `--wq-fluo` | `#FFE14A` | `#FFE14A` | highlighter; text on it is always `#13172E` |
| `--wq-fluo-tint` | `#FFF4B8` | `#4A4320` | running status, unselected marks |
| `--wq-fluo-text` | `#5C4A00` | `#FFE14A` | text in "running" pills |
| `--wq-good` | `#0F7A55` | `#5FD3A0` | right answers, always with an icon and a word |
| `--wq-good-tint` | `#E7F5EF` | `#173A30` | |

The dark tints are starting values; check contrast when implementing.
Text needs 4.5:1, or 3:1 at 24 px and above; UI borders need 3:1.

### Stage colours (the names lessons use)

Lessons refer to colours by **name** (`packages/lesson/src/schema/common.ts`: chalk, dim, faint, task, good,
bad, coral, sky, gold, rose, mint, lilac; plus `board` for the stage). The player resolves names through
`COLORS` in `packages/lesson/src/player/theme.ts`.

Keep the names and give each theme its own table, so every existing lesson works. Some names are used both
as text and as fills, so each entry has a text variant and a fill variant.

| Name | Sheet text | Sheet fill | Board (text and fill) | Today, chalk |
|---|---|---|---|---|
| chalk (main) | `#13172E` | `#13172E` | `#EEF0FA` | `#ece8dc` |
| dim | `#4A5170` | `#4A5170` | `#B4BAD8` | `#9aaba3` |
| faint | `#8A93B5` (lines only) | `#D6DEF3` | `#5A6396` | `#5d7068` |
| task (accent) | `#7A5A00` | `#FFE14A` | `#FFE14A` | `#f0b45a` |
| good | `#0F7A55` | `#0F7A55` | `#5FD3A0` | `#8fd6b0` |
| bad | `#C22A35` | `#C22A35` | `#FF7A82` | `#f08c7a` |
| board (stage) | — | `#FFFFFF` | `#171C36` | `#1d2b27` |
| sky | `#2A3CD1` | `#2A3CD1` | `#8C9BFF` | `#86c9e8` |
| coral | `#D2492F` | `#D2492F` | `#FF9B7A` | `#f4a48c` |
| gold | `#7A5A00` | `#FFE14A` | `#FFE14A` | `#f3c95c` |
| rose | `#B4357A` | `#B4357A` | `#F2A0CF` | `#e8a0c8` |
| mint | `#0F7A55` | `#0F7A55` | `#5FD3A0` | `#8fd6b0` |
| lilac | `#7B4FD0` | `#7B4FD0` | `#C2B0FF` | `#bba8ee` |

Prefer the sky/coral (blue/orange) pair for "two things compared"; the canvas uses +7 in sky and −3 in coral.

### Type

- **Readex Pro**, variable, with the `HEXP` width axis (0–100) and weight 160–700, for everything in both
  scripts.
  - Display: `font-variation-settings: 'HEXP' 100; font-weight: 650`, letter-spacing −0.01em for Latin only.
  - Body: HEXP 0, weight 400.
  - Scale: 12 · 14 · 16 · 20 · 24 · 32 · 44 · 64 px.
  - Line height: 1.5 for Latin, 1.7 for Arabic (titles 1.45). No letter-spacing for Arabic.
- **Playpen Sans Arabic**, a handwriting face, only for the teacher's red-pen notes (judge scores, QA
  findings, teacher comments).
- **Geist Mono** for money, times, page ranges, step and beat numbers, key caps.
- **STIX Two Text** for mathematics (unchanged), always left to right.
- **Noto Naskh Arabic** stays as the fallback.

### Shape, space, focus

- Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Radii:
  - sheets and cards 6;
  - controls 10;
  - pills 999;
  - highlighter shape `border-radius: 0.3em 0.15em 0.35em 0.2em; padding: 0 0.2em`.
- One shadow (a lifted sheet): `0 1px 0 rgba(19,23,46,.04), 0 14px 32px -24px rgba(19,23,46,.35)`.
  Dialogs use `0 24px 60px -28px rgba(19,23,46,.55)`.
- Focus: `outline: 2px solid var(--wq-ink); outline-offset: 2px`.
- Targets 44 px minimum; play buttons 52–64 px.
- Icons: a 24 grid with a 1.75 stroke, round caps and joins, `currentColor`. The set and its paths are in
  the Kit artboard:
  - play, pause, back, next, restart, captions, transcript, speed, language, fullscreen, voice;
  - add PDF, download, key, regenerate, edit, locked, cue thread, book, settings, search, stop, open,
    board theme.
- Back and next icons swap in RTL; play never does.

### Logo

- An ink-blue portrait sheet whose **top-left** corner is folded down, showing a highlighter-yellow
  underside: the corner an Arabic reader lifts to turn the page.
- It never mirrors.
- SVG (viewBox `0 0 56 64`):
  - sheet `M20 4h28a4 4 0 0 1 4 4v48a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V20z` (`#2A3CD1`);
  - fold `M20 4L4 20h16z` (`#FFE14A`).
- Colour variants:
  - paper on ink: sheet `#FFFFFF`;
  - on Board: sheet `#EEF0FA`;
  - single colour: sheet `#13172E`, fold white with a `#13172E` stroke.
- App icon: an ink rounded square with a white sheet and a yellow fold.
- The mark replaces the ∞ sign everywhere: the finish mascot, "Made with Warqa", PWA icons.
- Wordmark: ورقة / Warqa in Readex Pro HEXP 100.

### Voice

- Plain verbs and sentence case.
- Say the cost before anything spends money: "Make chapter 6 · about $0.04".
- Errors say what happened and what to do: "Google refused this key. Copy it again from AI Studio, all of
  it."
- Learners hear "Not quite. Look where the arrow stops on the line.", never "Wrong!".

### Interaction system: "Sheets on a desk"

Rule of thumb: **Places stack. Tools slide in from the end. Work sinks to the tray. Only money and loss
interrupt.**

| Surface | Use it for | Desktop | Phone | Closes by |
|---|---|---|---|---|
| Place | Your books (level 1), a Book (level 2), a Lesson (level 3); AI and voices (level 1) | full sheet | full screen, pushed from the inline-end | stack strip, browser Back |
| Stack strips | going back up | parents peek above as 40 px strips (title + mono meta); max depth 3 | top-bar back arrow with the parent's title; swipe from the inline-start edge | — |
| Side sheet | inspecting or editing ONE thing (beat inspector, translation row, judge note, new book, help, player transcript) | inline-end, 440 px (360 min, 40% max); pushes the place at ≥1280 px, overlays with a paper veil below | bottom sheet, half and full snaps | ×, veil, Esc, same control; one at a time |
| Tray | work that runs (read, plan, make, translate, narrate, check, export) | bottom of the window, follows you: hidden → open (≤45% height, opens once per job) → pill (bottom inline-end, "Making ch. 6 · 43% · $0.02") → done (check + toast with "Open") | bottom sheet with a 56 px peek bar | Hide; Stop keeps finished work |
| Menu | choosing (language, speed, sort, voice, model) | anchored, 8 px offset, toward free space | bottom-sheet list, 56 px rows | choice, Esc, outside click |
| Dialog | only: spending beyond the estimate or reaching the limit; replacing a teacher's work; deleting | centred 480 px, paper veil; safe action has default focus; primary names the result | anchored to the bottom | buttons, Esc = safe action |
| Disclosure | more detail in place (log, objectives, other providers, cue details) | expands downward, pushes | same | toggle |
| Toast | results and Undo | bottom inline-start, one at a time, 5 s, pauses on hover | above the tray peek | timeout, × |
| Preview | the learner's view inside the studio | the stage thumbnail **lifts** to a full-window player with a strip "Preview · Chapter 5 · العربية · Close"; closing returns to the beat reached | same, full screen | Close, Esc |
| New tab | only the exported book and outside links (external icon) | — | — | — |
| Go to | jump anywhere; run actions | Ctrl/⌘ K or the top-bar button; centred 640 px, 20% from the top; books, chapters, beats, strings, settings, actions (spending ones show their cost) | full screen | Esc, choice |
| In the picture | player questions | side card at the inline-end, band at the bottom, or screen card (finish/practice); never modal | band | Continue |

Player specifics:
- **Captions** sit below the stage, never over the picture: words already said in text colour, the spoken
  word on the highlighter, words to come in `--wq-text-3`.
- **Transcript** is a side sheet that pushes the stage; the stage scales down and is never covered.
- **Paused** has no dark veil: a big yellow play button in the stage centre and "Paused · Space or tap to
  continue".
- **Finish** is a screen card rising over the stage; the fold mascot flips once.
- **Phones** use one "Listening" bottom sheet: language, speed, read-along captions, Sheet/Board.

### Motion tokens

| Token | ms | For |
|---|---|---|
| `--wq-t-tap` | 100 | press, hover |
| `--wq-t-menu` | 160 | menus, toasts, cross-fades, language switch |
| `--wq-t-sheet` | 240 | side sheets, dialogs, disclosures, question cards |
| `--wq-t-place` | 320 | Stack (places) |
| `--wq-t-tray` | 400 | tray, Lift |
| `--wq-t-scene` | 600 | player scene moves (unchanged from today) |

Easing:
- `--wq-settle: cubic-bezier(.2,.8,.2,1)` for arriving;
- `--wq-lift: cubic-bezier(.4,0,1,1)` for leaving, at 70% of the arrival time;
- `--wq-ink: cubic-bezier(.6,0,.2,1)` for the highlighter;
- linear only for progress.

Distance: menus and toasts 8 px; side sheets their own width; places 32 px + fade (a full-screen slide only
for the phone push).

Rules:
- One thing moves at a time.
- The container settles before its content, with a 40 ms stagger for at most 6 items.
- The highlighter sweeps in the reading direction.
- Nothing bounces except the finish fold.
- Reduced motion: 120 ms opacity only, the highlighter appears without sweeping, player scenes cut.
- Never animated:
  - maps, number lines and equations during page transitions;
  - letter-by-letter text;
  - Arabic split into letters.

Named transitions:

| Name | What it does |
|---|---|
| Stack | a new place lays on top; the parent becomes a strip |
| Hand-off | the rail's highlighter leaves the finished step and sweeps into the next |
| Lift | the Preview stage expands to full window |
| Writing | while a model writes, ruled lines draw in ink in the reading direction |
| Fold | completion: the logo's fold flips up and back |

---

## Codebase map (what the redesign touches)

**Player and exported book** (`packages/lesson`):
- `src/player/player.ts`: main class; bar, captions, finish card with the ∞ mascot at about line 826.
- `src/player/scene.ts`: 1600×900 stage, slots.
- `src/player/quiz.ts`: question cards.
- `src/player/book.ts`: cover and contents, with "∞ Made with Warqa" at about line 96.
- `src/player/theme.ts`: `COLORS`, `color()`, `mix()`.
- `src/player/styles.css`: about 1,500 lines. `wq-playing` and `wq-with-transcript` have no styles today.
- `src/player/panel.ts`: teacher rating.
- `src/player/views/*`: components. `views/map.ts` and `views/widget.ts` contain hard-coded hex.
- `build.mjs` bundles the fonts with @fontsource (Readex Pro static 400–700, STIX Two, Noto Naskh).
- `src/schema/lesson.ts` has `Book.theme: z.string().default('chalk')`.
- `src/schema/common.ts` has the colour names.

**Player strings:** `packages/i18n/src/catalog/{en,fr,ar,ary}.ts`, 113 keys. A test enforces that every
language has every key.

**Exports** (`packages/pipeline/src/export/`):
- `site.ts`.
- `pwa.ts`: draws icon-192/512 with a canvas, and sets the manifest and the `theme-color` `#1d2b27`.

**Studio** (`apps/studio/src/client/`):
- `App.tsx`: top bar and routes.
- `router.tsx`: a custom history router.
- `styles.css`: about 2,600 lines; tokens `--paper/--sheet/--ink/--amber…`; dark tokens defined twice; 19
  `!important`.
- `components/ui.tsx`: Icon, Sheet logo, Button, Field, Notice, Toast.
- `components/JobBoard.tsx`: the Activity board over SSE `/api/jobs/:id/events`.
- `components/KeysForm.tsx`.
- `pages/Home.tsx`, `Project.tsx` (steps Read/Plan/Make/Voice/Export), `Lesson.tsx` (beat editor with JSON
  textareas), `Translations.tsx`, `Review.tsx`, `Settings.tsx`, `Keys.tsx`.
- `messages.ts`: about 437 keys in en/fr/ar.
- `index.html`: data-URI favicon.
- The server's `/favicon.ico` is in `apps/studio/src/server/app.ts`, at about line 1078.

**Web app** (`apps/web/src/`):
- `ui/WebApp.tsx`: boot and tab lock.
- `ui/Onboarding.tsx`: the 5-step start guide.
- `ui/Chrome.tsx`: banner, Your data, home and project actions.
- `ui/messages.ts`.
- `ui/web.css`.
- `worker/runners.ts`: `desktopOnlyJobs = ['qa','improve','panel']`.
- `main.tsx`, and `index.html` with `theme-color`.

**Native confirm and alert dialogs to replace** (6 confirm, 2 alert):
- `KeysForm.tsx:56`;
- `Review.tsx:215`;
- `Project.tsx:373` and `:478`;
- web `Chrome.tsx:37` and `:209`;
- alerts in web `main.tsx:35` and `bridge/client.ts:245`.

**Launcher page:** `launchers/help.html` (teal, system fonts).

**Tests coupled to class names and labels:**
- Files: `e2e/tests/{player,features}.spec.ts` and `apps/web/e2e/*.spec.ts` (create, demo, onboarding,
  persist, providers, review, no-service-worker).
- Classes:
  - `.book-card`, `.new-book`, `.step-panel`, `.stepper`, `.preview`, `.plan-chapter`;
  - `.review-row`, `.review-state`, `.review-source-text`;
  - `.methods`, `.langs`, `.layer-list`;
  - `.web-banner`, `.web-warning-soft`, `.welcome-card`, `.board .board-head .pill`.
- Accessible names:
  - "Open the example book", "Next"/"التالي", "Export the book", "Download .zip";
  - "Welcome to Warqa", "Checked by a person";
  - the Title textbox and the Arabic checkbox.
- Prefer roles and accessible names in updated tests; keep these names where the design allows.

---

## Phase 0: decisions (done: the defaults in bold are adopted)

These choices were made with the recommended default (in **bold**) so sessions can build without
stopping. They are recorded in the [Decisions log](#decisions-log). The user can change any of them by
editing the log; a session that sees a change follows it.

1. **Canvas comments:** if the user has left comments on a canvas page, read them (ArtifactComments, action
   `read`) at the start of the phase that uses that page, and follow them.
2. **Release:** **phase by phase on `master`, behind no flag** (each phase is committed when its checks pass).
3. **Default theme for books:**
   - **New and existing books default to Sheet; `chalk` stays valid and maps to Board.**
   - Learners can switch, and the choice is remembered on the device.
   - This changes the look of existing books: CHANGELOG note.
4. **Board colour:** **navy as on the canvas**, or keep today's green.
5. **Where tokens live:** **a new workspace package `@warqa/brand`** holding:
   - `tokens.css` (CSS variables, light and dark);
   - `tokens.ts` (the same values for TypeScript: `theme.ts`, `pwa.ts`);
   - `fonts/` and `fonts.css` (so the studio no longer depends on `player.css` for fonts);
   - `logo.ts`;
   - `icons.ts`.

   The alternative is a folder inside `packages/lesson`.
6. **Font weight budget per exported book:**
   - **Readex Pro variable with HEXP: Arabic + Latin subsets.**
   - **Playpen Sans Arabic: Arabic + Latin subsets, one weight.**
   - **Geist Mono: Latin subset, one weight.**
   - Measure the bundle before and after, and set a ceiling, for example +150 KB.
   - If `@fontsource-variable/readex-pro` lacks the HEXP axis, vendor the OFL font from Google Fonts with its
     licence.
7. **Six steps:** Read · Plan · Make · Translate & narrate · **Check** (new: QA, the judge, the teacher kit
   move out of Export) · Share. Keep `?step=export` working as an alias of `share`.
8. **AI and voices:**
   - **Keys and global default models and voices on one page (`/ai`).**
   - **Book settings keep per-book overrides** (model set, budget, voices per language).
   - Today the model set is per book in `warqa.json`; keep that, show it on the global page as "default
     for new books".
9. **Interface languages:** the studio stays en/fr/ar; Darija stays a book and player language.

## Phase 1: foundation (size M)

**Canvas:** Main, Kit, MotionTokens.

**Goal:** one brand everywhere, with no layout changes yet. After this phase, today's screens wear the
Cahier colours, fonts, logo and icons.

**Where:** new `packages/brand` (per decision 5); `packages/lesson/build.mjs`; `packages/lesson/src/player/
{theme.ts,styles.css,player.ts,book.ts}`; `apps/studio/src/client/{styles.css,components/ui.tsx,index.html}`;
`apps/studio/src/server/app.ts`; `apps/web/{index.html,src/ui/web.css,src/main.tsx}`;
`packages/pipeline/src/export/pwa.ts`; `launchers/help.html`.

Tasks:
1. **Tokens.**
   - Create the tokens (tables above) as CSS variables for light and dark, defined once using
     `@media (prefers-color-scheme: dark)` plus `[data-theme]` without duplicated blocks; for example, a
     `:root` light block and a single dark block reused through a shared selector list.
   - Add the motion tokens.
2. **Fonts.**
   - Switch Readex Pro to the variable font with HEXP; add Playpen Sans Arabic and Geist Mono; keep STIX
     Two Text and Noto Naskh.
   - The studio and web app load fonts from the brand package, not from `/player/player.css`.
   - Measure bundle size before and after (exported book `_warqa/` folder).
3. **Studio interim reskin.**
   - Re-point the existing studio variables to the new tokens: `--paper`→ground, `--sheet`→sheet,
     `--ink`→text, `--amber`→ink, and so on. Fix the hard-coded hex values (primary button, board).
   - Replace the amber double margin with the single red margin line.
   - Do not restructure layouts yet.
4. **Logo.**
   - Replace the `Sheet` logo in `ui.tsx` with the new mark; it no longer mirrors in RTL.
   - Add a Latin wordmark next to ورقة.
   - New favicon (studio, web, server route).
   - Web manifest and icons for the studio and web app.
   - `theme-color` set to `#F4F6FA`, or `#0E1226` in dark.
5. **Icons.** Replace the 20 icons in `ui.tsx` with the Kit set; add the missing ones.
6. **Exported books.**
   - `pwa.ts` draws the new app icon and sets the manifest colours.
   - Replace the ∞ in `player.ts` and `book.ts` with the mark (the finish animation comes in Phase 2).
7. **Launcher page.** `launchers/help.html` gets the same tokens (inlined) and fonts with system fallbacks.

**Done when:**
- `pnpm build && pnpm test && pnpm lint && pnpm typecheck` pass.
- `pnpm e2e` and `pnpm --filter @warqa/web e2e` pass.
- Screenshots of the studio, the web app and an exported book in Arabic and English, light and dark, show
  the new brand, with no layout regressions at 390 px.

## Phase 2: the player and the exported book (size L)

**Canvas:** PlayerAr, QuestionFr, StoryDarija, BookHome, PhoneAr, PhoneFr, PhoneFinish, PlayerSurfaces,
MotionPlayer, ProtoPlayer, ProtoPhone, plus the learner parts of States and Keyboard.

**Where:** `packages/lesson/src/player/*` (player, scene, quiz, book, theme, styles, views/map, views/widget),
`packages/lesson/src/schema/lesson.ts`, `packages/i18n/src/catalog/*`, `packages/pipeline/src/export/site.ts`.

Tasks:
1. **Themes.**
   - `theme.ts` gets per-theme palettes (`sheet`, `board`) with text and fill variants per colour name;
     `color()` and `mix()` read the active theme.
   - Remove the hard-coded hex in `views/map.ts` and `views/widget.ts`.
   - `Book.theme` accepts `sheet` | `board` | `chalk` (an alias of board); the default follows decision 3.
   - A `?theme=` URL parameter and a remembered learner choice (`warqa:theme`).
2. **Stage.**
   - Replace the chalk grain and vignette with the Sheet stage: white, faint ruling, the margin line on the
     inline-start side, mirrored in RTL.
   - Board gets its navy equivalent.
   - The stage content never mirrors (existing rules).
3. **Chrome.**
   - New header strip: All lessons, title, language menu, Sheet/Board toggle, transcript, fullscreen.
   - New bar: 52 px ink play button, back/next, the timeline with question diamonds (current segment
     partly yellow with an ink outline), step label, speed, captions.
4. **Captions below the stage.** Re-layout stage + caption + bar so the stage scales to the space left;
   read-along colours as specified.
5. **Transcript pushes.** Style `wq-with-transcript` as a 360–420 px side sheet that narrows the stage;
   bottom sheet on phones.
6. **Speed (new).**
   - 0.75× · 1× · 1.25× · 1.5×, using the audio element's `playbackRate`.
   - The clock already follows the audio; scale the wall-clock fallback too.
   - Remember the choice.
7. **Paused, finish, help.**
   - The paused state without a veil.
   - The finish card with the fold mascot (`Fold` motion).
   - The help dialog restyled.
8. **Questions.**
   - Restyle the side, band and screen cards and the feedback ("Not quite." with a hint; no shake).
   - Key badges in Geist Mono.
9. **Book home** (`book.ts`).
   - Cover and contents per BookHome: continue button, progress, first-try score, language menu, "Install
     for offline use".
   - Chapter thumbnails are optional: render them at export when Playwright is available (desktop), skip
     them in the web app.
10. **Strings.**
    - New keys in en/fr/ar/ary: speed, theme names, paused text, install, and so on.
    - Remove or use the four unused keys (`lesson.loading`, `lesson.error`, `book.back`, `quiz.option`).

**Done when:**
- `pnpm e2e` passes in Chromium, Firefox and WebKit.
- `pnpm warqa qa examples/<book> --shots` for integers, fox and morocco, in ar and fr, in Sheet and
  Board, show no overlaps or cut text.
- With reduced motion, the animations are off.
- The phone layout at 390 px matches PhoneAr/PhoneFr.
- A CHANGELOG entry covers the theme default.

## Phase 3: the studio's frame (size L)

**Canvas:** AppMap, NavModel, Surfaces, SurfaceMap, SurfaceMatrix, MotionStudio, ProtoStudio, Keyboard,
States.

**Where:** `apps/studio/src/client/{App.tsx,router.tsx,styles.css,components/*,pages/Project.tsx}`,
`messages.ts`; `apps/web/src/ui/{Chrome.tsx,WebApp.tsx,web.css,messages.ts}`.

Tasks:
1. **Shared components** in `components/`:
   - `TopBar`: logo → Your books, Go to, spend chip, AI and voices, interface-language menu, theme.
   - `StackStrips`: derived from the route.
   - `SideSheet`: push or overlay, bottom sheet on phones, focus trap, Esc.
   - `Tray`: refactor `JobBoard`, keeping its SSE logic. Job state moves into a top-level context so the
     tray follows navigation; states hidden/open/pill/done.
   - `Dialog`: replaces the 6 `confirm()` calls; the 2 `alert()`s become toasts or notices.
   - `ToastHost`: one at a time, Undo.
   - `Menu`.
   - `GoTo`: a command bar indexing books, chapters, beats, settings and actions; actions call the existing
     job API and show the estimate's cost.
2. **Navigation.**
   - Keep the existing routes (tests and bookmarks); add `/ai`.
   - Strips replace breadcrumbs.
   - The browser Back button and Esc behave as specified: Esc closes the top tool, never leaves a place.
3. **The six-step rail.** Add the `check` step: move QA, `ImproveBox` and `PanelBox` out of the Export step;
   keep `?step=export` as an alias of `share`.
4. **Project layout.** Change the 3-column grid (`228px | 1fr | 300–360px`) to the rail plus one sheet, with
   the tray at the bottom.
5. **Web app chrome.**
   - One quiet line "Runs in this browser · Your data" replaces the banner and up to 5 warning bars; the
     warnings move into a status menu.
   - "Your data" becomes a side sheet.
6. **Motion.** Implement Stack, Hand-off, the side sheet, the tray, dialogs, toasts and Lift with the tokens.
7. **Strings.** New messages in en/fr/ar.

**Done when:**
- No `window.confirm` or `alert` is left.
- Ctrl/⌘ K opens Go to; Esc closes the top tool.
- The tray follows navigation.
- Studio and web e2e pass with updated selectors.
- Screenshots in ar and en at 1280 and 390 px.

## Phase 4: the studio's screens (one session each)

Each sub-phase uses the canvas board of the same name and ends with `/verify`, `/visual-qa` and e2e.

| Sub-phase | Screens | Canvas | Notes |
|---|---|---|---|
| 4a1 (M) | The `learn` job and `warqa learn` (backend, no UI) | FlowSelf | See [Self-learners](#self-learners-phases-4a1-and-4a2). It does not depend on Phases 1–3, so it can be built earlier if wanted. |
| 4a2 (L) | First visit with "I teach / I'm learning for myself", the learner path, What I'm learning, Your books, the learner finish card in the player, docs | Welcome, Connect, ProtoFirstRun, Books, SelfChoice, SelfSetup, SelfMaking, SelfFinish, SelfHome, SelfPhone, ProtoSelf | The start guide moves into the studio client so the desktop version gets it too (today only `apps/web/src/ui/Onboarding.tsx`); host-specific steps by capability. New book = side sheet. Search and sort on Your books. Learner path and docs as in [Self-learners](#self-learners-phases-4a1-and-4a2). |
| 4b (M) | Read, Plan | Read, Plan | The page strip coloured by reading method; plan as a sommaire; glossary; sticky approve bar with the estimate. |
| 4c (M) | Make + tray content | Make, StudioPhone | Beats appearing as they are written: check whether the build job's SSE stage events carry per-beat progress; if not, add events in the pipeline runner (no model calls in tests: `FakeModel`). |
| 4d (XL) | Lesson editor | Editor, EditorAr, SurfaceMap, FlowFix | Split into three sessions: (1) layout, beats on the margin, the stage with Preview **Lift**; (2) a structured inspector generated from component definitions (Zod props and `text` paths), cue and question editors, with an "Edit as JSON" escape hatch; (3) narration with mark chips and **cue threads** to stage parts, "Regenerate this beat" in the tray, before/after compare. |
| 4e (L) | Translate & narrate | Languages | Merge `Translations.tsx` + `Review.tsx` + the voice step into one workspace: language cards, review queue with locked mark and math tokens, glossary hints, CSV round-trip kept. |
| 4f (M) | Check, Share | Check, Share | Contact sheet with judge scores in red pen, Improve weak beats (dialog: it spends), teacher review kit; exports with "Desktop version only" where true. |
| 4g (M) | AI and voices, Book settings | Models | Keys, model set, roles with prices, voices with samples; book settings keep only book things. |
| 4h (S) | States | States | Every empty, error, offline, 429 countdown, budget, desktop-only and tab-conflict state from the canvas. |

### Self-learners (phases 4a1 and 4a2)

**Who:** a teen or adult learning on their own. They drop a PDF they want to understand and want to be
taught; they don't want to review a plan.

**Canvas:** SelfChoice, SelfSetup, SelfMaking, SelfFinish, SelfHome, SelfPhone, ProtoSelf (click through the
whole path), FlowSelf.

**The path:**
1. **The start guide's first question:** "How will you use Warqa?"
   - "I teach": today's path, with plan review, approval, and every lesson editable.
   - "I'm learning for myself".
2. **Drop a PDF,** with the copyright line under the drop zone.
3. **Pick your language:** the four book languages. Say which language the PDF is in ("Your PDF is in
   French. I can teach you in another language.").
4. **Pick your level:** Beginner ("I'm new to this. Explain every word.") · I know some ("I know the basics.
   Go a bit faster.") · Advanced ("I know it well. Go deeper, skip the basics."). The Arabic and French
   wording is on the canvas.
5. **Connect an AI service,** only if none is connected: the same key check as the teacher path, in a
   compact form.
6. **Summary and consent.** It shows time and cost ("About 3 minutes · about $0.03 · your limit $1.00"),
   then "Teach me". This summary is the consent to spend; no plan approval follows.
7. **One go:** read → plan (approved automatically) → build chapter 1 (narrate too when a voice is
   available) → open chapter 1 in the player with the Lift transition.
   - The one-go screen shows the stages, the plan appearing, beats being written, time left and spend.
   - Stop keeps what is done.
   - In the web app it says "Keep this tab open while Warqa works."
8. **After each chapter,** the learner finish card offers:
   - "How was this chapter? Too easy · About right · Too hard", which moves the level one step for the
     next chapters;
   - "Review what you missed" (My notebook, first item in the vision backlog);
   - "Make chapter N · about $x", which makes the next chapter on demand.
9. **The learner's home:** "What I'm learning" lists courses with progress, Continue and "Make the next
   chapter". A quiet "Open as a teacher" link shows the six-step rail for anyone who wants to edit.

**Wording:**
- Learner copy never says "pupils" or "audience"; it speaks to "you".
- New studio strings go in en/fr/ar; new player strings (the learner finish card) in en/fr/ar/ary.

**Levels become the plan's audience.** The plan stage already takes an `audience` override
(`packages/pipeline/src/stages/plan.ts`), and `stages/storyboard.ts` reuses `plan.audience`:

| Level | Audience text |
|---|---|
| `beginner` | "a person learning on their own who is new to this subject: explain every term, go slowly, use many everyday examples" |
| `some` | "a person learning on their own who knows the basics: short reminders, a steady pace, practice on each idea" |
| `advanced` | "a person learning on their own who knows the subject well: skip the basics, go deeper, harder practice" |

The plan's audience is fixed when the plan is made. To let "Too easy / Too hard" change later chapters,
pass the current level's audience to the storyboard and write stages per chapter: add an override next to
`plan.audience`.

The book records that it is a learner's book in an optional field in `warqa.json` (for example
`learn: { level }`). An optional field keeps the format backward compatible. Settle the exact shape in 4a1
and log it.

**Backend (4a1):**
- **A `learn` job type** in `RUNNERS`, in `apps/studio/src/server/jobs.ts`.
  - The web app reuses it through `apps/web/src/worker/runners.ts`; keep it out of `desktopOnlyJobs`.
  - Steps: ingest → plan with the level's audience, approved automatically → build chapter 1 (and narrate
    when a voice is configured and available) → return the chapter to open.
  - It is one job with one progress stream, reporting the stages the one-go screen shows. Stop keeps
    finished work, and running it again is free thanks to the cache.
- **Spending:**
  - Estimate before starting (reuse the estimate stage) and respect the spending limit (default $1).
  - The estimate is what the learner sees on the summary.
- **Large PDFs:**
  - Read the text layer of the whole PDF, which is cheap.
  - Use the vision model for chapter 1's pages first, and read the other pages when their chapter is made.
  - Check how `ingest` handles page ranges (`args.pages`) before designing this.
- **CLI:** `warqa learn <pdf> --lang <code> --level beginner|some|advanced [--out <dir>] [--yes]` in
  `apps/cli/src/warqa.ts`.
  - It creates the book (like `init`), prints the estimate and asks for confirmation unless `--yes`, then
    runs the same steps.
  - It finishes by printing how to open the result (`warqa preview`).
  - It shares the runner code with the studio.
- **Tests:**
  - pipeline/studio unit tests for the job with the scripted `FakeModel`;
  - in 4a2, a web e2e of the learner path with `?warqa-fake=1`.
  - Never real model calls.

**Docs (4a2):**
- README and `docs/{en,fr,ar}/start-here.md`:
  - say "for teachers, students, and anyone learning on their own" (fr: « pour les enseignants, les élèves
    et toute personne qui apprend seule » · ar: «للمعلّمين والتلاميذ ولكل من يتعلّم بنفسه»);
  - add a short "Learning on your own" section.
- A copyright note in README, the start-here guides and the UI where a PDF is chosen: "Lessons made from a
  PDF are for your own use unless you have the right to share them."
  - fr: « Les leçons faites à partir d'un PDF sont pour votre usage personnel, sauf si vous avez le droit de
    les partager. »
  - ar: «الدروس المصنوعة من ملف PDF لاستعمالك الشخصي، إلا إذا كان لك الحق في مشاركتها.»

## Phase 5: phones, gestures and keys (size M)

**Canvas:** PhoneAr, PhoneFr, ProtoPhone, StudioPhone, Keyboard, PlayerSurfaces.

Tasks:
- **Player on phones:** the "Listening" bottom sheet, the transcript bottom sheet with snaps, band
  questions, and gestures:
  - tap the stage to pause or play;
  - swipe toward the reading direction for the next step;
  - long-press a caption word to hear it again.
- **Studio on phones:** places push full screen, side sheets become bottom sheets, the tray is a peek bar.
- **Keys:**
  - studio: Ctrl/⌘ K, Ctrl/⌘ S, J/K, Enter, Esc, ?, Alt+1…6;
  - player: keep today's keys and add speed if wanted.
- **Focus order and screen-reader labels** on every new surface.

**Done when:** e2e passes, and phone screenshots at 390 px in ar and fr show no sideways scroll.

## Phase 6: tests, docs and release (size S–M)

- Finish updating selectors; add e2e for:
  - the tray following navigation;
  - Go to;
  - Dialog instead of confirm;
  - the theme switch;
  - speed.
- Refresh `docs/assets/social-preview.png`, README visuals, and the docs that name screens and buttons
  (`docs/{en,fr,ar}/start-here.md`, `web-app.md`, `quality.md`): the steps, the "AI and voices" page, Check.
- CHANGELOG:
  - the theme default;
  - the new Check step and the `export` alias;
  - the keys page moved to `/ai`;
  - fonts.
- Fix the known issues below, or record why they stay.
- Release per `docs/en/release.md`.

### Known issues (carried forward)

- `warqa qa` without `--shots` on the fox book reports an image overflow on the finish step. The image is
  measured before it has loaded, so it is a timing problem, not a layout one. It predates the redesign
  (Phase 1's code shows it too). Fix it by waiting for images to load before measuring.
- Left for later on purpose:
  - Chapter thumbnails on the book home: a number badge stands in.
  - The phone "Listening" sheet: Phase 5; until then phones use buttons under the stage.

## Vision backlog (after the redesign)

Each item needs its own design review with teachers (and with self-learners for My notebook), then a plan
session. Order and what each builds on:

| When | Concept (canvas board) | Builds on | First step |
|---|---|---|---|
| **First** | My notebook (Carnet): review of missed questions and progress across books. Self-learners need it most. | first-try scores in localStorage, the learner finish card's "Review what you missed" | a notebook view (in the exported book and on "What I'm learning") + spaced review of missed questions, across books |
| Next | Reading supports (Access) | tashkeel (worker), word timings, reduced motion, Board | player settings side sheet; tashkeel on/off per caption |
| Next | Bridge (Bridge) | strings per language, glossary, translation memory | dual captions + tappable glossary terms |
| Next | Back to paper (BackToPaper) | step links `?beat=N`, answer boxes | printable A4 export (desktop, Playwright PDF) with a QR per exercise |
| Next | Snap a page (SnapPage) | vision reading of scanned pages, web app | camera capture in the web app → images → ingest |
| Later | Class mode (ClassMode) | the desktop studio's server, player, questions | serve a book over the teacher's hotspot; pupil phones join by QR; teacher remote |
| Later | Results without accounts (ClassResults) | first-try scores, SCORM | QR receipts + a scanner in the studio; an aggregated, anonymous step view in Check |
| Later | The teacher's voice (TeacherVoice) | worker forced alignment, word times | record per sentence in the editor; align; "Only your own voice" |
| Later | Ask the lesson (AskLesson) | lesson format, validators, local models | answers grounded in the book only, drawn with existing components; hidden without a model |
| Later | The shelf (Shelf) | exports are static sites, teacher panels | a static index of books by level and subject; "Make my copy" |

## Risks and how to keep them small

- **The lesson editor (4d) is the largest piece.** It is split into three sessions; Phases 3–4 ship without
  it if it slips.
- **Offline weight from fonts.** Measure the bundle in Phase 1 and hold the budget.
- **Existing books change look.** That is decision 3: alias `chalk`, write a CHANGELOG note, keep Board one
  click away.
- **Test churn.** Move tests to roles and accessible names as each screen changes, not all at the end.
- **The one-go learner path spends without a plan review.** The summary's estimate is the consent; the
  spending limit (default $1) still applies; Stop keeps finished work; only chapter 1 is made until the
  learner asks for more.
- **Big PDFs in the learner path.** Read cheap text first and run vision only on the pages of the chapter
  being made.
- **Four languages and RTL at every step.** Use `/ui-strings`, then `/visual-qa` in Arabic and a
  left-to-right language every time.

## Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-04 | Direction "Cahier" chosen; name Warqa · ورقة kept | user |
| 2026-10-04 | Sessions change the code themselves and work directly on `master`, no branches; one commit per phase or sub-phase; no push unless asked | user |
| 2026-10-04 | Release phase by phase on `master`, no feature flag | default |
| 2026-10-04 | Books default to the Sheet theme; `chalk` stays valid as an alias of Board; learners can switch and the choice is remembered | default |
| 2026-10-04 | Board is navy (`#0E1226` / `#171C36`), as on the canvas | default |
| 2026-10-04 | Tokens, fonts, logo and icons live in a new workspace package `@warqa/brand` | default |
| 2026-10-04 | Fonts: Readex Pro variable with HEXP (Arabic + Latin), Playpen Sans Arabic (one weight), Geist Mono (Latin, one weight); budget +150 KB per exported book, measured | default |
| 2026-10-04 | Six steps: Read · Plan · Make · Translate & narrate · Check · Share; `?step=export` aliases `share` | default |
| 2026-10-04 | One global "AI and voices" page at `/ai` (keys, default models and voices); book settings keep per-book overrides | default |
| 2026-10-04 | Interface languages stay en/fr/ar for the studio; Darija stays a book and player language | default |
| 2026-10-05 | Third audience, self-learners. The first visit asks "I teach / I'm learning for myself". The learner path is PDF → language → level (beginner · I know some · advanced) → one go (read, plan approved automatically, build chapter 1) → open it; no approval step and no "pupils" or "audience" wording. A `learn` job (studio and web app) and `warqa learn <pdf> --lang --level`; the level maps to the plan's audience text. My notebook moves first in the vision backlog. Docs say "for teachers, students, and anyone learning on their own", with a copyright note for lessons made from a PDF | user |
| 2026-10-05 | A learner's book is `learn: { level: 'beginner' \| 'some' \| 'advanced' }` in `warqa.json` (optional, so old books stay valid). The level can change after the plan: storyboard and write take the current level's audience per chapter, and `adjustLevel` moves it one step for "Too easy / Too hard". A learner's book without a spending limit gets $1 | default |
| 2026-10-05 | Large PDFs: `learn` first reads the whole text layer with no model (free). The vision model (or the OCR worker) reads only the scanned pages of the chapter being made (at most 40), merged page by page into `source/document.json`. A mostly scanned book gets its first 40 pages read before planning, so the plan sees real text, chapters and language; if nothing can be read, the run stops with a clear message before the plan is paid for, and a chapter of unread scans is never written. The PDF's language counts only with 500+ characters of text. The spending limit also covers reading scans | default |
| 2026-10-05 | The learner's summary comes from `GET /api/projects/:id/estimate?learn=1[&chapter=]`: pages, the PDF's language (when known), the chapter it will make, scanned pages, cost p50/p90, seconds, the limit and what the book has `spent` (the limit counts the whole book). It reads the text layer if needed (free). Without a connected AI service it still returns the PDF facts, with `error`. The plan's cost counts only while there is no plan; a one-language book no longer needs a translator model in any estimate | default |
| 2026-10-05 | `learn` narrates when a voice is configured and can run here (the web app skips Edge and worker voices, like `build`). A failing voice never fails the job: the lesson plays with captions and the job logs a warning | default |
| 2026-10-05 | Progress events carry `usd` (spend so far) and the `write` beats carry the beat's title, for the one-go screen. Running `learn` again makes the next chapter not made yet ("Make chapter N"); `chapter` picks one; the estimate and the run choose the same chapter. `warqa learn` works the same way, accepts ar, fr, en and ary, keeps the book's level unless `--level` is given, and takes `--limit <usd>` | default |
| 2026-10-05 | When the PDF's language differs from the lesson's, the learner's audience asks to keep that language's key terms, in parentheses the first time (SelfSetup: "I'll teach you in Arabic and keep the French words you need") | default |
| 2026-10-05 | Tokens live in `packages/brand/src/tokens.ts`, the one source; the build generates `tokens.css` (a light block, then the dark values under `prefers-color-scheme: dark` for `:root:not([data-theme="light"])` and under `[data-theme="dark"]`: CSS can't share one rule between a media query and a selector). Easings are `--wq-ease-settle/lift/ink` (the spec's `--wq-ink` would clash with the ink colour). `--wq-board-*` carry the dark values for surfaces that stay dark in both schemes (the studio's activity board). Reduced motion turns every duration into a 120 ms fade, and player scenes into a cut | default |
| 2026-10-05 | Contrast is tested for every text and border pair (`brand.test.ts`). Three values moved a hair to pass: `text-3` light `#687091` → `#676F90` (4.5:1 on the ground), the dark `input-border` `#5A6396` → `#676F9E` (3:1 on raised), the Sheet stage's coral text `#D2492F` → `#D0482F` (its fill unchanged). Dark shadows use black instead of navy, which doesn't show on the Board | default |
| 2026-10-05 | Fonts come from `@fontsource-variable/readex-pro` (its `full` files carry HEXP 0–100 and weight 160–700, so nothing is vendored), `@fontsource/playpen-sans-arabic` (400, Arabic + Latin), `@fontsource/geist-mono` (400, Latin), plus STIX Two Text and Noto Naskh as before; Readex Pro keeps its usual family name. Measured on `examples/integers.warqa`: fonts 362 → 467 KB (+102 KB, under the +150 KB ceiling). The studio and the web app import the brand's `tokens.css` and `fonts.css` themselves. Every face carries its `unicode-range` (read from Fontsource's per-weight sheets), so a script downloads only its own file | default |
| 2026-10-05 | Interim studio reskin: today's variable names (`--paper`, `--amber`…) now point at the tokens and the duplicated dark blocks are gone. The old amber split by meaning: primary actions, links and selection → ink; the current step and the selected beat → the highlighter; running status and warnings → `fluo-tint`/`fluo-text`; errors → pen. Inputs use `--wq-input-border` (3:1); marks in the editor are text on `fluo-tint`. Display type follows the canvas: page titles Readex HEXP 100 at 650; section and card titles HEXP 60 at 600, except Arabic ones, which keep their natural width as on the canvas | default |
| 2026-10-05 | Brand in the top bar as on the canvas: the mark, "Warqa" (HEXP 100, 600) and ورقة smaller in `text-2`. Phones (≤760 px) keep only the wordmark in the interface's script, the smallest (≤420 px) the mark alone (the canvas's phone bar has no wordmark). Icons are typed (`IconName`): `x` → `close`, `external` → `open`, `refresh` → `regenerate`, `gear` → `settings`, and the theme toggle uses `sheet-theme`, `board-theme`, `auto-theme`. Back and next mirror through `.icon-mirror` | default |
| 2026-10-05 | Icons and manifests: `packages/brand` draws the app icon (one function for the build's PNGs and for exported books through `@napi-rs/canvas` or the browser's canvas) and writes `icon-192`, `icon-512`, a maskable 512 (full bleed, the mark inside the safe circle) and an Apple touch icon. The studio's server serves `/favicon.svg`, `/icons/*` and `/manifest.webmanifest`; the web app emits them as static files. The finish mascot keeps its hop until Phase 2's Fold. Exported books already take the brand's light manifest colours, as this phase asks, though their player stays chalk until Phase 2 | default |
| 2026-10-05 | Book themes: `sheet` (default for new books) and `board`; `chalk` is an alias of Board. Saved books carry the old default `"theme": "chalk"`, which can't be told from a choice, so they open on the Board (CHANGELOG migration note); the example books moved to `sheet`. The player's choice order: `?theme=` > the learner's remembered `warqa:theme` > the book's. The book home follows the same rule and has its own switch | default |
| 2026-10-05 | Stage colours live in one mutable palette (`theme.ts` `COLORS`, refilled by `setTheme`); a theme switch rebuilds the scene at the same moment, like a language switch. `color()` gives the text and line variant, `fill()` the area variant (the highlighter yellow for task and gold on the Sheet). The palette is module-wide; each player sets its own before it builds or draws | default |
| 2026-10-05 | Player page: a strip (All lessons, title, language, Sheet/Board, transcript, keyboard help, full screen), then the stage column (stage, captions box, bar) with the transcript beside it. The bar drops restart (Home key and the finish card's Watch again remain). The keyboard-help button stays in the strip (desktop only). Speed has a menu (menuitemradio) above its button. Phones get the bar as a grid (step, timeline, back/play/next, pills for speed, captions and text), the transcript as a bottom sheet, and question cards under the picture at full size (the Listening sheet of PlayerSurfaces is left for Phase 5) | default |
| 2026-10-05 | `?bare` shows the stage alone, edge to edge: the video export and `warqa qa` use it, so frames stay 1600 × 900. `head: false` hides the strip where the host page shows the title (the studio's preview). `warqa qa --theme sheet,board` | default |
| 2026-10-05 | Book home per BookHome without chapter thumbnails (optional in the spec; a number badge stands in). Chapter progress comes from the step reached, now saved with the progress (`at`), and the first-try score from the saved scores. "Install for offline use" shows only when the browser fires `beforeinstallprompt` | default |
| 2026-10-05 | Player strings: new keys for the strip, speed, themes, transcript hint and book home in en/fr/ar/ary; `bar.home` now reads "All lessons"; the four unused keys (`lesson.loading`, `lesson.error`, `book.back`, `quiz.option`) are removed, and `bar.restart` and `book.open`, unused by the new chrome | default |
| 2026-10-05 | Player details from the review: the stage's margin line sits outside the slots (x 38, or 1562 in right-to-left), clear of the content; translucent colours are generated as `rgba()` variables at build (no `color-mix()`, which the player's Safari 15 target lacks); a band card puts its key hints and action on one row so it stays below the picture; without the strip (`head: false`) the rating and transcript buttons move into the bar; every player sets its own palette before drawing, so two players with different themes can share a page | default |
| 2026-10-05 | Studio routes stay as they were (tests and bookmarks); `/ai` is added and `/settings` shows the same page. The top bar is the same everywhere: the mark (Your books), Go to, the book's spend chip (when a book is open; it opens the tray when that book has work), AI and voices, the interface-language menu and a two-state Sheet/Board button (the first visit follows the computer) | default |
| 2026-10-05 | Stack strips replace breadcrumbs. They come from the route plus a small "place" each screen publishes (`place.tsx`: the book with its step and spend, the lesson with its beats); the farther place sits further in. Alt+↑ goes to the nearest strip. A new place arrives with the Stack motion (32 px and a fade, `--wq-t-place`) | default |
| 2026-10-05 | Esc closes the topmost open tool (Go to, a menu, the side sheet, Lift) through one stack (`components/tools.ts`); a modal dialog handles its own Esc; Esc never leaves a place. Closing a dialog, Go to or Lift gives the focus back to what opened it | default |
| 2026-10-05 | Keys: ⌘ K on a Mac, Ctrl K elsewhere, matched on the physical key (`e.code`) so an Arabic layout works and the Mac's Ctrl K stays in text fields. Alt+↑ does nothing in a text field or list box, or while a tool or dialog is open | default |
| 2026-10-05 | Unsaved work (a lesson, the plan, the book's settings) asks before an in-app link, a strip, Alt+↑ or Go to leaves the screen (the loss dialog: Stay, or Leave without saving); closing the tab gets the browser's own question. Moving inside the screen (`?beat`, `?step`) never asks. The browser's Back button cannot be asked | default |
| 2026-10-05 | The tray: job state lives above the routes (`JobsProvider`), so it follows navigation. It opens once per job (at most 45 % of the height); Hide folds it into a pill in the bottom inline-end corner; when a job it followed while running ends, the open tray folds to its pill with a check and a toast offers Open (unless you are working inside it); opening an earlier task from its list announces nothing. The toast host is a live region, and toasts sit above the tray. The page keeps room under its last line for the tray (`--tray-space`). Earlier tasks come from `GET /api/projects/:id/jobs`. Per-beat content in the tray is 4c | default |
| 2026-10-05 | Check is optional: it is never the next step, and it is done once the book has a `qa/` folder. QA, Improve and the rating panel moved there from Export; Share holds the export | default |
| 2026-10-05 | Dialogs replace the six `confirm()`s (draft a new plan, make a lesson again, forget the keys, approve the shown strings, delete everything in the browser, delete a book). The safe choice has the focus and answers Esc; the action button says what happens; loss is red. The two `alert()`s of the web app become `warqa:notice` window events shown as toasts | default |
| 2026-10-05 | Web app: the status line ("Runs in this browser · Your data") sits in the studio's top bar through `extras.topbarStatus`; warnings wait in its status menu, which shows their count. The test-mode chip is short ("Test mode", the whole sentence in its tooltip and the menu) and hidden on phones. The menu's explanation and warnings are outside `role="menu"` and describe it (`aria-describedby`); a menu moves itself back inside the window on phones. "Your data" is a side sheet | default |
| 2026-10-05 | Side sheets push the place at 1280 px and wider, cover it with a veil below that, and come up from the bottom on phones; they are rendered on `<body>` because the top bar's backdrop blur would otherwise contain them | default |
| 2026-10-05 | Lift (Phase 3 version): the lesson editor's preview grows into a full-window frame with a strip (Preview · title · language · Close); the same player moves, so closing returns to the beat reached. The editor's new layout is 4d1. `?beat=N` (1-based) opens that beat | default |
| 2026-10-05 | Go to indexes the book's six steps, chapters, the open lesson's beats, other books, Your books, settings and AI and voices, then actions (run through the job API). Nothing is chosen until you type or press an arrow, and places come before actions, so Enter never starts work by accident. Actions show what they spend (Make the estimate, Plan and Read the AI service) and appear only when they make sense here: Read with a PDF, Plan only before a plan exists (drafting again replaces it, so only the Plan step offers it, behind its dialog), Make once the plan is approved, Check and Export with lessons, none the host cannot run. Search ignores accents and Arabic vowel marks | default |

## Session prompts

Paste one of these into a new Claude Code session in this repository. They tell the session to change the
code itself, on `master`, and to commit each finished phase.

**Build the next phase (use this one most of the time)**
> Read REDESIGN.md and build the next unticked phase yourself, directly on master (no branches). Follow
> "How to run a phase": check the working tree is clean, read that phase's canvas artboards with the
> Artifact tool and any canvas comments, read the files it lists, follow the Decisions log, then implement
> without waiting for plan approval. Run /verify, the e2e suites the phase names, /ui-strings for new text
> and /visual-qa in Arabic and a left-to-right language (1280 and 390 px; Sheet and Board where it
> applies), fix what they find, then /review-change. Commit to master as "Redesign phase <n>: …" with the
> phase ticked in REDESIGN.md. Don't push. If there's room left, continue with the next phase; otherwise
> stop and report what changed, the check results with counts, the commit hash and what's next.

**A specific phase** (replace N)
> Read REDESIGN.md and build Phase N yourself, directly on master, following "How to run a phase" and the
> Decisions log. Implement, check (/verify, the phase's e2e, /ui-strings, /visual-qa, /review-change), fix,
> commit to master as "Redesign phase N: …" with the phase ticked, and report. Don't push.

**Phase 4 sub-phases** (one per session; 4d takes three sessions)
> Read REDESIGN.md and build Phase 4x yourself on master: read the canvas artboards named in the 4x row and
> the pages involved, reuse the Phase 3 components, check, commit as "Redesign phase 4x: …" with the
> sub-phase noted in Status, and report. Don't push.

**Change a decision first** (optional)
> In REDESIGN.md, change the decision about <topic> to <your choice> in the Decisions log, then build the
> next phase as described there.
