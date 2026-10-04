// End-to-end pipeline test with a scripted fake model: plan → storyboard → write (with a repair) →
// translate → export, all validated by the real validators.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLesson } from '@warqa/lesson';
import { describe, expect, it } from 'vitest';
import { exportSite } from '../export/site.js';
import type { SourceDocument } from '../ingest/document.js';
import { extractJson, type FakeModel, Llm } from '../models/llm.js';
import { Project } from '../project/index.js';
import { improveLesson } from '../qa/judge.js';
import { buildChapter, ensurePlan, estimateBuild } from './build.js';
import { liteToBeat } from './write.js';

const doc: SourceDocument = {
  schema: 'warqa.document/1',
  source: { file: 'integers.pdf', pages: 4, sha1: 'x', title: 'Integers' },
  lang: 'en',
  outline: [{ level: 1, title: 'Subtracting integers', page: 2 }],
  pages: [1, 2, 3, 4].map((n) => ({ n, width: 600, height: 800, method: 'text' as const, quality: 'ok' as const })),
  blocks: [
    { id: 'p2b0', page: 2, kind: 'heading', text: 'Subtracting integers', bbox: [0, 0, 600, 40], level: 1 },
    {
      id: 'p2b1',
      page: 2,
      kind: 'paragraph',
      text: 'To subtract a number, add its opposite. For example 7 − 3 = 7 + (−3) = 4.',
      bbox: [0, 50, 600, 120],
    },
    {
      id: 'p3b0',
      page: 3,
      kind: 'paragraph',
      text: 'Subtracting a negative number moves right: 2 − (−5) = 7.',
      bbox: [0, 50, 600, 120],
    },
  ],
  sections: [
    { id: '00_front', title: 'Front matter', start: 1, end: 1 },
    { id: 'ch01', title: 'Subtracting integers', start: 2, end: 4 },
  ],
};

const beats: Record<string, (attempt: number) => unknown> = {
  intro: () => ({
    title: 'Subtracting integers',
    narration: 'Seven minus three is four. [[b]]Seven plus negative three is four too.',
    scene: {
      clear: true,
      add: [{ id: 'tc', type: 'title', title: 'Subtracting integers', lines: ['$7 − 3 = 4$', '$7 + (−3) = 4$'] }],
    },
    cues: [{ at: 'b', do: 'show', target: 'tc#line:1' }],
    sources: [{ page: 2 }],
  }),
  rule: (attempt) => ({
    title: 'Add the opposite',
    narration: 'Here is the rule. [[keep]]Keep the seven. [[chg]]Change minus to plus and three to negative three.',
    scene: {
      clear: true,
      add: [
        { id: 'nl', type: 'numberline', min: -8, max: 8 },
        {
          id: 'eq',
          type: 'equation',
          steps: [
            ['7', ' − ', '3'],
            ['7', ' + ', '(−3)'],
          ],
        },
      ],
    },
    // first attempt uses a mark that does not exist → the validator must send it back
    cues: [
      { at: attempt === 0 ? 'chnge' : 'chg', do: 'step', target: 'eq' },
      { at: 'keep', do: 'highlight', target: 'eq#tok:0' },
    ],
    sources: [{ page: 2 }],
  }),
  q1: () => ({
    title: 'Quick check',
    narration: 'Quick check.',
    scene: { clear: false },
    cues: [],
    card: { place: 'band', label: 'check' },
    questions: [
      {
        kind: 'pick',
        id: 'c-land',
        prompt: 'Where does $7 − 3$ land?',
        on: 'nl',
        correct: ['tick:4'],
        explain: '$7 + (−3) = 4$.',
      },
    ],
    sources: [{ page: 2 }],
  }),
  wrap: () => ({
    title: 'Summary',
    narration: 'To subtract, add the opposite.',
    scene: {
      clear: true,
      add: [
        { id: 'sum', type: 'list', items: [{ text: 'To subtract, add the opposite.', sub: '$a − b = a + (−b)$' }] },
      ],
    },
    cues: [],
    sources: [{ page: 3 }],
  }),
  final1: () => ({
    title: 'Practice',
    narration: 'Chapter practice.',
    scene: { clear: true },
    cues: [],
    card: { place: 'screen', label: 'practice' },
    questions: [
      {
        kind: 'blanks',
        id: 'p-d',
        prompt: 'Find each difference.',
        rows: [{ template: '3 − 10 = [[a]]', answers: { a: '-7' } }],
      },
    ],
    sources: [{ page: 3 }],
  }),
  finish: () => ({ title: 'Finished', narration: 'Well done.', scene: { clear: true }, cues: [], sources: [] }),
};

const fake: FakeModel = ({ name, prompt, attempt }) => {
  if (name === 'plan')
    return JSON.stringify({
      title: 'Integers',
      audience: 'middle school',
      chapters: [
        { section: '00_front', title: 'Front', objectives: ['-'], minutes: 2, visuals: [], packs: [], include: false },
        {
          section: 'ch01',
          title: 'Subtracting integers',
          objectives: ['Subtract by adding the opposite'],
          minutes: 6,
          visuals: ['number line hops'],
          packs: ['stem'],
          include: true,
        },
      ],
      glossary: [{ terms: { en: 'opposite', ar: 'مقابل' } }],
      conventions: { notation: 'true minus', colors: 'positive sky, negative coral', tone: 'warm' },
    });
  if (name.startsWith('storyboard'))
    return JSON.stringify({
      title: 'Subtracting integers',
      beats: ['intro:intro', 'rule:transform', 'q1:check', 'wrap:summary', 'final1:practice', 'finish:finish'].map(
        (x) => {
          const [id, move] = x.split(':');
          return {
            id,
            move,
            title: id,
            idea: 'idea',
            visual: 'visual',
            components: ['equation'],
            keep: [],
            pages: [2],
            seconds: 10,
          };
        },
      ),
    });
  if (name.startsWith('beat:')) return JSON.stringify(beats[name.split(':')[2]!]!(attempt));
  if (name.startsWith('translate')) {
    const m = /\(key: text\):\n([\s\S]*)$/.exec(prompt)!;
    const input = extractJson(m[1]!) as Record<string, string>;
    return JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `ع ${v}`])));
  }
  throw new Error(`unexpected call ${name}`);
};

describe('pipeline stages (fake model)', () => {
  it('plans, storyboards, writes with repair, translates and exports a chapter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'warqa-test-'));
    const project = Project.create(root, { id: 'demo', title: 'Demo', langs: ['en', 'ar'], defaultLang: 'en' });
    project.config.models = {
      planner: 'anthropic:claude-sonnet-5-5',
      storyboard: 'anthropic:claude-sonnet-5-5',
      writer: 'anthropic:claude-sonnet-5-5',
      translator: 'anthropic:claude-sonnet-5-5',
    };
    project.saveBook();
    project.writeJson('source/document.json', doc);
    const events: string[] = [];
    const llm = new Llm({
      fake,
      cacheDir: project.path('cache', 'llm'),
      ledger: project.path('.ledger.jsonl'),
      onEvent: (e) => events.push(`${e.type}:${e.stage}`),
    });
    const plan = await ensurePlan(project, { llm, approve: true });
    expect(plan.chapters.filter((c) => c.include).map((c) => c.id)).toEqual(['ch01']);
    expect(project.book.units[0]!.chapters).toEqual(['ch01']);
    const r = await buildChapter(project, 'ch01', { llm, narrate: false });
    expect(events).toContain('repair:write');
    expect(r.lesson.beats.map((b) => b.id)).toEqual(['intro', 'rule', 'q1', 'wrap', 'final1', 'finish']);
    expect(validateLesson(r.lesson).ok).toBe(true);
    const ar = project.loadStrings('ch01', 'ar')!;
    expect(String(ar['beat.rule.narration'])).toContain('[[keep]]');
    expect(ar['q.p-d.rows.0.template']).toBe('3 − 10 = [[a]]'); // math-only strings are copied
    const out = exportSite(project, { out: join(root, 'dist') });
    expect(out.langs).toEqual(['en', 'ar']);
    expect(readFileSync(join(root, 'dist', 'ch01', 'index.html'), 'utf8')).toContain('WARQA_DATA');
    // second run is served from the cache: no new calls
    const before = events.length;
    await buildChapter(project, 'ch01', { llm, narrate: false, force: ['write'] });
    expect(events.slice(before).every((e) => e.startsWith('cached') || !e.startsWith('call'))).toBe(true);
    const est = estimateBuild(project);
    expect(est.p50).toBeGreaterThan(0);

    // judge in the loop: a weak beat is rewritten with the judge's notes, its stale translations dropped
    const judged: string[] = [];
    const report = await improveLesson(project, 'ch01', {
      llm,
      judge: async () => {
        judged.push('x');
        return judged.length === 1
          ? [
              { id: 'intro', score: 5 },
              { id: 'rule', score: 2, problem: 'the hops are hard to see', fix: 'make the hops bigger' },
            ]
          : [
              { id: 'intro', score: 5 },
              { id: 'rule', score: 4 },
            ];
      },
    });
    expect(report.rewritten).toEqual(['rule']);
    expect(report.after.find((v) => v.id === 'rule')?.score).toBe(4);
    expect(judged.length).toBe(2);
    const arAfter = project.loadStrings('ch01', 'ar')!;
    expect(arAfter['beat.rule.narration']).toBeUndefined();
    expect(arAfter['beat.intro.narration']).toBeDefined();
    expect(validateLesson(project.loadLesson('ch01')).ok).toBe(true);
  });

  it('turns a tier-C answer into a beat with automatic cues', () => {
    const beat = liteToBeat(
      {
        id: 'ex',
        move: 'example',
        title: 'Example',
        idea: '',
        visual: '',
        components: [],
        keep: [],
        pages: [3],
        seconds: 10,
      },
      {
        title: 'Example',
        sentences: ['Take two minus five.', 'Add the opposite.', 'The answer is negative three.'],
        nodes: [
          {
            id: 'e',
            type: 'equation',
            steps: [
              ['2', ' − ', '5'],
              ['2', ' + ', '(−5)'],
              ['2', ' + ', '(−5)', ' = ', '−3'],
            ],
          },
          { id: 'n', type: 'text', text: 'add the opposite' },
        ],
      },
    );
    expect(beat.narration).toBe('Take two minus five. [[s2]]Add the opposite. [[s3]]The answer is negative three.');
    expect((beat.cues as { do: string }[]).map((c) => c.do)).toEqual(['show', 'step', 'step']);
  });
});

describe('normalizeDraft', () => {
  it('forgives nested props, kind aliases, mark prefixes and bad ids', async () => {
    const { normalizeDraft } = await import('./write.js');
    const d = normalizeDraft({
      title: 't',
      narration: 'n',
      scene: { clear: true, add: [{ id: 'nl', type: 'numberline', props: { min: -5, max: 5 } }] },
      cues: [
        { at: 'mark:a', do: 'arc', target: 'nl', args: { from: 0, to: 3, id: 'Arc-1R' } },
        { at: '1.5', do: 'show', target: 'nl' },
      ],
      questions: [
        { kind: 'multiple_choice', id: 'Q1', prompt: 'p', resolve: [{ at: '[[b]]', do: 'show', target: 'nl' }] },
      ],
    });
    expect((d.scene as { add: Record<string, unknown>[] }).add[0]).toMatchObject({ id: 'nl', min: -5, max: 5 });
    expect((d.cues as { at: unknown; args?: { id: string } }[])[0]).toMatchObject({ at: 'a', args: { id: 'arc-1r' } });
    expect((d.cues as { at: unknown }[])[1]!.at).toBe(1.5);
    expect((d.questions as Record<string, unknown>[])[0]).toMatchObject({ kind: 'choice', id: 'q1' });
  });
});
