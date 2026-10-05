// The self-learner's one go through the studio API: the summary's estimate (free text read, the PDF's
// language), then the `learn` job (read → plan approved automatically → chapter 1), with a scripted model.
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '@warqa/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';

const here = dirname(fileURLToPath(import.meta.url));
const pdf = join(here, '../../../examples/pdfs/science-water-cycle-fr.pdf');
let root: string;
let app: ReturnType<typeof createApp>['app'];
let jobs: ReturnType<typeof createApp>['jobs'];
const prompts: string[] = [];

const BEATS: Record<string, unknown> = {
  intro: {
    title: 'The water cycle',
    narration: 'The water cycle. [[b]]Water moves all the time.',
    scene: { clear: true, add: [{ id: 'tc', type: 'title', title: 'The water cycle', lines: ['Water moves all the time'] }] },
    cues: [{ at: 'b', do: 'show', target: 'tc#line:0' }],
    sources: [{ page: 2 }],
  },
  states: {
    title: 'Three states',
    narration: 'Water can be ice, liquid or vapour. [[l]]The Sun makes it change.',
    scene: {
      clear: true,
      add: [{ id: 'l', type: 'list', items: [{ text: 'ice' }, { text: 'liquid' }, { text: 'vapour' }] }],
    },
    cues: [{ at: 'l', do: 'show', target: 'l#item:2' }],
    sources: [{ page: 2 }],
  },
  q1: {
    title: 'Quick check',
    narration: 'Quick check.',
    scene: { clear: false },
    cues: [],
    card: { place: 'band', label: 'check' },
    questions: [
      {
        kind: 'choice',
        id: 'c-sun',
        prompt: 'What makes water evaporate?',
        options: [
          { id: 'a', text: 'The Sun' },
          { id: 'b', text: 'The Moon', why: 'The Sun heats the water.' },
        ],
        correct: ['a'],
        explain: 'The Sun heats the water, which becomes vapour.',
      },
    ],
    sources: [{ page: 2 }],
  },
  wrap: {
    title: 'Summary',
    narration: 'Water changes state and goes round and round.',
    scene: { clear: true, add: [{ id: 'sum', type: 'list', items: [{ text: 'Water changes state.' }] }] },
    cues: [],
    sources: [{ page: 3 }],
  },
  final1: {
    title: 'Practice',
    narration: 'Practice.',
    scene: { clear: true },
    cues: [],
    card: { place: 'screen', label: 'practice' },
    questions: [
      {
        kind: 'choice',
        id: 'p-state',
        prompt: 'Which one is water as a gas?',
        options: [
          { id: 'a', text: 'Vapour' },
          { id: 'b', text: 'Ice', why: 'Ice is water as a solid.' },
        ],
        correct: ['a'],
        explain: 'Vapour is water as a gas.',
      },
    ],
    sources: [{ page: 3 }],
  },
  finish: { title: 'Finished', narration: 'Well done.', scene: { clear: true }, cues: [], sources: [] },
};

const fake: P.FakeModel = ({ name, prompt }) => {
  prompts.push(prompt);
  if (name === 'plan')
    return JSON.stringify({
      title: 'The water cycle',
      audience: 'a person learning on their own',
      chapters: [
        { section: '00_front', title: 'Front', objectives: ['-'], minutes: 2, visuals: [], packs: [], include: false },
        {
          section: 'ch01',
          title: 'The water cycle',
          objectives: ['Name the stages of the water cycle'],
          minutes: 5,
          visuals: [],
          packs: ['core'],
          include: true,
        },
      ],
      glossary: [],
      conventions: { notation: '', colors: '', tone: 'warm' },
    });
  if (name.startsWith('storyboard'))
    return JSON.stringify({
      title: 'The water cycle',
      beats: [
        ['intro', 'intro', 'The water cycle'],
        ['states', 'define', 'Three states'],
        ['q1', 'check', 'Quick check'],
        ['wrap', 'summary', 'Summary'],
        ['final1', 'practice', 'Practice'],
        ['finish', 'finish', 'Finished'],
      ].map(([id, move, title]) => ({
        id,
        move,
        title,
        idea: 'idea',
        visual: 'visual',
        components: ['list'],
        keep: [],
        pages: [2],
        seconds: 10,
      })),
    });
  if (name.startsWith('beat:')) return JSON.stringify(BEATS[name.split(':')[2]!]);
  throw new Error(`unexpected call ${name}`);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'warqa-studio-learn-'));
  const p = P.Project.create(join(root, 'mine.warqa'), { id: 'mine', title: 'Mine', langs: ['en'], defaultLang: 'en' });
  p.config.models = { planner: 'anthropic:claude-sonnet-5-5', storyboard: 'anthropic:claude-sonnet-5-5', writer: 'anthropic:claude-sonnet-5-5' };
  p.saveBook();
  copyFileSync(pdf, p.path('source', 'science-water-cycle-fr.pdf'));
  ({ app, jobs } = createApp({ root, llm: { fake } }));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('learning on your own', () => {
  it('estimates the one go for the summary: pages, the PDF’s language, time and cost', async () => {
    const res = await app.request('/api/projects/mine/estimate?learn=1');
    expect(res.status).toBe(200);
    const e = (await res.json()) as { pages: number; sourceLang: string; visionPages: number; usd: { p50: number }; seconds: number };
    expect(e).toMatchObject({ pages: 4, sourceLang: 'fr', visionPages: 0, spent: 0 });
    expect(e.usd.p50).toBeGreaterThan(0);
    expect(e.seconds).toBeGreaterThan(0);
    expect(prompts).toEqual([]); // nothing was spent
  });

  it('makes chapter 1 in one go, at the learner’s level, and reports titles and spend', async () => {
    const res = await app.request('/api/projects/mine/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'learn', args: { level: 'beginner' } }),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    await jobs.idle('mine');
    const { job, events } = (await (await app.request(`/api/jobs/${jobId}`)).json()) as {
      job: { status: string; error?: string; result: { chapter: string; level: string; chapters: { id: string }[] } };
      events: { kind: string; stage?: string; status?: string; detail?: string; usd?: number }[];
    };
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ chapter: 'ch01', level: 'beginner', chapters: [{ id: 'ch01' }] });

    const book = JSON.parse(readFileSync(join(root, 'mine.warqa', 'warqa.json'), 'utf8'));
    expect(book.learn).toEqual({ level: 'beginner' });
    expect(book.pipeline.budget.usd).toBe(1);
    expect(JSON.parse(readFileSync(join(root, 'mine.warqa', 'plan.json'), 'utf8')).status).toBe('approved');
    expect(prompts.find((x) => x.includes('new to this subject'))).toBeDefined();

    const progress = events.filter((e) => e.kind === 'progress');
    expect(progress.filter((e) => e.stage === 'write' && e.status === 'beat').map((e) => e.detail)).toEqual([
      'The water cycle',
      'Three states',
      'Quick check',
      'Summary',
      'Practice',
      'Finished',
    ]);
    expect(progress.every((e) => typeof e.usd === 'number')).toBe(true);
  });

  it('lists the book as a learner\'s book with its chapters made, and moves the level on feedback', async () => {
    const { projects } = (await (await app.request('/api/projects')).json()) as {
      projects: { id: string; learn?: { level: string }; made?: { id: string }[] }[];
    };
    const mine = projects.find((x) => x.id === 'mine')!;
    expect(mine.learn).toEqual({ level: 'beginner' });
    expect(mine.made?.map((m) => m.id)).toEqual(['ch01']);

    const send = (feedback: string) =>
      app.request('/api/projects/mine/learn/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
    expect(await (await send('too-easy')).json()).toEqual({ level: 'some' });
    expect(await (await send('right')).json()).toEqual({ level: 'some' });
    expect(await (await send('too-hard')).json()).toEqual({ level: 'beginner' });
    // answers about one chapter move from the level it was made at: a double click or a changed answer never
    // moves two steps
    const about = (feedback: string) =>
      app.request('/api/projects/mine/learn/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback, from: 'beginner' }),
      });
    expect(await (await about('too-easy')).json()).toEqual({ level: 'some' });
    expect(await (await about('too-easy')).json()).toEqual({ level: 'some' });
    expect(await (await about('right')).json()).toEqual({ level: 'beginner' });
    expect((await send('boring')).status).toBe(400);
    const book = JSON.parse(readFileSync(join(root, 'mine.warqa', 'warqa.json'), 'utf8'));
    expect(book.learn).toEqual({ level: 'beginner' });
  });

  it('makes the lesson without a voice where the voice cannot run (Edge voices in the web app)', async () => {
    const p = new P.Project(join(root, 'mine.warqa'));
    p.config.tts.provider = 'edge';
    p.saveBook();
    const { app: web, jobs: webJobs } = createApp({ root, llm: { fake }, capabilities: { ttsUnavailable: ['edge'] } });
    const res = await web.request('/api/projects/mine/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'learn', args: {} }),
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { args: Record<string, unknown> } };
    expect(job.args.narrate).toBe(false);
    await webJobs.idle('mine');
    expect(webJobs.list('mine')[0]).toMatchObject({ status: 'done' });
  });
});
