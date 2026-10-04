// The web app: the studio's React app plus its server and pipeline, built for the browser.
//   WARQA_BASE=/warqa/ pnpm --filter @warqa/web build   → dist/ for GitHub Pages at https://<user>.github.io/warqa/
// Node built-ins used by the server and the pipeline are replaced by browser versions (src/shims); the lesson
// player bundle, pdf.js data files and the example book are added as static files.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type Zippable, zipSync } from 'fflate';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const base = `/${(process.env.WARQA_BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const studio = JSON.parse(readFileSync(join(here, '../studio/package.json'), 'utf8')) as { version: string };
const repo =
  process.env.WARQA_REPO_URL ??
  (process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : '');

const shim = (f: string) => join(here, 'src/shims', f);

/** Every file under a folder (relative paths). */
function walk(dir: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(dir, p).split('\\').join('/');
      if (skip(rel)) continue;
      if (e.isDirectory()) go(p);
      else out.push(rel);
    }
  };
  go(dir);
  return out.sort();
}

/** Static files the app serves besides its own bundle: published path → bytes (made on first use). */
function staticFiles(): Map<string, () => Uint8Array> {
  const files = new Map<string, () => Uint8Array>();
  // the lesson player (an export copies it into every book)
  const bundle = join(dirname(require.resolve('@warqa/lesson/package.json')), 'dist', 'bundle');
  if (!existsSync(join(bundle, 'player.js')))
    throw new Error('the lesson player is not built: run `npx turbo run build --filter=@warqa/lesson` first');
  const player = walk(bundle, (rel) => rel.endsWith('.map'));
  for (const f of player) files.set(`player/${f}`, () => readFileSync(join(bundle, f)));
  files.set('player/manifest.json', () => new TextEncoder().encode(JSON.stringify(player)));
  // pdf.js data: CMaps (CJK text), standard fonts, image decoders
  const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'));
  for (const sub of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
    for (const f of walk(join(pdfjs, sub))) files.set(`pdfjs/${sub}/${f}`, () => readFileSync(join(pdfjs, sub, f)));
  // the example book (its sources and recorded narration; the browser exports it itself). Not under demo/:
  // the Pages workflow exports the demo books there, and an export empties its folder first.
  const example = join(here, '../../examples/integers.warqa');
  files.set('example/integers.zip', () => {
    const z: Zippable = {};
    for (const f of walk(example, (rel) => /^(dist|cache|qa|source)(\/|$)|^\.|(^|\/)\.DS_Store$/.test(rel)))
      z[`integers.warqa/${f}`] = f.endsWith('.mp3')
        ? [readFileSync(join(example, f)), { level: 0 }]
        : readFileSync(join(example, f));
    return zipSync(z, { level: 6 });
  });
  return files;
}

const TYPES: Record<string, string> = {
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  woff2: 'font/woff2',
  wasm: 'application/wasm',
  zip: 'application/zip',
  txt: 'text/plain',
};

function warqaStatic(): Plugin {
  let files: Map<string, () => Uint8Array> | null = null;
  const cache = new Map<string, Uint8Array>();
  const get = (name: string) => {
    files ??= staticFiles();
    const make = files.get(name);
    if (!make) return undefined;
    if (!cache.has(name)) cache.set(name, make());
    return cache.get(name);
  };
  return {
    name: 'warqa-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        if (!path.startsWith(base)) return next();
        const body = get(path.slice(base.length));
        if (!body) return next();
        res.setHeader('content-type', TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-cache');
        res.end(body);
      });
    },
    generateBundle() {
      files ??= staticFiles();
      for (const name of files.keys()) this.emitFile({ type: 'asset', fileName: name, source: get(name)! });
    },
    writeBundle(opts) {
      // GitHub Pages answers unknown paths (/warqa/project/x after a reload) with 404.html: make it the app
      const dir = opts.dir ?? join(here, 'dist');
      const index = join(dir, 'index.html');
      if (existsSync(index) && statSync(index).isFile()) writeFileSync(join(dir, '404.html'), readFileSync(index));
    },
  };
}

/** The pipeline's MathJax module (Node only) → src/shims/math.ts, whichever file of the pipeline imports it. */
function browserMath(): Plugin {
  const pipeline = join(here, '../../packages/pipeline');
  const targets = new Set([join(pipeline, 'dist/export/math.js'), join(pipeline, 'src/export/math.ts')]);
  return {
    name: 'warqa-browser-math',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/(^|\/)math\.js$/.test(source) || !source.startsWith('.')) return null;
      const abs = resolve(dirname(importer.split('?')[0]!), source);
      return targets.has(abs) || targets.has(abs.replace(/\.js$/, '.ts')) ? shim('math.ts') : null;
    },
  };
}

const alias = [
  { find: /^node:fs$/, replacement: shim('fs.ts') },
  { find: /^node:path$/, replacement: shim('path.ts') },
  { find: /^node:os$/, replacement: shim('os.ts') },
  { find: /^node:crypto$/, replacement: shim('crypto.ts') },
  { find: /^node:module$/, replacement: shim('module.ts') },
  { find: /^node:child_process$/, replacement: shim('child_process.ts') },
  { find: /^node:stream$/, replacement: shim('stream.ts') },
  { find: /^node:url$/, replacement: shim('url.ts') },
  { find: /^node:vm$/, replacement: shim('vm.ts') },
  { find: /^node:http$/, replacement: shim('unavailable.ts') },
  { find: /^playwright$/, replacement: shim('unavailable.ts') },
  { find: /^@napi-rs\/canvas$/, replacement: shim('canvas.ts') },
];

export default defineConfig(({ command }) => ({
  base,
  plugins: [react(), warqaStatic(), browserMath()],
  resolve: { alias },
  define: {
    // A build replaces process.env with {}; the server code keeps provider keys there at run time (the worker
    // defines a process global, src/shims/globals.ts; the page's own code never reads it). Dev leaves it alone.
    ...(command === 'build' ? { 'process.env': 'globalThis.process.env' } : {}),
    __STUDIO_VERSION__: JSON.stringify(studio.version),
    __WARQA_REPO__: JSON.stringify(repo),
  },
  worker: { format: 'es', plugins: () => [browserMath()] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  server: { port: Number(process.env.PORT ?? 5180), strictPort: false },
  preview: { port: Number(process.env.PORT ?? 4180), strictPort: false },
}));
