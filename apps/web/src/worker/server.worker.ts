// The studio server in a Web Worker: the same Hono app and pipeline as the local studio, over a virtual file
// system kept in IndexedDB. The page sends it HTTP requests as messages (bridge/client.ts); long jobs run here
// without freezing the page.
import '../shims/globals';
import * as P from '@warqa/pipeline';
import type { Hono } from 'hono';
import { dirname, join } from 'pathe';
import { createApp } from '../../../studio/src/server/app';
import { applyKeys } from '../../../studio/src/server/keys';
import { zipPath, zipReady } from '../../../studio/src/server/zip';
import type { FromWorker, InitOptions, ToWorker } from '../bridge/protocol';
import { fakeModel } from './fake';
import { setupPdf } from './pdf';
import { webRoutes } from './routes';
import { browserRunners, desktopOnlyJobs, desktopOnlyVoices } from './runners';
import { vfs } from './vfs';

/** The parts of DedicatedWorkerGlobalScope used here (the DOM typings describe the page, not workers). */
const scope = self as unknown as {
  postMessage(m: FromWorker, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

/** Projects live in /books (one folder per book, as on the desktop); keys in /home/.warqa. */
const ROOT = '/books';

let handle: ((req: Request) => Promise<Response>) | null = null;
/** This tab holds the books (another tab may take them over). */
let active = false;
let options: InitOptions | null = null;
const queued: Extract<ToWorker, { t: 'req' }>[] = [];
const inflight = new Map<number, ReadableStreamDefaultReader<Uint8Array>>();

/* ---------- one tab at a time ---------- */

// Two tabs would each keep their own copy of the books in memory and overwrite each other's changes. The tab that
// holds this lock owns them; another tab can ask for them (the owner saves, lets go and says so to its page).
const LOCK = 'warqa-books';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(LOCK) : null;
let letGo: (() => void) | null = null;
/** Stops the jobs of this tab (set once the server runs). */
let stopJobs: () => void = () => {};
let takeover: (() => void) | null = null;

function hold(): Promise<void> {
  return new Promise<void>((resolve) => (letGo = resolve));
}

function lost() {
  if (!active) return;
  active = false;
  stopJobs();
  void vfs.freeze();
  post({ t: 'released' });
}

async function acquire(): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return;
  const first = await new Promise<boolean>((ok) => {
    locks
      .request(LOCK, { ifAvailable: true }, (lock) => {
        ok(!!lock);
        return lock ? hold() : undefined;
      })
      .catch(lost);
  });
  if (first) return;
  post({ t: 'busy' });
  await new Promise<void>((ok) => (takeover = ok));
  channel?.postMessage({ t: 'release' });
  await new Promise<void>((ok) => {
    const ac = new AbortController();
    const grant = () => {
      clearTimeout(timer);
      ok();
      return hold();
    };
    // the other tab may be frozen: after a while, take the lock anyway (it saved what it could)
    const timer = setTimeout(() => {
      ac.abort();
      locks.request(LOCK, { steal: true }, grant).catch(lost);
    }, 4000);
    // rejected when this wait is given up for the steal above (ignore), or when a third tab steals it later
    locks.request(LOCK, { signal: ac.signal }, grant).catch(() => {
      if (!ac.signal.aborted) lost();
    });
  });
}

channel?.addEventListener('message', (e: MessageEvent<{ t: string }>) => {
  if (e.data?.t !== 'release' || !active) return;
  active = false;
  // this tab's jobs stop and it stores nothing more: the other tab owns the books now
  stopJobs();
  void vfs.freeze().finally(() => {
    letGo?.();
    post({ t: 'released' });
  });
});

/* ---------- requests ---------- */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function serve(m: Extract<ToWorker, { t: 'req' }>) {
  const { id, method } = m;
  let res: Response;
  if (!handle || !active) res = json(409, { error: 'Warqa is open in another tab', inactive: true });
  else {
    const body = m.body && method !== 'GET' && method !== 'HEAD' ? m.body : undefined;
    try {
      res = await handle(new Request(`http://127.0.0.1${m.url}`, { method, headers: m.headers, body }));
    } catch (e) {
      res = json(500, { error: (e as Error).message || 'server error' });
    }
    // what the request changed is stored before the page hears back
    if (method !== 'GET' && method !== 'HEAD')
      await vfs.flush().catch((e: Error) => post({ t: 'storage', message: e.message }));
  }
  post({ t: 'head', id, status: res.status, statusText: res.statusText, headers: [...res.headers] });
  if (!res.body) return post({ t: 'end', id });
  const reader = res.body.getReader();
  inflight.set(id, reader);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // transfer the chunk's memory to the page (copy views into bigger buffers first)
      const chunk = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength ? value : value.slice();
      post({ t: 'chunk', id, data: chunk }, [chunk.buffer as ArrayBuffer]);
    }
    post({ t: 'end', id });
  } catch (e) {
    post({ t: 'fail', id, message: (e as Error).message });
  } finally {
    inflight.delete(id);
  }
}

/* ---------- start ---------- */

async function start(opts: InitOptions) {
  await acquire();
  const { persistent } = await vfs.load();
  vfs.onError = (e) => post({ t: 'storage', message: e.message });
  applyKeys();
  setupPdf(opts.base);
  const urlBase = opts.base;
  const {
    app: studio,
    jobs,
    registry,
  } = createApp({
    root: ROOT,
    urlBase,
    runners: browserRunners(urlBase, (running) => post({ t: 'jobs', running })),
    capabilities: {
      platform: 'browser',
      ttsUnavailable: desktopOnlyVoices,
      jobsUnavailable: desktopOnlyJobs,
      keyStore: 'browser',
      worker: false,
    },
    defaultTts: 'none',
    ...(opts.fake ? { llm: { fake: fakeModel } } : {}),
  });
  const web: Hono = webRoutes({ root: ROOT, base: urlBase, fake: opts.fake, jobs });
  stopJobs = () => {
    for (const id of registry.scan().keys())
      for (const j of jobs.list(id)) if (j.status === 'running' || j.status === 'queued') jobs.cancel(j.id);
  };
  // An exported book's zip is kept in memory only (/tmp): after a reload it is made again from the export, on
  // demand, so "Download .zip" stays offered for every exported book.
  const zipFor = (id: string) => {
    const dir = registry.dir(id);
    if (!dir || zipReady(dir) || !vfs.existsSync(join(dir, 'dist', 'index.html'))) return;
    vfs.mkdirSync(dirname(zipPath(dir)), { recursive: true });
    P.zipFolder(join(dir, 'dist'), zipPath(dir));
  };
  handle = async (req) => {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/web/')) return web.fetch(req);
    const download = /^\/api\/projects\/([^/]+)\/download$/.exec(path);
    if (download) zipFor(decodeURIComponent(download[1]!));
    const res = await studio.fetch(req);
    if (req.method !== 'GET' || !res.ok || !/^\/api\/projects\/[^/]+$/.test(path)) return res;
    const detail = (await res.json()) as { exportInfo?: { exported: boolean; zip: boolean } };
    if (detail.exportInfo?.exported) detail.exportInfo.zip = true;
    return Response.json(detail, { status: res.status });
  };
  active = true;
  post({ t: 'ready', info: { persistent, fake: opts.fake, version: __STUDIO_VERSION__ } });
  for (const m of queued.splice(0)) void serve(m);
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.t === 'init') {
    if (options) return;
    options = m.opts;
    start(m.opts).catch((err: Error) => post({ t: 'fatal', message: err?.message || String(err) }));
  } else if (m.t === 'req') {
    // before the books are loaded, requests wait (the page shows a loading screen meanwhile)
    if (!handle) queued.push(m);
    else void serve(m);
  } else if (m.t === 'abort') {
    void inflight.get(m.id)?.cancel();
  } else if (m.t === 'takeover') {
    takeover?.();
  }
};
