// The file system the studio server and the pipeline see in the browser: a synchronous, in-memory tree with the
// part of Node's fs API they use, persisted to IndexedDB.
//
// Why not ZenFS or memfs: the pipeline writes with synchronous calls, so any backend keeps a full copy in memory
// anyway; what matters is knowing when a change is safely stored. ZenFS's IndexedDB store offers no "durable now"
// point (its sync() does not wait for the queued IndexedDB writes) and memfs needs Node polyfills (path, stream,
// events, buffer) plus a persistence layer of its own. Here every change marks its path, and flush() writes all
// marked paths in one IndexedDB transaction and resolves when that transaction has committed. The worker flushes
// before it answers any request that changed something, and when a job ends.
import { Buffer } from 'buffer';
import { basename, dirname, join, resolve } from 'pathe';

interface FileNode {
  kind: 'file';
  data: Uint8Array;
  mtime: number;
  mode: number;
}
interface DirNode {
  kind: 'dir';
  mtime: number;
  mode: number;
}
type Node = FileNode | DirNode;

/** What IndexedDB stores per path. */
interface Record_ {
  k: 'f' | 'd';
  d?: Uint8Array;
  m: number;
  o: number;
}

type Encoding = 'utf8' | 'utf-8' | 'base64' | 'hex' | 'latin1' | 'binary' | 'ascii' | null | undefined;
type ReadOpts = Encoding | { encoding?: Encoding; flag?: string };
type WriteData = string | Uint8Array | ArrayBufferView;
type WriteOpts = Encoding | { encoding?: Encoding; mode?: number; flag?: string };

export class FsError extends Error {
  constructor(
    readonly code: string,
    syscall: string,
    readonly path: string,
    what: string,
  ) {
    super(`${code}: ${what}, ${syscall} '${path}'`);
    this.syscall = syscall;
  }
  readonly syscall: string;
  readonly errno = -1;
}

const WHAT: Record<string, string> = {
  ENOENT: 'no such file or directory',
  EEXIST: 'file already exists',
  EISDIR: 'illegal operation on a directory',
  ENOTDIR: 'not a directory',
  ENOTEMPTY: 'directory not empty',
  EINVAL: 'invalid argument',
};
const fail = (code: string, syscall: string, path: string) => new FsError(code, syscall, path, WHAT[code] ?? code);

const encOf = (o: ReadOpts | WriteOpts): Encoding => (typeof o === 'string' || o === null ? o : o?.encoding);

function toBytes(data: WriteData, enc: Encoding): Uint8Array {
  if (typeof data === 'string') return new Uint8Array(Buffer.from(data, (enc ?? 'utf8') as BufferEncoding));
  if (data instanceof Uint8Array) return data.slice();
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

export class Stats {
  constructor(
    private node: Node,
    readonly ino: number,
  ) {
    this.size = node.kind === 'file' ? node.data.byteLength : 0;
    this.mtimeMs = node.mtime;
    this.mode = (node.kind === 'file' ? 0o100000 : 0o40000) | node.mode;
  }
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
  readonly dev = 1;
  readonly nlink = 1;
  readonly uid = 0;
  readonly gid = 0;
  readonly blksize = 4096;
  get blocks() {
    return Math.ceil(this.size / 512);
  }
  get atimeMs() {
    return this.mtimeMs;
  }
  get ctimeMs() {
    return this.mtimeMs;
  }
  get birthtimeMs() {
    return this.mtimeMs;
  }
  get mtime() {
    return new Date(this.mtimeMs);
  }
  get atime() {
    return new Date(this.mtimeMs);
  }
  get ctime() {
    return new Date(this.mtimeMs);
  }
  get birthtime() {
    return new Date(this.mtimeMs);
  }
  isFile() {
    return this.node.kind === 'file';
  }
  isDirectory() {
    return this.node.kind === 'dir';
  }
  isSymbolicLink() {
    return false;
  }
}

export class Dirent {
  constructor(
    readonly name: string,
    readonly parentPath: string,
    private kind: Node['kind'],
  ) {}
  get path() {
    return this.parentPath;
  }
  isFile() {
    return this.kind === 'file';
  }
  isDirectory() {
    return this.kind === 'dir';
  }
  isSymbolicLink() {
    return false;
  }
}

/** A "stream" that only Readable.toWeb (shims/stream.ts) understands: the studio serves files with it. */
export interface WebReadStream {
  __web: ReadableStream<Uint8Array>;
}

const DB = 'warqa';
const STORE = 'vfs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error ?? new Error('IndexedDB is not available'));
    req.onblocked = () => ko(new Error('IndexedDB is blocked by another tab'));
  });
}

export class Vfs {
  private nodes = new Map<string, Node>();
  private kids = new Map<string, Set<string>>();
  private dirty = new Map<string, 'put' | 'del'>();
  private db: IDBDatabase | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inos = new Map<string, number>();
  private frozen = false;
  /** Called when a background flush fails (storage full, IndexedDB gone). */
  onError?: (e: Error) => void;

  constructor(
    /** Paths kept in IndexedDB (the rest lives in memory only). */
    readonly persistent: string[] = ['/books', '/home'],
  ) {
    this.nodes.set('/', { kind: 'dir', mtime: Date.now(), mode: 0o755 });
    this.kids.set('/', new Set());
    // like any system: a scratch folder (memory only, see `persistent`)
    this.putNode('/tmp', { kind: 'dir', mtime: Date.now(), mode: 0o777 }, false);
  }

  /* ---------- persistence ---------- */

  private persisted(p: string): boolean {
    return this.persistent.some((r) => p === r || p.startsWith(`${r}/`));
  }

  /** Load everything stored in IndexedDB (call once, before use). Without IndexedDB, stays in memory. */
  async load(): Promise<{ persistent: boolean }> {
    try {
      this.db = await openDb();
    } catch {
      this.db = null;
      for (const r of this.persistent) this.mkdirSync(r, { recursive: true });
      return { persistent: false };
    }
    const db = this.db;
    const [keys, values] = await new Promise<[IDBValidKey[], Record_[]]>((ok, ko) => {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const k = st.getAllKeys();
      const v = st.getAll();
      tx.oncomplete = () => ok([k.result, v.result as Record_[]]);
      tx.onerror = () => ko(tx.error);
    });
    // parents first, so every node has its directory
    const rows = keys.map((key, i) => [String(key), values[i]!] as const).sort((a, b) => a[0].length - b[0].length);
    for (const [path, r] of rows) {
      this.ensureParents(path);
      if (r.k === 'd') this.putNode(path, { kind: 'dir', mtime: r.m, mode: r.o }, false);
      else this.putNode(path, { kind: 'file', data: r.d ?? new Uint8Array(), mtime: r.m, mode: r.o }, false);
    }
    for (const r of this.persistent) if (!this.nodes.has(r)) this.mkdirSync(r, { recursive: true });
    return { persistent: true };
  }

  private ensureParents(path: string) {
    const parent = dirname(path);
    if (parent === path || this.nodes.has(parent)) return;
    this.ensureParents(parent);
    this.putNode(parent, { kind: 'dir', mtime: Date.now(), mode: 0o755 }, false);
  }

  private mark(path: string, op: 'put' | 'del') {
    if (this.frozen || !this.persisted(path)) return;
    this.dirty.set(path, op);
    if (!this.timer) this.timer = setTimeout(() => void this.flush().catch((e) => this.onError?.(e)), 400);
  }

  /** Store what is pending, then stop storing anything (another tab took the books over). */
  async freeze(): Promise<void> {
    await this.flush().catch(() => {});
    this.frozen = true;
    this.dirty.clear();
  }

  /** Changes not yet stored. */
  get pending(): number {
    return this.dirty.size;
  }

  /** Store every change made so far; resolves once IndexedDB has committed them. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const run = async () => {
      if (!this.db || !this.dirty.size) return;
      const batch = [...this.dirty];
      this.dirty.clear();
      const db = this.db;
      try {
        await new Promise<void>((ok, ko) => {
          const tx = db.transaction(STORE, 'readwrite');
          const st = tx.objectStore(STORE);
          for (const [path, op] of batch) {
            const n = this.nodes.get(path);
            if (op === 'del' || !n) st.delete(path);
            else
              st.put(
                n.kind === 'dir'
                  ? ({ k: 'd', m: n.mtime, o: n.mode } satisfies Record_)
                  : ({ k: 'f', d: n.data, m: n.mtime, o: n.mode } satisfies Record_),
                path,
              );
          }
          tx.oncomplete = () => ok();
          tx.onabort = () => ko(tx.error ?? new Error('the browser refused to save (storage full?)'));
          tx.onerror = () => ko(tx.error ?? new Error('the browser refused to save'));
        });
      } catch (e) {
        // keep them for the next attempt (newer changes win)
        for (const [path, op] of batch) if (!this.dirty.has(path)) this.dirty.set(path, op);
        throw e;
      }
    };
    this.flushing = this.flushing.then(run, run);
    return this.flushing;
  }

  /** Forget everything stored under a path (memory and IndexedDB). */
  async wipe(path: string): Promise<void> {
    if (this.existsSync(path)) this.rmSync(path, { recursive: true, force: true });
    await this.flush();
  }

  /* ---------- tree ---------- */

  private norm(p: string | URL | Uint8Array): string {
    const s = typeof p === 'string' ? p : p instanceof URL ? decodeURIComponent(p.pathname) : Buffer.from(p).toString();
    if (s.includes('\0')) throw fail('EINVAL', 'open', s);
    const out = resolve('/', s);
    return out.length > 1 ? out.replace(/\/+$/, '') : out;
  }

  private putNode(path: string, node: Node, mark = true) {
    const existed = this.nodes.has(path);
    this.nodes.set(path, node);
    if (node.kind === 'dir' && !this.kids.has(path)) this.kids.set(path, new Set());
    if (!existed && path !== '/') this.kids.get(dirname(path))?.add(basename(path));
    if (mark) {
      this.mark(path, 'put');
      this.touchDir(dirname(path));
    }
  }

  private dropNode(path: string) {
    const n = this.nodes.get(path);
    if (!n) return;
    if (n.kind === 'dir') {
      for (const k of [...(this.kids.get(path) ?? [])]) this.dropNode(join(path, k));
      this.kids.delete(path);
    }
    this.nodes.delete(path);
    this.inos.delete(path);
    this.kids.get(dirname(path))?.delete(basename(path));
    this.mark(path, 'del');
  }

  private touchDir(path: string) {
    const d = this.nodes.get(path);
    if (d?.kind === 'dir') d.mtime = Date.now();
  }

  private dir(path: string, syscall: string): DirNode {
    const n = this.nodes.get(path);
    if (!n) throw fail('ENOENT', syscall, path);
    if (n.kind !== 'dir') throw fail('ENOTDIR', syscall, path);
    return n;
  }

  private file(path: string, syscall: string): FileNode {
    const n = this.nodes.get(path);
    if (!n) throw fail('ENOENT', syscall, path);
    if (n.kind !== 'file') throw fail('EISDIR', syscall, path);
    return n;
  }

  /** Paths under a directory (deepest last). */
  private walk(path: string): string[] {
    const out: string[] = [path];
    const n = this.nodes.get(path);
    if (n?.kind === 'dir')
      for (const k of [...(this.kids.get(path) ?? [])].sort()) out.push(...this.walk(join(path, k)));
    return out;
  }

  /* ---------- the fs API ---------- */

  existsSync(p: string): boolean {
    try {
      return this.nodes.has(this.norm(p));
    } catch {
      return false;
    }
  }

  statSync(p: string, opts?: { throwIfNoEntry?: boolean }): Stats {
    const path = this.norm(p);
    const n = this.nodes.get(path);
    if (!n) {
      if (opts?.throwIfNoEntry === false) return undefined as unknown as Stats;
      throw fail('ENOENT', 'stat', path);
    }
    let ino = this.inos.get(path);
    if (!ino) this.inos.set(path, (ino = this.inos.size + 2));
    return new Stats(n, ino);
  }

  readFileSync(p: string, opts?: ReadOpts): string | Buffer {
    const path = this.norm(p);
    const n = this.file(path, 'open');
    const enc = encOf(opts);
    const buf = Buffer.from(n.data);
    return enc ? buf.toString(enc as BufferEncoding) : buf;
  }

  writeFileSync(p: string, data: WriteData, opts?: WriteOpts): void {
    const path = this.norm(p);
    const o = typeof opts === 'object' && opts ? opts : {};
    if (o.flag?.startsWith('a')) {
      this.appendFileSync(path, data, opts);
      return;
    }
    const parent = this.nodes.get(dirname(path));
    if (!parent) throw fail('ENOENT', 'open', path);
    if (parent.kind !== 'dir') throw fail('ENOTDIR', 'open', path);
    const cur = this.nodes.get(path);
    if (cur?.kind === 'dir') throw fail('EISDIR', 'open', path);
    if (o.flag === 'wx' && cur) throw fail('EEXIST', 'open', path);
    this.putNode(path, {
      kind: 'file',
      data: toBytes(data, encOf(opts)),
      mtime: Date.now(),
      mode: o.mode ?? (cur as FileNode | undefined)?.mode ?? 0o644,
    });
  }

  appendFileSync(p: string, data: WriteData, opts?: WriteOpts): void {
    const path = this.norm(p);
    const cur = this.nodes.get(path);
    if (!cur) {
      this.writeFileSync(path, data, typeof opts === 'object' && opts ? { ...opts, flag: 'w' } : opts);
      return;
    }
    if (cur.kind === 'dir') throw fail('EISDIR', 'open', path);
    const add = toBytes(data, encOf(opts));
    const next = new Uint8Array(cur.data.byteLength + add.byteLength);
    next.set(cur.data);
    next.set(add, cur.data.byteLength);
    this.putNode(path, { ...cur, data: next, mtime: Date.now() });
  }

  mkdirSync(p: string, opts?: number | { recursive?: boolean; mode?: number }): string | undefined {
    const path = this.norm(p);
    const o = typeof opts === 'number' ? { mode: opts } : (opts ?? {});
    const cur = this.nodes.get(path);
    if (cur) {
      if (o.recursive && cur.kind === 'dir') return undefined;
      throw fail('EEXIST', 'mkdir', path);
    }
    const parent = dirname(path);
    let first: string | undefined;
    if (!this.nodes.has(parent)) {
      if (!o.recursive) throw fail('ENOENT', 'mkdir', path);
      first = this.mkdirSync(parent, o);
    } else this.dir(parent, 'mkdir');
    this.putNode(path, { kind: 'dir', mtime: Date.now(), mode: o.mode ?? 0o755 });
    return o.recursive ? (first ?? path) : undefined;
  }

  readdirSync(p: string, opts?: Encoding | { withFileTypes?: boolean; encoding?: Encoding; recursive?: boolean }) {
    const path = this.norm(p);
    this.dir(path, 'scandir');
    const names = [...(this.kids.get(path) ?? [])].sort();
    const o = typeof opts === 'object' && opts ? opts : {};
    if (o.recursive) {
      const all = this.walk(path)
        .slice(1)
        .map((x) => x.slice(path === '/' ? 1 : path.length + 1));
      return o.withFileTypes
        ? all.map((rel) => new Dirent(basename(rel), dirname(join(path, rel)), this.nodes.get(join(path, rel))!.kind))
        : all;
    }
    if (o.withFileTypes) return names.map((n) => new Dirent(n, path, this.nodes.get(join(path, n))!.kind));
    return names;
  }

  renameSync(from: string, to: string): void {
    const a = this.norm(from);
    const b = this.norm(to);
    const n = this.nodes.get(a);
    if (!n) throw fail('ENOENT', 'rename', a);
    if (a === b) return;
    const parent = this.nodes.get(dirname(b));
    if (!parent) throw fail('ENOENT', 'rename', b);
    if (parent.kind !== 'dir') throw fail('ENOTDIR', 'rename', b);
    const target = this.nodes.get(b);
    if (n.kind === 'dir' && b.startsWith(`${a}/`)) throw fail('EINVAL', 'rename', b);
    if (target) {
      if (target.kind === 'dir' && n.kind !== 'dir') throw fail('EISDIR', 'rename', b);
      if (target.kind !== 'dir' && n.kind === 'dir') throw fail('ENOTDIR', 'rename', b);
      if (target.kind === 'dir' && this.kids.get(b)?.size) throw fail('ENOTEMPTY', 'rename', b);
      this.dropNode(b);
    }
    const moved = this.walk(a).map((p) => [p, this.nodes.get(p)!] as const);
    this.dropNode(a);
    for (const [p, node] of moved) this.putNode(b + p.slice(a.length), node);
  }

  rmSync(p: string, opts?: { recursive?: boolean; force?: boolean }): void {
    const path = this.norm(p);
    const n = this.nodes.get(path);
    if (!n) {
      if (opts?.force) return;
      throw fail('ENOENT', 'rm', path);
    }
    if (path === '/') throw fail('EINVAL', 'rm', path);
    if (n.kind === 'dir' && !opts?.recursive) throw fail('EISDIR', 'rm', path);
    this.touchDir(dirname(path));
    this.dropNode(path);
  }

  rmdirSync(p: string, opts?: { recursive?: boolean }): void {
    const path = this.norm(p);
    this.dir(path, 'rmdir');
    if (!opts?.recursive && this.kids.get(path)?.size) throw fail('ENOTEMPTY', 'rmdir', path);
    this.dropNode(path);
  }

  unlinkSync(p: string): void {
    const path = this.norm(p);
    this.file(path, 'unlink');
    this.dropNode(path);
  }

  copyFileSync(from: string, to: string): void {
    const src = this.file(this.norm(from), 'copyfile');
    this.writeFileSync(to, src.data, { mode: src.mode });
  }

  cpSync(
    from: string,
    to: string,
    opts: {
      recursive?: boolean;
      force?: boolean;
      errorOnExist?: boolean;
      filter?: (s: string, d: string) => boolean;
    } = {},
  ): void {
    const a = this.norm(from);
    const b = this.norm(to);
    const n = this.nodes.get(a);
    if (!n) throw fail('ENOENT', 'cp', a);
    if (opts.filter && !opts.filter(a, b)) return;
    if (n.kind === 'file') {
      if (this.nodes.has(b) && opts.force === false) {
        if (opts.errorOnExist) throw fail('EEXIST', 'cp', b);
        return;
      }
      if (!this.nodes.has(dirname(b))) this.mkdirSync(dirname(b), { recursive: true });
      this.copyFileSync(a, b);
      return;
    }
    if (!opts.recursive) throw fail('EISDIR', 'cp', a);
    if (b === a || b.startsWith(`${a}/`)) throw fail('EINVAL', 'cp', b);
    this.mkdirSync(b, { recursive: true });
    for (const k of [...(this.kids.get(a) ?? [])].sort()) this.cpSync(join(a, k), join(b, k), opts);
  }

  mkdtempSync(prefix: string): string {
    for (;;) {
      const path = this.norm(prefix + Math.random().toString(36).slice(2, 8));
      if (this.nodes.has(path)) continue;
      this.mkdirSync(path, { recursive: true });
      return path;
    }
  }

  chmodSync(p: string, mode: number): void {
    const path = this.norm(p);
    const n = this.nodes.get(path);
    if (!n) throw fail('ENOENT', 'chmod', path);
    n.mode = mode & 0o777;
    this.mark(path, 'put');
  }

  utimesSync(p: string, _atime: number | Date, mtime: number | Date): void {
    const path = this.norm(p);
    const n = this.nodes.get(path);
    if (!n) throw fail('ENOENT', 'utime', path);
    n.mtime = typeof mtime === 'number' ? mtime * 1000 : mtime.getTime();
    this.mark(path, 'put');
  }

  realpathSync(p: string): string {
    const path = this.norm(p);
    if (!this.nodes.has(path)) throw fail('ENOENT', 'realpath', path);
    return path;
  }

  accessSync(p: string): void {
    const path = this.norm(p);
    if (!this.nodes.has(path)) throw fail('ENOENT', 'access', path);
  }

  createReadStream(p: string, opts?: { start?: number; end?: number }): WebReadStream {
    const n = this.file(this.norm(p), 'open');
    const start = opts?.start ?? 0;
    const end = opts?.end !== undefined ? opts.end + 1 : n.data.byteLength;
    const bytes = n.data.slice(start, end);
    return { __web: new Blob([bytes]).stream() };
  }

  /* ---------- helpers for the web app ---------- */

  /** Every file under a directory: relative path → bytes (no copy). */
  files(root: string, skip?: (rel: string) => boolean): Map<string, Uint8Array> {
    const base = this.norm(root);
    const out = new Map<string, Uint8Array>();
    for (const p of this.walk(base)) {
      const n = this.nodes.get(p);
      const rel = p.slice(base.length + 1);
      if (!rel || n?.kind !== 'file' || skip?.(rel)) continue;
      out.set(rel, n.data);
    }
    return out;
  }

  /** Bytes stored under a path (files only), for storage summaries. */
  size(root: string): number {
    let total = 0;
    for (const p of this.walk(this.norm(root))) {
      const n = this.nodes.get(p);
      if (n?.kind === 'file') total += n.data.byteLength;
    }
    return total;
  }
}

/** The one file system of this worker. */
export const vfs = new Vfs();
