# Contributing to Warqa

Thank you! Warqa is meant to be useful to learners everywhere, and especially in Arabic. Every kind of
contribution helps:

- **Teaching feedback**: watch a generated lesson and tell us what a student would find confusing.
- **PDF reports**: a textbook that Warqa reads badly is a precious bug report ("My PDF didn't work" form).
- **Translations** of the player and studio interface, and new languages.
- **Components**: new kinds of pictures and animations (a diagram, a manipulative, a map…).
- **Code**: the pipeline, the player, the studio, the CLI, the MCP server, the Python worker.
- **Example books** under an open licence, **model evaluations**, and **docs**.

Questions are welcome in Discussions, in English, Arabic or French. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Development setup](#development-setup)
- [Repository map](#repository-map)
- [Everyday commands](#everyday-commands)
- [How the lesson format works](#how-the-lesson-format-works)
- [Adding a component](#adding-a-component)
- [Adding an interface language](#adding-an-interface-language)
- [Adding a model provider](#adding-a-model-provider)
- [Tests](#tests)
- [Code style and commits](#code-style-and-commits)
- [Pull requests](#pull-requests)
- [Licence of contributions](#licence-of-contributions)
- [Content and rights](#content-and-rights)
- [Good first issues](#good-first-issues)

## Development setup

**You need:** Node.js 22 (see `.nvmrc`; `nvm use` picks it up) and pnpm, whose exact version is pinned in
`package.json` (`"packageManager": "pnpm@11.6.0"`). Corepack, bundled with Node 22, installs it for you.

```bash
git clone https://github.com/Redouane-E/warqa && cd warqa
corepack enable          # once; or prefix commands with `corepack pnpm`
pnpm install
pnpm build
pnpm test
```

Optional, depending on what you work on:

| For | Install |
| --- | --- |
| end-to-end tests, `warqa qa`, video export | `pnpm --filter @warqa/e2e exec playwright install --with-deps` (all browsers) or `… install chromium` |
| narration with the free Edge voices | [uv](https://docs.astral.sh/uv/) (or `pip install edge-tts`) |
| video export | ffmpeg |
| the Python worker | uv, Python 3.12+ |
| the container | Docker |

Making real books needs a model: one API key in `.env` (copy `.env.example`) or a local server such as
Ollama. Tests never need a key: they use a fake model.

**pnpm 11 notes**

- Dependency install scripts are refused unless the package is listed under `allowBuilds` in
  `pnpm-workspace.yaml` (today: esbuild, Biome, `@napi-rs/canvas`). If you add a dependency and
  `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, decide whether its script is needed and add it to
  `allowBuilds` with `true` or `false` in the same pull request.
- Arguments after a script name go straight to the script: `pnpm warqa export --zip`, `pnpm e2e --project=chromium`.
  Do **not** add `--`: pnpm forwards it literally and most tools then misread the arguments.
- Commit `pnpm-lock.yaml` with any `package.json` change. CI installs with `--frozen-lockfile`.

## Repository map

```
packages/i18n       UI catalogs for the player (ar/ary/fr/en), number parsing, Arabic normalization, bidi helpers
packages/lesson     lesson format (Zod), compiler, validators, grading, components, and the player
packages/pipeline   PDF ingest, model layer, prompts, stages, translation memory, maps, math, speech, QA, panels, exports
apps/cli            the `warqa` command (src/warqa.ts)
apps/studio         the local web studio (Hono server + React client, its own ar/fr/en messages)
apps/mcp            MCP server for coding agents
apps/web            the studio in the browser, with no server (GitHub Pages)
workers/py          optional Python worker: OCR, forced alignment, Arabic diacritics, local voices
e2e                 Playwright tests of the player in Chromium, Firefox and WebKit
evals               model evaluations (`pnpm eval`)
examples            example books (maths, a picture book, geography) and a component pack
launchers           one-click launchers for Windows, macOS and Linux
docs                user and contributor documentation (en, ar, fr)
```

Packages are ES modules written in strict TypeScript. Turborepo builds them in dependency order
(`turbo.json`); `typecheck` and `test` first build what they depend on.

## Everyday commands

| Command | Does |
| --- | --- |
| `pnpm build` | build every package and app |
| `pnpm test` | unit and property tests (Vitest, fast-check) |
| `pnpm typecheck` | TypeScript, no output |
| `pnpm lint` | Biome: lint + formatting + import order (fails on errors, not warnings) |
| `pnpm format` | Biome: rewrite formatting |
| `pnpm e2e` | Playwright on the exported example book, all three browsers |
| `pnpm e2e --project=chromium` | the same in Chromium only |
| `pnpm docs:components` | regenerate `docs/en/components.md` from the component definitions |
| `pnpm warqa <command>` | the CLI from source, e.g. `pnpm warqa preview examples/integers.warqa` |
| `pnpm warqa studio examples` | the studio on the example book, <http://127.0.0.1:5170/> |
| `pnpm --filter @warqa/studio dev` | the studio with hot reload |
| `pnpm --filter @warqa/lesson test` | one package's tests (any `@warqa/*` name works) |
| `pnpm mcp` | the MCP server |
| `pnpm eval …` | model evaluations, see `evals/README.md` |
| `cd workers/py && uv run --with pytest --with httpx pytest -q` | the Python worker's tests |

## How the lesson format works

A lesson (`warqa.lesson/1`) is JSON that models write and the player renders. Nothing in it is code or a
pixel position. In short:

- A lesson is a list of **beats**. Each beat has **narration** with `[[marks]]` placed right before the
  words an animation waits for, a **scene** (nodes added, removed or kept), **cues** (`at` a mark, `do` an
  action, on a `target` node or part such as `eq1#tok:2`) and optional **questions** shown inside the picture.
- **Nodes** are instances of **components** placed in **slots** (`main`, `start`, `end`, `band`…); the player
  lays them out and mirrors `start`/`end` in right-to-left languages.
- Text lives in the author language inside the lesson; other languages are **string tables**
  (`strings.<lang>.json`) keyed by stable paths. Narration marks, answer boxes and `$math$` must survive
  translation; `checkStrings` verifies it.
- `compileLesson` folds the scene beat by beat into channel segments, so any instant of any beat can be
  sampled directly: seeking equals playing through, and tests check it.
- **Validators** check meaning against the live scene (marks exist, targets are on stage, answers parse,
  pacing). Their messages are written for models: the pipeline sends them back for repair.

Read [docs/en/lesson-format.md](docs/en/lesson-format.md) for the details and
[docs/en/components.md](docs/en/components.md) for every component.

## Adding a component

A component has two halves: a **definition** in `packages/lesson/src/components/` (Node-safe: props schema,
an LLM-facing `doc`, localizable text paths, parts, actions, examples) and a **view** in
`packages/lesson/src/player/views/` (DOM/SVG, browser only). The short version:

1. Define it (`ComponentDef`) in the right pack file and give it **at least one example**.
2. Register it in `packages/lesson/src/components/registry.ts` (plus its `minWidth`/`natHeight` for layout checks).
3. Write the view and register it in `VIEWS` (`packages/lesson/src/player/scene.ts`).
4. Respect right-to-left: follow the reading direction where position means order; keep mathematical
   orientation where position means value.
5. `pnpm --filter @warqa/lesson test` (the gallery test compiles every example), then `pnpm docs:components`.

The full walkthrough, with a worked example and a review checklist:
**[docs/en/contributing-components.md](docs/en/contributing-components.md)**.

A component that only some books need can live outside Warqa as a **component pack**: one plain script,
published on npm or shared as a file, installed with `warqa pack add`. See
[docs/en/component-packs.md](docs/en/component-packs.md) and the example in `examples/packs/clock`.

## Adding an interface language

There are two interface catalogs: the **player** (`packages/i18n/src/catalog/<lang>.ts`, registered in
`catalog.ts`, with the language's direction, locale and speaking rate in `lang.ts`) and the **studio**
(`apps/studio/src/client/messages.ts` and `i18n.ts`). Tests check that every key exists in every catalog.
Arabic plurals use all six `Intl.PluralRules` forms.

Step by step, including voices, prompts and number formats:
**[docs/en/adding-a-language.md](docs/en/adding-a-language.md)**. Small wording fixes need only a one-line
pull request, or the "Translation or wording fix" issue form.

## Adding a model provider

Most providers are one entry away, because Warqa talks to models through the [AI SDK](https://ai-sdk.dev).
Many services already work through `openrouter` or `compat` (any OpenAI-compatible endpoint); add a
dedicated provider when it brings something (native structured output, a local server, a key people
already have).

1. **Dependency**: add the AI SDK provider package to `packages/pipeline/package.json`
   (`pnpm --filter @warqa/pipeline add @ai-sdk/<name>`), or use `@ai-sdk/openai-compatible`.
2. **`packages/pipeline/src/models/providers.ts`**:
   - add a `ProviderInfo` to `PROVIDERS`: `id` (used in `provider:model` ids), `name`, `kind`
     (`cloud`, `gateway` or `local`), `env` (the key variable first; for local servers the base URL),
     `structured` (`native` if it supports JSON Schema output, `grammar` for local constrained decoding,
     else `json`) and a `docs` link where people get a key;
   - add a `case` to `languageModel()` that builds the model, reading the key with `need()`.
   The studio's key form, `warqa models status` and `warqa doctor` pick the provider up from `PROVIDERS`.
3. **Capabilities and prices**: add the models people will use to `SNAPSHOT` in
   `packages/pipeline/src/models/catalog.ts` (vision, structured output, context, USD per million tokens,
   tier A/B/C). If models.dev lists the provider, add its id to `updateCatalog()`.
4. **Optional preset** in `packages/pipeline/src/models/presets.ts` (`needs` lists the key variables).
5. **Docs and config**: the key in `.env.example`, a row in [docs/en/models.md](docs/en/models.md).
6. **Check it**: `pnpm warqa models probe <provider>:<model>` runs five small tasks and suggests a tier;
   for a real comparison, run the evals on an openly licensed PDF.

Never log keys, never write them into book projects or exports, and keep error messages free of them.

## Tests

- **Unit and property tests** live next to the code (`*.test.ts`) and in `apps/*/test`. Add a test for
  every behaviour you change. Prefer property tests (fast-check) for parsers, grading and compilation.
- **The component gallery** (`galleryLesson()`) turns every component example into a beat; the lesson
  package test validates and compiles it, so a broken example fails CI.
- **End-to-end tests** (`e2e/`) export `examples/integers.warqa`, serve it and drive the player in
  Chromium, Firefox and WebKit, including axe accessibility checks. CI runs Chromium on pull requests and
  all three browsers on `master`.
- **The Python worker** has its own pytest suite. It runs without any optional engine installed (engines are blocked or faked), so it is fast and needs no model downloads.
- **Arabic and right-to-left**: for anything visible, look at it in Arabic as well as in French or
  English, and attach screenshots to the pull request.
- Tests never call real model APIs or need keys. If you need a model's behaviour, use the fake model in
  `packages/pipeline/src/stages/stages.test.ts` as a starting point.

## Code style and commits

- Biome formats and lints (2 spaces, single quotes, semicolons, 120 columns). Run `pnpm format` before
  committing; `pnpm lint` must pass. An `.editorconfig` sets the basics for other editors.
- Write comments for the *why*. Keep user-facing messages short, concrete and free of jargon: they are
  translated, and many readers are teachers, not developers.
- Files that contain code ported from Papermorph keep the header "Portions derived from Papermorph (MIT)".
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org) loosely:
  `type(scope): summary` in the imperative, under 72 characters. Types: `feat`, `fix`, `docs`, `test`,
  `refactor`, `perf`, `i18n`, `ci`, `build`, `chore`. Scopes: `lesson`, `player`, `pipeline`, `models`,
  `tts`, `studio`, `web`, `cli`, `mcp`, `worker`, `i18n`, `e2e`, `docs`, `launchers`. Example:
  `feat(lesson): add a fraction circle component`.
- Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) when users will notice the change.

## Pull requests

- Keep each pull request focused on one change; open an issue first for anything large (a new format
  field, a new dependency, a change to how lessons teach).
- Fill in the template's checklist: tests, `pnpm lint`, `pnpm typecheck`, `pnpm docs:components` when
  components change, screenshots for the player or studio, right-to-left checked.
- CI must be green. A maintainer reviews; see [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.

## Licence of contributions

Warqa is licensed under [Apache-2.0](LICENSE). **There is no contributor licence agreement (CLA).** As
section 5 of the licence says, anything you intentionally submit for inclusion is licensed under
Apache-2.0, the same licence as the project (*inbound = outbound*). By opening a pull request you confirm
that you have the right to submit the work under that licence. Signing off your commits
(`git commit -s`, the [Developer Certificate of Origin](https://developercertificate.org)) is welcome but
not required.

If you bring in third-party code, it must have a compatible licence (MIT, BSD, Apache-2.0…), keep its
copyright notice, and be listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Content and rights

Never commit copyrighted source PDFs or page images. Example books must use content you have the right
to share (CC-BY or public domain), with attribution. Do not commit model responses that reproduce large
parts of a copyrighted book (`cache/` is ignored for that reason), and never anything about real students.

## Good first issues

Look for the `good first issue` label, or pick one of these:

- **Wording**: read the Arabic or French interface (`packages/i18n/src/catalog/ar.ts`, `fr.ts`,
  `apps/studio/src/client/messages.ts`) and fix anything that sounds translated rather than written.
- **A new interface language** for the player (about 90 strings) following
  [adding-a-language.md](docs/en/adding-a-language.md).
- **More chapter headings** in `packages/pipeline/src/ingest/classify.ts` (e.g. Spanish "Capítulo",
  Turkish "Bölüm") with a unit test.
- **A second example** for a component that has only one, showing another action.
- **Docs**: an Arabic or French version of a page in `docs/en/`.
- **Studio**: an empty state, an error message or a keyboard shortcut that would help.
- **A test** for a validator message that has none, or a property test for answer parsing.
- **A small component**: a fraction circle, a thermometer with zones, a Venn diagram
  (see [contributing-components.md](docs/en/contributing-components.md)).
- **Evaluations**: run `pnpm eval` on an openly licensed PDF with a model that is not on the leaderboard yet.
- **Launchers**: try them on your OS and report or fix what is unclear.
