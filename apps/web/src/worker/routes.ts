// API routes only the web app has (/api/web/*): the example book, project backups (zip in, zip out), deleting a
// book from the browser, checking a provider key, and how much the browser stores.
import * as P from '@warqa/pipeline';
import { unzipSync, type Zippable, zipSync } from 'fflate';
import { Hono } from 'hono';
import { basename, dirname, join } from 'pathe';
import type { Jobs } from '../../../studio/src/server/jobs';
import { keysFile, loadKeys, saveKeys } from '../../../studio/src/server/keys';
import { Registry } from '../../../studio/src/server/projects';
import { candidates, idOf, newSlug, sameTitle } from './identity';
import { vfs } from './vfs';

interface Options {
  root: string;
  base: string;
  fake: boolean;
  jobs: Jobs;
}

/** Folders of a project that a backup leaves out (rebuilt for free, or desktop by-products). */
// what a backup leaves out: the same list as the desktop's (what is made again; the saved checks are kept)
const SKIP = P.BACKUP_SKIP;
const MAX_IMPORT = 1024 * 1024 * 1024;

interface Unzipped {
  files: Record<string, Uint8Array>;
  names: string[];
  /** Where the book's files start in the zip ("integers.warqa/", or "" when warqa.json is at the top). */
  prefix: string;
  /** The folder name a new copy takes ("integers"). */
  slug: string;
  /** The folders it may already have here, most likely first (see identity.ts). */
  candidates: string[];
  /** Its titles: the same book only if one matches. */
  title?: Record<string, string> | string;
  /** When the backup was made (backups from before warqa-backup.json: unknown). */
  exported?: string;
}

/** Read a project zip: where its book is, the folder it would take, when it was made. */
function readZip(zip: Uint8Array, hint: string): Unzipped {
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
  let title: Record<string, string> | string | undefined;
  try {
    const j = JSON.parse(new TextDecoder().decode(files[book])) as { id?: string; title?: typeof title };
    id = String(j.id ?? '');
    title = j.title;
  } catch {
    throw new Error('warqa.json in this zip is not valid JSON');
  }
  let exported: string | undefined;
  const meta = files[`${prefix}${P.BACKUP_META}`];
  if (meta)
    try {
      const m = JSON.parse(new TextDecoder().decode(meta)) as Partial<P.BackupMeta>;
      if (typeof m.exported === 'string' && !Number.isNaN(Date.parse(m.exported))) exported = m.exported;
    } catch {
      /* a date we cannot read: unknown */
    }
  return {
    files,
    names,
    prefix,
    slug: newSlug(prefix, id, hint),
    candidates: candidates(prefix, id),
    ...(title !== undefined ? { title } : {}),
    ...(exported ? { exported } : {}),
  };
}

/**
 * Unpack a read zip into a new folder under root ("integers-2" when "integers" is taken); returns the folder. A copy
 * beside a book of the same name gets an id of its own (its exports then keep their own progress, and a backup of it
 * comes back to it, not to the original).
 */
function unpack(root: string, z: Unzipped): string {
  let slug = z.slug;
  for (let n = 2; vfs.existsSync(join(root, `${slug}.warqa`)); n++) slug = `${z.slug}-${n}`;
  const dir = join(root, `${slug}.warqa`);
  try {
    write(dir, z.prefix, z.names, z.files);
    if (slug !== z.slug) {
      const p = new P.Project(dir);
      p.book.id = idOf(slug);
      p.saveBook();
    }
  } catch (e) {
    vfs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

/** The book here that a zip is a backup of: a folder it may have (identity.ts) holding a book with one of its titles. */
function bookHere(root: string, z: Unzipped): { dir: string; book: P.Project['book'] } | null {
  for (const slug of z.candidates) {
    const dir = join(root, `${slug}.warqa`);
    if (!vfs.existsSync(dir) || !P.Project.isProject(dir)) continue;
    try {
      const book = new P.Project(dir).book;
      if (sameTitle(z.title, book.title)) return { dir, book };
    } catch {
      /* a book that cannot be read is not offered for replacement */
    }
  }
  return null;
}

/**
 * Put a read zip in place of the book in `dir`: written beside it first (a hidden folder the books list skips), so a
 * broken zip never costs the book; then the old folder goes and the new one takes its name.
 */
async function replace(dir: string, z: Unzipped): Promise<void> {
  const tmp = join(dirname(dir), `.importing-${basename(dir)}`);
  vfs.rmSync(tmp, { recursive: true, force: true });
  try {
    write(tmp, z.prefix, z.names, z.files);
  } catch (e) {
    vfs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  // the old book steps aside, the new one takes its name, then the old one goes (no moment without a book)
  const old = join(dirname(dir), `.replaced-${basename(dir)}`);
  vfs.rmSync(old, { recursive: true, force: true });
  vfs.renameSync(dir, old);
  try {
    vfs.renameSync(tmp, dir);
  } catch (e) {
    vfs.renameSync(old, dir);
    vfs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  vfs.rmSync(old, { recursive: true, force: true });
  await vfs.flush();
}

function write(dir: string, prefix: string, names: string[], files: Record<string, Uint8Array>) {
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    // never outside the project folder
    if (!rel || rel.split('/').some((s) => s === '..' || s === '') || rel.includes('\\') || rel.startsWith('/'))
      continue;
    // nor what this browser makes itself: an exported site (dist/), caches, hidden files. A book's pages then only
    // ever come from this studio's own export (a zip could carry scripts that would run as this site)
    if (P.BACKUP_SKIP.test(rel)) continue;
    const target = join(dir, rel);
    vfs.mkdirSync(dirname(target), { recursive: true });
    vfs.writeFileSync(target, files[name]!);
  }
  if (!P.Project.isProject(dir)) throw new Error('the project in this zip could not be read');
  new P.Project(dir); // throws on a broken warqa.json (or a book that needs the desktop version)
}

export function webRoutes({ root, base, jobs }: Options): Hono {
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
    const dir = unpack(root, readZip(new Uint8Array(await res.arrayBuffer()), 'integers'));
    // its narration is already recorded; no speech engine is needed to replay it
    const p = new P.Project(dir);
    p.config.tts.provider = 'none';
    p.saveBook();
    return c.json({ id: registry.idFor(dir) ?? basename(dir, '.warqa'), created: true });
  });

  /**
   * A project backup (zip) back into the browser. `mode`: `copy` (the default) adds it as a new book ("-2" when its
   * name is taken); `ask` answers 409 with the book already here instead; `replace` puts it in that book's place
   * (refused while that book has work in progress, as deleting it is).
   */
  app.post('/import', async (c) => {
    const mode = c.req.query('mode') ?? 'copy';
    if (!['ask', 'copy', 'replace'].includes(mode)) throw new Error(`unknown import mode "${mode}"`);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || !file.size) throw new Error('choose a .zip file');
    if (file.size > MAX_IMPORT) throw new Error('this file is larger than 1 GB');
    const z = readZip(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/i, ''));
    const found = mode === 'copy' ? null : bookHere(root, z);
    if (found && mode === 'ask') {
      const { dir: here, book } = found;
      return c.json(
        {
          error: 'this book is already here',
          exists: {
            id: registry.idFor(here) ?? basename(here, '.warqa'),
            title: book.title,
            defaultLang: book.defaultLang,
            ...(z.exported ? { exported: z.exported } : {}),
          },
        },
        409,
      );
    }
    if (found && mode === 'replace') {
      const here = found.dir;
      const id = registry.idFor(here) ?? basename(here, '.warqa');
      if (jobs.list(id).some((j) => j.status === 'running' || j.status === 'queued'))
        throw new Error('this book has work in progress: stop it first');
      await replace(here, z);
      return c.json({ id: registry.idFor(here) ?? basename(here, '.warqa'), replaced: true });
    }
    const dir = unpack(root, z);
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
    // when it was made: an import that finds this book already here says since when changes would be lost
    files[`${name}/${P.BACKUP_META}`] = P.backupMeta();
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

  /** How much this browser stores for Warqa (`?books=1`: each book's size too, largest first). */
  app.get('/storage', async (c) => {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const list =
      c.req.query('books') === '1'
        ? [...registry.scan()]
            .map(([id, dir]) => {
              let title: Record<string, string> | string = id;
              let defaultLang = 'en';
              try {
                const b = new P.Project(dir).book;
                title = b.title;
                defaultLang = b.defaultLang ?? defaultLang;
              } catch {
                /* a book that cannot be read still takes space */
              }
              return { id, title, defaultLang, bytes: vfs.size(dir) };
            })
            .sort((a, b) => b.bytes - a.bytes)
        : undefined;
    return c.json({
      books: vfs.size(root),
      usage: est?.usage ?? null,
      quota: est?.quota ?? null,
      pending: vfs.pending,
      ...(list ? { list } : {}),
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
