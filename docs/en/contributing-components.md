# Contributing a component

Components are the building blocks of every lesson picture: `equation`, `numberline`, `balance`, `map`,
`timeline`… Models never draw: they place components in slots and animate them with cues. A good new
component therefore teaches every model a new way to explain something, in every language.

This guide walks through adding one, using a **fraction circle** (a pie cut into equal parts) as the
running example. Read [lesson-format.md](lesson-format.md) first if you have not.

## The two halves

| | Where | Runs in | Job |
| --- | --- | --- | --- |
| **Definition** (`ComponentDef`) | `packages/lesson/src/components/*.ts` | Node and the browser | props schema, LLM-facing doc, localizable text, parts, actions, examples, layout hints |
| **View** (`ViewFactory`) | `packages/lesson/src/player/views/*.ts` | the browser only | draws the component (SVG and/or HTML) from channel values |

The definition must stay free of DOM code: the pipeline imports it in Node to validate and compile
lessons. The compiler turns cues into **channels** (numbers that tween, strings that switch) on the node
and on its **parts**; the view only reads channel values at time *t*. That is why seeking is instant and
identical to playing through.

Look at real components before writing yours. Good small references: `fractionbar`, `areagrid`
(`components/more.ts`, `player/views/more.ts`) and `counters` (`components/stem.ts`, `player/views/stem.ts`).

## 1. The definition

The fields of `ComponentDef` (`packages/lesson/src/core/types.ts`):

| Field | What to put there |
| --- | --- |
| `type` | the name models write, lower case, unique |
| `pack` | `core`, `stem`, `humanities`, `document`, `kids` or `custom` (prompts can restrict to packs) |
| `doc` | 1–3 sentences **for the model**: what it shows, when to use it, its actions with their arguments, its parts |
| `props` | a Zod schema; bound every number and array (`.min()`, `.max()`) so a model cannot ask for 10 000 parts |
| `defaultSlot` | where it goes when the model gives no slot (`main`, `full`, `band`…) |
| `text` | prop paths that are learner-facing text (`'label'`, `'items.*.text'`): they are translated |
| `subs(props)` | named parts cues can target (`part:0`, `tok:2`…) |
| `initSub`, `init` | initial channels of parts and of the node (default `{o: 1}` for parts) |
| `reveal(props)` | parts hidden at first and revealed one by one unless a cue shows them |
| `pickable(props)` | parts a learner can click in a `pick` question |
| `minWidth`, `natHeight` | the narrowest readable width and usual height in stage pixels (stage is 1600 × 900), used by the layout checks |
| `actions` | component actions (`step`, `hop`, `tilt`…): `doc`, Zod `args`, localizable `text` args, default `dur`, and `apply(ctx, args)` |
| `examples` | at least one: `title`, `props`, and optional `cues` targeting `x` (the example node) |

Generic actions (`show`, `hide`, `highlight`, `pulse`, `draw`, `dim`, `undim`, `color`…) work on every
node and part for free; only add actions that change something specific to your component.

The fraction circle, in `packages/lesson/src/components/more.ts`:

```ts
type FractionCircleProps = { parts: number; shaded: number; color?: z.infer<typeof ColorName>; label?: string };

export const fractioncircle: ComponentDef<FractionCircleProps> = {
  type: 'fractioncircle',
  pack: 'stem',
  doc: 'A circle cut into equal parts (a pie) to show a fraction: parts (denominator), shaded parts and an optional label (e.g. "$3/4$"). Action shade {to} animates how many parts are shaded. Parts: part:i (pickable).',
  props: z.object({
    parts: z.number().int().min(1).max(24),
    shaded: z.number().min(0),
    color: ColorName.optional(),
    label: Text.optional(),
  }),
  defaultSlot: 'main',
  text: ['label'],
  subs: (p) => range(p.parts, (i) => `part:${i}`),
  init: (p) => ({ sh: p.shaded }),
  pickable: (p) => range(p.parts, (i) => `part:${i}`),
  minWidth: () => 320,
  natHeight: (p) => (p.label ? 420 : 360),
  actions: {
    shade: {
      doc: 'Animate how many parts are shaded.',
      args: z.object({ to: z.number().min(0) }),
      dur: 0.9,
      apply(ctx, a) {
        ctx.tween('', 'sh', a.to as number, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: 'One quarter becomes three quarters',
      props: { parts: 4, shaded: 1, label: '$3/4$' },
      cues: [{ at: 1, do: 'shade', target: 'x', args: { to: 3 } }],
    },
  ],
};
```

Inside `apply`, the `ActionCtx` gives you:

- `ctx.tween(sub, channel, to, t0?, dur?, ease?, amp?)` — animate a channel of the node (`''`) or of a part;
- `ctx.get(sub, channel)` — the value at this point of the compile walk (actions see earlier actions);
- `ctx.addMark(id, data, channels)` and `ctx.markId(prefix)` — create a mark that exists for the rest of
  the beat (a hop on a number line, a fill on a grid), then animate it with `tween`;
- `ctx.error(message)` — report a problem; write the message so a model can fix its lesson
  ("bar 3 does not exist: this fractionbar has 2 bars (0–1)").

Then register the definition in `packages/lesson/src/components/registry.ts`: import it and add it to the
list passed to `registerComponent`. If you did not set `minWidth`/`natHeight` on the definition, add entries
to the `MIN_WIDTH` and `NAT_HEIGHT` tables there.

## 2. The view

A view factory receives a `ViewCtx` (`player/views/types.ts`): the `node` (with props already localized),
an SVG group `g` and an HTML `div` in stage coordinates, the `lang` and `dir`, `fmt(n)` to format numbers
for the book's digits, and `asset(path)`. It returns:

- `size(maxW, maxH)` — the natural size within a maximum;
- `place(box)` — lay out inside the box (once per beat);
- `update(get, t)` — apply channel values (every frame while playing, and on seek);
- `part(sub)` — the stage box of a part, for highlights and `pick` questions.

The fraction circle, in `packages/lesson/src/player/views/more.ts` (a sketch: compare with `fractionbar`
just above it for colours and labels):

```ts
const wedge = (cx: number, cy: number, r: number, a0: number, a1: number) =>
  `M${cx} ${cy}L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}` +
  `A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z`;

const fractioncircle: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const LABEL_H = p.label ? 60 : 0;
  const layer = svg('g', {}, ctx.g);
  let cx = 0;
  let cy = 0;
  let r = 0;
  const angle = (i: number) => (i / p.parts) * 2 * Math.PI - Math.PI / 2; // clockwise from the top
  return {
    size: (maxW, maxH) => {
      const d = Math.min(maxW, maxH - LABEL_H, 360);
      return { w: d, h: d + LABEL_H };
    },
    place(box) {
      r = Math.min(box.w, box.h - LABEL_H) / 2 - 4;
      cx = box.x + box.w / 2;
      cy = box.y + (box.h - LABEL_H) / 2;
    },
    update(get) {
      layer.replaceChildren();
      const shaded = clamp(num(get('', 'sh'), p.shaded), 0, p.parts);
      const c = color(p.color ?? 'sky');
      for (let i = 0; i < p.parts; i++) {
        const g = svg('g', {}, layer);
        svg('path', { d: wedge(cx, cy, r, angle(i), angle(i + 1)), fill: COLORS.board, stroke: COLORS.chalk, 'stroke-width': 2 }, g);
        const q = clamp(shaded - i, 0, 1); // the last shaded part fills progressively while animating
        if (q > 0) svg('path', { d: wedge(cx, cy, r, angle(i), angle(i) + (angle(i + 1) - angle(i)) * q), fill: mix(COLORS.board!, c, 0.65) }, g);
        applySvg(g, get, `part:${i}`, cx, cy); // generic channels: opacity, pulse, highlight
      }
      if (p.label) svgLabel(layer, p.label, { x: cx, y: cy + r + 48, size: 40, fill: c, dir: ctx.dir });
    },
    part(sub) {
      const i = Number(sub.split(':')[1]);
      if (!(i >= 0 && i < p.parts)) return null;
      const mid = (angle(i) + angle(i + 1)) / 2;
      const x = cx + (r / 2) * Math.cos(mid);
      const y = cy + (r / 2) * Math.sin(mid);
      return { x: x - r / 3, y: y - r / 3, w: (2 * r) / 3, h: (2 * r) / 3 };
    },
  };
};
```

Add it to the map the file exports (`MORE_VIEWS` here), which `VIEWS` in `packages/lesson/src/player/scene.ts`
spreads in. A new view file needs its own entry in `VIEWS`.

**Third-party packs** (outside this repository) can do the same at runtime with `registerComponent(def)`
from `@warqa/lesson` and `registerView(type, factory)` from `@warqa/lesson/player`.

## 3. Right to left

Arabic is a first-class language, so decide what your component means:

- **Position means order** (lists, timelines, flows, rows of counters, cards): follow the reading
  direction. In `rtl`, the first item is on the right.
- **Position means value** (number lines, coordinate planes, graphs, equations, fraction bars, pies):
  keep the mathematical orientation. A number line still grows to the right in Arabic.
- Never split Arabic text into letters (joining breaks); reveal whole words or elements.
- Put text in HTML (`ctx.div`) when it is long or must wrap; use `svgLabel` for short labels and pass
  `dir: ctx.dir`. Math (`$…$`) is always left to right.
- Use `ctx.fmt(n)` for numbers shown on screen, so books that use Arabic-Indic digits get them.

Write the choice in a comment, and check it visually in Arabic.

## 4. Tests and docs

```bash
pnpm --filter @warqa/lesson test   # the gallery test validates and compiles every example
pnpm docs:components               # regenerate docs/en/components.md (CI fails if it is stale)
pnpm lint
```

- `galleryLesson()` (`packages/lesson/src/core/gallery.ts`) turns every example into one beat; a broken
  example or action fails the test. Add more examples to cover each action.
- Add unit tests in `packages/lesson/src/core/core.test.ts` for anything subtle in `apply` (e.g. "shading
  more parts than exist is clamped", "an action on a missing part reports an error").
- Look at it: compile the gallery into a lesson and preview it, or add a beat with your component to a
  scratch book and run `pnpm warqa preview <book>`. Check Arabic, French and English, a narrow window,
  reduced motion, and keyboard selection in a `pick` question.

## 5. Make it easy for models

The `doc` string is part of every prompt that offers your component (see `packages/lesson/src/core/catalog.ts`),
and the Zod schema becomes JSON Schema for constrained decoding. So:

- say **when to use it** ("to compare fractions with the same whole"), not only what it is;
- list actions with their arguments and parts by name, exactly as the cues must write them;
- prefer a few clear props with defaults over many optional ones; small local models (tier C) must cope;
- keep prop names consistent with existing components (`label`, `color`, `items`, `steps`, `min`/`max`).

## Review checklist

- [ ] Definition and view registered; at least one example per action
- [ ] Props bounded; `doc` says when to use it, its actions and parts
- [ ] Learner-facing props listed in `text`; nothing hard-coded in English in the view
- [ ] Right-to-left behaviour decided, commented and checked in Arabic
- [ ] `minWidth`/`natHeight` realistic (QA reports nodes scaled below 80 %)
- [ ] `pnpm --filter @warqa/lesson test`, `pnpm docs:components`, `pnpm lint` pass
- [ ] Screenshots in the pull request (Arabic and one left-to-right language)
