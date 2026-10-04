# packages/pipeline — ingest, models, stages, speech, QA, exports

Read the root `AGENTS.md` first; this file adds what applies inside `packages/pipeline/`.

- It also runs in the browser (`apps/web`). A new Node-only import (child_process, vm, native addons, new
  `node:` modules) needs a shim or alias in `apps/web/vite.config.ts`. New Playwright or local-program jobs go
  in `desktopOnlyJobs` (`apps/web/src/worker/runners.ts`).
- Model calls go through `Llm.structured` / `Llm.text` (cache, ledger, budget, repair loop). Never call a
  provider SDK directly. Tests use `FakeModel`; never use real keys in tests.
- Write project files through `Project` (`writeJson` is atomic). Keys must never be written into a book or
  an export.
- The lesson schema comes from `@warqa/lesson`'s `dist`: rebuild it first
  (`npx turbo run build --filter=@warqa/lesson`). The CLI uses the pipeline's `dist`: rebuild after changes
  (`npx turbo run build --filter=@warqa/cli`).
- Tests: `pnpm --filter @warqa/pipeline test` (Vitest). Fixtures live in `examples/` and the test files.
