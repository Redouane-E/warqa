import * as z from 'zod';
import { Cue, Id, Text } from './common.js';

/**
 * An expected answer. A string or number is an exact number ("-7", "3/4", "2 1/4", "0.75"); equal values match
 * (6/8 = 3/4) unless `lowest` is set. `{value, tol}` accepts an approximation. `{text}` accepts words,
 * compared after normalization (case, accents, Arabic letter variants and diacritics are ignored).
 */
export const Answer = z.union([
  z.string().min(1),
  z.number(),
  z.object({
    value: z.union([z.string(), z.number()]),
    tol: z.number().min(0).optional(),
    lowest: z.boolean().optional(),
  }),
  z.object({ text: z.array(Text).min(1) }),
]);
export type Answer = z.infer<typeof Answer>;

const base = {
  id: Id,
  /** The question. Inline math goes between $…$. */
  prompt: Text,
  hint: Text.optional(),
  /** Why the right answer is right (shown after a right answer or "Show answer"). */
  explain: Text.optional(),
  /** Cues played on the picture when the question is resolved; part of the scene after this beat either way. */
  resolve: z.array(Cue).default([]),
};

export const ChoiceQuestion = z.object({
  kind: z.literal('choice'),
  ...base,
  options: z
    .array(
      z.object({
        id: Id,
        text: Text,
        why: Text.optional().meta({
          description: 'Feedback for choosing this option when it is wrong: name the mistake.',
        }),
      }),
    )
    .min(2)
    .max(6),
  correct: z.array(Id).min(1),
  multi: z.boolean().default(false),
});

export const BlanksRow = z.object({
  /** Text with answer boxes written as [[name]], e.g. "3 − 10 = [[a]]". Math runs and boxes are shown left-to-right. */
  template: Text,
  answers: z.record(Id, Answer),
  explain: Text.optional(),
  hint: Text.optional(),
  /** Judge the whole row by the set of values (e.g. two factors in any order). */
  anyOrder: z.boolean().default(false),
});
export type BlanksRow = z.infer<typeof BlanksRow>;

export const BlanksQuestion = z.object({ kind: z.literal('blanks'), ...base, rows: z.array(BlanksRow).min(1).max(10) });

export const NumericQuestion = z.object({
  kind: z.literal('numeric'),
  ...base,
  answer: Answer,
  unit: Text.optional(),
});

export const TF_COLS = 'tf' as const;
export const GridQuestion = z.object({
  kind: z.literal('grid'),
  ...base,
  /** "tf" for True/False (localized automatically), or custom columns. */
  cols: z.union([
    z.literal(TF_COLS),
    z
      .array(z.object({ id: Id, text: Text }))
      .min(2)
      .max(5),
  ]),
  rows: z
    .array(z.object({ id: Id, text: Text, correct: z.union([Id, z.array(Id).min(1)]), why: Text.optional() }))
    .min(1)
    .max(10),
});

export const OrderQuestion = z.object({
  kind: z.literal('order'),
  ...base,
  /** Items in the CORRECT order; the player shuffles them deterministically. */
  items: z
    .array(z.object({ id: Id, text: Text }))
    .min(2)
    .max(8),
});

export const PickQuestion = z.object({
  kind: z.literal('pick'),
  ...base,
  /** The node to pick on (a number line, an equation, a chart…). */
  on: Id,
  /** Right sub-targets of that node, e.g. ["tick:-3"] or ["tok:2"]. */
  correct: z.array(z.string()).min(1),
  /** Allowed choices; defaults to every pickable part of the node. */
  choices: z.array(z.string()).optional(),
  /** Feedback for specific wrong picks. */
  wrong: z.record(z.string(), Text).optional(),
});

export const TextQuestion = z.object({
  kind: z.literal('text'),
  ...base,
  accept: z.array(Text).min(1),
});

export const Question = z.discriminatedUnion('kind', [
  ChoiceQuestion,
  BlanksQuestion,
  NumericQuestion,
  GridQuestion,
  OrderQuestion,
  PickQuestion,
  TextQuestion,
]);
export type Question = z.infer<typeof Question>;
export type QuestionKind = Question['kind'];

export const Card = z.object({
  /** Where the question card goes: band (below the picture), side, top, screen (full-screen practice), auto. */
  place: z.enum(['auto', 'band', 'side', 'top', 'screen']).default('auto'),
  /** "check" questions are quick checks during the lesson; "practice" sets are numbered "Chapter practice k of n". */
  label: z.enum(['check', 'practice']).default('check'),
});
export type Card = z.infer<typeof Card>;
