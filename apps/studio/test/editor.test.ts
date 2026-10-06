// The lesson editor's logic without a browser: the generated forms against the real lesson schemas (which variant
// a value belongs to, what a new value starts from, numbers being typed), renaming a part, the translation keys
// that follow a removed cue, and the smallest shape of a beat.
import { COMPONENTS, Question } from '@warqa/lesson';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  defaultFor,
  fits,
  numberOf,
  preview,
  textOrNumber,
  translated,
  variantKey,
  variantOf,
} from '../src/client/pages/editor/schema.js';
import {
  type Beat,
  beatProblem,
  copyBeat,
  cueRemovalMoves,
  type LessonObj,
  renameNode,
} from '../src/client/pages/editor/shared.js';
import type { JsonSchema } from '../src/shared/types.js';

const js = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
const kinds = (js(Question).oneOf ?? []) as JsonSchema[];
const kind = (k: string) =>
  kinds.find((v) => ((v.properties as Record<string, JsonSchema>).kind as JsonSchema).const === k)!;

describe('generated forms', () => {
  // a blank's answer: a number, a fraction as text, {value, tol} or {text: [words]}
  const answer = (
    ((kind('blanks').properties as Record<string, JsonSchema>).rows as JsonSchema).items as JsonSchema
  ).properties as Record<string, JsonSchema>;
  const variants = ((answer.answers as JsonSchema).additionalProperties as JsonSchema).anyOf as JsonSchema[];

  it('finds the variant of an answer, and names what sets each apart', () => {
    expect(variantOf(variants, '-7')).toBe(0);
    expect(variantOf(variants, 3)).toBe(1);
    expect(variantOf(variants, { value: '3/4', tol: 0.1 })).toBe(2);
    expect(variantOf(variants, { text: ['seven'] })).toBe(3);
    expect(variants.map((_, k) => variantKey(variants, k).value)).toEqual(['string', 'number', 'value', 'text']);
    // the fourth kind starts from its own shape, which stays the fourth
    expect(variantOf(variants, defaultFor(variants[3]))).toBe(3);
  });

  it('tells a grid of true/false from one with its own columns', () => {
    const cols = ((kind('grid').properties as Record<string, JsonSchema>).cols as JsonSchema).anyOf as JsonSchema[];
    expect(variantOf(cols, 'tf')).toBe(0);
    expect(variantOf(cols, [{ id: 'a', text: 'A' }])).toBe(1);
    expect(fits(cols[0]!, 'xy')).toBe(false);
  });

  it('starts a new value from the definition (defaults, minimums, required fields)', () => {
    const nl = js(COMPONENTS.numberline!.props);
    expect(defaultFor(nl)).toEqual({ min: 0, max: 0 });
    const list = js(COMPONENTS.list!.props);
    expect(defaultFor(list)).toEqual({ items: [{ text: '' }] });
    expect(defaultFor(kind('choice'))).toMatchObject({ kind: 'choice', options: [{}, {}], correct: [''] });
  });

  it('keeps a number being typed out of the lesson until it is one', () => {
    expect(numberOf('-')).toBeUndefined();
    expect(numberOf('1.')).toBe(1);
    expect(numberOf('-8')).toBe(-8);
    expect(numberOf('.5')).toBe(0.5);
    expect(numberOf('3/4')).toBeUndefined();
    expect(textOrNumber('3')).toBe(3);
    expect(textOrNumber('3/4')).toBe('3/4');
    expect(textOrNumber('03')).toBe('03');
  });

  it('marks translated fields with the components’ patterns', () => {
    expect(translated(['items', 2, 'text'], ['items.*.text'])).toBe(true);
    expect(translated(['wrong', 'tick:-3'], ['wrong.*'])).toBe(true);
    expect(translated(['items', 2, 'sub'], ['items.*.text'])).toBe(false);
    expect(preview([['7', '+', { t: '(−3)' }]])).toBe('7 + (−3)');
  });
});

describe('editing a lesson', () => {
  const lesson = (): LessonObj => ({
    id: 'ch01',
    title: 'T',
    lang: 'en',
    beats: [
      {
        id: 'a',
        title: 'A',
        narration: 'One [[k]]two.',
        scene: { add: [{ id: 'eq', type: 'equation', steps: [['1']] }] },
        cues: [{ at: 'k', do: 'highlight', target: 'eq#tok:0' }],
      },
      {
        id: 'b',
        title: 'B',
        narration: 'Three.',
        scene: { keep: ['eq'] },
        cues: [{ at: 'start', do: 'pulse', target: 'eq' }],
        questions: [{ kind: 'pick', id: 'q1', on: 'eq', resolve: [{ at: 0, do: 'show', target: 'eq#tok:0' }] }],
      },
      { id: 'c', title: 'C', narration: 'Four.', scene: { add: [{ id: 'eq', type: 'text', text: 'x' }] }, cues: [{ at: 'start', do: 'show', target: 'eq' }] },
    ],
  });

  it('renames a part where it is added and after, up to a beat that adds another part with that id', () => {
    const l = lesson();
    renameNode(l, 0, 'eq', 'eq2');
    expect(l.beats[0]!.scene!.add![0]!.id).toBe('eq2');
    expect(l.beats[0]!.cues![0]!.target).toBe('eq2#tok:0');
    expect(l.beats[1]!.scene!.keep).toEqual(['eq2']);
    expect(l.beats[1]!.cues![0]!.target).toBe('eq2');
    expect((l.beats[1]!.questions![0] as { on: string }).on).toBe('eq2');
    // beat c adds its own "eq": untouched
    expect(l.beats[2]!.scene!.add![0]!.id).toBe('eq');
    expect(l.beats[2]!.cues![0]!.target).toBe('eq');
  });

  it('copies a beat with new ids for its parts and questions', () => {
    const l = lesson();
    const copy = copyBeat(l.beats[0] as Beat, l);
    expect(copy.id).toBe('a-2');
    expect(copy.scene!.add![0]!.id).toBe('eq-2');
    expect(copy.cues![0]!.target).toBe('eq-2#tok:0');
  });

  it('moves the translated arguments of the cues after a removed one', () => {
    expect(cueRemovalMoves('b', [1], 4)).toEqual([
      { from: 'beat.b.cue.1.', to: null },
      { from: 'beat.b.cue.2.', to: 'beat.b.cue.1.' },
      { from: 'beat.b.cue.3.', to: 'beat.b.cue.2.' },
    ]);
    expect(cueRemovalMoves('b', [3], 4)).toEqual([{ from: 'beat.b.cue.3.', to: null }]);
  });

  it('keeps Edit as JSON from breaking a beat', () => {
    expect(beatProblem({ id: 'a', title: 'A', narration: 'x' })).toBeNull();
    expect(beatProblem({ id: 'a', title: 'A' })).toBe('narration');
    expect(beatProblem({ id: 'a', title: 'A', narration: 'x', cues: {} })).toBe('cues');
    expect(beatProblem([])).toBe('object');
  });
});
