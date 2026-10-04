# packages/i18n — interface text and language helpers

Read the root `AGENTS.md` first; this file adds what applies inside `packages/i18n/`.

- Every key in every catalog, in the same change: player `en`, `fr`, `ar`, `ary`; studio `en`, `fr`, `ar`.
- Real language, for teachers and pupils. Darija uses Arabic script only. Keep `{placeholders}` exact.
- Arabic and Darija plurals use `zero`, `one`, `two`, `few`, `many` and `other`. Never build sentences by
  concatenating translated pieces.
- Check with `pnpm --filter @warqa/i18n test`, or `pnpm --filter @warqa/studio typecheck`. See the `ui-strings` skill in `.agents/skills/`.
