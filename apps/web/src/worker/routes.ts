// API routes only the web app has (/api/web/*): the example book, project backups (zip in, zip out), deleting a
// book from the browser, checking a provider key, and how much the browser stores.
import * as P from '@warqa/pipeline';
import { unzipSync, type Zippable, zipSync } from 'fflate';
import { Hono } from 'hono';
import { basename, dirname, join } from 'pathe';
import type { Jobs } from '../../../studio/src/server/jobs';
import { keysFile, loadKeys, saveKeys } from '../../../studio/src/server/keys';
import { Registry } from '../../../studio/src/server/projects';
import { type KeyCheck, providerById } from '../providers';
import { vfs } from './vfs';

interface Options {
  root: string;
  base: string;
  fake: boolean;
  jobs: Jobs;
}

/** Folders of a project that a backup leaves out (rebuilt for free, or desktop by-products). */
const SKIP = /^(dist|qa)\/|^cache\/(?!llm\/|tts\/)|^dist[^/]*\.zip$|^flashcards\.|\.mp4$/;
const MAX_IMPORT = 1024 * 1024 * 1024;

const slugOf = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.warqa$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 40) || 'book';

/** Unpack a project zip into a new folder under root; returns the folder. */
function unpack(root: string, zip: Uint8Array, hint: string): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new Error('this file is not a zip archive');
  }
  const names = Object.keys(files).filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'));
  const book = names
    .filter((n) => n === 'warqa.json' || n.endsWith('/warqa.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!book) throw new Error('this zip has no warqa.json: it is not a Warqa book project');
  const prefix = book.slice(0, -'warqa.json'.length);
  let id = '';
  try {
    id = String((JSON.parse(new TextDecoder().decode(files[book])) as { id?: string }).id ?? '');
  } catch {
    throw new Error('warqa.json in this zip is not valid JSON');
  }
  const base = slugOf(id || prefix.replace(/\/$/, '').split('/').pop() || hint);
  let slug = base;
  for (let n = 2; vfs.existsSync(join(root, `${slug}.warqa`)); n++) slug = `${base}-${n}`;
  const dir = join(root, `${slug}.warqa`);
  try {
    write(dir, prefix, names, files);
  } catch (e) {
    vfs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

function write(dir: string, prefix: string, names: string[], files: Record<string, Uint8Array>) {
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    // never outside the project folder
    if (!rel || rel.split('/').some((s) => s === '..' || s === '') || rel.includes('\\') || rel.startsWith('/'))
      continue;
    const target = join(dir, rel);
    vfs.mkdirSync(dirname(target), { recursive: true });
    vfs.writeFileSync(target, files[name]!);
  }
  if (!P.Project.isProject(dir)) throw new Error('the project in this zip could not be read');
  new P.Project(dir); // throws on a broken warqa.json (or a book that needs the desktop version)
}

async function checkKey(url: string, headers: Record<string, string>): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { ok: false, reason: 'network', message: (e as Error).message };
  }
  if (res.ok) return { ok: true };
  const text = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status === 429) return { ok: true, warning: 'rate' };
  // Gemini and xAI answer a wrong key with 400 ("API key not valid", "Incorrect API key")
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key/i.test(text)))
    return { ok: false, reason: 'key', status: res.status, message: text };
  if (res.status === 402) return { ok: false, reason: 'credits', status: res.status, message: text };
  return { ok: false, reason: 'http', status: res.status, message: text };
}

export function webRoutes({ root, base, fake, jobs }: Options): Hono {
  const registry = new Registry(root, 'none');
  const app = new Hono().basePath('/api/web');

  app.onError((err, c) => c.json({ error: err.message || 'error' }, 400));

  const dirOf = (id: string) => {
    const dir = registry.dir(id);
    if (!dir) throw new Error(`no project "${id}"`);
    return dir;
  };

  /** The example book, copied into the browser's books on first use. */
  app.post('/demo', async (c) => {
    const existing = registry.dir('integers');
    if (existing) return c.json({ id: 'integers', created: false });
    const res = await fetch(new URL(`${base}example/integers.zip`, self.location.origin));
    if (!res.ok) throw new Error(`the example book is missing from this site (HTTP ${res.status})`);
    const dir = unpack(root, new Uint8Array(await res.arrayBuffer()), 'integers');
    // its narration is already recorded; no speech engine is needed to replay it
    const p = new P.Project(dir);
    p.config.tts.provider = 'none';
    p.saveBook();
    return c.json({ id: registry.idFor(dir) ?? basename(dir, '.warqa'), created: true });
  });

  /** A project backup (zip) back into the browser. */
  app.post('/import', async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || !file.size) throw new Error('choose a .zip file');
    if (file.size > MAX_IMPORT) throw new Error('this file is larger than 1 GB');
    const dir = unpack(root, new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/i, ''));
    return c.json({ id: registry.idFor(dir) ?? basename(dir, '.warqa') });
  });

  /** A whole project as a zip (its folder, without what an export or a run rebuilds). */
  app.get('/projects/:id/archive', (c) => {
    const dir = dirOf(c.req.param('id'));
    const name = basename(dir);
    const files: Zippable = {};
    // audio, images and fonts are compressed already: store them as they are
    for (const [rel, data] of vfs.files(dir, (r) => SKIP.test(r)))
      files[`${name}/${rel}`] = /\.(mp3|wav|png|jpe?g|webp|woff2?)$/i.test(rel) ? [data, { level: 0 }] : data;
    const zip = zipSync(files, { level: 6 });
    return c.body(zip, 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '_')}.zip"`,
      'content-length': String(zip.byteLength),
    });
  });

  /** Remove a book from this browser. */
  app.delete('/projects/:id', async (c) => {
    const id = c.req.param('id');
    const dir = dirOf(id);
    if (jobs.list(id).some((j) => j.status === 'running' || j.status === 'queued'))
      throw new Error('this book has work in progress: stop it first');
    await vfs.wipe(dir);
    return c.json({ deleted: id });
  });

  /** Check a provider key without spending anything (the key is not stored by this call). */
  app.post('/check-key', async (c) => {
    const { provider, key } = (await c.req.json()) as { provider?: string; key?: string };
    const p = providerById(String(provider ?? ''), fake);
    if (!p) throw new Error(`unknown provider "${provider}"`);
    if (p.id === 'fake') return c.json({ ok: true } satisfies KeyCheck);
    const value = String(key ?? '').trim();
    if (!value && !p.local) return c.json({ ok: false, reason: 'key', message: 'empty key' } satisfies KeyCheck);
    const req = p.check!(value);
    return c.json(await checkKey(req.url, req.headers));
  });

  /** How much this browser stores for Warqa. */
  app.get('/storage', async (c) => {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    return c.json({
      books: vfs.size(root),
      usage: est?.usage ?? null,
      quota: est?.quota ?? null,
      pending: vfs.pending,
    });
  });

  /** Forget everything: books and keys. */
  app.post('/reset', async (c) => {
    for (const j of registry.scan().keys())
      for (const job of jobs.list(j)) if (job.status === 'running' || job.status === 'queued') jobs.cancel(job.id);
    const stored = Object.keys(loadKeys());
    if (stored.length) saveKeys(Object.fromEntries(stored.map((k) => [k, null])));
    await vfs.wipe(root);
    await vfs.wipe(dirname(keysFile()));
    vfs.mkdirSync(root, { recursive: true });
    await vfs.flush();
    return c.json({ reset: true });
  });

  return app;
}
