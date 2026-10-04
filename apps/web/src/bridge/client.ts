// The page side of the in-browser server. The studio's React app calls fetch('/api/…') and new EventSource(…)
// as it does with the local server; here those calls go to the Web Worker that runs the studio's Hono app
// (worker/server.worker.ts). Loads the browser makes on its own (audio and images in the lesson preview, an
// exported book opened in a new tab, a download link) go through the service worker (public/sw.js), which hands
// them to this page too.
import { stripBase } from '../../../studio/src/client/base';
import { type FromWorker, type InitOptions, SERVER_PATH, type ToWorker, type WorkerInfo } from './protocol';

export type BridgeState = 'starting' | 'ready' | 'busy' | 'released' | 'failed';

interface Pending {
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  head?: boolean;
}

/** Is this URL one the in-browser server answers (same origin, /api/… or /books/… under the base)? */
export function isServerUrl(url: string | URL): boolean {
  const u = new URL(String(url), location.href);
  return u.origin === location.origin && SERVER_PATH.test(stripBase(u.pathname));
}

export class Bridge {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private listeners = new Set<() => void>();
  state: BridgeState = 'starting';
  info: WorkerInfo | null = null;
  error = '';
  /** The last storage problem (quota), for a banner. */
  storageError = '';
  /** Jobs running in the worker (they stop if the tab closes). */
  running = 0;
  readonly ready: Promise<WorkerInfo>;

  constructor(readonly opts: InitOptions) {
    this.worker = new Worker(new URL('../worker/server.worker.ts', import.meta.url), {
      type: 'module',
      name: 'warqa-studio-server',
    });
    let ok!: (i: WorkerInfo) => void;
    let ko!: (e: Error) => void;
    this.ready = new Promise<WorkerInfo>((a, b) => {
      ok = a;
      ko = b;
    });
    this.ready.catch(() => {});
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data, ok, ko);
    this.worker.onerror = (e) => {
      this.fail(e.message || 'the studio could not start in this browser');
      ko(new Error(this.error));
    };
    this.post({ t: 'init', opts });
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  private set(state: BridgeState) {
    this.state = state;
    for (const l of this.listeners) l();
  }

  private fail(message: string) {
    this.error = message;
    this.set('failed');
  }

  /** For React's useSyncExternalStore. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Ask the tab that has the books open to hand them over to this one. */
  takeover() {
    this.post({ t: 'takeover' });
  }

  private receive(m: FromWorker, ok: (i: WorkerInfo) => void, ko: (e: Error) => void) {
    switch (m.t) {
      case 'ready':
        this.info = m.info;
        this.set('ready');
        ok(m.info);
        return;
      case 'busy':
        this.set('busy');
        return;
      case 'released':
        this.set('released');
        return;
      case 'fatal':
        this.fail(m.message);
        ko(new Error(m.message));
        return;
      case 'storage':
        this.storageError = m.message;
        this.set(this.state);
        return;
      case 'jobs':
        this.running = m.running;
        return;
      case 'head': {
        const p = this.pending.get(m.id);
        if (!p) return;
        const id = m.id;
        const empty = p.head || [101, 204, 205, 304].includes(m.status);
        const body = empty
          ? null
          : new ReadableStream<Uint8Array>({
              start: (c) => {
                p.controller = c;
              },
              cancel: () => {
                this.pending.delete(id);
                this.post({ t: 'abort', id });
              },
            });
        p.resolve(new Response(body, { status: m.status, statusText: m.statusText, headers: m.headers }));
        return;
      }
      case 'chunk':
        try {
          this.pending.get(m.id)?.controller?.enqueue(m.data);
        } catch {
          /* the reader went away */
        }
        return;
      case 'end': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        try {
          p?.controller?.close();
        } catch {
          /* already closed */
        }
        return;
      }
      case 'fail': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        const err = new TypeError(m.message);
        if (p?.controller) p.controller.error(err);
        else p?.reject(err);
        return;
      }
    }
  }

  /** Send a request to the in-browser server. */
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const head = req.method === 'HEAD';
    const body = req.method === 'GET' || head ? undefined : await req.arrayBuffer();
    const id = ++this.seq;
    return new Promise<Response>((resolve, reject) => {
      const p: Pending = { resolve, reject, head };
      this.pending.set(id, p);
      if (req.signal) {
        const abort = () => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          this.post({ t: 'abort', id });
          const e = new DOMException('The request was aborted', 'AbortError');
          try {
            p.controller?.error(e);
          } catch {
            /* closed */
          }
          reject(e);
        };
        if (req.signal.aborted) return abort();
        req.signal.addEventListener('abort', abort, { once: true });
      }
      this.post(
        {
          t: 'req',
          id,
          method: req.method,
          url: stripBase(u.pathname) + u.search,
          headers: [...req.headers],
          ...(body ? { body } : {}),
        },
        body ? [body] : [],
      );
    });
  }
}

/* ---------- fetch and EventSource in the page ---------- */

const PLAYER_DATA = /^\/api\/projects\/[^/]+\/lessons\/[^/]+\/player$/;
const blobs = new Map<string, string>();

/** Without a service worker the preview's <audio> cannot load server URLs: hand it in-memory copies instead. */
async function withLocalAudio(bridge: Bridge, res: Response): Promise<Response> {
  if (!res.ok) return res;
  const data = (await res.json()) as { audio?: Record<string, Record<string, string>> };
  for (const clips of Object.values(data.audio ?? {}))
    for (const [beat, url] of Object.entries(clips)) {
      let local = blobs.get(url);
      if (!local) {
        const r = await bridge.fetch(new Request(new URL(url, location.href)));
        if (!r.ok) continue;
        local = URL.createObjectURL(await r.blob());
        blobs.set(url, local);
      }
      clips[beat] = local;
    }
  return Response.json(data, { status: res.status, statusText: res.statusText });
}

const swControls = () => !!navigator.serviceWorker?.controller;

/** Route the page's fetch() calls for the server to the worker. */
export function installFetch(bridge: Bridge) {
  const native = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isServerUrl(url)) return native(input, init);
    const req = input instanceof Request ? (init ? new Request(input, init) : input) : new Request(url, init);
    if (!swControls() && PLAYER_DATA.test(stripBase(new URL(req.url).pathname)))
      return bridge.fetch(req).then((res) => withLocalAudio(bridge, res));
    return bridge.fetch(req);
  };
}

/**
 * Without a service worker, links to the server cannot load by themselves either: a download link is fetched and
 * saved from here; other links (an exported book in a new tab) get an explanation.
 */
export function installLinkFallback(explain: () => void) {
  document.addEventListener(
    'click',
    (e) => {
      if (swControls() || e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !isServerUrl(a.href)) return;
      e.preventDefault();
      if (a.hasAttribute('download'))
        void download(a.href, 'warqa.zip').catch((err: Error) => window.alert(err.message));
      else explain();
    },
    true,
  );
}

/** EventSource over the worker (Server-Sent Events of running jobs), with reconnection like the real one. */
class BridgeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  readonly withCredentials = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private ac: AbortController | null = null;
  private lastId = '';

  constructor(
    readonly url: string,
    private bridge: Bridge,
  ) {
    super();
    void this.connect();
  }

  private emit(e: Event) {
    this.dispatchEvent(e);
    const h = (this as unknown as Record<string, unknown>)[`on${e.type}`];
    if (typeof h === 'function' && ['open', 'message', 'error'].includes(e.type)) h.call(this, e);
  }

  private async connect() {
    if (this.readyState === 2) return;
    this.ac = new AbortController();
    let retry = true;
    try {
      const res = await this.bridge.fetch(
        new Request(this.url, {
          headers: { accept: 'text/event-stream', ...(this.lastId ? { 'last-event-id': this.lastId } : {}) },
          signal: this.ac.signal,
        }),
      );
      if (!res.ok || !res.body) {
        retry = false;
        throw new Error(`HTTP ${res.status}`);
      }
      this.readyState = 1;
      this.emit(new Event('open'));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let data: string[] = [];
      let event = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        for (let m = /\r\n|\r|\n/.exec(buf); m; m = /\r\n|\r|\n/.exec(buf)) {
          const line = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          if (!line) {
            if (data.length)
              this.emit(new MessageEvent(event || 'message', { data: data.join('\n'), lastEventId: this.lastId }));
            data = [];
            event = '';
            continue;
          }
          if (line.startsWith(':')) continue;
          const c = line.indexOf(':');
          const field = c < 0 ? line : line.slice(0, c);
          const val = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
          if (field === 'data') data.push(val);
          else if (field === 'event') event = val;
          else if (field === 'id') this.lastId = val;
        }
      }
    } catch {
      /* reconnect below, unless closed */
    }
    if (this.readyState === 2) return;
    if (!retry) {
      this.readyState = 2;
      this.emit(new Event('error'));
      return;
    }
    this.readyState = 0;
    this.emit(new Event('error'));
    setTimeout(() => void this.connect(), 1000);
  }

  close() {
    this.readyState = 2;
    this.ac?.abort();
  }
}

export function installEventSource(bridge: Bridge) {
  const Native = window.EventSource;
  function WebEventSource(url: string | URL, init?: EventSourceInit) {
    return isServerUrl(url)
      ? new BridgeEventSource(new URL(String(url), location.href).href, bridge)
      : new Native(url, init);
  }
  Object.assign(WebEventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  window.EventSource = WebEventSource as unknown as typeof EventSource;
}

/* ---------- the service worker ---------- */

interface SwRequest {
  t: 'sw-req';
  method: string;
  url: string;
  headers: [string, string][];
  body?: ArrayBuffer;
}

/**
 * Register the service worker and answer the requests it relays (resources the browser loads by itself).
 * Returns false when service workers are unavailable (e.g. some private windows): the studio still works, but
 * lesson audio in the preview and opening an exported book in a new tab do not.
 */
export async function installServiceWorker(bridge: Bridge, base: string): Promise<boolean> {
  const sw = navigator.serviceWorker;
  if (!sw) return false;
  sw.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as SwRequest | { t: 'who' };
    if (m?.t === 'who') {
      if (bridge.state === 'ready') (e.source as ServiceWorker | null)?.postMessage({ t: 'hello' });
      return;
    }
    if (m?.t !== 'sw-req') return;
    const port = e.ports[0];
    if (!port) return;
    void relay(bridge, m, port);
  });
  try {
    // a browser that refuses service workers may also never answer: give up after a while
    const timeout = new Promise<never>((_, ko) => setTimeout(() => ko(new Error('timeout')), 8000));
    const reg = await Promise.race([sw.register(`${base}sw.js`, { scope: base }), timeout]);
    await Promise.race([sw.ready, timeout]);
    const hello = () => (sw.controller ?? reg.active)?.postMessage({ t: 'hello' });
    void bridge.ready.then(hello);
    sw.addEventListener('controllerchange', () => void bridge.ready.then(hello));
    return true;
  } catch {
    return false;
  }
}

async function relay(bridge: Bridge, m: SwRequest, port: MessagePort) {
  if (bridge.state !== 'ready') {
    port.postMessage({ t: 'head', status: 503, statusText: 'busy', headers: [] });
    port.postMessage({ t: 'end' });
    return;
  }
  try {
    const res = await bridge.fetch(
      new Request(m.url, { method: m.method, headers: m.headers, ...(m.body ? { body: m.body } : {}) }),
    );
    port.postMessage({ t: 'head', status: res.status, statusText: res.statusText, headers: [...res.headers] });
    if (res.body) {
      const reader = res.body.getReader();
      port.onmessage = (e) => {
        if (e.data?.t === 'cancel') void reader.cancel();
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        port.postMessage({ t: 'chunk', data: value }, [value.buffer as ArrayBuffer]);
      }
    }
    port.postMessage({ t: 'end' });
  } catch (e) {
    port.postMessage({ t: 'fail', message: (e as Error).message });
  }
}

/** Save a server response (a zip) as a download, without relying on the service worker. */
export async function download(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
