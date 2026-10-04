// STEM components: equations with step morphs, number lines, counters, vertical scales, bar charts, coordinate planes.
// Portions derived from Papermorph (MIT): number-line hops, landing dots, tiles, thermometer and the token "collapse" idea.
import * as z from 'zod';
import { compileExpr } from '../core/expr.js';
import { texParts, texToTokens, UNSAFE_TEX } from '../core/tex.js';
import type { ActionCtx, ComponentDef } from '../core/types.js';
import { ColorName, Id, Size, Text } from '../schema/common.js';

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

/* ---------- equation ---------- */

export const Token = z.union([
  z.string().min(1).max(40),
  z.object({
    t: z.string().min(1).max(40).optional(),
    frac: z.tuple([z.string(), z.string()]).optional(),
    /** Superscript (exponent) and subscript, e.g. {"t": "x", "sup": "2"}. */
    sup: z.string().max(12).optional(),
    sub: z.string().max(12).optional(),
    id: Id.optional(),
    c: ColorName.optional(),
    note: Text.optional(),
  }),
]);
export type Token = z.infer<typeof Token>;

export interface TokenInfo {
  id: string;
  t: string;
  frac?: [string, string];
  sup?: string;
  sub?: string;
  c?: string;
  note?: string;
}

/** Normalize a step's tokens: default id = position, so tokens at the same position match across steps.
 * A step may also be written as a TeX-like string ("x^2 + 2x + 1", "\\frac{3}{4}"). */
export function tokenInfos(step: Token[] | string): TokenInfo[] {
  const toks: Token[] = typeof step === 'string' ? (texToTokens(step) as Token[]) : step;
  return toks.map((tok, i) => {
    if (typeof tok === 'string') return { id: String(i), t: tok };
    const info: TokenInfo = { id: tok.id ?? String(i), t: tok.t ?? (tok.frac ? `${tok.frac[0]}/${tok.frac[1]}` : '') };
    if (tok.frac) info.frac = tok.frac;
    if (tok.sup) info.sup = tok.sup;
    if (tok.sub) info.sub = tok.sub;
    if (tok.c) info.c = tok.c;
    if (tok.note) info.note = tok.note;
    return info;
  });
}

type EquationProps = { steps: (Token[] | string)[]; size: z.infer<typeof Size> };

export const equation: ComponentDef<EquationProps> = {
  type: 'equation',
  pack: 'stem',
  doc:
    'A row of math tokens that transforms step by step. steps is a list of token rows; tokens at the same position (or with the same id) match across steps: a changed token gets a box and morphs, removed tokens shrink away, new tokens fade in. ' +
    'Token: a string ("7", " − ", "(−3)") or {t, id, c (colour), note (small label under it), frac: ["3","4"], sup: "2" (exponent), sub: "n" (index)}. Action "step" moves to the next row (or {to: k}). Parts: tok:<id> (default id = position, e.g. tok:1), note:<id> (hidden until shown). ' +
    'A step may instead be a TeX-like string, split into tokens automatically: "x^2 + 2x + 1", "\\frac{3}{4} = 0.75", "a_n = 2n + 1", "\\sqrt{9} = 3" (use token arrays when you need colours, notes or ids). ' +
    'Use for rewriting an expression ("keep, change, change"), simplifying, or appending "= 4".',
  props: z.object({
    steps: z
      .array(z.union([z.string().min(1).max(200), z.array(Token).min(1).max(16)]))
      .min(1)
      .max(8),
    size: Size.default('lg'),
  }),
  defaultSlot: 'upper',
  text: ['steps.*.*.note'],
  subs: (p) => {
    const ids = new Set<string>();
    const notes = new Set<string>();
    for (const st of p.steps)
      for (const t of tokenInfos(st)) {
        ids.add(`tok:${t.id}`);
        if (t.note) notes.add(`note:${t.id}`);
      }
    return [...ids, ...notes];
  },
  initSub: (_p, s): Record<string, number> => (s.startsWith('note:') ? { o: 0 } : { o: 1, hl: 0 }),
  init: () => ({ step: 0 }),
  pickable: (p) => tokenInfos(p.steps[0]!).map((t) => `tok:${t.id}`),
  actions: {
    step: {
      doc: 'Morph to the next step (or {to: k}, 0-based). Takes about 1.4 s per step.',
      args: z.object({ to: z.number().int().min(0).optional() }),
      dur: 1.4,
      apply(ctx, args) {
        const p = ctx.node.props as EquationProps;
        const cur = Math.round(Number(ctx.get('', 'step') ?? 0));
        const to = (args.to as number | undefined) ?? cur + 1;
        if (to < 0 || to >= p.steps.length)
          return ctx.error(`equation ${ctx.node.id} has no step ${to} (it has ${p.steps.length})`);
        if (to === cur) return;
        ctx.tween('', 'step', to, ctx.t0, ctx.dur * Math.abs(to - cur), 'lin');
      },
    },
  },
  examples: [
    {
      title: 'Add the opposite',
      props: {
        steps: [
          ['7', ' − ', '3'],
          ['7', ' + ', '3'],
          ['7', ' + ', { t: '(−3)', c: 'coral' }],
          ['7', ' + ', { t: '(−3)', c: 'coral' }, ' = ', '4'],
        ],
      },
      cues: [
        { at: 0.5, do: 'step', target: 'x' },
        { at: 2.2, do: 'step', target: 'x' },
        { at: 4, do: 'step', target: 'x' },
      ],
    },
    {
      title: 'Steps written as TeX',
      props: {
        steps: [
          '\\frac{1}{2} + \\frac{1}{4}',
          '\\frac{2}{4} + \\frac{1}{4}',
          '\\frac{2}{4} + \\frac{1}{4} = \\frac{3}{4}',
        ],
      },
      cues: [
        { at: 1, do: 'step', target: 'x' },
        { at: 2.5, do: 'step', target: 'x' },
      ],
    },
    {
      title: 'Factor a perfect square',
      props: { steps: [[{ t: 'x', sup: '2' }, ' + ', '2x', ' + ', '1'], [{ t: '(x + 1)', sup: '2', c: 'mint' }]] },
      cues: [{ at: 1, do: 'step', target: 'x' }],
    },
  ],
};

/* ---------- number line ---------- */

type NumberLineProps = { min: number; max: number; step: number; labels: 'all' | 'ends' | 'none' };

const ticks = (p: NumberLineProps) => {
  const out: number[] = [];
  const n = Math.round((p.max - p.min) / p.step);
  for (let i = 0; i <= n; i++) out.push(+(p.min + i * p.step).toFixed(6));
  return out;
};

const mark = (
  ctx: ActionCtx,
  prefix: string,
  args: Record<string, unknown>,
  data: Record<string, unknown>,
  ch: Record<string, number>,
) => ctx.addMark((args.id as string | undefined) ?? ctx.markId(prefix), data, ch);

export const numberline: ComponentDef<NumberLineProps> = {
  type: 'numberline',
  pack: 'stem',
  doc:
    'A horizontal number line from min to max (≤ 40 ticks; stays left-to-right in every language). Actions: dot {at, color?, label?} lands a dot; hop {from, to, level? 1–3, color?, label?} draws an arrow above the line (default colour sky for right, coral for left, label "+n"/"−n"); arc {from, to, color?} a curved arc (e.g. mirror images); vline {at, label?, color?} a vertical marker. ' +
    'Parts: tick:<value> (pickable), and each mark by its id (pass id to name it, e.g. "h1").',
  props: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(1),
    labels: z.enum(['all', 'ends', 'none']).default('all'),
  }),
  defaultSlot: 'lower',
  text: [],
  subs: (p) => ticks(p).map((v) => `tick:${v}`),
  init: () => ({ d: 0 }),
  pickable: (p) => ticks(p).map((v) => `tick:${v}`),
  actions: {
    dot: {
      doc: 'Land a dot on a value.',
      args: z.object({ at: z.number(), color: ColorName.optional(), label: Text.optional(), id: Id.optional() }),
      text: ['label'],
      dur: 0.45,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'dot',
          a,
          { kind: 'dot', at: a.at, color: a.color ?? 'chalk', label: a.label },
          { o: 0, s: 0 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur, 'out');
        ctx.tween(s, 's', 1, ctx.t0, ctx.dur, 'back');
      },
    },
    hop: {
      doc: 'Draw an arrow from one value to another above the line.',
      args: z.object({
        from: z.number(),
        to: z.number(),
        level: z.number().int().min(1).max(3).default(1),
        color: ColorName.optional(),
        label: Text.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      apply(ctx, a) {
        const from = a.from as number;
        const to = a.to as number;
        const s = mark(
          ctx,
          'hop',
          a,
          {
            kind: 'hop',
            from,
            to,
            level: a.level ?? 1,
            color: a.color ?? (to >= from ? 'sky' : 'coral'),
            label: a.label,
          },
          { d: 0 },
        );
        ctx.tween(s, 'd', 1, ctx.t0, Math.max(ctx.dur, 0.35 + Math.abs(to - from) * 0.09), 'lin');
      },
    },
    arc: {
      doc: 'A curved arc between two values.',
      args: z.object({ from: z.number(), to: z.number(), color: ColorName.optional(), id: Id.optional() }),
      dur: 0.8,
      apply(ctx, a) {
        const s = mark(ctx, 'arc', a, { kind: 'arc', from: a.from, to: a.to, color: a.color ?? 'dim' }, { d: 0 });
        ctx.tween(s, 'd', 1, ctx.t0, ctx.dur);
      },
    },
    vline: {
      doc: 'A vertical line at a value with an optional label (e.g. "mirror at 0").',
      args: z.object({ at: z.number(), label: Text.optional(), color: ColorName.optional(), id: Id.optional() }),
      text: ['label'],
      dur: 0.7,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'vline',
          a,
          { kind: 'vline', at: a.at, label: a.label, color: a.color ?? 'task' },
          { d: 0 },
        );
        ctx.tween(s, 'd', 1, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: '7 − 3 as hops',
      props: { min: -8, max: 8 },
      cues: [
        { at: 0.5, do: 'hop', target: 'x', args: { from: 0, to: 7 } },
        { at: 1.6, do: 'hop', target: 'x', args: { from: 7, to: 4, level: 2 } },
        { at: 2.6, do: 'dot', target: 'x', args: { at: 4 } },
      ],
    },
  ],
};

/* ---------- counters (signed tiles, objects to count) ---------- */

type CountersProps = {
  count: number;
  kind: 'pos' | 'neg' | 'plain';
  color?: z.infer<typeof ColorName>;
  symbol?: string;
  perRow: number;
};

export const counters: ComponentDef<CountersProps> = {
  type: 'counters',
  pack: 'stem',
  doc: 'A row of identical tiles or counters to count, add or take away (kind pos = "+" tiles in sky, neg = "−" tiles in coral, plain = dots). Action remove {count, from: "end"|"start"} takes some away. Parts: item:i.',
  props: z.object({
    count: z.number().int().min(1).max(40),
    kind: z.enum(['pos', 'neg', 'plain']).default('plain'),
    color: ColorName.optional(),
    symbol: z.string().max(3).optional(),
    perRow: z.number().int().min(1).max(20).default(10),
  }),
  defaultSlot: 'main',
  text: [],
  subs: (p) => range(p.count, (i) => `item:${i}`),
  initSub: () => ({ o: 1, gone: 0 }),
  pickable: (p) => range(p.count, (i) => `item:${i}`),
  actions: {
    remove: {
      doc: 'Take counters away (they float up and fade).',
      args: z.object({ count: z.number().int().min(1), from: z.enum(['end', 'start']).default('end') }),
      dur: 0.7,
      apply(ctx, a) {
        const p = ctx.node.props as CountersProps;
        const n = Math.min(a.count as number, p.count);
        const idx = range(p.count, (i) => `item:${i}`).filter((s) => Number(ctx.get(s, 'gone') ?? 0) < 1);
        const pick = (a.from ?? 'end') === 'end' ? idx.slice(-n).reverse() : idx.slice(0, n);
        pick.forEach((s, i) => ctx.tween(s, 'gone', 1, ctx.t0 + i * 0.12, ctx.dur));
      },
    },
  },
  examples: [
    {
      title: 'Seven minus tiles, take six away',
      props: { count: 7, kind: 'neg' },
      cues: [{ at: 1, do: 'remove', target: 'x', args: { count: 6 } }],
    },
  ],
};

/* ---------- vertical scale (axis or thermometer) ---------- */

type VScaleProps = {
  min: number;
  max: number;
  step: number;
  unit?: string;
  style: 'axis' | 'thermometer';
  value?: number;
  color?: z.infer<typeof ColorName>;
  zones: { from: number; to: number; color: z.infer<typeof ColorName>; label?: string }[];
};

export const vscale: ComponentDef<VScaleProps> = {
  type: 'vscale',
  pack: 'stem',
  doc: 'A vertical scale: a plain axis (heights, depths, sea level) or a thermometer with a level. zones shade ranges (e.g. under water). Actions: set {value} moves the thermometer level; marker {at, label?, color?} places a labelled point; brace {from, to, label?, color?} shows a distance. Parts: zone:i and marks by id.',
  props: z.object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    unit: z.string().max(8).optional(),
    style: z.enum(['axis', 'thermometer']).default('axis'),
    value: z.number().optional(),
    color: ColorName.optional(),
    zones: z
      .array(z.object({ from: z.number(), to: z.number(), color: ColorName, label: Text.optional() }))
      .max(4)
      .default([]),
  }),
  defaultSlot: 'start',
  text: ['zones.*.label', 'unit'],
  subs: (p) => range(p.zones.length, (i) => `zone:${i}`),
  init: (p) => ({ v: p.value ?? p.min, d: 0 }),
  actions: {
    set: {
      doc: 'Move the thermometer level to a value.',
      args: z.object({ value: z.number() }),
      dur: 2,
      apply(ctx, a) {
        ctx.tween('', 'v', a.value as number, ctx.t0, ctx.dur);
      },
    },
    marker: {
      doc: 'A labelled point on the scale.',
      args: z.object({ at: z.number(), label: Text.optional(), color: ColorName.optional(), id: Id.optional() }),
      text: ['label'],
      dur: 0.45,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'marker',
          a,
          { kind: 'marker', at: a.at, label: a.label, color: a.color ?? 'chalk' },
          { o: 0, s: 0.6 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur);
        ctx.tween(s, 's', 1, ctx.t0, ctx.dur, 'back');
      },
    },
    brace: {
      doc: 'A bracket beside the scale from one value to another, with a label (a distance or difference).',
      args: z.object({
        from: z.number(),
        to: z.number(),
        label: Text.optional(),
        color: ColorName.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      dur: 0.8,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'brace',
          a,
          { kind: 'brace', from: a.from, to: a.to, label: a.label, color: a.color ?? 'task' },
          { d: 0 },
        );
        ctx.tween(s, 'd', 1, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: 'Falling temperature',
      props: { min: -10, max: 10, step: 5, unit: '°', style: 'thermometer', value: 5, color: 'coral' },
      cues: [{ at: 1, do: 'set', target: 'x', args: { value: -7 } }],
    },
  ],
};

/* ---------- bar chart ---------- */

type BarProps = {
  bars: { label: string; value: number; color?: z.infer<typeof ColorName> }[];
  unit?: string;
  max?: number;
};

export const barchart: ComponentDef<BarProps> = {
  type: 'barchart',
  pack: 'stem',
  doc: 'A bar chart of 2–10 labelled values (bars grow in order unless cued; a cue "draw" on bar:i grows one). Parts: bar:i (pickable).',
  props: z.object({
    bars: z
      .array(z.object({ label: Text, value: z.number(), color: ColorName.optional() }))
      .min(1)
      .max(10),
    unit: z.string().max(12).optional(),
    max: z.number().optional(),
  }),
  defaultSlot: 'main',
  text: ['bars.*.label', 'unit'],
  subs: (p) => range(p.bars.length, (i) => `bar:${i}`),
  initSub: () => ({ o: 1, d: 0, hl: 0 }),
  reveal: (p) => range(p.bars.length, (i) => `bar:${i}`),
  pickable: (p) => range(p.bars.length, (i) => `bar:${i}`),
  examples: [
    {
      title: 'Rainfall',
      props: {
        bars: [
          { label: 'Rabat', value: 560 },
          { label: 'Ifrane', value: 1100 },
        ],
        unit: 'mm',
      },
    },
  ],
};

/* ---------- coordinate plane ---------- */

type PlaneProps = { x: [number, number]; y: [number, number]; step: number; grid: boolean; labels: boolean };

export const plane: ComponentDef<PlaneProps> = {
  type: 'plane',
  pack: 'stem',
  doc: 'A coordinate plane (axes keep their mathematical orientation in every language). Actions: point {x, y, label?, color?}; plot {fn, color?, label?} draws y = fn(x) (fn uses x, + − * / ^, sqrt, abs, sin, cos, tan, log, ln, exp, pi; e.g. "2*x - 1"); line {from: [x,y], to: [x,y], extend?} a line or segment. Parts: marks by id; pick questions use pt:x,y.',
  props: z.object({
    x: z.tuple([z.number(), z.number()]).default([-6, 6]),
    y: z.tuple([z.number(), z.number()]).default([-6, 6]),
    step: z.number().positive().default(1),
    grid: z.boolean().default(true),
    labels: z.boolean().default(true),
  }),
  defaultSlot: 'start',
  text: [],
  subs: () => [],
  init: () => ({ d: 0 }),
  actions: {
    point: {
      doc: 'Plot a point.',
      args: z.object({
        x: z.number(),
        y: z.number(),
        label: Text.optional(),
        color: ColorName.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      dur: 0.45,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'pt',
          a,
          { kind: 'point', x: a.x, y: a.y, label: a.label, color: a.color ?? 'task' },
          { o: 0, s: 0 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur);
        ctx.tween(s, 's', 1, ctx.t0, ctx.dur, 'back');
      },
    },
    plot: {
      doc: 'Draw the graph of y = fn(x).',
      args: z.object({
        fn: z.string().min(1).max(120),
        color: ColorName.optional(),
        label: Text.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      dur: 1.4,
      apply(ctx, a) {
        try {
          compileExpr(a.fn as string, ['x']);
        } catch (e) {
          return ctx.error(`plot: ${(e as Error).message}`);
        }
        const s = mark(ctx, 'plot', a, { kind: 'plot', fn: a.fn, color: a.color ?? 'sky', label: a.label }, { d: 0 });
        ctx.tween(s, 'd', 1, ctx.t0, ctx.dur, 'lin');
      },
    },
    line: {
      doc: 'A segment between two points (extend: true draws the whole line).',
      args: z.object({
        from: z.tuple([z.number(), z.number()]),
        to: z.tuple([z.number(), z.number()]),
        extend: z.boolean().default(false),
        color: ColorName.optional(),
        id: Id.optional(),
      }),
      dur: 0.9,
      apply(ctx, a) {
        const s = mark(
          ctx,
          'line',
          a,
          { kind: 'line', from: a.from, to: a.to, extend: a.extend ?? false, color: a.color ?? 'mint' },
          { d: 0 },
        );
        ctx.tween(s, 'd', 1, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: 'A line through two points',
      props: { x: [-5, 5], y: [-5, 5] },
      cues: [
        { at: 0.5, do: 'point', target: 'x', args: { x: 0, y: -1, label: 'A' } },
        { at: 1, do: 'point', target: 'x', args: { x: 2, y: 3, label: 'B' } },
        { at: 1.6, do: 'plot', target: 'x', args: { fn: '2*x - 1' } },
      ],
    },
  ],
};

type MathProps = {
  steps: string[];
  mode: 'replace' | 'stack';
  size: z.infer<typeof Size>;
  color?: z.infer<typeof ColorName>;
};

const mathPartSubs = (p: MathProps) => [...new Set(p.steps.flatMap(texParts))].map((n) => `part:${n}`);

export const math: ComponentDef<MathProps> = {
  type: 'math',
  pack: 'stem',
  doc: 'Display math typeset from TeX (MathJax): nested fractions, roots, matrices, sums, integrals, aligned derivations — anything the token-based "equation" cannot show. steps: TeX strings (write \\frac, \\sqrt, \\begin{pmatrix}…). mode "replace" (default) shows one step at a time and cross-fades to the next with action "step"; mode "stack" is a derivation: lines appear one under the other, aligned on "=", with action "step" (or show line:i). Mark parts to point at with \\part{name}{…}, e.g. "\\part{num}{x+1} \\over 2", then highlight "m#part:num". Parts: line:i (stack mode), part:<name>. Prefer "equation" for simple one-line arithmetic that should morph token by token.',
  props: z.object({
    steps: z.array(z.string().min(1).max(600)).min(1).max(10),
    mode: z.enum(['replace', 'stack']).default('replace'),
    size: Size.default('lg'),
    color: ColorName.optional(),
  }),
  defaultSlot: 'main',
  text: [],
  subs: (p) => [...(p.mode === 'stack' ? range(p.steps.length, (i) => `line:${i}`) : []), ...mathPartSubs(p)],
  initSub: (_p, s): Record<string, number> => (s.startsWith('line:') ? { o: 0 } : { o: 1, hl: 0 }),
  // a derivation starts with its first line; "step" (or show line:i) adds the next ones
  reveal: (p) => (p.mode === 'stack' ? ['line:0'] : []),
  init: () => ({ step: 0 }),
  pickable: (p) => mathPartSubs(p),
  minWidth: () => 300,
  natHeight: (p) => (p.mode === 'stack' ? 90 * p.steps.length : 160),
  actions: {
    step: {
      doc: 'Next step: cross-fade to the next formula (replace mode) or show the next line (stack mode). {to: k} jumps.',
      args: z.object({ to: z.number().int().min(0).optional() }),
      dur: 0.9,
      apply(ctx, args) {
        const p = ctx.node.props as MathProps;
        if (p.mode === 'stack') {
          const next =
            (args.to as number | undefined) ??
            Array.from({ length: p.steps.length }, (_, i) => i).find(
              (i) => Number(ctx.get(`line:${i}`, 'o') ?? 0) < 0.5,
            );
          if (next === undefined || next >= p.steps.length)
            return ctx.error(`math ${ctx.node.id} has no more lines to show`);
          for (let i = 0; i <= next; i++)
            if (Number(ctx.get(`line:${i}`, 'o') ?? 0) < 0.5) ctx.tween(`line:${i}`, 'o', 1, ctx.t0, ctx.dur);
          return;
        }
        const cur = Math.round(Number(ctx.get('', 'step') ?? 0));
        const to = (args.to as number | undefined) ?? cur + 1;
        if (to < 0 || to >= p.steps.length)
          return ctx.error(`math ${ctx.node.id} has no step ${to} (it has ${p.steps.length})`);
        if (to !== cur) ctx.tween('', 'step', to, ctx.t0, ctx.dur, 'io');
      },
    },
  },
  examples: [
    {
      title: 'A fraction that simplifies',
      props: { steps: ['\\frac{\\part{num}{2x + 4}}{2}', '\\frac{2(x + 2)}{2}', 'x + 2'] },
      cues: [
        { at: 0.8, do: 'highlight', target: 'x#part:num' },
        { at: 1.6, do: 'step', target: 'x' },
        { at: 3, do: 'step', target: 'x' },
      ],
    },
    {
      title: 'Solving step by step (stack)',
      props: { mode: 'stack', steps: ['3x + 5 = 20', '3x = 15', 'x = 5'] },
      cues: [
        { at: 1, do: 'step', target: 'x' },
        { at: 2.5, do: 'step', target: 'x' },
      ],
    },
    {
      title: 'Matrices and roots',
      props: {
        steps: [
          '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\begin{pmatrix} 5 \\\\ 6 \\end{pmatrix}',
          'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
        ],
      },
      cues: [{ at: 1.5, do: 'step', target: 'x' }],
    },
  ],
};

/** Reject TeX the typesetter must not see (used by the validator). */
export const unsafeMath = (p: { steps: string[] }): string | undefined => p.steps.find((s) => UNSAFE_TEX.test(s));
