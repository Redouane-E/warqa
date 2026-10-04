// Node globals the studio server and the pipeline expect (process.env, process.pid, Buffer), for the Web Worker
// that runs them. Imported first by the worker entry. `process` must not look like Node's (pdf.js checks
// String(process) === "[object process]" to pick its Node code paths), and has no `versions.node`.
import { Buffer } from 'buffer';

type Listener = (...args: unknown[]) => void;

const g = globalThis as unknown as Record<string, unknown>;
g.global ??= globalThis;
g.Buffer ??= Buffer;

const print = (to: (s: string) => void, s: string) => {
  to(String(s).trimEnd());
  return true;
};

if (!g.process) {
  const noop = () => proc;
  const proc = {
    env: {} as Record<string, string | undefined>,
    pid: 1,
    ppid: 0,
    platform: 'browser',
    arch: 'wasm',
    title: 'browser',
    version: '',
    versions: {} as Record<string, string>,
    argv: [] as string[],
    execArgv: [] as string[],
    exitCode: undefined as number | undefined,
    cwd: () => '/',
    chdir: () => {},
    umask: () => 0o22,
    uptime: () => performance.now() / 1000,
    hrtime: Object.assign(
      (prev?: [number, number]) => {
        const t = performance.now();
        const s = Math.floor(t / 1000);
        const ns = Math.floor((t % 1000) * 1e6);
        return prev ? [s - prev[0], ns - prev[1]] : [s, ns];
      },
      { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) },
    ),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    nextTick: (fn: Listener, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
    emitWarning: (w: unknown) => console.warn(w),
    exit: (code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) is not available in the browser`);
    },
    on: noop,
    once: noop,
    off: noop,
    addListener: noop,
    removeListener: noop,
    removeAllListeners: noop,
    emit: () => false,
    listeners: () => [] as Listener[],
    stdout: { write: (s: string) => print(console.log, s), isTTY: false },
    stderr: { write: (s: string) => print(console.warn, s), isTTY: false },
    getBuiltinModule: () => undefined,
    toString: () => '[object BrowserProcess]',
  };
  g.process = proc;
}
