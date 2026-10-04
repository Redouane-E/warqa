# packages/lesson — lesson format, components and player

Read the root `AGENTS.md` first; this file adds what applies inside `packages/lesson/`.

- The player runs in the browser and from `file://`. Load data with `<script>` files next to the bundle, not
  `fetch` (it fails on `file://`); see `views/map.ts` (`loadScript`, `setAssetBase`).
- Views draw in stage coordinates (1600 × 900). Text goes through `svgLabel` or `rich` with `ctx.dir`.
  Measure with `textWidth`.
- Right to left: `slotBoxes` mirrors slots. A view mirrors only what is reading order; number lines, planes,
  maps, clocks and math keep their orientation.
- Channels: `o` (opacity), `s` (pulse), `hl`/`hlc` (highlight), `c` (colour), plus your own. Read them with
  `num(get(sub, ch), fallback)`. Parts in `pickable` become pick-question targets through `part(sub)`.
- `prefers-reduced-motion`: transitions in `styles.css` must have a reduced-motion variant.
- After a change: `pnpm --filter @warqa/lesson test`, then rebuild (`pnpm --filter @warqa/lesson build`) and
  look at it (the `visual-qa` skill in `.agents/skills/`). A component change also needs `pnpm docs:components`.
