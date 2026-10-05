// Make an exported book an installable, offline web app: manifest, icons and a service worker that
// pre-caches every file of the book (lessons, audio, fonts). Pages register it only over http(s).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const SW = (version: string, files: string[]) => `// Warqa offline cache (generated)
const CACHE = 'warqa-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('warqa-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // audio may be requested with Range headers: answer from the full cached file
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(async (hit) => {
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

const REGISTER = `<script>if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register(new URL('{{BASE}}sw.js',location.href)).catch(function(){});</script>`;

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
  const version = createHash('sha1').update(files.join('|')).update(String(files.length)).digest('hex').slice(0, 10);
  writeFileSync(join(out, 'sw.js'), SW(version, files));
  // link the manifest and register the worker in every page
  for (const f of files.filter((x) => x.endsWith('index.html'))) {
    const depth = f.split('/').length - 1;
    const base = depth ? '../'.repeat(depth) : '';
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
}
