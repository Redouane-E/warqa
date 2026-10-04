# Component packs

A component pack adds new kinds of pictures to Warqa (a clock, a chemistry lab bench, a musical staff, …)
without changing Warqa itself. Once a book installs a pack, its components work everywhere: the writer model
can use them, the validator checks them, the player draws them, and exported books include them.

> **A pack is code.** It runs on your computer when Warqa opens the book, and in the browser of everyone who
> reads it. Only add packs you trust, and read the file first: it is one short script.

## Using a pack

```bash
warqa pack add examples/packs/clock      # a folder with package.json
warqa pack add ./my-pack.js              # a single file
warqa pack add warqa-pack-clock          # from npm (downloaded with npm, scripts disabled)
warqa pack list
warqa pack remove packs/warqa-pack-clock.js
```

`pack add` copies the script into the book (`packs/<name>.js`) and lists it in `warqa.json`
(`pipeline.components`). The book stays self-contained: it works without npm or network, and the file is
diffable like the rest of the book.

## Writing a pack

A pack is **one plain JavaScript file**. It pushes a setup function onto `WARQA_PACKS`; Warqa calls it with
`W`, an object with everything a pack needs:

```js
(globalThis.WARQA_PACKS = globalThis.WARQA_PACKS || []).push(function (W) {
  W.registerComponent({ /* the definition: runs in Node and in the browser */ });
  if (!W.registerView) return;           // in Node, the definition is all that is needed
  W.registerView('clock', function (ctx) { /* the drawing: browser only */ });
});
```

The same file runs in two places:

| Where | What it is used for | `W` has |
|---|---|---|
| Node (CLI, studio, MCP) | schema, validation, the writer's component catalog | `z`, `Text`, `ColorName`, `Id`, `Size`, `registerComponent` |
| The player (browser) | compiling cues and drawing | all of the above, plus `registerView` and `kit` |

Use `W.z` (Zod 4) for props and action arguments; do not bring your own copy of Zod.

### The definition

It has the same shape as the built-in components in `packages/lesson/src/components/*.ts` (read
`docs/en/contributing-components.md` for the details). The important fields:

- `type` is a new name. Built-in names cannot be replaced.
- `doc` is what the writer model reads: say what the component shows, its props, actions and parts, briefly.
- `props` is a `W.z.object({…})` with defaults.
- `text` lists the localizable props (`["label", "items.*.text"]`). Use `W.Text` for them.
- `subs(props)` names the parts that cues can target (`"c#minute"`), and `pickable(props)` the parts a
  "pick" question can ask for.
- `init(props)` sets the starting channel values. `actions` are verbs for cues: `apply(ctx, args)` tweens
  channels with `ctx.tween(sub, channel, value, ctx.t0, ctx.dur)`.
- `examples` hold one or more working examples. They power the catalog and the gallery.

### The view

`W.registerView(type, factory)` gets a `ctx` with:

- the node: `ctx.node.props` and `ctx.node.subs`
- an SVG group `ctx.g` and an HTML container `ctx.div`
- `ctx.lang`, `ctx.dir` and `ctx.fmt(n)` (numbers in the book's digits)
- `ctx.asset(path)`

The factory returns these functions:

- `size(maxW, maxH)` returns the natural size.
- `place(box)` lays the picture out in its box (stage coordinates, 1600 × 900).
- `update(get, t)` draws the current state. `get(sub, channel)` reads animated values: `o` (opacity), `hl`
  (highlight), `c` (colour) and your own channels.
- `part(sub)` (optional) returns a part's box, for highlights and pick questions.

`W.kit` has the helpers the built-in views use:

- `svg(tag, attrs, parent)` and `h(tag, attrs, ...children)` build elements
- `svgLabel(parent, text, {x, y, size, fill, weight, dir})` draws a text label
- `textWidth` measures text
- `color(name)`, `COLORS` and `mix(a, b, t)` give theme colours
- `num(value, fallback)` and `clamp` handle numbers

Maps are never mirrored and neither should most pictures be. Use `ctx.dir` only for text.

### The example

[`examples/packs/clock`](../../examples/packs/clock) is a complete pack of about 150 lines: an analogue clock
whose hands turn forward when a cue says `set {hour, minute}`, with pickable hands. Copy it to start.

### Publishing on npm

Add a `package.json` with a `"warqa": {"pack": "pack.js"}` entry and the keyword `warqa-pack`:

```json
{
  "name": "warqa-pack-clock",
  "version": "0.1.0",
  "license": "Apache-2.0",
  "keywords": ["warqa-pack"],
  "files": ["pack.js", "README.md"],
  "warqa": { "pack": "pack.js" }
}
```

Then `npm publish`. People install it with `warqa pack add warqa-pack-clock`.

### Testing

Add the pack to a scratch book, write a lesson that uses it, and run:

```bash
warqa validate my-book.warqa        # schema, cues, parts and layout checks
warqa qa my-book.warqa --shots      # renders every beat; look at qa/<lesson>/<lang>/sheet_*.png
```
