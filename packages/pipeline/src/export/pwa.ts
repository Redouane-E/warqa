// Make an exported book an installable, offline web app: manifest, icons and a service worker that
// pre-caches every file of the book (lessons, audio, fonts). Pages register it only over http(s).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { listFiles } from './site.js';

/** A lemniscate (∞) on the chalkboard green, drawn without fonts. */
function icon(size: number): Uint8Array | null {
  try {
    const c = createCanvas(size, size);
    const g = c.getContext('2d');
    g.fillStyle = '#1d2b27';
    g.beginPath();
    g.roundRect(0, 0, size, size, size * 0.18);
    g.fill();
    g.strokeStyle = '#f0b45a';
    g.lineWidth = size * 0.07;
    g.lineCap = 'round';
    g.beginPath();
    const a = size * 0.3;
    for (let k = 0; k <= 200; k++) {
      const t = (k / 200) * Math.PI * 2;
      const d = 1 + Math.sin(t) ** 2;
      const x = size / 2 + (a * Math.cos(t)) / d;
      const y = size / 2 + (a * Math.sin(t) * Math.cos(t)) / d;
      if (k) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    return new Uint8Array(c.toBuffer('image/png'));
  } catch {
    return null;
  }
}

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
  for (const s of [192, 512]) {
    const png = icon(s);
    if (png) writeFileSync(join(out, `icon-${s}.png`), png);
  }
  const manifest = {
    name: book.title,
    short_name: book.title.slice(0, 24),
    description: book.description ?? book.title,
    lang: book.lang,
    dir: book.dir,
    start_url: './index.html',
    scope: './',
    display: 'standalone',
    background_color: '#121b18',
    theme_color: '#1d2b27',
    icons: [192, 512].map((s) => ({
      src: `icon-${s}.png`,
      sizes: `${s}x${s}`,
      type: 'image/png',
      purpose: 'any maskable',
    })),
  };
  writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
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
          `<link rel="manifest" href="${base}manifest.webmanifest">\n<meta name="theme-color" content="#1d2b27">\n<link rel="apple-touch-icon" href="${base}icon-192.png">\n</head>`,
        )
        .replace('</body>', `${REGISTER.replace('{{BASE}}', base)}\n</body>`),
    );
  }
}
