// Make an exported book an installable, offline web app: manifest, icons and a service worker that
// pre-caches every file of the book (lessons, audio, fonts). Pages register it only over http(s).
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { drawAppIcon, THEME_COLOR } from '@warqa/brand';
import { listFiles } from './site.js';

/** Warqa's app icon (the folded sheet on ink), drawn without fonts; null where no canvas is available. */
function icon(size: number, maskable = false): Uint8Array | null {
  try {
    const c = createCanvas(size, size);
    drawAppIcon(c.getContext('2d'), size, (d) => new Path2D(d), { maskable });
    return new Uint8Array(c.toBuffer('image/png'));
  } catch {
    return null;
  }
}

/** Icons of an installed book: [file, size, maskable (full bleed, the mark inside the safe circle)]. */
const ICONS: [string, number, boolean][] = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];

/**
 * The worker of one book: it saves every file of the book (six at a time) in caches named after the book's own
 * folder (`warqa:/demo/:<version>`), so books sharing a site never touch each other's copies, and tells the pages
 * how far it is (`{ t: 'warqa-cache', done, total }` in bytes, then `ready`, or `failed`). A page asks
 * `{ t: 'warqa-status' }` on later visits; a copy found incomplete (cleared by the browser, an install cut short)
 * is topped up. Deleting the book from the device is the page's (book.ts: its caches, its registration, its flag).
 */
const SW = (version: string, files: [string, number][]) => `// Warqa offline cache (generated)
const SCOPE = new URL('./', self.location.href).pathname;
const PREFIX = 'warqa:' + SCOPE + ':';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};
const TOTAL = FILES.reduce((a, f) => a + f[1], 0);
const tell = (m) => self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage(m)));
const path = (u) => new URL(u, self.location.href).pathname;
async function status() {
  const c = await caches.open(CACHE);
  const have = new Set((await c.keys()).map((r) => path(r.url)));
  let done = 0;
  for (const [f, size] of FILES) if (have.has(path(f))) done += size;
  return { t: 'warqa-cache', done, total: TOTAL, ready: done >= TOTAL };
}
let filling = null;
function fill() {
  if (filling) return filling;
  filling = (async () => {
    const c = await caches.open(CACHE);
    const have = new Set((await c.keys()).map((r) => path(r.url)));
    let next = 0;
    let done = 0;
    let failed = false;
    const one = async () => {
      while (next < FILES.length && !failed) {
        const [f, size] = FILES[next++];
        if (!have.has(path(f))) {
          const req = new Request(f, { cache: 'reload' });
          const res = await fetch(req);
          if (!res.ok) throw new Error(f + ': HTTP ' + res.status);
          await c.put(req, res);
        }
        done += size;
        if (!failed) tell({ t: 'warqa-cache', done, total: TOTAL });
      }
    };
    try {
      await Promise.all([1, 2, 3, 4, 5, 6].map(() => one().catch((err) => { failed = true; throw err; })));
    } catch (err) {
      tell({ t: 'warqa-cache', failed: true, done, total: TOTAL });
      throw err;
    } finally {
      filling = null;
    }
    tell({ t: 'warqa-cache', done: TOTAL, total: TOTAL, ready: true });
  })();
  return filling;
}
self.addEventListener('install', (e) => {
  e.waitUntil(fill().then(() => self.skipWaiting()));
});
self.addEventListener('message', (e) => {
  if (!e.data || e.data.t !== 'warqa-status' || !e.source) return;
  const src = e.source;
  e.waitUntil(status().then((m) => { src.postMessage(m); if (!m.ready) return fill().catch(() => {}); }));
});
self.addEventListener('activate', (e) => {
  // this book's older copies, and copies from before caches were named per book ("warqa-<version>")
  const old = (k) => (k.startsWith(PREFIX) && k !== CACHE) || /^warqa-[0-9a-f]{10}$/.test(k);
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(old).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // audio may be requested with Range headers: answer from the full cached file
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then(async (hit) => {
      if (!hit) return fetch(req);
      const range = req.headers.get('range');
      if (!range) return hit;
      const buf = await hit.arrayBuffer();
      const m = /bytes=(\\d*)-(\\d*)/.exec(range) || [];
      const start = Number(m[1] || 0);
      const end = m[2] ? Number(m[2]) : buf.byteLength - 1;
      return new Response(buf.slice(start, end + 1), { status: 206, headers: { 'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength, 'Content-Length': String(end - start + 1) } });
    }),
  );
});
`;

// Not after "Delete it from this device" (a flag per book, keyed by the book's folder): the book home offers to save
// it again.
const REGISTER = `<script>try{var b=new URL('{{BASE}}',location.href);if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&localStorage.getItem('warqa:offline:'+b.pathname)!=='off')navigator.serviceWorker.register(new URL('sw.js',b)).catch(function(){});}catch(e){}</script>`;

/** Add PWA files to an exported site folder. */
export function addPwa(
  out: string,
  book: { title: string; lang: string; dir: 'ltr' | 'rtl'; description?: string },
): void {
  const made = ICONS.filter(([file, size, maskable]) => {
    const png = icon(size, maskable);
    if (png) writeFileSync(join(out, file), png);
    return !!png;
  });
  const manifest = {
    name: book.title,
    short_name: book.title.slice(0, 24),
    description: book.description ?? book.title,
    lang: book.lang,
    dir: book.dir,
    start_url: './index.html',
    scope: './',
    display: 'standalone',
    background_color: THEME_COLOR[0],
    theme_color: THEME_COLOR[0],
    icons: made
      .filter(([file]) => file.startsWith('icon-'))
      .map(([file, size, maskable]) => ({
        src: file,
        sizes: `${size}x${size}`,
        type: 'image/png',
        purpose: maskable ? 'maskable' : 'any',
      })),
  };
  writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
  const apple = made.some(([file]) => file === 'apple-touch-icon.png');
  const files = listFiles(out).filter((f) => !f.endsWith('.map') && f !== 'sw.js');

  // link the manifest and register the worker in every page
  for (const f of files.filter((x) => x.endsWith('index.html'))) {
    const depth = f.split('/').length - 1;
    // the book's folder from this page ("./" at its root: the "deleted here" flag and the worker are keyed by it)
    const base = depth ? '../'.repeat(depth) : './';
    const p = join(out, f);
    const html = readFileSync(p, 'utf8');
    if (html.includes('manifest.webmanifest')) continue;
    writeFileSync(
      p,
      html
        .replace(
          '</head>',
          `<link rel="manifest" href="${base}manifest.webmanifest">\n<meta name="theme-color" content="${THEME_COLOR[0]}" media="(prefers-color-scheme: light)">\n<meta name="theme-color" content="${THEME_COLOR[1]}" media="(prefers-color-scheme: dark)">\n${apple ? `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">\n` : ''}</head>`,
        )
        .replace('</body>', `${REGISTER.replace('{{BASE}}', base)}\n</body>`),
    );
  }
  // each file with its size (pages as linked above): the page shows how much is saved ("9 / 14 MB"); the version
  // follows the contents, so an edited book is saved again on the next visit
  const sized = files.map((f) => [f, statSync(join(out, f)).size] as [string, number]);
  const hash = createHash('sha1');
  for (const f of files)
    hash
      .update(f)
      .update('\0')
      .update(readFileSync(join(out, f)));
  writeFileSync(join(out, 'sw.js'), SW(hash.digest('hex').slice(0, 10), sized));
}
