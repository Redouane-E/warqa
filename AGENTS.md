<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Warqa — guide for AI coding agents

Warqa (ورقة) turns PDFs into animated, narrated, interactive lessons. It is Arabic-first (also Darija, French
and English), works with any AI model, and is Apache-2.0. User docs live in `docs/`, contributor docs in
`CONTRIBUTING.md`; read them rather than guessing. This file holds what is easy to get wrong. (Claude Code
also reads `CLAUDE.md`, which adds its skills and hooks.)

## Map

- `packages/i18n`: player UI catalogs (`src/catalog/{en,fr,ar,ary}.ts`), numbers, Arabic text helpers.
- `packages/lesson`: the lesson format (Zod), compiler, validators, components (`src/components`), the player
  (`src/player`, browser only) and component packs (`src/packs.ts`). `build.mjs` bundles the player into
  `dist/bundle` (player.js/css, fonts, geo-world*.js).
- `packages/pipeline`: PDF ingest, models, stages (plan, storyboard, write, translate, memory, geo), TTS, QA
  (check, judge, panel), exports (site, packages, video, math).
- `apps/cli` (`warqa`), `apps/studio` (Hono + React; its own messages in `src/client/messages.ts`),
  `apps/web` (the studio running in the browser; Node built-ins replaced by `src/shims/*`),
  `apps/mcp` (MCP server), `workers/py` (optional Python worker, run with uv).
- `e2e` (Playwright, three browsers), `evals` (model leaderboard), `examples/*.warqa` (books used by the
  tests and the Pages demo), `launchers`, `docs`.

## Commands

```bash
pnpm install && pnpm build            # build everything (turbo)
pnpm test                             # unit tests of every package (excludes e2e)
pnpm lint                             # Biome; `pnpm format` to fix formatting
pnpm typecheck
pnpm e2e                              # player in Chromium, Firefox, WebKit (first: pnpm --filter @warqa/e2e exec playwright install)
pnpm --filter @warqa/web e2e          # the browser-only web app (first: pnpm --filter @warqa/web e2e:install)
pnpm docs:components                  # regenerate docs/en/components.md after changing a component
(cd workers/py && uv run --locked --with pytest pytest -q)   # Python worker
pnpm warqa <command>                  # the CLI from apps/cli/dist (rebuild it after pipeline changes)
```

Run one package: `pnpm --filter @warqa/<name> test` (or `npx vitest run <file>` inside it).

## Gotchas

- **Build order matters.** Packages import each other's `dist`, not `src`. After changing `@warqa/lesson` or
  `@warqa/i18n`, rebuild them (`npx turbo run build --filter=@warqa/lesson`) before type-checking or testing
  the pipeline, the apps or e2e. The CLI, the studio and e2e run built code. Player changes need the
  bundle rebuilt (`pnpm --filter @warqa/lesson build`) before an export shows them.
- **Generated files:** `docs/en/components.md` (from component definitions; CI fails if stale),
  `packages/lesson/dist/bundle/*`, lockfiles, and books' `cache/`, `dist/`, `qa/`. Edit the source, regenerate.
- **Every UI string in every language:** the player catalogs `en`, `fr`, `ar`, `ary` must all have every key
  (a test enforces it); the studio's `messages.ts` has `en`, `fr`, `ar`. Write real Arabic, French and
  Darija, not placeholders.
- **Right to left:** mirror what is reading order (navigation, slots, timelines, cards); never mirror what
  has a value or geometry (number lines, planes, maps, math). Math is written left to right inside Arabic.
  Arabic-script cells need `dir="auto"`.
- **The web app runs the pipeline in the browser.** A new Node-only import in `packages/pipeline` (fs, child
  processes, `vm`, native modules) needs a shim or alias in `apps/web/vite.config.ts`, and new jobs that need
  Playwright or local programs go in `desktopOnlyJobs` (`apps/web/src/worker/runners.ts`).
- **Lesson strings:** a component's localizable props are listed in its `text` paths; translations are keyed
  by them (`node.<id>.<path>`). Marks `[[name]]`, answer boxes and `$math$` must survive translation.
- **No literal invisible characters** in source (U+2028, bidi controls, ZWJ): write escapes.
- **Components:** a definition (`packages/lesson/src/components`), a view (`src/player/views`), registration
  (`components/registry.ts` with `minWidth`/`natHeight`, `player/scene.ts` VIEWS), at least one example, then
  `pnpm docs:components`. Parts that a "pick" question can target go in `pickable`.

## Money, keys and privacy

- Never run model calls that spend the maintainer's or a user's API credits (`warqa build`, `plan`,
  `translate`, `improve`, `qa --judge`, `eval`) without asking. Tests use the scripted `FakeModel`
  (`packages/pipeline/src/models/llm.ts`); the web app has `?warqa-fake=1`.
- Never read or write `.env`, `~/.warqa/keys.json` or any key. Keys must never end up in books, exports, logs
  or commits.
- Edge voices (`warqa narrate`, provider `edge`) are free and fine for examples (needs uv or edge-tts).

## Checking your work

- Logic: the package's unit tests, plus `pnpm typecheck` and `pnpm lint`.
- Anything visible (player, views, components, styles): look at it. Use `pnpm warqa qa <book> --shots`, then
  view `qa/<lesson>/<lang>/sheet_*.png`, in Arabic and in a left-to-right language. For the studio or web
  app, screenshot at 1280 px and at 390 px.
- Before finishing: `pnpm format`, then `pnpm build && pnpm test && pnpm lint`, and `pnpm e2e` when the
  player, exports or examples changed. The `verify` skill picks the right checks for a diff.

## Skills (task procedures)

Step-by-step procedures in the open Agent Skills format live in `.agents/skills/<name>/SKILL.md`. Codex,
Cursor, Gemini CLI, Copilot and others discover them there; Claude Code finds the same files through the
`.claude/skills` link. Any agent, or a person, can also just read them.

| Skill | Use it to |
|---|---|
| `verify` | pick and run the checks a change needs (build order, tests, lint, docs, e2e, worker) |
| `visual-qa` | render lessons or the UI and look at the screenshots (RTL, overlaps, phone width) |
| `review-change` | review a diff or PR against this project's rules |
| `add-component` | add or change a lesson component, or write a component pack |
| `ui-strings` | add interface text in every language |
| `author-lesson` | write or fix a lesson by hand without spending model credits |

Folders with their own rules have a nested `AGENTS.md`: `packages/lesson`, `packages/i18n`,
`packages/pipeline`, `apps`, `workers/py`, `examples`. Read it when you work there.

## Agent setup in this repository

| Tool | Reads |
|---|---|
| Codex, Cursor, Copilot coding agent, Jules, Amp, Zed, Windsurf, Aider, opencode… | `AGENTS.md` (nested ones too) and `.agents/skills/` |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`), `.claude/` (skills link, subagents, hooks, permissions), `.mcp.json` |
| Gemini CLI | `.gemini/settings.json`, which points it at `AGENTS.md` |
| GitHub Copilot in VS Code | `.github/copilot-instructions.md`, `AGENTS.md`, `.vscode/mcp.json` |
| Cursor | also `.cursor/mcp.json` |

**MCP servers:** `warqa` (this project's server: lesson schema, component catalog, validation, rendering;
run `pnpm build` first) and `playwright` (a browser for checking the studio and web app) are configured for
Claude Code, Cursor and VS Code. For Codex, add them to `~/.codex/config.toml`:

```toml
[mcp_servers.warqa]
command = "node"
args = ["/absolute/path/to/warqa/apps/mcp/dist/server.js"]
```

## Conventions

- TypeScript strict ES modules, Biome formatting (single quotes, 120 columns), comments that say why.
- Keep the lesson format backward compatible; a breaking change needs a CHANGELOG entry with a migration
  note.
- Default branch `master`. Commit or push only when asked. PRs follow `.github/PULL_REQUEST_TEMPLATE.md`.
