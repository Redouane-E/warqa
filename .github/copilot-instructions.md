# Copilot instructions for Warqa

Follow `AGENTS.md` at the repository root (the guide for every coding agent), and the nested `AGENTS.md` in
the folder you are working in. Task procedures — verify a change, look at the UI, add a component, add
interface text, write a lesson by hand, review a change — are in `.agents/skills/*/SKILL.md`.

The essentials:

- Packages build into `dist/` and import each other's builds: rebuild `@warqa/lesson` / `@warqa/i18n` before
  testing what depends on them (`npx turbo run build --filter=@warqa/lesson`).
- Every interface string goes in every language: the player has `en`, `fr`, `ar` and `ary`
  (`packages/i18n/src/catalog`), and the studio has `en`, `fr` and `ar` (`apps/studio/src/client/messages.ts`).
- Right to left: mirror reading order, never number lines, maps or math.
- Never spend API credits and never touch `.env` or keys. Tests use the scripted `FakeModel`.
- Generated files (`docs/en/components.md`, `dist/`, lockfiles) are regenerated, not edited.
- Check: `pnpm build && pnpm test && pnpm lint`, plus `pnpm e2e` for player and export changes.
