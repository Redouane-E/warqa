import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BlanksRow,
  checkStrings,
  collectStrings,
  compileLesson,
  componentCatalog,
  evalExpr,
  finalState,
  grade,
  inlineRuns,
  lessonJsonSchema,
  localize,
  marksFromSentences,
  matchAnswer,
  parseLesson,
  parseMarks,
  parseTemplate,
  sameFunction,
  sampler,
  sceneAt,
  shuffleIds,
  stringTable,
  syntheticTiming,
  type Timings,
  templateGroups,
  validateLesson,
  wordAt,
} from '../index.js';

const root = fileURLToPath(new URL('../../../../examples/integers.warqa/lessons/ch05/', import.meta.url));
const raw = JSON.parse(readFileSync(`${root}lesson.json`, 'utf8'));
const timings: Timings = JSON.parse(readFileSync(`${root}timings.en.json`, 'utf8'));
const lesson = parseLesson(raw);

describe('lesson format', () => {
  it('parses the chapter 5 example with defaults applied', () => {
    expect(lesson.beats).toHaveLength(14);
    expect(lesson.beats[0]!.scene.add[0]!.enter).toBe('auto');
    expect(lesson.beats[10]!.scene.add).toEqual([]);
  });

  it('validates without errors against the real English timings', () => {
    const v = validateLesson(lesson, { timings });
    const errors = v.issues.filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('reports actionable errors for bad cues', () => {
    const bad = structuredClone(raw);
    bad.beats[2].cues.push({ at: 'nope', do: 'show', target: 'eq1' });
    bad.beats[2].cues.push({ at: 'r', do: 'fly', target: 'eq1' });
    bad.beats[2].cues.push({ at: 'r', do: 'show', target: 'eq1#tok:99' });
    bad.beats[2].cues.push({ at: 'r', do: 'hop', target: 'nl', args: { from: 'a' } });
    const v = validateLesson(parseLesson(bad), { timings });
    const msgs = v.issues.filter((i) => i.level === 'error').map((i) => i.message);
    expect(msgs.some((m) => m.includes('unknown mark "nope"'))).toBe(true);
    expect(msgs.some((m) => m.includes('no action "fly"') && m.includes('step'))).toBe(true);
    expect(msgs.some((m) => m.includes('no part "tok:99"'))).toBe(true);
    expect(msgs.some((m) => m.includes('bad args'))).toBe(true);
  });

  it('exports a JSON Schema and an LLM catalog', () => {
    const js = JSON.stringify(lessonJsonSchema());
    expect(js).toContain('numberline');
    const cat = componentCatalog({ packs: ['stem'] });
    expect(cat).toContain('### equation');
    expect(cat).not.toContain('### timeline');
  });
});

describe('compiler', () => {
  const c = compileLesson(lesson, timings, { lang: 'en' });

  it('keeps the number line across beats and clears its marks', () => {
    const rule = c.beats[2]!;
    expect(rule.start.nodes.nl).toBeDefined();
    expect(rule.leaving).toContain('cap1');
    expect(rule.leaving).not.toContain('nl');
    expect(Object.keys(rule.out.nodes.nl!.subs).filter((s) => s.startsWith('hop'))).toEqual(['hop1', 'hop2']);
    expect(Object.keys(rule.out.nodes.nl!.subs).some((s) => s.startsWith('arc'))).toBe(false);
  });

  it('times cues at their marks', () => {
    const rule = c.beats[2]!;
    const get = sampler(rule, timings.rule!.marks.chg1! + 1.5);
    expect(get('eq1', '', 'step')).toBe(1);
    expect(sampler(rule, 0)('eq1', '', 'step')).toBe(0);
    expect(sampler(rule, 100)('eq1', '', 'step')).toBe(3);
  });

  it('auto-shows uncued nodes at the start and waits for cued ones', () => {
    const inverse = c.beats[1]!;
    expect(sampler(inverse, 1)('nl', '', 'o')).toBe(1);
    expect(sampler(inverse, 1)('cap1', '', 'o')).toBe(0);
    expect(sampler(inverse, timings.inverse!.marks.def! + 1)('cap1', '', 'o')).toBe(1);
  });

  it('resolves questions in the state after the beat', () => {
    const q1 = c.beats[5]!;
    expect(q1.ask).toBe(true);
    expect(q1.out.nodes.eq4!.ch.step).toBe(1);
    expect(sampler(q1, 100)('eq4', '', 'step')).toBe(0); // until answered, the picture is unchanged
    expect(q1.resolve['c-rewrite']!.length).toBeGreaterThan(0);
  });

  it('folding equals playing every beat to its end (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: c.beats.length - 1 }), (i) => {
        // play beat i-1 to its end (with questions resolved) and compare with beat i's start state
        const prev = c.beats[i - 1]!;
        const played = sceneAt(prev, prev.end + 10);
        const resolved = Object.values(prev.resolve).length ? prev.out : played;
        const start = c.beats[i]!.start;
        for (const id of Object.keys(resolved.nodes)) {
          if (!start.nodes[id]) continue;
          expect(start.nodes[id]!.ch).toEqual(resolved.nodes[id]!.ch);
        }
        return true;
      }),
      { numRuns: 30 },
    );
  });

  it('random access: sampling any time is independent of earlier samples', () => {
    const rule = c.beats[2]!;
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: rule.end, noNaN: true }), { minLength: 2, maxLength: 8 }), (ts) => {
        const direct = ts.map((t) => JSON.stringify(sceneAt(rule, t)));
        const reversed = [...ts]
          .reverse()
          .map((t) => JSON.stringify(sceneAt(rule, t)))
          .reverse();
        return direct.every((d, i) => d === reversed[i]);
      }),
      { numRuns: 20 },
    );
  });

  it('final state equals sampling far past the end', () => {
    const b = c.beats[3]!;
    const fin = finalState(b.start, b.segs);
    const late = sceneAt(b, 1e6);
    expect(late.nodes.eq2!.ch).toEqual(fin.nodes.eq2!.ch);
  });
});

describe('text helpers', () => {
  it('parses marks, inline math and answer templates', () => {
    const m = parseMarks('Keep the [[keep]]seven. [[b]] Then go.');
    expect(m.clean).toBe('Keep the seven.  Then go.');
    expect(m.clean.slice(m.marks.keep!)).toMatch(/^seven/);
    expect(m.clean.slice(m.marks.b!)).toMatch(/^Then/);
    expect(inlineRuns('Find $4 − (−9)$ now, \\$5.')).toEqual([
      { math: false, text: 'Find ' },
      { math: true, text: '4 − (−9)' },
      { math: false, text: ' now, $5.' },
    ]);
    const g = templateGroups(parseTemplate('25 − (−8) = [[a]] مترًا'));
    expect(g.map((x) => x.math)).toEqual([true, false]);
    expect(g[0]!.parts.some((p) => 'box' in p)).toBe(true);
    expect(templateGroups(parseTemplate('The opposite of 4 is [[a]]')).map((x) => x.math)).toEqual([false, true]);
  });

  it('makes synthetic timings with marks inside the clip', () => {
    const t = syntheticTiming('أولا، نأخذ [[a]]سبعة. ثم [[b]]نطرح ثلاثة؟ نعم.', 'ar');
    expect(t.captions).toHaveLength(3);
    expect(t.marks.a!).toBeGreaterThan(0);
    expect(t.marks.b!).toBeGreaterThan(t.marks.a!);
    expect(t.dur).toBeGreaterThan(t.marks.b!);
  });

  it('evaluates expressions safely', () => {
    expect(evalExpr('4 + (-9)')).toBe(-5);
    expect(evalExpr('2^3 - 1')).toBe(7);
    expect(evalExpr('٢×٣')).toBe(6);
    expect(sameFunction('2(x+1)', '2x+2')).toBe(true);
    expect(sameFunction('x^2', '2x')).toBe(false);
    expect(() => evalExpr('alert(1)')).toThrow();
  });
});

describe('grading', () => {
  it('matches exact values, decimals, Arabic digits and text answers', () => {
    expect(matchAnswer('-7', '−7', 'en')).toBe('ok');
    expect(matchAnswer('-7', '٧-', 'ar')).toBe('nan');
    expect(matchAnswer('-7', '-٧', 'ar')).toBe('ok');
    expect(matchAnswer('3/4', '0,75', 'fr')).toBe('ok');
    expect(matchAnswer({ value: '3/4', lowest: true }, '6/8', 'en')).toBe('lowest');
    expect(matchAnswer({ value: 3.14159, tol: 0.01 }, '3.14', 'en')).toBe('ok');
    expect(matchAnswer({ text: ['المقابل'] }, 'المُقابِل', 'ar')).toBe('ok');
    expect(matchAnswer('13', 'abc', 'en')).toBe('nan');
  });

  it('grades rows in any order', () => {
    const row: BlanksRow = { template: '(x + [[a]])(x + [[b]])', answers: { a: '2', b: '3' }, anyOrder: true };
    expect(
      grade(
        { kind: 'blanks', id: 'q', prompt: 'p', resolve: [], rows: [row] },
        { kind: 'blanks', rows: [{ a: '3', b: '2' }] },
        'en',
      ).ok,
    ).toBe(true);
  });

  it('shuffles order questions deterministically and never in the right order', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(shuffleIds(ids, 'q1')).toEqual(shuffleIds(ids, 'q1'));
    for (const seed of ['x', 'y', 'z', 'w']) expect(shuffleIds(ids, seed)).not.toEqual(ids);
  });
});

describe('localization', () => {
  it('collects strings with stable keys and localizes them back', () => {
    const table = stringTable(lesson);
    expect(table['beat.rule.narration']).toContain('[[keep]]');
    expect(table['node.sum.items.1.text']).toBe('Subtracting a positive number moves you left.');
    expect(table['beat.inverse.cue.9.args.label']).toBe('mirror at 0');
    expect(table['q.p-tf.rows.r1.text']).toBeDefined();
    const fake = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, `«${v}»`]));
    const loc = localize(lesson, fake);
    expect(loc.beats[2]!.narration.startsWith('«')).toBe(true);
    expect(loc.beats[1]!.cues[9]!.args!.label).toBe('«mirror at 0»');
    expect(collectStrings(loc).every((e) => e.text.startsWith('«'))).toBe(true);
  });

  it('checks that translations keep marks and answer boxes', () => {
    const table = stringTable(lesson);
    const tr = { ...table, 'beat.rule.narration': 'Voici la règle.', 'q.p-diffs.rows.0.template': '3 − 10 =' };
    const issues = checkStrings(lesson, tr, 'fr').map((i) => i.message);
    expect(issues.some((m) => m.includes('beat.rule.narration') && m.includes('marks'))).toBe(true);
    expect(issues.some((m) => m.includes('answer boxes'))).toBe(true);
  });
});

describe('component gallery', () => {
  it('every component example validates and compiles', async () => {
    const { galleryLesson } = await import('../index.js');
    const g = galleryLesson();
    const v = validateLesson(g);
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(g.beats.length).toBeGreaterThan(18);
  });
});

describe('cues on things that are cleared', () => {
  it('rejects cues on marks and nodes that fade out at the beat start', () => {
    const bad = structuredClone(raw);
    // rule keeps the number line but clears its marks (the arcs and dots of "inverse")
    bad.beats[2].cues.push({ at: 'r', do: 'color', target: 'nl#dot1', args: { color: 'gold' } });
    bad.beats[2].cues.push({ at: 'r', do: 'pulse', target: 'cap1' });
    const msgs = validateLesson(parseLesson(bad), { timings })
      .issues.filter((i) => i.level === 'error')
      .map((i) => i.message);
    expect(msgs.some((m) => m.includes('mark "dot1" belongs to the previous beat'))).toBe(true);
    expect(msgs.some((m) => m.includes('node "cap1" is cleared'))).toBe(true);
  });
});

describe('TeX-like equation steps', () => {
  it('splits terms and operators, builds fractions, exponents and indices', async () => {
    const { texToTokens, tokenInfos } = await import('../index.js');
    expect(texToTokens('x^2 + 2x + 1')).toEqual([{ t: 'x', sup: '2' }, ' + ', '2x', ' + ', '1']);
    expect(texToTokens('\\frac{3}{4} = 0.75')).toEqual([{ frac: ['3', '4'] }, ' = ', '0.75']);
    expect(texToTokens('-3 - 5 = -8')).toEqual(['−3', ' − ', '5', ' = ', '−8']);
    expect(texToTokens('a_n = 2n')).toEqual([{ t: 'a', sub: 'n' }, ' = ', '2n']);
    expect(texToTokens('x \\le 3')).toEqual(['x', ' ≤ ', '3']);
    expect(texToTokens('7 - (-3)')).toEqual(['7', ' − ', '(−3)']);
    expect(tokenInfos('x^2 + 1').map((t) => t.id)).toEqual(['0', '1', '2']);
  });
});

describe('read-along word times', () => {
  it('times every word, in order, with offsets into the spoken text', () => {
    const t = syntheticTiming('Hello [[a]]big world. The $x$ fox.', 'en');
    expect(t.words?.map(([, a, b]) => 'Hello big world. The x fox.'.slice(a, b))).toEqual([
      'Hello',
      'big',
      'world',
      'The',
      'x',
      'fox',
    ]);
    const times = t.words!.map(([s]) => s);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(t.marks.a).toBeCloseTo(t.words![1]![0], 2);
  });

  it('finds the word being spoken', () => {
    const words: [number, number, number][] = [
      [0.2, 0, 5],
      [0.6, 6, 9],
      [1.0, 10, 15],
    ];
    expect(wordAt(words, 0, 2)).toBe(-1);
    expect(wordAt(words, 0.25, 2)).toBe(0);
    expect(wordAt(words, 0.7, 2)).toBe(1);
    expect(wordAt(words, 1.9, 2)).toBe(2);
    expect(wordAt(words, 3, 2)).toBe(-1);
  });

  it('spreads words over sentence times for engines without word times', () => {
    const r = marksFromSentences('أهلا بكم. [[b]]هذا درس جديد؟', [
      { start: 0, end: 1 },
      { start: 1.2, end: 3 },
    ]);
    expect(r.words.length).toBe(5);
    expect(r.words[2]![0]).toBeCloseTo(1.2, 2);
    expect(r.marks.b).toBeCloseTo(1.2, 2);
  });
});
