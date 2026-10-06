// API tests of the book-wide features: the translation review queue (list, approve, edit, approve many, CSV out
// and back in, glossary flags), the player data (typeset math, component packs and their route), and the jobs
// that improve lessons with the judge, add map regions and export a teacher review kit (with stub judges,
// a scripted model and a fake network).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { checkLesson, FakeModel, ImproveOptions, judgeLesson } from '@warqa/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { geoRunner, improveRunner, qaRunner, RUNNERS } from '../src/server/jobs.js';
import { panelZipPath } from '../src/server/zip.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, '../../../examples/integers.warqa');

let root: string;
let home: string;
let app: ReturnType<typeof createApp>['app'];
let jobs: ReturnType<typeof createApp>['jobs'];
const id = 'integers';
let dir: string;

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const get = async <T>(url: string) => (await (await app.request(url)).json()) as T;

/** A rewritten beat from the scripted model (rewriteBeat asks for "beat:<lesson>:<beat>"). */
const fake: FakeModel = ({ name }) => {
  if (name.startsWith('beat'))
    return JSON.stringify({
      title: 'Opposites',
      narration: 'Every number has an opposite. [[b]]They sit at the same distance from zero.',
      // later beats keep the number line this beat puts on stage
      scene: {
        clear: true,
        add: [
          { id: 'zz-text', type: 'text', text: 'Same distance from zero', slot: 'title' },
          { id: 'nl', type: 'numberline', min: -8, max: 8 },
        ],
      },
      cues: [{ at: 'b', do: 'show', target: 'zz-text' }],
      sources: [{ page: 1 }],
    });
  throw new Error(`unexpected call ${name}`);
};

/** The judge without Playwright: "inverse" is weak the first time, fine after its rewrite. */
let judged = 0;
/** A check that "draws" every beat of ch05 (a tiny picture each) and finds labels overlapping on its second beat. */
const stubCheck: typeof checkLesson = async (o) => {
  const lesson = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8')) as {
    beats: { id: string; move: string; scene: { add: { id: string }[] } }[];
  };
  mkdirSync(o.shots!, { recursive: true });
  const ends: Record<number, string> = {};
  const thumbs: Record<number, string> = {};
  lesson.beats.forEach((_, i) => {
    ends[i] = join(o.shots!, `b${String(i).padStart(2, '0')}_end.png`);
    thumbs[i] = ends[i]!.replace(/\.png$/, '.jpg');
    writeFileSync(ends[i]!, 'png');
    writeFileSync(thumbs[i]!, 'jpg');
    o.onBeat?.(i, lesson.beats.length);
  });
  const second = lesson.beats[1]!;
  const parts = lesson.beats.flatMap((b) => b.scene.add.map((n) => n.id));
  return {
    beats: lesson.beats.length,
    shots: Object.values(ends),
    sheets: [],
    ends,
    thumbs,
    beatInfo: lesson.beats.map((b, i) => ({ id: b.id, index: i, dur: 12, end: 12, ask: false, move: b.move })),
    issues: [
      {
        beat: 1,
        id: second.id,
        kind: 'overlap',
        message: 'nodes overlap',
        nodes: parts.slice(0, 2),
        box: { x: 100, y: 100, w: 80, h: 40 },
      },
    ],
  };
};
/** The judge scores the first beat 2/5 and the others 5 (it writes its verdict as the real one does). */
const stubJudge: typeof judgeLesson = async (p, lessonId, o) => {
  const lesson = p.loadLesson(lessonId);
  const v = lesson.beats
    .filter((b) => !b.questions?.length && b.move !== 'finish')
    .map((b, i) => (i === 0 ? { id: b.id, score: 2, problem: 'Too small.', fix: 'Make it bigger.' } : { id: b.id, score: 5 }));
  p.writeJson(`qa/${lessonId}/${o.lang}-judge.json`, v);
  return v;
};

const judge: NonNullable<ImproveOptions['judge']> = async () => {
  judged++;
  return judged % 2 === 1
    ? [
        { id: 'intro', score: 5 },
        { id: 'inverse', score: 2, problem: 'the picture shows nothing', fix: 'show the distance to zero' },
      ]
    : [
        { id: 'intro', score: 5 },
        { id: 'inverse', score: 4 },
      ];
};

/** geoBoundaries without the network: its metadata, then a two-region GeoJSON. */
const square = (x: number) => [
  [
    [x, 30],
    [x + 1, 30],
    [x + 1, 31],
    [x, 31],
    [x, 30],
  ],
];
const fakeFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes('/api/current/gbOpen/MAR/ADM1/'))
    return Response.json({
      gjDownloadURL: 'https://example.test/mar.geojson',
      boundarySource: 'OpenStreetMap',
      boundaryLicense: 'Open Data Commons Open Database License 1.0',
      boundaryYearRepresented: '2023',
    });
  if (u === 'https://example.test/mar.geojson')
    return Response.json({
      type: 'FeatureCollection',
      features: [
        { properties: { shapeName: 'Oriental', shapeISO: 'MA-02' }, geometry: { type: 'Polygon', coordinates: square(-3) } },
        { properties: { shapeName: 'Souss-Massa', shapeISO: 'MA-09' }, geometry: { type: 'Polygon', coordinates: square(-9) } },
      ],
    });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'warqa-studio-features-'));
  home = mkdtempSync(join(tmpdir(), 'warqa-studio-features-home-'));
  process.env.WARQA_HOME = home;
  dir = join(root, 'integers.warqa');
  // the example book's sources (not its export or caches)
  cpSync(example, dir, {
    recursive: true,
    filter: (src) => !/[\\/](dist|cache|qa)([\\/]|$)/.test(src.slice(example.length)),
  });
  // a component pack, a lesson with display math, and what "improve" needs (the read PDF and an approved plan)
  mkdirSync(join(dir, 'packs'), { recursive: true });
  writeFileSync(join(dir, 'packs', 'clock.js'), '(globalThis.WARQA_PACKS ||= []).push(function () {});\n');
  const book = JSON.parse(readFileSync(join(dir, 'warqa.json'), 'utf8'));
  book.pipeline = { ...book.pipeline, components: ['packs/clock.js'] };
  book.pipeline.models = Object.fromEntries(
    ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'].map((r) => [r, 'anthropic:claude-sonnet-5-5']),
  );
  writeFileSync(join(dir, 'warqa.json'), JSON.stringify(book, null, 2));
  mkdirSync(join(dir, 'lessons', 'mx'), { recursive: true });
  writeFileSync(
    join(dir, 'lessons', 'mx', 'lesson.json'),
    JSON.stringify({
      schema: 'warqa.lesson/1',
      id: 'mx',
      title: 'Fractions',
      lang: 'en',
      beats: [
        {
          id: 'b',
          title: 'B',
          move: 'example',
          narration: 'A half.',
          scene: { clear: true, add: [{ id: 'm', type: 'math', steps: ['\\frac{1}{2}'] }] },
          cues: [],
        },
      ],
    }),
  );
  mkdirSync(join(dir, 'source'), { recursive: true });
  writeFileSync(
    join(dir, 'source', 'document.json'),
    JSON.stringify({
      schema: 'warqa.document/1',
      source: { file: 'integers.pdf', pages: 2, sha1: 'x', title: 'Integers' },
      lang: 'en',
      outline: [],
      pages: [1, 2].map((n) => ({ n, width: 600, height: 800, method: 'text', quality: 'ok' })),
      blocks: [{ id: 'p1b0', page: 1, kind: 'paragraph', text: 'The opposite of 3 is −3.', bbox: [0, 0, 600, 40] }],
      sections: [{ id: 'ch05', title: 'Integers', start: 1, end: 2 }],
    }),
  );
  writeFileSync(
    join(dir, 'plan.json'),
    JSON.stringify({
      status: 'approved',
      title: 'Integers',
      audience: 'middle school',
      lang: 'en',
      chapters: [
        {
          id: 'ch05',
          section: 'ch05',
          title: 'Subtracting',
          pages: [1, 2],
          objectives: ['Subtract integers'],
          minutes: 6,
          visuals: [],
          packs: ['core', 'stem'],
          include: true,
        },
      ],
      // a term the French translation does not use: every string about "opposite" gets a glossary flag
      glossary: [{ terms: { en: 'opposite', fr: 'zzsymétrique' } }],
      conventions: { notation: '', colors: '', tone: '' },
    }),
  );
  ({ app, jobs } = createApp({
    root,
    runners: {
      ...RUNNERS,
      improve: improveRunner({ judge }),
      geo: geoRunner({ fetch: fakeFetch }),
      qa: qaRunner({ check: stubCheck, judge: stubJudge }),
    },
    llm: { fake },
    // the checks run with stubs here: this computer's Playwright and ffmpeg do not matter
    capabilities: { playwright: true, ffmpeg: true },
  }));
});

afterAll(() => {
  rmSync(panelZipPath(dir), { force: true });
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

interface Item {
  lesson: string;
  key: string;
  kind: string;
  source: string;
  text: string;
  state: string;
  flags: string[];
}
interface Review {
  items: Item[];
  counts: Record<string, number>;
  lessons: { id: string; title: string }[];
  sourceLangs: Record<string, string>;
}

describe('translation review', () => {
  it('lists every string of a language with its state, counts and glossary flags', async () => {
    const r = await get<Review>(`/api/projects/${id}/review/fr`);
    expect(r.items.length).toBeGreaterThan(20);
    expect(r.counts.total).toBe(r.items.length);
    expect(r.counts.machine).toBeGreaterThan(0);
    expect(r.counts.missing).toBe(r.items.filter((i) => i.state === 'missing').length);
    expect(r.sourceLangs.ch05).toBe('en');
    const flagged = r.items.filter((i) => i.flags.some((f) => f.includes('zzsymétrique')));
    expect(flagged.length).toBeGreaterThan(0);
    expect(r.counts.flagged).toBeGreaterThanOrEqual(flagged.length);
    expect((await app.request(`/api/projects/${id}/review/x!`)).status).toBe(400);
  });

  it('approves a string, saves an edit, approves many at once', async () => {
    const { items } = await get<Review>(`/api/projects/${id}/review/fr`);
    const [a, b, c, d] = items.filter((i) => i.lesson === 'ch05' && i.state === 'machine' && i.kind !== 'math-template');
    let res = await app.request(`/api/projects/${id}/review/fr/strings`, json('POST', { lesson: 'ch05', key: a!.key }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'approved', item: { key: a!.key, state: 'approved' } });

    res = await app.request(
      `/api/projects/${id}/review/fr/strings`,
      json('POST', { lesson: 'ch05', key: b!.key, text: `${b!.text} (revu)` }),
    );
    expect(await res.json()).toMatchObject({ state: 'edited', item: { text: `${b!.text} (revu)` } });
    const strings = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'strings.fr.json'), 'utf8'));
    expect(strings[b!.key]).toBe(`${b!.text} (revu)`);
    // the book's translation memory keeps the person's wording for later chapters
    const tm = JSON.parse(readFileSync(join(dir, 'tm', 'en-fr.json'), 'utf8'));
    expect(tm.entries[b!.source.replace(/\s+/g, ' ').trim()]).toMatchObject({ status: 'edited' });

    res = await app.request(
      `/api/projects/${id}/review/fr/approve`,
      json('POST', {
        items: [
          { lesson: 'ch05', key: c!.key },
          { lesson: 'ch05', key: d!.key },
          { lesson: 'nope', key: 'x' },
        ],
      }),
    );
    expect(await res.json()).toMatchObject({ approved: 2, errors: [{ key: 'nope/x' }] });
    const after = await get<Review>(`/api/projects/${id}/review/fr`);
    const state = (k: string) => after.items.find((i) => i.lesson === 'ch05' && i.key === k)?.state;
    expect([state(a!.key), state(b!.key), state(c!.key), state(d!.key)]).toEqual([
      'approved',
      'edited',
      'approved',
      'approved',
    ]);
    expect(after.counts.approved).toBeGreaterThanOrEqual(3);
  });

  it('refuses a translation that breaks the marks of its narration', async () => {
    const { items } = await get<Review>(`/api/projects/${id}/review/fr`);
    const n = items.find((i) => i.lesson === 'ch05' && /\[\[\w+\]\]/.test(i.source))!;
    const res = await app.request(
      `/api/projects/${id}/review/fr/strings`,
      json('POST', { lesson: 'ch05', key: n.key, text: 'Plus aucun repère.' }),
    );
    expect(res.status).toBe(422);
  });

  it('downloads the queue as CSV and imports a reviewed sheet', async () => {
    const res = await app.request(`/api/projects/${id}/review/fr.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/integers-review-fr\.csv/);
    const raw = new Uint8Array(await res.arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: spreadsheets show Arabic and accents right
    const csv = new TextDecoder().decode(raw);
    expect(csv.split('\r\n')[0]).toBe('lesson,key,where,state,problems,source,translation,ok');

    const { items } = await get<Review>(`/api/projects/${id}/review/fr`);
    const [e, o] = items.filter((i) => i.lesson === 'ch05' && i.state === 'machine' && i.kind === 'text');
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const sheet = [
      'lesson,key,translation,ok',
      `ch05,${e!.key},${q(`${e!.text} !`)},`,
      `ch05,${o!.key},${q(o!.text)},oui`,
      `../../evil,lesson.title,${q('x')},yes`,
    ].join('\n');
    const imp = await app.request(`/api/projects/${id}/review/fr/import`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: sheet,
    });
    expect(imp.status).toBe(200);
    const r = (await imp.json()) as { edited: number; approved: number; errors: { key: string }[] };
    expect(r).toMatchObject({ edited: 1, approved: 1 });
    expect(r.errors.map((x) => x.key)).toEqual(['../../evil']);
    expect(existsSync(join(root, 'evil'))).toBe(false);
    const bad = await app.request(`/api/projects/${id}/review/fr/import`, { method: 'POST', body: 'a,b\n1,2' });
    expect(bad.status).toBe(422);
  });
});

describe('the book’s languages (Translate & narrate)', () => {
  type Lang = {
    lang: string;
    role: string;
    texts: number;
    translated: number;
    checked: number;
    audio: { chapters: number; narrated: number; changed: number; seconds: number };
    voice: { engine: string; name: string; sample: boolean };
  };
  type Item = Review['items'][number] & {
    beat?: { n: number; id: string };
    field: string;
    problems: { code: string; lost?: string[]; blocking: boolean }[];
    glossary: { term: string; expected: string; used: boolean }[];
    before?: string;
    reviewed?: { by?: string };
    chapter?: number;
  };

  it('sums up each language: the original, how much is translated and checked, its voice and recordings', async () => {
    const { languages } = await get<{ languages: Lang[] }>(`/api/projects/${id}/languages`);
    const en = languages.find((l) => l.lang === 'en')!;
    const fr = languages.find((l) => l.lang === 'fr')!;
    expect(en.role).toBe('original');
    expect(en.texts).toBeGreaterThan(20);
    expect(fr.role).toBe('translation');
    expect(fr.translated).toBeGreaterThan(20);
    expect(fr.checked).toBeGreaterThan(0); // the earlier review tests checked some
    expect(fr.audio.narrated).toBeGreaterThan(0);
    expect(fr.audio.seconds).toBeGreaterThan(10);
    expect(fr.voice.name).toBeTruthy();
    expect(fr.voice.sample).toBe(true);
    // the sample is the book's own recording: nothing is synthesized
    const sample = await app.request(`/api/projects/${id}/voices/fr/sample`);
    expect(sample.status).toBe(200);
    expect(sample.headers.get('content-type')).toMatch(/audio/);
  });

  it('says where each string sits, its coded problems and the glossary term it should use', async () => {
    const { items, lessons } = await get<{ items: Item[]; lessons: { id: string; n?: number }[] }>(
      `/api/projects/${id}/review/fr`,
    );
    const narr = items.find((i) => i.key === 'beat.rule.narration')!;
    expect(narr.field).toBe('narration');
    expect(narr.beat).toMatchObject({ n: 3, id: 'rule' });
    expect(narr.chapter).toBe(lessons.find((l) => l.id === 'ch05')?.n);
    const glossed = items.find((i) => i.glossary.some((g) => g.expected === 'zzsymétrique'))!;
    expect(glossed.glossary[0]).toMatchObject({ term: 'opposite', used: false });
    expect(glossed.problems.some((p) => p.code === 'glossary' && !p.blocking)).toBe(true);
  });

  it('keeps a person’s wording when its original changes, and lets them keep it', async () => {
    const res = await app.request(
      `/api/projects/${id}/review/fr/strings`,
      json('POST', { lesson: 'ch05', key: 'beat.intro.title', text: 'Soustraire, à ma façon' }),
    );
    expect(((await res.json()) as { item: Item }).item.reviewed?.by).toBe('studio');
    // the author changes the original
    const lesson = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8'));
    const was = lesson.beats.find((b: { id: string }) => b.id === 'intro').title;
    lesson.beats.find((b: { id: string }) => b.id === 'intro').title = 'Subtracting, told again';
    const put = await app.request(`/api/projects/${id}/lessons/ch05?force=1`, json('PUT', lesson));
    expect(put.status).toBe(200);
    let item = (await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`)).items.find(
      (i) => i.key === 'beat.intro.title',
    )!;
    expect(item).toMatchObject({ state: 'stale', before: was, text: 'Soustraire, à ma façon' });
    const kept = await app.request(
      `/api/projects/${id}/review/fr/strings`,
      json('POST', { lesson: 'ch05', key: 'beat.intro.title', keep: true }),
    );
    item = ((await kept.json()) as { item: Item }).item;
    expect(item.state).toBe('edited');
    expect(item.before).toBeUndefined();
  });

  it('takes back approvals given many at once', async () => {
    const { items } = await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`);
    const shown = items.filter((i) => i.lesson === 'ch05' && i.state === 'machine' && !i.problems.length).slice(0, 3);
    const body = { items: shown.map((i) => ({ lesson: i.lesson, key: i.key })) };
    expect(await (await app.request(`/api/projects/${id}/review/fr/approve`, json('POST', body))).json()).toMatchObject(
      { approved: 3 },
    );
    await app.request(`/api/projects/${id}/review/fr/approve`, json('POST', { ...body, approve: false }));
    const after = (await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`)).items;
    expect(shown.map((s) => after.find((i) => i.key === s.key && i.lesson === s.lesson)?.state)).toEqual([
      'machine',
      'machine',
      'machine',
    ]);
  });

  it('keeps a translation typed by hand as made from the original as it is now', async () => {
    const lesson = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8'));
    lesson.beats.find((b: { id: string }) => b.id === 'ex1').title = '−3 − 5, again';
    expect((await app.request(`/api/projects/${id}/lessons/ch05?force=1`, json('PUT', lesson))).status).toBe(200);
    let item = (await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`)).items.find(
      (i) => i.lesson === 'ch05' && i.key === 'beat.ex1.title',
    )!;
    expect(item.state).toBe('stale');
    // an API client (or the MCP server) saves its own wording for it
    const strings = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'strings.fr.json'), 'utf8'));
    strings['beat.ex1.title'] = '−3 − 5, encore';
    const put = await app.request(`/api/projects/${id}/lessons/ch05/strings/fr`, json('PUT', strings));
    expect(put.status).toBe(200);
    item = (await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`)).items.find(
      (i) => i.lesson === 'ch05' && i.key === 'beat.ex1.title',
    )!;
    expect(item.state).toBe('machine');
    expect(item.text).toBe('−3 − 5, encore');
  });

  it('has no sample for a book without a voice', async () => {
    const book = JSON.parse(readFileSync(join(dir, 'warqa.json'), 'utf8'));
    const was = book.pipeline.tts?.provider;
    await app.request(`/api/projects/${id}/settings`, json('PUT', { tts: { provider: 'none' } }));
    expect((await app.request(`/api/projects/${id}/voices/fr/sample`)).status).toBe(404);
    const { languages } = await get<{ languages: Lang[] }>(`/api/projects/${id}/languages`);
    expect(languages.every((l) => !l.voice.sample)).toBe(true);
    await app.request(`/api/projects/${id}/settings`, json('PUT', { tts: { provider: was ?? 'edge' } }));
  });

  it('previews a spreadsheet before it changes anything, and exports one chapter', async () => {
    const { items } = await get<{ items: Item[] }>(`/api/projects/${id}/review/fr`);
    const e = items.find((i) => i.lesson === 'ch05' && i.state === 'machine' && i.kind === 'text')!;
    const sheet = ['lesson,key,translation,ok', `ch05,${e.key},"${e.text} (relu)",`].join('\n');
    const dry = await app.request(`/api/projects/${id}/review/fr/import?dry=1`, { method: 'POST', body: sheet });
    expect(await dry.json()).toMatchObject({
      edited: 1,
      changes: [{ key: e.key, kind: 'edited', before: e.text, after: `${e.text} (relu)` }],
    });
    const strings = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'strings.fr.json'), 'utf8'));
    expect(strings[e.key]).toBe(e.text);
    const csv = await app.request(`/api/projects/${id}/review/fr.csv?lesson=ch05`);
    expect(csv.headers.get('content-disposition')).toMatch(/integers-review-fr-ch05\.csv/);
    expect((await csv.text()).split('\r\n').slice(1, -1).every((r) => r.startsWith('ch05,'))).toBe(true);
  });
});

describe('player data', () => {
  it('carries typeset math and the book’s component packs', async () => {
    const d = await get<{ math?: Record<string, string>; packs?: string[] }>(`/api/projects/${id}/lessons/mx/player`);
    expect(d.math?.['\\frac{1}{2}']).toMatch(/^<svg/);
    expect(d.packs).toEqual([`/api/projects/${id}/packs/clock.js`]);
    const plain = await get<{ math?: unknown }>(`/api/projects/${id}/lessons/ch05/player`);
    expect(plain.math).toBeUndefined();
    const pack = await app.request(`/api/projects/${id}/packs/clock.js`);
    expect(pack.status).toBe(200);
    expect(pack.headers.get('content-type')).toMatch(/javascript/);
    expect(await pack.text()).toContain('WARQA_PACKS');
    // only the listed packs, nothing else of the book
    expect((await app.request(`/api/projects/${id}/packs/warqa.json`)).status).toBe(404);
    expect((await app.request(`/api/projects/${id}/packs/..%2Fwarqa.json`)).status).toBe(404);
  });
});

describe('jobs', () => {
  const run = async (type: string, args: Record<string, unknown>) => {
    const res = await app.request(`/api/projects/${id}/jobs`, json('POST', { type, args }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    await jobs.idle(id);
    return (await get<{ job: { status: string; error?: string; result: unknown } }>(`/api/jobs/${jobId}`)).job;
  };

  it('improves a lesson with the judge: weak beats are rewritten and judged again', async () => {
    const job = await run('improve', { lesson: 'ch05', threshold: 4 });
    expect(job.error).toBeUndefined();
    expect(job.status).toBe('done');
    const r = job.result as {
      lessons: { lesson: string; before: { id: string; score: number }[]; after: { id: string; score: number }[]; rewritten: string[]; failed: unknown[] }[];
    };
    expect(r.lessons[0]!.failed).toEqual([]);
    expect(r.lessons[0]).toMatchObject({ lesson: 'ch05', rewritten: ['inverse'] });
    expect(r.lessons[0]!.before.find((b) => b.id === 'inverse')?.score).toBe(2);
    expect(r.lessons[0]!.after.find((b) => b.id === 'inverse')?.score).toBe(4);
    const lesson = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8'));
    expect(JSON.stringify(lesson.beats[1])).toContain('zz-text');
  });

  it('adds the regions of a country as a map layer', async () => {
    const job = await run('geo', { country: 'mar', level: 1 });
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({
      id: 'MAR-ADM1',
      regions: 2,
      license: 'Open Data Commons Open Database License 1.0',
      attribution: expect.stringMatching(/OpenStreetMap/),
    });
    const { layers } = await get<{ layers: { id: string; regions: { name: string }[] }[] }>(`/api/projects/${id}/geo`);
    expect(layers.map((l) => [l.id, l.regions.map((x) => x.name)])).toEqual([
      ['MAR-ADM1', ['Oriental', 'Souss-Massa']],
    ]);
    expect(existsSync(join(dir, 'assets', 'geo', 'MAR-ADM1.js'))).toBe(true);
    const bad = await run('geo', { country: 'Morocco' });
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/three-letter/);
  });

  it('exports a teacher review kit, its zip and its key', async () => {
    const job = await run('panel', { chapters: ['ch05'] });
    expect(job.error).toBeUndefined();
    expect(job.result).toMatchObject({ lessons: ['ch05'], kit: expect.stringMatching(/^integers-/) });
    const zip = await app.request(`/api/projects/${id}/panel/kit.zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-disposition')).toMatch(/integers-review-kit\.zip/);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK');
    const key = (await (await app.request(`/api/projects/${id}/panel/key.json`)).json()) as { codes: object };
    expect(Object.keys(key.codes)).toEqual(['ch05']);
    const page = readFileSync(join(dir, 'dist-panel', 'ch05', 'ch05', 'index.html'), 'utf8');
    expect(page).toContain('"panel"');
    const detail = await get<{ panelKit?: { at: number } }>(`/api/projects/${id}`);
    expect(detail.panelKit?.at).toBeGreaterThan(0);
  });

  it('refuses the jobs a host cannot run', async () => {
    const { app: web } = createApp({ root, capabilities: { jobsUnavailable: ['improve', 'video'] } });
    const res = await web.request(`/api/projects/${id}/jobs`, json('POST', { type: 'improve', args: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ desktopOnly: true });
    // the desktop without the programs a job drives says so before it runs
    const { app: bare } = createApp({ root, capabilities: { playwright: false, ffmpeg: false } });
    const qa = await bare.request(`/api/projects/${id}/jobs`, json('POST', { type: 'qa', args: {} }));
    expect(await qa.json()).toMatchObject({ needs: 'playwright' });
    const { app: noFfmpeg } = createApp({ root, capabilities: { playwright: true, ffmpeg: false } });
    const video = await noFfmpeg.request(`/api/projects/${id}/jobs`, json('POST', { type: 'video', args: {} }));
    expect(video.status).toBe(400);
    expect(await video.json()).toMatchObject({ needs: 'ffmpeg' });
  });

  it('checks a chapter, keeps its pictures, findings and scores, and says what needs attention', async () => {
    const job = await run('qa', { chapters: ['ch05'], langs: ['en'], judge: true });
    expect(job.error).toBeUndefined();
    const d = await get<{
      chapter?: number;
      beats: { id: string; n: number; score?: number; fix?: string; thumb?: string; attention: boolean; issues: { kind: string; nodes?: { id: string; type: string }[] }[] }[];
      checked?: number;
      stale?: boolean;
      fresh?: boolean;
      judge?: { model: string };
    }>(`/api/projects/${id}/check/ch05?lang=en`);
    expect(d.chapter).toBe(1);
    expect(d.checked).toBeGreaterThan(0);
    expect(d.stale).toBeUndefined();
    expect(d.beats[0]).toMatchObject({ score: 2, fix: 'Make it bigger.', attention: true });
    expect(d.beats[1]!.issues[0]).toMatchObject({ kind: 'overlap' });
    expect(d.beats[1]!.issues[0]!.nodes?.[0]?.type).toBeTruthy();
    expect(d.beats.filter((b) => b.attention).length).toBe(2);
    // the small picture, and nothing else of qa/
    const thumb = await app.request(d.beats[0]!.thumb!.replace(/^.*?\/api\//, '/api/'));
    expect(thumb.status).toBe(200);
    expect((await app.request(`/api/projects/${id}/qa/ch05/en/sheet_00.png`)).status).toBe(403);
    expect((await app.request(`/api/projects/${id}/qa/ch05/en/..%2F..%2Fwarqa.json`)).status).not.toBe(200);
    // the rail's count
    const book = await get<{ checks?: Record<string, { lang: string; attention: number; flagged?: string[] }[]> }>(
      `/api/projects/${id}`,
    );
    expect(book.checks?.ch05?.find((c) => c.lang === 'en')?.attention).toBe(2);
    expect(book.checks?.ch05?.find((c) => c.lang === 'en')?.flagged).toHaveLength(2);
    // the check shows the lesson as it is: Improve starts from the judge's verdict and judges only what it rewrote
    expect(d.fresh).toBe(true);
    const judgedBefore = judged;
    const imp = await run('improve', { chapters: ['ch05'], lang: 'en', threshold: 4, reuse: true, rejudge: 'rewritten' });
    expect(imp.error).toBeUndefined();
    const ir = (imp.result as { lessons: { before: { id: string; score: number }[] }[] }).lessons[0]!;
    expect(ir.before.find((b) => b.score === 2)?.id).toBe(d.beats[0]!.id);
    expect(judged - judgedBefore).toBeLessThanOrEqual(1);
    // the lesson changes after the check: the check says so, and which beat changed
    const lesson = JSON.parse(readFileSync(join(dir, 'lessons', 'ch05', 'lesson.json'), 'utf8'));
    lesson.beats[2].title = `${lesson.beats[2].title} (again)`;
    expect((await app.request(`/api/projects/${id}/lessons/ch05?force=1`, json('PUT', lesson))).status).toBe(200);
    const after = await get<{ stale?: boolean; beats: { changed?: boolean }[] }>(`/api/projects/${id}/check/ch05?lang=en`);
    expect(after.stale).toBe(true);
    expect(after.beats[2]!.changed).toBe(true);
    expect((after as { fresh?: boolean }).fresh).toBeUndefined();
  });

  it('makes the SCORM package and the flashcards, and backs the book up', async () => {
    const job = await run('scorm', {});
    expect(job.error).toBeUndefined();
    expect(job.result).toMatchObject({ bytes: expect.any(Number), download: `/api/projects/${id}/scorm.zip` });
    const zip = new Uint8Array(await (await app.request(`/api/projects/${id}/scorm.zip`)).arrayBuffer());
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe('PK');
    const anki = await app.request(`/api/projects/${id}/flashcards/fr`);
    expect(anki.headers.get('content-disposition')).toMatch(/integers-flashcards-fr\.txt/);
    expect((await anki.text()).startsWith('#separator:tab')).toBe(true);
    const csv = new Uint8Array(await (await app.request(`/api/projects/${id}/flashcards/ar?format=csv`)).arrayBuffer());
    expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const backup = await app.request(`/api/projects/${id}/archive`);
    expect(backup.headers.get('content-disposition')).toMatch(/integers\.warqa\.zip/);
    const b = new Uint8Array(await backup.arrayBuffer());
    expect(String.fromCharCode(b[0]!, b[1]!)).toBe('PK');
    // the book's facts for the Share step
    const book = await get<{ lessons: { id: string; questions?: number }[]; exportInfo: { scorm?: { bytes: number } } }>(
      `/api/projects/${id}`,
    );
    expect(book.lessons.find((l) => l.id === 'ch05')?.questions).toBeGreaterThan(0);
    expect(book.exportInfo.scorm?.bytes).toBeGreaterThan(1000);
  });

  it('says the export is out of date only when something it shows changed', async () => {
    const exp = await run('export', {});
    expect(exp.error).toBeUndefined();
    const info = async () =>
      (await get<{ exportInfo: { stale?: boolean; zipBytes?: number } }>(`/api/projects/${id}`)).exportInfo;
    expect((await info()).stale).toBeUndefined();
    expect((await info()).zipBytes).toBeGreaterThan(1000);
    const later = Date.now() / 1000 + 30;
    const touch = (f: string, text: string) => {
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
      utimesSync(f, later, later);
    };
    // the editor's candidates, the review marks and the models are not in an export
    touch(join(dir, 'lessons', 'ch05', 'candidates', 'x.json'), '{}');
    touch(join(dir, 'lessons', 'ch05', 'review.fr.json'), '{}');
    const bookFile = join(dir, 'warqa.json');
    const original = readFileSync(bookFile, 'utf8');
    const cfg = JSON.parse(original);
    cfg.pipeline = { ...cfg.pipeline, models: { ...cfg.pipeline?.models, judge: 'openai:gpt-5.5' } };
    writeFileSync(bookFile, JSON.stringify(cfg));
    expect((await info()).stale).toBeUndefined();
    // the title is
    cfg.title = { ...cfg.title, en: 'Another title' };
    writeFileSync(bookFile, JSON.stringify(cfg));
    expect((await info()).stale).toBe(true);
    writeFileSync(bookFile, original);
    expect((await info()).stale).toBeUndefined();
    // and so is a lesson's text
    const strings = join(dir, 'lessons', 'ch05', 'strings.fr.json');
    utimesSync(strings, later, later);
    expect((await info()).stale).toBe(true);
  });
});
