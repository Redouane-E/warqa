// Generic components: title cards, text, lists, definitions, callouts, comparisons, tables, flows, key figures, images.
import * as z from 'zod';
import type { ComponentDef } from '../core/types.js';
import { ColorName, Size, Text } from '../schema/common.js';

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

export const title: ComponentDef<{ kicker?: string; title: string; subtitle?: string; lines: string[] }> = {
  type: 'title',
  pack: 'core',
  doc: 'Title card that opens a lesson: optional kicker ("Unit 2, Chapter 5"), the title, an optional subtitle and up to 4 short lines (often the key example, e.g. "$7 − 3 = 4$"). Parts: kicker, title, subtitle, line:0…; lines appear one by one unless cued.',
  props: z.object({
    kicker: Text.optional(),
    title: Text,
    subtitle: Text.optional(),
    lines: z.array(Text).max(4).default([]),
  }),
  defaultSlot: 'full',
  text: ['kicker', 'title', 'subtitle', 'lines.*'],
  subs: (p) => ['kicker', 'title', 'subtitle', ...range(p.lines.length, (i) => `line:${i}`)],
  initSub: (_p, s) => (s.startsWith('line:') ? { o: 0, s: 1 } : { o: 1, s: 1 }),
  reveal: (p) => range(p.lines.length, (i) => `line:${i}`),
  examples: [
    {
      title: 'Chapter opener with a key example',
      props: { kicker: 'Unit 2, Chapter 5', title: 'Subtracting integers', lines: ['$7 − 3 = 4$', '$7 + (−3) = 4$'] },
      cues: [{ at: 1.5, do: 'pulse', target: 'x#line:1' }],
    },
  ],
};

export const text: ComponentDef<{
  text: string;
  tone: z.infer<typeof ColorName>;
  size: z.infer<typeof Size>;
  weight: 'normal' | 'bold';
  align: 'center' | 'start';
}> = {
  type: 'text',
  pack: 'core',
  doc: 'One short line or paragraph of on-screen text: a caption, a rule, a key sentence. Wraps to its slot. Use $…$ for inline math. Keep it short; the narration carries the explanation.',
  props: z.object({
    text: Text,
    tone: ColorName.default('chalk'),
    size: Size.default('md'),
    weight: z.enum(['normal', 'bold']).default('bold'),
    align: z.enum(['center', 'start']).default('center'),
  }),
  defaultSlot: 'title',
  text: ['text'],
  subs: () => [],
  examples: [
    { title: 'Rule caption', props: { text: 'Subtracting a number = adding its opposite', tone: 'chalk', size: 'lg' } },
  ],
};

export const list: ComponentDef<{ items: { text: string; sub?: string }[]; style: 'numbered' | 'bullets' | 'plain' }> =
  {
    type: 'list',
    pack: 'core',
    doc: 'A list of 2–6 short items, e.g. the chapter summary (numbered takeaways) or steps. Each item may have a second line `sub` (an example, often math). Parts: item:0…; items appear one by one unless cued (cue "show" on item:i at the matching mark).',
    props: z.object({
      items: z
        .array(z.object({ text: Text, sub: Text.optional() }))
        .min(1)
        .max(8),
      style: z.enum(['numbered', 'bullets', 'plain']).default('numbered'),
    }),
    defaultSlot: 'main',
    text: ['items.*.text', 'items.*.sub'],
    subs: (p) => range(p.items.length, (i) => `item:${i}`),
    initSub: () => ({ o: 0 }),
    reveal: (p) => range(p.items.length, (i) => `item:${i}`),
    examples: [
      {
        title: 'Summary',
        props: {
          items: [
            { text: 'To subtract, add the opposite.', sub: '$a − b = a + (−b)$' },
            { text: 'Subtracting a positive number moves you left.', sub: '$2 − 5 = −3$' },
          ],
        },
      },
    ],
  };

export const definition: ComponentDef<{ term: string; text: string; example?: string }> = {
  type: 'definition',
  pack: 'core',
  doc: 'A definition card: the term, its definition and an optional example. Parts: term, text, example.',
  props: z.object({ term: Text, text: Text, example: Text.optional() }),
  defaultSlot: 'main',
  text: ['term', 'text', 'example'],
  subs: (p) => ['term', 'text', ...(p.example ? ['example'] : [])],
  initSub: (_p, s) => (s === 'example' ? { o: 0 } : { o: 1 }),
  reveal: (p) => (p.example ? ['example'] : []),
  examples: [
    {
      title: 'Additive inverse',
      props: { term: 'Additive inverse', text: 'The number you add to get 0.', example: '$3 + (−3) = 0$' },
    },
  ],
};

export const callout: ComponentDef<{
  text: string;
  title?: string;
  tone: 'info' | 'tip' | 'warn' | 'mistake' | 'good';
}> = {
  type: 'callout',
  pack: 'core',
  doc: 'A boxed note with a tone: info, tip, warn, mistake (a common error, shown crossed) or good. Use "mistake" to show the common mistake before the right way.',
  props: z.object({
    text: Text,
    title: Text.optional(),
    tone: z.enum(['info', 'tip', 'warn', 'mistake', 'good']).default('info'),
  }),
  defaultSlot: 'band',
  text: ['text', 'title'],
  subs: () => [],
  examples: [
    { title: 'Common mistake', props: { tone: 'mistake', title: 'Careful', text: '$5 − (−3)$ is not $5 − 3$.' } },
  ],
};

const Side = z.object({
  title: Text,
  items: z.array(Text).min(1).max(6),
  tone: z.enum(['neutral', 'good', 'bad']).default('neutral'),
});
export const compare: ComponentDef<{ left: z.infer<typeof Side>; right: z.infer<typeof Side> }> = {
  type: 'compare',
  pack: 'core',
  doc: 'Two columns side by side to contrast ideas (before/after, wrong/right, two cases). Each side: title, 1–6 short items, tone (neutral, good, bad). Parts: a (first column), b (second), a:i, b:i. Column b appears after a unless cued. "first" is the reading-start side (right in Arabic).',
  props: z.object({ left: Side, right: Side }),
  defaultSlot: 'main',
  text: ['left.title', 'left.items.*', 'right.title', 'right.items.*'],
  subs: (p) => [
    'a',
    'b',
    ...range(p.left.items.length, (i) => `a:${i}`),
    ...range(p.right.items.length, (i) => `b:${i}`),
  ],
  initSub: (_p, s) => (s === 'b' ? { o: 0 } : { o: 1 }),
  reveal: () => ['b'],
  examples: [
    {
      title: 'Wrong vs right',
      props: {
        left: { title: 'Wrong', items: ['$5 − (−3) = 2$'], tone: 'bad' },
        right: { title: 'Right', items: ['$5 − (−3) = 5 + 3 = 8$'], tone: 'good' },
      },
    },
  ],
};

export const table: ComponentDef<{ columns: string[]; rows: string[][]; caption?: string }> = {
  type: 'table',
  pack: 'core',
  doc: 'A small table (≤ 6 columns, ≤ 8 rows) of short cells. Parts: row:i, col:j, cell:i:j (0-based, rows exclude the header) — highlight a row or cell as the narration mentions it.',
  props: z.object({
    columns: z.array(Text).min(1).max(6),
    rows: z
      .array(z.array(z.string().max(200)))
      .min(1)
      .max(8),
    caption: Text.optional(),
  }),
  defaultSlot: 'main',
  text: ['columns.*', 'rows.*.*', 'caption'],
  subs: (p) => [
    ...range(p.rows.length, (i) => `row:${i}`),
    ...range(p.columns.length, (j) => `col:${j}`),
    ...p.rows.flatMap((r, i) => r.map((_, j) => `cell:${i}:${j}`)),
  ],
  pickable: (p) => p.rows.flatMap((r, i) => r.map((_, j) => `cell:${i}:${j}`)),
  examples: [
    {
      title: 'Prices',
      props: {
        columns: ['Item', 'Price'],
        rows: [
          ['Pen', '3 MAD'],
          ['Notebook', '12 MAD'],
        ],
      },
    },
  ],
};

export const flow: ComponentDef<{ steps: string[]; direction: 'row' | 'column'; cycle: boolean }> = {
  type: 'flow',
  pack: 'core',
  doc: 'A process: 2–6 short steps joined by arrows (row follows reading direction; column goes down). cycle: true joins the last step back to the first. Parts: step:i, arrow:i; steps appear in order unless cued.',
  props: z.object({
    steps: z.array(Text).min(2).max(6),
    direction: z.enum(['row', 'column']).default('row'),
    cycle: z.boolean().default(false),
  }),
  defaultSlot: 'main',
  text: ['steps.*'],
  subs: (p) => [
    ...range(p.steps.length, (i) => `step:${i}`),
    ...range(p.steps.length - (p.cycle ? 0 : 1), (i) => `arrow:${i}`),
  ],
  initSub: () => ({ o: 0 }),
  reveal: (p) =>
    Array.from({ length: p.steps.length }, (_, i) => [
      `step:${i}`,
      ...(i < p.steps.length - 1 || p.cycle ? [`arrow:${i}`] : []),
    ]).flat(),
  pickable: (p) => range(p.steps.length, (i) => `step:${i}`),
  examples: [
    {
      title: 'Water cycle',
      props: { steps: ['Evaporation', 'Condensation', 'Precipitation', 'Collection'], cycle: true },
    },
  ],
};

export const keyfigures: ComponentDef<{ items: { value: string; label: string; tone?: z.infer<typeof ColorName> }[] }> =
  {
    type: 'keyfigures',
    pack: 'document',
    doc: 'Two to four big numbers with labels ("37 %" – "of students…"), for reports and papers. Parts: item:i, revealed in order unless cued.',
    props: z.object({
      items: z
        .array(z.object({ value: z.string().min(1).max(16), label: Text, tone: ColorName.optional() }))
        .min(1)
        .max(4),
    }),
    defaultSlot: 'main',
    text: ['items.*.label', 'items.*.value'],
    subs: (p) => range(p.items.length, (i) => `item:${i}`),
    initSub: () => ({ o: 0, s: 1 }),
    reveal: (p) => range(p.items.length, (i) => `item:${i}`),
    examples: [
      {
        title: 'Survey results',
        props: {
          items: [
            { value: '37 %', label: 'read every day' },
            { value: '2×', label: 'more since 2020', tone: 'good' },
          ],
        },
      },
    ],
  };

export const image: ComponentDef<{
  src?: string;
  prompt?: string;
  alt: string;
  caption?: string;
  fit: 'contain' | 'cover';
}> = {
  type: 'image',
  pack: 'core',
  doc: 'A picture: a figure cropped from the source PDF, an illustration or a photo. src is a path inside the book (assets/…); or give prompt (a description) and Warqa generates the illustration. alt describes it for screen readers.',
  props: z.object({
    src: z.string().min(1).optional(),
    prompt: z.string().max(800).optional(),
    alt: Text,
    caption: Text.optional(),
    fit: z.enum(['contain', 'cover']).default('contain'),
  }),
  defaultSlot: 'main',
  text: ['alt', 'caption'],
  subs: () => [],
  examples: [],
};

export const widget: ComponentDef<{ html: string; title: string; height: number }> = {
  type: 'widget',
  pack: 'custom',
  doc: 'EXPERIMENTAL — a custom interactive picture written as one self-contained HTML document (inline CSS and JS, no external files, no network). It runs in a sandboxed frame and receives the lesson clock as messages: window.addEventListener("message", e => { if (e.data.type === "warqa:time") draw(e.data.t) }) (also e.data.lang, e.data.dir). Use only when no built-in component can show the idea. title describes it for screen readers.',
  props: z.object({
    html: z.string().min(20).max(30000),
    title: Text,
    height: z.number().int().min(160).max(860).default(480),
  }),
  defaultSlot: 'main',
  text: ['title'],
  subs: () => [],
  examples: [
    {
      title: 'A growing circle',
      props: {
        title: 'A circle whose radius grows with time',
        height: 300,
        html: '<svg viewBox="0 0 400 300" width="100%" height="100%"><circle id="c" cx="200" cy="150" r="10" fill="#f0b45a"/></svg><script>addEventListener("message",e=>{if(e.data&&e.data.type==="warqa:time")document.getElementById("c").setAttribute("r",10+Math.min(120,e.data.t*30))})</script>',
      },
    },
  ],
};
