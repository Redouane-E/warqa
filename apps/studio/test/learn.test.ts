// The self-learner's one go through the studio API: the summary's estimate (free text read, the PDF's
// language), then the `learn` job (read → plan approved automatically → chapter 1), with a scripted model.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('reads again only some pages, keeping the others, and prices each chapter of the plan', async () => {
    const file = join(root, 'mine.warqa', 'source', 'document.json');
    const before = JSON.parse(readFileSync(file, 'utf8')) as { pages: { n: number }[] };
    const res = await app.request('/api/projects/mine/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'ingest', args: { pages: '2', ocr: 'never' } }),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    await jobs.idle('mine');
    const { job, events } = (await (await app.request(`/api/jobs/${jobId}`)).json()) as {
      job: { status: string; error?: string };
      events: { kind: string; stage?: string; status?: string; index?: number; total?: number }[];
    };
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    // progress counts the pages asked for: page 2 is 1 of 1
    const beats = events.filter((e) => e.stage === 'read' && e.status === 'beat');
    expect(beats.map((e) => [e.index, e.total])).toEqual([[0, 1]]);
    const after = JSON.parse(readFileSync(file, 'utf8')) as { pages: { n: number }[] };
    expect(after.pages.map((pg) => pg.n)).toEqual(before.pages.map((pg) => pg.n));

    // two ranges: the progress goes on from one to the next; a range past the end is refused
    const read = async (pages: string) => {
      const r = await app.request('/api/projects/mine/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'ingest', args: { pages, ocr: 'never' } }),
      });
      const { jobId: id } = (await r.json()) as { jobId: string };
      await jobs.idle('mine');
      return (await (await app.request(`/api/jobs/${id}`)).json()) as {
        job: { status: string; error?: string };
        events: { stage?: string; status?: string; index?: number; total?: number }[];
      };
    };
    const two = await read('1, 3');
    expect(two.job.status).toBe('done');
    expect(two.events.filter((e) => e.stage === 'read' && e.status === 'beat').map((e) => [e.index, e.total])).toEqual([
      [0, 2],
      [1, 2],
    ]);
    const past = await read('50-60');
    expect(past.job.status).toBe('error');
    expect(past.job.error).toMatch(/past the end/);

    const detail = (await (await app.request('/api/projects/mine')).json()) as {
      document: { read: { n: number }[]; langs: string[]; lang: string; readAt: number };
      pdfBytes: number;
      planUpdated: number;
    };
    expect(detail.document.read).toHaveLength(before.pages.length);
    expect(detail.document.langs[0]).toBe(detail.document.lang);
    expect(detail.document.readAt).toBeGreaterThan(0);
    expect(detail.pdfBytes).toBeGreaterThan(1000);
    expect(detail.planUpdated).toBeGreaterThan(0);

    const est = (await (await app.request('/api/projects/mine/estimate')).json()) as {
      plan: number;
      chapters: Record<string, number>;
      spread: number;
    };
    expect(est.chapters.ch01).toBeGreaterThan(0);
    expect(est.plan).toBeGreaterThan(0);
    expect(est.spread).toBeGreaterThan(1);
  });

  it('makes a chapter again: the chapter it is on, Stop between two beats, then the rest from there', async () => {
    type Detail = { drafts?: Record<string, { written: number; total: number }>; ledger: { byChapter?: Record<string, number> } };
    const detail = async () => (await (await app.request('/api/projects/mine')).json()) as Detail;
    // Stop pressed while the second beat is being written: the job stops once that beat is saved
    const again = jobs.enqueue('mine', 'build', { chapters: ['ch01'], narrate: false, force: ['storyboard', 'translate'] });
    const off = jobs.subscribe(again.id, (e) => {
      if (e.stage === 'write' && e.status === 'beat' && e.index === 1) jobs.cancel(again.id);
    });
    await jobs.idle('mine');
    off();
    expect(jobs.get(again.id)?.status).toBe('cancelled');
    const progress = jobs.events(again.id).filter((e) => e.kind === 'progress');
    expect(progress[0]).toMatchObject({
      stage: 'chapter',
      status: 'start',
      chapter: 'ch01',
      detail: 'The water cycle',
      n: 1, // among the chapters to make: the front matter left out has no number
      index: 0,
      total: 1,
      limit: 1,
    });
    expect(progress[0]!.estimate).toBeGreaterThan(0);
    expect(progress.filter((e) => e.status === 'beat').map((e) => e.title)).toEqual(['The water cycle', 'Three states']);
    expect(progress.every((e) => typeof e.usd === 'number')).toBe(true);
    expect((await detail()).drafts).toEqual({ ch01: { written: 2, total: 6 } });

    // Make the rest (no force): beats 3 to 6, then the chapter is made and says so
    const rest = jobs.enqueue('mine', 'build', { chapters: ['ch01'], narrate: false });
    await jobs.idle('mine');
    expect(jobs.get(rest.id)).toMatchObject({
      status: 'done',
      result: { chapters: [{ chapter: 'ch01', title: 'The water cycle', n: 1, beats: 6 }] },
    });
    const written = jobs.events(rest.id).filter((e) => e.stage === 'write' && e.status === 'beat');
    expect(written.map((e) => e.index)).toEqual([2, 3, 4, 5]);
    expect(jobs.events(rest.id).at(-1)).toMatchObject({ kind: 'status' });
    expect(jobs.events(rest.id).some((e) => e.stage === 'chapter' && e.status === 'done')).toBe(true);
    const after = await detail();
    expect(after.drafts).toBeUndefined();
    // the editor's kicker numbers the lesson among the chapters to make, as the Make step does
    const lesson = (await (await app.request('/api/projects/mine/lessons/ch01')).json()) as { chapter?: number };
    expect(lesson.chapter).toBe(1);
    expect(Object.keys(after.ledger.byChapter ?? {})).toContain('ch01');

    // Stop pressed while the last beat is written: it is taken once the lesson is saved, so nothing is lost
    const lessonFile = join(root, 'mine.warqa', 'lessons', 'ch01', 'lesson.json');
    const before = statSync(lessonFile).mtimeMs;
    const late = jobs.enqueue('mine', 'build', { chapters: ['ch01'], narrate: false, force: ['write'] });
    const stopLate = jobs.subscribe(late.id, (e) => {
      if (e.stage === 'write' && e.status === 'beat' && e.index === 5) jobs.cancel(late.id);
    });
    await jobs.idle('mine');
    stopLate();
    expect(jobs.get(late.id)?.status).toBe('cancelled');
    expect(jobs.events(late.id).filter((e) => e.stage === 'write' && e.status === 'done')).toHaveLength(1);
    expect(statSync(lessonFile).mtimeMs).toBeGreaterThan(before);
    expect((await detail()).drafts).toBeUndefined();
  });

  it('writes a beat again as a candidate to compare, then keeps it, then takes it back', async () => {
    const lessonUrl = '/api/projects/mine/lessons/ch01';
    const lessonFile = join(root, 'mine.warqa', 'lessons', 'ch01', 'lesson.json');
    const before = readFileSync(lessonFile, 'utf8');
    const mtime = statSync(lessonFile).mtimeMs;
    const job = jobs.enqueue('mine', 'rewrite', { lesson: 'ch01', beat: 'states', instruction: 'Shorter.', candidate: true });
    await jobs.idle('mine');
    expect(jobs.get(job.id)).toMatchObject({ status: 'done', result: { beat: 'states', candidate: true } });
    // the lesson was never written meanwhile (a save made while it ran stays); the new version waits, with its
    // cost shown beside the next Regenerate
    expect(statSync(lessonFile).mtimeMs).toBe(mtime);
    expect(readFileSync(lessonFile, 'utf8')).toBe(before);
    const d = (await (await app.request(lessonUrl)).json()) as {
      candidates?: Record<string, { instruction?: string }>;
      rewriteUsd?: number;
    };
    expect(d.candidates?.states?.instruction).toBe('Shorter.');
    expect(d.rewriteUsd).toBeGreaterThan(0);
    // the judge's note on a beat comes with the lesson (red pen on the stage)
    mkdirSync(join(root, 'mine.warqa', 'qa', 'ch01'), { recursive: true });
    writeFileSync(
      join(root, 'mine.warqa', 'qa', 'ch01', 'en-judge.json'),
      JSON.stringify([{ id: 'states', score: 2, problem: 'The labels overlap.', fix: 'Put the labels apart.' }]),
    );
    const judged = (await (await app.request(lessonUrl)).json()) as { judge?: Record<string, unknown> };
    expect(judged.judge?.states).toEqual({ score: 2, problem: 'The labels overlap.', fix: 'Put the labels apart.' });
    // "After" on the stage: the player gets the lesson with the new version in it
    const candFile = join(root, 'mine.warqa', 'lessons', 'ch01', 'candidates', 'states.json');
    const cand = JSON.parse(readFileSync(candFile, 'utf8'));
    // (its marks kept: its cues wait on them)
    cand.beat.narration = `A new version. ${cand.beat.narration}`;
    writeFileSync(candFile, JSON.stringify(cand));
    const after = (await (await app.request(`${lessonUrl}/player?candidate=states`)).json()) as {
      lesson: { beats: { id: string; narration: string }[] };
      timings: Record<string, Record<string, { marks: Record<string, number> }>>;
    };
    expect(after.lesson.beats.find((b) => b.id === 'states')?.narration).toBe(cand.beat.narration);
    expect(after.timings.en?.states).toBeDefined();
    // the beat saved with changes since: Compare says so
    const saved = JSON.parse(before);
    saved.beats.find((b: { id: string }) => b.id === 'states').title = 'States, renamed';
    const put = await app.request(`${lessonUrl}?force=1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(saved),
    });
    expect(put.status).toBe(200);
    const changed = (await (await app.request(lessonUrl)).json()) as { candidates?: Record<string, { changed?: boolean }> };
    expect(changed.candidates?.states?.changed).toBe(true);
    // a version that breaks the lesson is refused, and the lesson stays
    const broken = { ...cand, beat: { ...cand.beat, cues: [{ at: 'start', do: 'show', target: 'nowhere' }] } };
    writeFileSync(candFile, JSON.stringify(broken));
    const refused = await app.request(`${lessonUrl}/beats/states/accept`, { method: 'POST' });
    expect(refused.status).toBe(409);
    expect(JSON.parse(readFileSync(lessonFile, 'utf8')).beats).toEqual(saved.beats);
    writeFileSync(candFile, JSON.stringify(cand));
    // keep it: the candidate goes, the old version is kept for Undo
    const kept = await app.request(`${lessonUrl}/beats/states/accept`, { method: 'POST' });
    expect(kept.status).toBe(200);
    expect(((await (await app.request(lessonUrl)).json()) as { candidates?: unknown }).candidates).toBeUndefined();
    expect(existsSync(join(root, 'mine.warqa', 'lessons', 'ch01', 'history', 'states.json'))).toBe(true);
    expect(JSON.parse(readFileSync(lessonFile, 'utf8')).beats.find((b: { id: string }) => b.id === 'states').narration).toBe(
      cand.beat.narration,
    );
    // the judge's note was about the old version: it goes with it
    expect(((await (await app.request(lessonUrl)).json()) as { judge?: unknown }).judge).toBeUndefined();
    // Undo: the old version back, and its note
    const back = await app.request(`${lessonUrl}/beats/states/restore`, { method: 'POST' });
    expect(back.status).toBe(200);
    expect(JSON.parse(readFileSync(lessonFile, 'utf8')).beats).toEqual(saved.beats);
    expect(((await (await app.request(lessonUrl)).json()) as { judge?: Record<string, unknown> }).judge?.states).toBeDefined();
    expect((await app.request(`${lessonUrl}/beats/states/restore`, { method: 'POST' })).status).toBe(404);
    // a candidate dropped ("Keep the old version")
    const again = jobs.enqueue('mine', 'rewrite', { lesson: 'ch01', beat: 'states', candidate: true });
    await jobs.idle('mine');
    expect(jobs.get(again.id)?.status).toBe('done');
    expect((await app.request(`${lessonUrl}/beats/states/candidate`, { method: 'DELETE' })).status).toBe(200);
    expect(((await (await app.request(lessonUrl)).json()) as { candidates?: unknown }).candidates).toBeUndefined();
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
