// More components: fraction bars, area grids, a balance scale (STEM) and picture-book pages (kids).
// Portions derived from Papermorph (MIT): the balance scale and area-grid ideas.
import * as z from 'zod';
import type { ComponentDef } from '../core/types.js';
import { ColorName, Id, Text } from '../schema/common.js';

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

type FractionProps = { bars: { parts: number; shaded: number; color?: z.infer<typeof ColorName>; label?: string }[] };

export const fractionbar: ComponentDef<FractionProps> = {
  type: 'fractionbar',
  pack: 'stem',
  doc: 'One to four fraction bars stacked to compare fractions: each bar has parts (denominator), shaded parts and an optional label (e.g. "$3/4$"). Actions: shade {bar, to} animates the shaded amount; split {bar, parts} cuts the bar into more parts (equivalent fractions). Parts: bar:i (pickable).',
  props: z.object({
    bars: z
      .array(
        z.object({
          parts: z.number().int().min(1).max(24),
          shaded: z.number().min(0),
          color: ColorName.optional(),
          label: Text.optional(),
        }),
      )
      .min(1)
      .max(4),
  }),
  defaultSlot: 'main',
  text: ['bars.*.label'],
  subs: (p) => range(p.bars.length, (i) => `bar:${i}`),
  init: (p) =>
    Object.fromEntries(
      p.bars.flatMap((b, i) => [
        [`sh${i}`, b.shaded],
        [`pt${i}`, b.parts],
      ]),
    ),
  pickable: (p) => range(p.bars.length, (i) => `bar:${i}`),
  actions: {
    shade: {
      doc: 'Animate how many parts of a bar are shaded.',
      args: z.object({ bar: z.number().int().min(0).default(0), to: z.number().min(0) }),
      dur: 0.9,
      apply(ctx, a) {
        ctx.tween('', `sh${a.bar}`, a.to as number, ctx.t0, ctx.dur);
      },
    },
    split: {
      doc: 'Cut a bar into a new number of equal parts (the shaded amount keeps its size).',
      args: z.object({ bar: z.number().int().min(0).default(0), parts: z.number().int().min(1).max(48) }),
      dur: 0.6,
      apply(ctx, a) {
        const b = a.bar as number;
        const oldParts = Number(ctx.get('', `pt${b}`) ?? 1);
        const oldShade = Number(ctx.get('', `sh${b}`) ?? 0);
        ctx.tween('', `pt${b}`, a.parts as number, ctx.t0, 0);
        ctx.tween('', `sh${b}`, (oldShade * (a.parts as number)) / oldParts, ctx.t0, 0);
      },
    },
  },
  examples: [
    {
      title: '1/2 = 2/4',
      props: {
        bars: [
          { parts: 2, shaded: 1, label: '$1/2$' },
          { parts: 4, shaded: 2, label: '$2/4$', color: 'coral' },
        ],
      },
      cues: [{ at: 1, do: 'split', target: 'x', args: { bar: 0, parts: 4 } }],
    },
  ],
};

type AreaProps = {
  rows: number;
  cols: number;
  unit: number;
  rowLabels: string[];
  colLabels: string[];
  caption?: string;
};

export const areagrid: ComponentDef<AreaProps> = {
  type: 'areagrid',
  pack: 'stem',
  doc: 'A grid of unit squares (area model): rows × cols, with optional labels along the edges (e.g. "x", "3"). Action fill {r0, c0, r1, c1, color, label?} shades a block of cells (inclusive, 0-based). Parts: cell:r:c (pickable) and fills by id.',
  props: z.object({
    rows: z.number().int().min(1).max(20),
    cols: z.number().int().min(1).max(30),
    unit: z.number().min(16).max(90).default(46),
    rowLabels: z.array(z.string().max(12)).default([]),
    colLabels: z.array(z.string().max(12)).default([]),
    caption: Text.optional(),
  }),
  defaultSlot: 'main',
  text: ['caption'],
  subs: (p) => Array.from({ length: p.rows }, (_, r) => range(p.cols, (c) => `cell:${r}:${c}`)).flat(),
  initSub: () => ({ o: 1, hl: 0 }),
  init: () => ({ d: 0 }),
  pickable: (p) => Array.from({ length: p.rows }, (_, r) => range(p.cols, (c) => `cell:${r}:${c}`)).flat(),
  actions: {
    fill: {
      doc: 'Shade a rectangular block of cells.',
      args: z.object({
        r0: z.number().int().min(0),
        c0: z.number().int().min(0),
        r1: z.number().int().min(0),
        c1: z.number().int().min(0),
        color: ColorName.optional(),
        label: Text.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      dur: 0.6,
      apply(ctx, a) {
        const s = ctx.addMark(
          (a.id as string | undefined) ?? ctx.markId('fill'),
          { kind: 'fill', ...a, color: a.color ?? 'sky' },
          { o: 0 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: '3 × 4',
      props: { rows: 3, cols: 4, rowLabels: ['3'], colLabels: ['4'] },
      cues: [{ at: 1, do: 'fill', target: 'x', args: { r0: 0, c0: 0, r1: 2, c1: 3, label: '12' } }],
    },
  ],
};

type BalanceProps = { left: string[]; right: string[]; tilt: number };

export const balance: ComponentDef<BalanceProps> = {
  type: 'balance',
  pack: 'stem',
  doc: 'A balance scale for equations: items (short math, e.g. "$x + 2$", "$6$") on the left and right pans. Actions: tilt {to: −20…20} (positive = left side down), put {side: "left"|"right", text, color?}, take {side, index}. Use it to show that both sides stay equal. Parts: left:i, right:i.',
  props: z.object({
    left: z.array(z.string().max(30)).max(6).default([]),
    right: z.array(z.string().max(30)).max(6).default([]),
    tilt: z.number().min(-25).max(25).default(0),
  }),
  defaultSlot: 'main',
  text: [],
  subs: (p) => [...range(p.left.length, (i) => `left:${i}`), ...range(p.right.length, (i) => `right:${i}`)],
  initSub: () => ({ o: 1, hl: 0, gone: 0 }),
  init: (p) => ({ tilt: p.tilt }),
  actions: {
    tilt: {
      doc: 'Tilt the beam (degrees; positive = left pan down, 0 = level).',
      args: z.object({ to: z.number().min(-25).max(25) }),
      dur: 0.9,
      apply(ctx, a) {
        ctx.tween('', 'tilt', a.to as number, ctx.t0, ctx.dur, 'back');
      },
    },
    put: {
      doc: 'Put an item on a pan.',
      args: z.object({
        side: z.enum(['left', 'right']),
        text: z.string().max(30),
        color: ColorName.optional(),
        id: Id.optional(),
      }),
      dur: 0.5,
      apply(ctx, a) {
        const s = ctx.addMark(
          (a.id as string | undefined) ?? ctx.markId(`put${a.side}`),
          { kind: 'item', side: a.side, text: a.text, color: a.color ?? 'chalk' },
          { o: 0, s: 0.6 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur);
        ctx.tween(s, 's', 1, ctx.t0, ctx.dur, 'back');
      },
    },
    take: {
      doc: 'Take an item off a pan (index among the original items).',
      args: z.object({ side: z.enum(['left', 'right']), index: z.number().int().min(0) }),
      dur: 0.6,
      apply(ctx, a) {
        ctx.tween(`${a.side}:${a.index}`, 'gone', 1, ctx.t0, ctx.dur);
      },
    },
  },
  examples: [
    {
      title: 'x + 2 = 6',
      props: { left: ['$x + 2$'], right: ['$6$'], tilt: 0 },
      cues: [{ at: 1, do: 'take', target: 'x', args: { side: 'left', index: 0 } }],
    },
  ],
};

type StoryProps = {
  image?: string;
  prompt?: string;
  alt: string;
  text?: string;
  layout: 'start' | 'end' | 'top' | 'full';
  readAlong: boolean;
};

export const storypage: ComponentDef<StoryProps> = {
  type: 'storypage',
  pack: 'kids',
  doc: "A picture-book page: an illustration and the page text. The sentence being read is highlighted (read-along). image: a path in the book (assets/…); or prompt: a description to generate the illustration (with the book's illustration style). text defaults to the narration. layout: start / end (picture beside the text), top, full (picture behind, text in a band).",
  props: z.object({
    image: z.string().optional(),
    prompt: z.string().max(800).optional(),
    alt: Text,
    text: Text.optional(),
    layout: z.enum(['start', 'end', 'top', 'full']).default('start'),
    readAlong: z.boolean().default(true),
  }),
  defaultSlot: 'full',
  text: ['alt', 'text'],
  subs: () => ['picture', 'text'],
  examples: [
    {
      title: 'A page',
      props: {
        prompt: 'A small fox reading under an argan tree, warm watercolor',
        alt: 'A fox reading under a tree',
        layout: 'start',
      },
    },
  ],
};
