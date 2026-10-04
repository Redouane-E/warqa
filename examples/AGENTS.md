# examples — example books and a component pack

Read the root `AGENTS.md` first; this file adds what applies inside `examples/`.

- They are fixtures: `e2e/global-setup.ts` exports them, the Pages workflow publishes them as demos, and
  unit tests copy them. After changing one, run `pnpm warqa validate <book>` and `pnpm e2e`.
- Narration comes from the free Edge voices (`pnpm warqa narrate <book>`). Never generate content with paid
  models for examples without asking.
- `cache/`, `dist/` and `qa/` are generated and git-ignored. `assets/geo/*` holds data under its own
  licence (see THIRD_PARTY_NOTICES.md).
