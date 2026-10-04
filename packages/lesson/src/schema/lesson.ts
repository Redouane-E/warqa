import * as z from 'zod';
import { COMPONENTS } from '../components/registry.js';
import { Cue, Id, Slot, SourceRef, Text } from './common.js';
import { Card, Question } from './question.js';

export const LESSON_SCHEMA = 'warqa.lesson/1' as const;
export const BOOK_SCHEMA = 'warqa.book/1' as const;

/** Fields every node has besides its component props. */
export const NodeBase = {
  id: Id,
  slot: Slot.optional().meta({ description: "Stage region; defaults to the component's usual place." }),
  enter: z.enum(['auto', 'cue']).default('auto').meta({
    description: 'auto: appears at the beat start unless a cue shows it later; cue: stays hidden until a cue shows it.',
  }),
};

export const MOVES = [
  'intro',
  'hook',
  'define',
  'example',
  'contrast',
  'transform',
  'predict',
  'check',
  'practice',
  'summary',
  'story',
  'finish',
] as const;
export const Move = z.enum(MOVES).meta({
  description:
    'The teaching move of a beat: intro (title card), hook, define, example (worked example), contrast (common mistake vs right way), transform (a picture or expression changes to show why), predict (ask the reader to guess before showing), check (quick question), practice (end-of-chapter set), summary, story (narrative scene), finish (score card).',
});
export type Move = z.infer<typeof Move>;

function buildSchemas() {
  const defs = Object.values(COMPONENTS);
  const variants = defs.map((d) => {
    const props = d.props as unknown as z.ZodObject<z.ZodRawShape>;
    return props.extend({ type: z.literal(d.type), ...NodeBase }).meta({ description: d.doc });
  });
  const Node = z.discriminatedUnion(
    'type',
    variants as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]],
  );

  const Scene = z
    .object({
      clear: z
        .boolean()
        .default(false)
        .meta({ description: 'Fade out the previous picture at the start of this beat.' }),
      keep: z.array(Id).default([]).meta({ description: 'Nodes kept when clearing (their marks are still cleared).' }),
      remove: z.array(Id).default([]),
      add: z.array(Node).default([]),
    })
    .prefault({});

  const Beat = z.object({
    id: Id,
    title: Text,
    move: Move.default('example'),
    narration: Text.meta({
      description:
        'What the narrator says. Put [[name]] right before the word an action waits for, e.g. "Keep the [[keep]]seven." Say math in words.',
    }),
    speak: Text.optional().meta({
      description: 'Optional text for speech synthesis (numbers spelled out, diacritics); same [[marks]] as narration.',
    }),
    scene: Scene,
    cues: z.array(Cue).default([]),
    questions: z.array(Question).min(1).max(8).optional(),
    card: Card.optional(),
    sources: z.array(SourceRef).default([]),
    lead: z
      .boolean()
      .default(true)
      .meta({ description: 'Allow the player to move an empty opening forward (see the lead-in rule).' }),
  });

  const Lesson = z.object({
    schema: z.literal(LESSON_SCHEMA).default(LESSON_SCHEMA),
    id: Id,
    title: Text,
    number: z.number().int().min(0).optional(),
    unit: Text.optional(),
    minutes: z.number().min(0).max(240).optional(),
    /** Language the lesson's inline text is written in. */
    lang: z.string().min(2).max(16),
    sourceLang: z.string().min(2).max(16).optional(),
    next: z.string().optional(),
    beats: z.array(Beat).min(1),
  });

  return { Node, Scene, Beat, Lesson };
}

let cache: ReturnType<typeof buildSchemas> | undefined;
let cacheSize = -1;

/** Schemas built from the component registry (rebuilt when components are registered). */
export function schemas(): ReturnType<typeof buildSchemas> {
  const n = Object.keys(COMPONENTS).length;
  if (!cache || n !== cacheSize) {
    cache = buildSchemas();
    cacheSize = n;
  }
  return cache;
}

type S = ReturnType<typeof buildSchemas>;
export type LessonNode = z.infer<S['Node']> & { type: string; id: string; slot?: Slot; enter: 'auto' | 'cue' } & Record<
    string,
    unknown
  >;
export type Scene = { clear: boolean; keep: string[]; remove: string[]; add: LessonNode[] };
export type Beat = Omit<z.infer<S['Beat']>, 'scene'> & { scene: Scene };
export type Lesson = Omit<z.infer<S['Lesson']>, 'beats'> & { beats: Beat[] };
export type LessonInput = z.input<S['Lesson']>;

/** Parse and apply defaults; throws a ZodError listing every problem. */
export const parseLesson = (data: unknown): Lesson => schemas().Lesson.parse(data) as Lesson;
export const safeParseLesson = (data: unknown) => schemas().Lesson.safeParse(data);

/** Timings for one language: per beat, the clip duration, mark times, caption sentences and word times. */
export const BeatTiming = z.object({
  dur: z.number().min(0),
  marks: z.record(z.string(), z.number()),
  captions: z.array(z.tuple([z.number(), z.string()])),
  /** Word start times for read-along: [seconds, start, end] with offsets into the spoken text of the narration. */
  words: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
  synthetic: z.boolean().optional(),
});
export const Timings = z.record(z.string(), BeatTiming);
export type BeatTiming = z.infer<typeof BeatTiming>;
export type Timings = z.infer<typeof Timings>;

/** strings.<lang>.json: localized text by key, optionally with a speech override. */
export const StringValue = z.union([z.string(), z.object({ text: z.string(), speak: z.string().optional() })]);
export const Strings = z.record(z.string(), StringValue);
export type Strings = z.infer<typeof Strings>;

/** Text that can be given per language in book-level metadata. */
export const LText = z.union([z.string(), z.record(z.string(), z.string())]);
export type LText = z.infer<typeof LText>;

export const Book = z.object({
  schema: z.literal(BOOK_SCHEMA).default(BOOK_SCHEMA),
  id: Id,
  title: LText,
  subtitle: LText.optional(),
  author: z.string().optional(),
  langs: z.array(z.string().min(2)).min(1),
  defaultLang: z.string().min(2).optional(),
  sourceLang: z.string().min(2).optional(),
  digits: z.enum(['latn', 'arab']).default('latn'),
  theme: z.string().default('chalk'),
  audience: z.string().optional(),
  units: z.array(z.object({ title: LText, chapters: z.array(z.string()).min(1) })).default([]),
  /** Where the content comes from and under which licence (shown in exports). */
  source: z
    .object({
      title: z.string().optional(),
      file: z.string().optional(),
      license: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  license: z.string().optional(),
  attribution: z.string().optional(),
  /** Pipeline settings (models per role, voices, budget) — see @warqa/pipeline. */
  pipeline: z.record(z.string(), z.unknown()).optional(),
});
export type Book = z.infer<typeof Book>;

export const ltext = (v: LText | undefined, lang: string, fallback = ''): string => {
  if (v === undefined) return fallback;
  if (typeof v === 'string') return v;
  return v[lang] ?? v[lang.split('-')[0]!] ?? Object.values(v)[0] ?? fallback;
};
