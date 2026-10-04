---
name: add-component
description: Add a new lesson component (a kind of picture such as a number line, a map or a clock) to Warqa, or change an existing one - definition, player view, registry, layout sizes, example, docs, gallery check. Use when asked to add, create or extend a component, or to decide between a built-in component and a third-party pack.
---

# Add a lesson component

Read `docs/en/contributing-components.md` first, and look at a similar component: `title`/`list`
(HTML views), `numberline` (SVG with actions), `map` (data loaded on demand), `math` (export-time data).

**Built-in or pack?** If only some books need it, write a component pack instead
(`docs/en/component-packs.md`, template `examples/packs/clock/pack.js`). Built-in components are for things
many lessons need.

## Steps

1. **Definition** in the right pack file `packages/lesson/src/components/{core,stem,humanities,more}.ts`:
   - `type`, and `pack` (core, stem, humanities, document or kids)
   - `doc`: what the writer model reads. Say what it shows, when to use it, its actions and its parts, briefly.
   - `props`: a Zod object with defaults. Use `Text` for localizable text, `ColorName`, `Id`, `Size` from
     `../schema/common.js`.
   - `text`: localizable prop paths (`'items.*.text'`). Everything a reader sees, except numbers and math.
   - `subs(props)`: parts that cues target. Add `initSub`, `reveal` (parts shown in order at the beat start)
     and `pickable` (parts a "pick" question can ask for).
   - `actions`: verbs for cues; `apply(ctx, args)` uses `ctx.tween` and `ctx.addMark`, and `ctx.error` for
     bad arguments.
   - `examples`: at least one realistic example, with cues if there are actions.
2. **Register** it in `packages/lesson/src/components/registry.ts`: the list, plus `MIN_WIDTH` and
   `NAT_HEIGHT`, which the layout checks use.
3. **View** in `packages/lesson/src/player/views/` (an SVG drawing in `ctx.g`, or HTML in `ctx.div`):
   `size`, `place`, `update(get, t)` and `part(sub)`. Register it in `VIEWS` (`src/player/scene.ts`).
   - Text uses `svgLabel` or `rich` with `ctx.dir`.
   - Mirror only what is reading order; values, geometry and maps keep their orientation in Arabic.
4. **Validate the idea against the rules:** a visual change on the words that explain it, readable at 1600×900,
   no overlap with other slots.
5. **Test:**
   - `pnpm --filter @warqa/lesson test`. The gallery test compiles every example and fails on bad cues or
     parts.
   - Add unit tests for any non-trivial logic.
6. **Docs:** `pnpm docs:components` regenerates `docs/en/components.md`. Commit it; CI fails if it is stale.
7. **Look at it** (the `visual-qa` skill):
   - Build the lesson package; `pnpm e2e` exports a gallery of every example to `e2e/.site/gallery/`.
   - Render a lesson that uses it with `pnpm warqa qa … --shots`, in `ar` and `en`.
8. **The writer:** if models should prefer it in some situations, say so in its `doc`. The prompts take
   their catalog from the docs.
9. **The web app:** if the view needs data files, check that the export copies them and that
   `apps/web` serves them.
