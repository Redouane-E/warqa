# packages/brand — the design system

Read the root `AGENTS.md` first; this file adds what applies inside `packages/brand/`.

- `src/tokens.ts` is the one source of the "Cahier" tokens (spec: `REDESIGN.md`, "Design system
  specification"). The build writes `dist/tokens.css` from it: never edit the CSS. Colours come in pairs,
  light (Sheet) and dark (Board); `--wq-board-*` are the dark values for surfaces that stay dark.
- Contrast is tested (`src/brand.test.ts`): a new colour pair used for text needs 4.5:1, a control border 3:1.
  Add the pair to the test.
- Icons (`src/icons.ts`) are one stroked path on a 24 grid with a 1.75 stroke (circles and rectangles written
  as paths), plus an optional filled part. Only reading-order icons go in `MIRRORED`. The mark never mirrors.
- Fonts: `build.mjs` copies only the subsets and weights in its `FONTS` list (the per-book budget is about
  +150 KB over the old set; measure an export's `_warqa/fonts` before adding any).
- After a change: `pnpm --filter @warqa/brand test`, then `pnpm build` (the player bundle, the studio and the
  web app all take the brand's `dist`), and look at the studio and an exported book (`visual-qa` skill).
