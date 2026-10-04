// API tests of the book-wide features: the translation review queue (list, approve, edit, approve many, CSV out
// and back in, glossary flags), the player data (typeset math, component packs and their route), and the jobs
// that improve lessons with the judge, add map regions and export a teacher review kit (with stub judges,
// a scripted model and a fake network).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FakeModel, ImproveOptions } from '@warqa/pipeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { geoRunner, improveRunner, RUNNERS } from '../src/server/jobs.js';
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
    runners: { ...RUNNERS, improve: improveRunner({ judge }), geo: geoRunner({ fetch: fakeFetch }) },
    llm: { fake },
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
    const { app: web } = createApp({ root, capabilities: { jobsUnavailable: ['improve', 'panel'] } });
    const res = await web.request(`/api/projects/${id}/jobs`, json('POST', { type: 'improve', args: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ desktopOnly: true });
  });
});
