---
name: verify
description: Run the checks that matter for the current change in the Warqa monorepo (build order, unit tests, typecheck, lint, generated docs, e2e, worker tests) and report results. Use before saying a change is done, before committing, or when asked to "verify", "check", or "run the tests".
---

# Verify a change

1. See what changed: `git status --short` and `git diff --stat` (plus `git diff --stat master...HEAD` on a
   branch). Map files to packages:
   - `packages/i18n/**` → i18n, then everything that depends on it
   - `packages/lesson/**` → lesson, pipeline, apps, e2e
   - `packages/pipeline/**` → pipeline, cli, studio, web, mcp
   - `apps/<x>/**` → that app
   - `workers/py/**` → the Python worker
   - `examples/**`, `packages/lesson/src/player/**`, `packages/pipeline/src/export/**` → e2e as well
2. **Build what changed and what depends on it** (packages use each other's `dist`). Turbo builds the
   dependencies it needs by itself:
   - uncommitted changes: `npx turbo run build --filter='...[HEAD]'`
   - a branch: `npx turbo run build --filter='...[master...HEAD]'` (turbo's `--affected` assumes `main`;
     here the default branch is `master`, so set `TURBO_SCM_BASE=master` if you use it)
   - when unsure: `pnpm build`
3. **Unit tests and types:** the same filter with `npx turbo run test typecheck --filter='!@warqa/e2e'`
   added, or simply `pnpm test && pnpm typecheck`.
4. **Lint:** `pnpm lint`. Fix errors with `pnpm format` / `npx biome check --write <files>`; warnings are
   acceptable.
5. **Generated docs:** if a file in `packages/lesson/src/components/` changed, run `pnpm docs:components` and
   check that `docs/en/components.md` changed as expected.
6. **Browser tests** when the player, exports, examples or the web app changed:
   - `pnpm e2e` (all three browsers; `pnpm --filter @warqa/e2e test --project=chromium` for a quick pass)
   - `pnpm --filter @warqa/web e2e` for `apps/web` or `apps/studio/src/client`
7. **Python worker** if `workers/py` changed: `cd workers/py && uv run --locked --with pytest pytest -q`.
8. **Visible changes** (views, styles, studio pages): use the `visual-qa` skill; tests alone do not show
   overlaps or RTL mistakes.

Report the command and its pass/fail counts for each step. Never call a step passed without running it. If
something fails, show the failing output, fix it, and run that step again.
