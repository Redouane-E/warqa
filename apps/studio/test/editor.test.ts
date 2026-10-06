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
import { segmentsOf } from '../src/client/pages/editor/Marks.js';
import {
  changeOf,
  liveProblems,
  putBack,
  staleRanges,
  termRanges,
  tokensOf,
} from '../src/client/pages/translate/tokens.js';
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

describe('the narration and its marks', () => {
  it('splits the narration into text and marks with the word each waits for, and their places', () => {
    const text = 'Add [[keep]]keep the first, [[flip]]flip.';
    const segs = segmentsOf(text);
    expect(segs).toEqual([
      { text: 'Add ' },
      { mark: 'keep', label: '[[keep]]', word: 'keep', start: 4, end: 16 },
      { text: ' the first, ' },
      { mark: 'flip', label: '[[flip]]', word: 'flip.', start: 28, end: 41 },
    ]);
    // drawn over the text box, the runs give back the text letter for letter
    expect(segs.map((s) => ('mark' in s ? s.label + s.word : s.text)).join('')).toBe(text);
    // Arabic, and a mark with no word after it
    const ar = 'نحتفظ [[keep]]بالعدد الأول [[end]]';
    expect(segmentsOf(ar).map((s) => ('mark' in s ? s.label + s.word : s.text)).join('')).toBe(ar);
    expect(segmentsOf(ar).at(-1)).toMatchObject({ mark: 'end', word: '' });
    // marks are named as the lesson format names them: a hyphen is fine, a leading digit is not a mark
    expect(segmentsOf('[[two-step]]Then [[1st]]x').map((s) => ('mark' in s ? `${s.mark}:${s.word}` : s.text))).toEqual([
      'two-step:Then',
      ' [[1st]]x',
    ]);
    // two marks on one word: the first has no word of its own
    expect(segmentsOf('[[a]][[b]]Word.').map((s) => ('mark' in s ? `${s.mark}:${s.word}` : s.text))).toEqual([
      'a:',
      'b:Word.',
    ]);
  });
});

describe('the locked parts of a translation', () => {
  it('splits a text into words, marks, answer boxes and formulas', () => {
    expect(tokensOf('Keep [[a]]seven, $7 - 3$ \\$5', 'narration').map((t) => t.kind)).toEqual([
      'text',
      'mark',
      'text',
      'math',
      'text',
    ]);
    // the same brackets in an answer template are answer boxes
    expect(tokensOf('25 − 8 = [[a]] meters', 'math-template').find((t) => t.kind !== 'text')?.kind).toBe('box');
  });

  it('sees lost and extra marks, answer boxes and an unbalanced $ while a person types', () => {
    expect(liveProblems('A [[k]]b [[m]]c.', 'A b [[m]]c [[x]].', 'narration')).toEqual([
      { code: 'marks', lost: ['k'], extra: ['x'] },
    ]);
    expect(liveProblems('= [[a]]', '= ', 'math-template')).toEqual([{ code: 'boxes', lost: ['a'], extra: [] }]);
    expect(liveProblems('$x$', '$x', 'text')).toEqual([{ code: 'dollars', lost: [], extra: [] }]);
    expect(liveProblems('A [[k]]b.', 'Un [[k]]b.', 'narration')).toEqual([]);
  });

  it('puts a lost mark back at the same share of the sentence, between the marks around it', () => {
    const src = 'Take seven. [[keep]]Keep the seven. [[chg]]Change the minus to a plus.';
    const tr = 'Prenons sept. [[keep]]On garde le sept. On change le moins en plus.';
    const r = putBack(src, tr, 'chg', 'narration');
    expect(r.text).toBe('Prenons sept. [[keep]]On garde le sept. [[chg]]On change le moins en plus.');
    expect(r.word).toBe('On');
    expect(r.text.slice(0, r.caret).endsWith('[[chg]]')).toBe(true);
    // at the caret, when the person put it there
    expect(putBack(src, tr, 'chg', 'narration', 3).text.startsWith('Pre[[chg]]')).toBe(true);
  });

  it('says what changed in an original, and finds the old words still in the translation', () => {
    const c = changeOf('Now −3 − 5 is −8.', 'Now −3 − 5 is −7.')!;
    expect([c.from, c.to]).toEqual(['−8', '−7']);
    expect('Now −3 − 5 is −7.'.slice(...c.ranges[0]!)).toBe('−7.');
    expect(staleRanges('Maintenant −3 − 5 donne −8.', c.from)).toEqual([[24, 27]]);
    expect(changeOf('Same text.', 'Same text.')).toBeNull();
    expect(termRanges("L'opposé et les opposés", 'opposé')).toEqual([
      [2, 8],
      [16, 23],
    ]);
  });
});
