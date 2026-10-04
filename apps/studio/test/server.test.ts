// API tests: a temp root with a created project, settings round-trip, lesson validation, file access rules,
// keys, and a job streamed over SSE.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { zipPath } from '../src/server/zip.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, '../../../examples/integers.warqa');

let root: string;
let home: string;
let app: ReturnType<typeof createApp>['app'];
let jobs: ReturnType<typeof createApp>['jobs'];
let id: string;
let dir: string;

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const PDF = new TextEncoder().encode('%PDF-1.4\n% studio test\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'warqa-studio-test-'));
  home = mkdtempSync(join(tmpdir(), 'warqa-studio-home-'));
  process.env.WARQA_HOME = home;
  ({ app, jobs } = createApp({ root }));

  const form = new FormData();
  form.set('pdf', new File([PDF], 'Maths 1AC.pdf', { type: 'application/pdf' }));
  form.set('title', 'Maths première année');
  form.set('langs', 'ar,fr,en');
  form.set('defaultLang', 'fr');
  form.set('audience', 'collégiens');
  const res = await app.request('/api/projects', { method: 'POST', body: form });
  expect(res.status).toBe(201);
  const p = (await res.json()) as { id: string; book: { defaultLang: string; langs: string[] } };
  id = p.id;
  dir = join(root, `${id}.warqa`);
  expect(p.book.defaultLang).toBe('fr');
  // give the project the example lesson (en) with its translations and an audio clip
  cpSync(join(example, 'lessons', 'ch05', 'lesson.json'), join(dir, 'lessons', 'ch05', 'lesson.json'));
  for (const l of ['fr', 'ar']) cpSync(join(example, 'lessons', 'ch05', `strings.${l}.json`), join(dir, 'lessons', 'ch05', `strings.${l}.json`));
  mkdirSync(join(dir, 'lessons', 'ch05', 'audio', 'en'), { recursive: true });
  writeFileSync(join(dir, 'lessons', 'ch05', 'audio', 'en', 'intro.mp3'), new Uint8Array(1000).map((_, i) => i % 256));
  mkdirSync(join(dir, 'cache', 'llm'), { recursive: true });
  writeFileSync(join(dir, 'cache', 'llm', 'x.json'), '{}');
});

afterAll(() => {
  rmSync(zipPath(dir), { force: true });
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('projects', () => {
  it('creates a project folder with the PDF and lists it', async () => {
    expect(id).toBe('maths-premiere-annee');
    expect(existsSync(join(dir, 'warqa.json'))).toBe(true);
    expect(existsSync(join(dir, 'source', 'Maths_1AC.pdf'))).toBe(true);
    const r = (await (await app.request('/api/projects')).json()) as { projects: { id: string; hasPdf: boolean; steps: Record<string, string> }[] };
    const p = r.projects.find((x) => x.id === id)!;
    expect(p.hasPdf).toBe(true);
    expect(p.steps.read).toBe('ready');
  });

  it('rejects a file that is not a PDF', async () => {
    const form = new FormData();
    form.set('pdf', new File(['hello'], 'notes.pdf'));
    form.set('langs', 'en');
    const res = await app.request('/api/projects', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('answers 404 for an unknown project', async () => {
    const res = await app.request('/api/projects/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/no project/);
  });
});

describe('settings', () => {
  it('round-trips book and pipeline settings', async () => {
    const res = await app.request(
      `/api/projects/${id}/settings`,
      json('PUT', {
        langs: ['ar', 'fr', 'en', 'es'],
        defaultLang: 'ar',
        audience: 'élèves',
        tone: 'chaleureux',
        preset: 'google',
        models: { writer: 'openrouter:qwen/qwen3.8-flash', judge: '' },
        tts: { provider: 'azure', voices: { ar: 'ar-MA-JamalNeural' }, rate: '-4%', tashkeel: true },
        budget: { usd: 3.5 },
        worker: 'http://localhost:8790',
        digits: 'arab',
        title: { ar: 'الرياضيات', es: 'Matemáticas' },
      }),
    );
    expect(res.status).toBe(200);
    const d = (await (await app.request(`/api/projects/${id}`)).json()) as {
      book: { langs: string[]; defaultLang: string; digits: string; title: Record<string, string> };
      config: { preset: string; models: Record<string, string>; tts: { provider: string; voices: Record<string, string>; rate: string; tashkeel: boolean }; budget: { usd: number }; worker: string; tone: string };
      roles: Record<string, { model?: string }>;
    };
    expect(d.book.langs).toEqual(['ar', 'fr', 'en', 'es']);
    expect(d.book.defaultLang).toBe('ar');
    expect(d.book.digits).toBe('arab');
    expect(d.book.title).toMatchObject({ fr: 'Maths première année', ar: 'الرياضيات', es: 'Matemáticas' });
    expect(d.config.preset).toBe('google');
    expect(d.config.models).toEqual({ writer: 'openrouter:qwen/qwen3.8-flash' });
    expect(d.config.tts).toMatchObject({ provider: 'azure', voices: { ar: 'ar-MA-JamalNeural' }, rate: '-4%', tashkeel: true });
    expect(d.config.budget.usd).toBe(3.5);
    expect(d.config.worker).toBe('http://localhost:8790');
    expect(d.roles.writer?.model).toBe('openrouter:qwen/qwen3.8-flash');
    expect(d.roles.planner?.model).toMatch(/^google:/);
    // clearing works too
    await app.request(`/api/projects/${id}/settings`, json('PUT', { langs: ['ar', 'fr', 'en'], budget: { usd: null }, preset: null, worker: null }));
    const raw = JSON.parse(readFileSync(join(dir, 'warqa.json'), 'utf8'));
    expect(raw.langs).toEqual(['ar', 'fr', 'en']);
    expect(raw.pipeline.budget.usd).toBeUndefined();
    expect(raw.pipeline.preset).toBeUndefined();
    expect(raw.pipeline.worker).toBeUndefined();
  });

  it('refuses bad values', async () => {
    expect((await app.request(`/api/projects/${id}/settings`, json('PUT', { models: { writer: 'no-provider' } }))).status).toBe(400);
    expect((await app.request(`/api/projects/${id}/settings`, json('PUT', { models: { painter: 'openai:x' } }))).status).toBe(400);
    expect((await app.request(`/api/projects/${id}/settings`, json('PUT', { tts: { provider: 'robot' } }))).status).toBe(400);
    expect((await app.request(`/api/projects/${id}/settings`, json('PUT', { defaultLang: 'de' }))).status).toBe(400);
  });
});

describe('keys', () => {
  it('stores keys outside projects, mode 0600, masked to the last 4 characters', async () => {
    const res = await app.request('/api/keys', json('PUT', { MISTRAL_API_KEY: 'sk-test-0123456789wxyz' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: { name: string; masked?: string; source?: string }[] };
    const k = body.keys.find((x) => x.name === 'MISTRAL_API_KEY')!;
    expect(k.masked).toBe('••••wxyz');
    expect(k.source).toBe('studio');
    expect(JSON.stringify(body)).not.toContain('0123456789');
    const file = join(home, 'keys.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(process.env.MISTRAL_API_KEY).toBe('sk-test-0123456789wxyz');
    expect(readFileSync(join(dir, 'warqa.json'), 'utf8')).not.toContain('sk-test');
    await app.request('/api/keys', json('PUT', { MISTRAL_API_KEY: null }));
    expect(process.env.MISTRAL_API_KEY).toBeUndefined();
    expect((await app.request('/api/keys', json('PUT', { 'bad name': 'x' }))).status).toBe(400);
  });

  it('refuses requests from other sites', async () => {
    const res = await app.request('/api/keys', json('PUT', { OPENAI_API_KEY: 'x' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    const rebinding = await app.request('http://evil.example/api/keys');
    expect(rebinding.status).toBe(403);
  });
});

describe('lessons', () => {
  const lessonUrl = () => `/api/projects/${id}/lessons/ch05`;
  const original = () => JSON.parse(readFileSync(join(example, 'lessons', 'ch05', 'lesson.json'), 'utf8'));

  it('returns the lesson with strings, string table and issues', async () => {
    const res = await app.request(lessonUrl());
    expect(res.status).toBe(200);
    const d = (await res.json()) as { lesson: { beats: unknown[] }; strings: Record<string, unknown>; entries: unknown[]; issues: { level: string; lang?: string }[]; langs: string[] };
    expect(d.lesson.beats.length).toBe(14);
    expect(Object.keys(d.strings).sort()).toEqual(['ar', 'fr']);
    expect(d.entries.length).toBeGreaterThan(50);
    expect(d.langs).toEqual(['ar', 'fr', 'en']);
  });

  it('saves a valid lesson and blocks one with errors unless forced', async () => {
    const good = original();
    good.beats[0].title = 'A new title';
    const ok = await app.request(lessonUrl(), json('PUT', good));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { saved: boolean }).saved).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8')).beats[0].title).toBe('A new title');

    const bad = original();
    bad.beats[0].narration = bad.beats[0].narration.replace('[[key]]', '[[nokey]]');
    const dry = await app.request(`${lessonUrl()}?dry=1`, json('PUT', bad));
    expect(((await dry.json()) as { issues: { level: string; lang?: string }[] }).issues.some((i) => i.level === 'error' && !i.lang)).toBe(true);
    const blocked = await app.request(lessonUrl(), json('PUT', bad));
    expect(blocked.status).toBe(422);
    const b = (await blocked.json()) as { saved: boolean; issues: { message: string }[] };
    expect(b.saved).toBe(false);
    expect(b.issues.some((i) => /unknown mark "key"/.test(i.message))).toBe(true);
    expect(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8')).not.toContain('[[nokey]]');

    const forced = await app.request(`${lessonUrl()}?force=1`, json('PUT', bad));
    expect(forced.status).toBe(200);
    expect(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8')).toContain('[[nokey]]');
  });

  it('never saves a lesson that breaks the schema or changes its id', async () => {
    const broken = { ...original(), beats: [] };
    const r1 = await app.request(`${lessonUrl()}?force=1`, json('PUT', broken));
    expect(r1.status).toBe(422);
    const renamed = { ...original(), id: 'other' };
    expect((await app.request(lessonUrl(), json('PUT', renamed))).status).toBe(422);
    expect((await app.request(lessonUrl(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{oops' })).status).toBe(400);
  });

  it('saves translations and reports mark problems', async () => {
    await app.request(lessonUrl(), json('PUT', original()));
    const fr = JSON.parse(readFileSync(join(example, 'lessons', 'ch05', 'strings.fr.json'), 'utf8'));
    fr['beat.intro.narration'] = 'Sept moins trois font quatre.';
    const res = await app.request(`${lessonUrl()}/strings/fr`, json('PUT', fr));
    expect(res.status).toBe(200);
    const d = (await res.json()) as { stringIssues: { fr: Record<string, string[]> } };
    expect(d.stringIssues.fr['beat.intro.narration']?.[0]).toMatch(/marks must be/);
    expect((await app.request(`${lessonUrl()}/strings/en`, json('PUT', {}))).status).toBe(400);
  });

  it('serves player data with audio URLs on the files endpoint', async () => {
    const d = (await (await app.request(`${lessonUrl()}/player?lang=fr`)).json()) as { lang: string; langs: string[]; audio: Record<string, Record<string, string>>; timings: Record<string, unknown> };
    expect(d.lang).toBe('fr');
    expect(d.langs).toContain('en');
    expect(d.audio.en?.intro).toMatch(new RegExp(`^/api/projects/${id}/files/lessons/ch05/audio/en/intro\\.mp3\\?v=\\d+$`));
    expect(Object.keys(d.timings).sort()).toEqual(['ar', 'en', 'fr']);
  });
});

describe('files', () => {
  const f = (p: string, init?: RequestInit) => app.request(`/api/projects/${id}/files/${p}`, init);

  it('serves lesson audio with Range support', async () => {
    const full = await f('lessons/ch05/audio/en/intro.mp3');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    const part = await f('lessons/ch05/audio/en/intro.mp3', { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]));
    expect((await f('lessons/ch05/audio/en/intro.mp3', { headers: { range: 'bytes=5000-' } })).status).toBe(416);
  });

  it('blocks path traversal and private files', async () => {
    for (const p of ['..%2fwarqa.json', 'lessons/..%2f..%2fwarqa.json', 'lessons/%2e%2e/%2e%2e/warqa.json', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'lessons/ch05/..%5c..%5cwarqa.json']) {
      const res = await f(p);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('warqa.book');
    }
    expect((await f('warqa.json')).status).toBe(403);
    expect((await f('source/Maths_1AC.pdf')).status).toBe(403);
    expect((await f('cache/llm/x.json')).status).toBe(403);
    expect((await f('.ledger.jsonl')).status).toBe(403);
    expect((await f('lessons/ch05/lesson.json')).status).toBe(200);
  });

  it('serves the player bundle', async () => {
    const res = await app.request('/player/player.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Warqa');
    expect((await app.request('/player/..%2fpackage.json')).status).toBe(403);
  });
});

describe('jobs', () => {
  it('runs an export job, streams its events over SSE, and serves the book', async () => {
    const res = await app.request(`/api/projects/${id}/jobs`, json('POST', { type: 'export' }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    await jobs.idle(id);
    const info = (await (await app.request(`/api/jobs/${jobId}`)).json()) as { job: { status: string; result: { lessons: string[]; url: string } } };
    expect(info.job.status).toBe('done');
    expect(info.job.result.lessons).toEqual(['ch05']);
    const sse = await app.request(`/api/jobs/${jobId}/events`);
    expect(sse.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await sse.text();
    expect(text).toContain('event: progress');
    expect(text).toContain('event: result');
    expect(text).toContain('event: end');
    const resumed = await (await app.request(`/api/jobs/${jobId}/events`, { headers: { 'last-event-id': '3' } })).text();
    expect(resumed).not.toContain('"seq":1,');
    const book = await app.request(`/books/${id}/`);
    expect(book.status).toBe(200);
    expect(await book.text()).toContain('WARQA_BOOK');
    expect((await app.request(`/books/${id}/ch05/audio/en/intro.mp3`, { headers: { range: 'bytes=0-9' } })).status).toBe(206);
    expect((await app.request(`/books/${id}/..%2fwarqa.json`)).status).toBe(403);
  });

  it('queues jobs one at a time per project and can cancel a queued job', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const local = createApp({
      root,
      runners: {
        estimate: async () => {
          order.push('first:start');
          await gate;
          order.push('first:end');
          return 1;
        },
        export: async () => {
          order.push('second');
          return 2;
        },
        plan: async () => 3,
      },
    });
    const a = local.jobs.enqueue(id, 'estimate');
    const b = local.jobs.enqueue(id, 'export');
    const c = local.jobs.enqueue(id, 'plan');
    expect(local.jobs.cancel(c.id)?.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 20));
    expect(local.jobs.get(b.id)?.status).toBe('queued');
    release();
    await local.jobs.idle(id);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(local.jobs.get(a.id)?.status).toBe('done');
    expect(local.jobs.get(c.id)?.status).toBe('cancelled');
  });

  it('rejects unknown job types', async () => {
    expect((await app.request(`/api/projects/${id}/jobs`, json('POST', { type: 'launch' }))).status).toBe(400);
  });
});
