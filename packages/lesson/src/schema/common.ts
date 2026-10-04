import * as z from 'zod';

/** Lower-case identifier used for beats, nodes, marks, questions and options. */
export const Id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, 'ids are lower-case letters, digits, "_" or "-", starting with a letter')
  .meta({ description: 'Identifier: lower-case letters, digits, _ or -, starting with a letter.' });

/** Localizable text in the lesson's author language. Translations live in strings.<lang>.json. */
export const Text = z.string().min(1).max(2000);

/** Colour or tone names from the theme palette. The player maps them to colours. */
export const ColorName = z
  .enum(['chalk', 'dim', 'faint', 'task', 'good', 'bad', 'coral', 'sky', 'gold', 'rose', 'mint', 'lilac'])
  .meta({
    description:
      'Theme colour: chalk (main text), dim, faint, task (accent/highlight), good (right), bad (wrong), or one of six hues: coral sky gold rose mint lilac. Keep one meaning per colour within a lesson.',
  });
export type ColorName = z.infer<typeof ColorName>;

export const Size = z.enum(['sm', 'md', 'lg', 'xl']);
export type Size = z.infer<typeof Size>;

/**
 * Stage regions. LLMs choose a slot, never pixel coordinates; the player lays nodes out inside it and
 * mirrors start/end for right-to-left languages.
 */
export const Slot = z.enum(['full', 'title', 'upper', 'lower', 'main', 'start', 'end', 'band']).meta({
  description:
    'Where a node goes: full (whole stage), title (heading line at the top), upper / lower (top or bottom half of the main area), main (main area), start / end (left / right half in LTR, mirrored in RTL), band (strip at the bottom, also used by question cards).',
});
export type Slot = z.infer<typeof Slot>;

/** A moment in a beat: a narration mark (or the clip start/end) plus an offset in seconds. */
export const At = z
  .union([
    z.string(),
    z.object({ mark: z.string(), offset: z.number().min(-5).max(8).default(0) }),
    z.number().min(0).max(120),
  ])
  .meta({
    description:
      'When a cue starts: a mark name from the narration ("keep"), "start" or "end" of the clip, {mark, offset} for seconds after (or before) the mark, or a number of seconds from the beat start.',
  });
export type At = z.infer<typeof At>;

/**
 * A timed visual change. `target` is a node id, or "node#sub" for part of a node (a token, an item, a tick,
 * a mark created by an earlier action). `do` is a generic action or one of the target component's actions.
 */
export const Cue = z.object({
  at: At,
  do: z.string().min(1),
  target: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  dur: z.number().min(0).max(8).optional(),
});
export type Cue = z.infer<typeof Cue>;

export const GENERIC_ACTIONS = [
  'show',
  'hide',
  'highlight',
  'unhighlight',
  'pulse',
  'draw',
  'dim',
  'undim',
  'color',
] as const;
export type GenericAction = (typeof GENERIC_ACTIONS)[number];

/** Where a beat's content comes from in the source document. */
export const SourceRef = z.object({
  page: z.number().int().min(1),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  quote: z.string().max(200).optional(),
  role: z.enum(['explains', 'example', 'figure', 'exercise', 'definition']).default('explains'),
});
export type SourceRef = z.infer<typeof SourceRef>;
