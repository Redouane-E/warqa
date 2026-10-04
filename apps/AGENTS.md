# apps — CLI, studio, web app, MCP server

Read the root `AGENTS.md` first; this file adds what applies inside `apps/`.

- The web app runs the studio's client and its Hono server in the browser (a Web Worker, a virtual file
  system in IndexedDB). A server change must also work there; check `pnpm --filter @warqa/web e2e`.
- Desktop-only features read `capabilities` from `/api/status` and explain themselves when unavailable.
  Never fail silently.
- Interface text in en, fr and ar (`messages.ts`); `dir="auto"` on mixed-script content; no sideways
  scrolling at 390 px.
- Tests: `pnpm --filter @warqa/studio test` (server routes) and `pnpm --filter @warqa/web test` /
  `e2e` (the web app uses the test model, `?warqa-fake=1`). Look at changed screens in ar and en (the `visual-qa` skill in `.agents/skills/`).
