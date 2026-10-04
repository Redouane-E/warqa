// The virtual file system behind the in-browser server: Node's fs semantics for the calls the studio and the
// pipeline make, and persistence to IndexedDB (fake-indexeddb here) that survives a "reload" (a new instance).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Vfs } from '../src/worker/vfs';

const fresh = async () => {
  const v = new Vfs();
  await v.load();
  return v;
};

describe('virtual file system', () => {
  it('reads, writes, lists and stats like node:fs', async () => {
    const fs = await fresh();
    fs.mkdirSync('/books/a.warqa/lessons/ch01', { recursive: true });
    fs.writeFileSync('/books/a.warqa/warqa.json', '{"id":"a"}');
    fs.writeFileSync('/books/a.warqa/lessons/ch01/lesson.json', new Uint8Array([123, 125]));
    expect(fs.readFileSync('/books/a.warqa/warqa.json', 'utf8')).toBe('{"id":"a"}');
    expect(fs.readFileSync('/books/a.warqa/lessons/ch01/lesson.json').toString()).toBe('{}');
    expect(fs.readdirSync('/books/a.warqa')).toEqual(['lessons', 'warqa.json']);
    const ents = fs.readdirSync('/books', { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[];
    expect(ents.map((d) => [d.name, d.isDirectory()])).toEqual([['a.warqa', true]]);
    const st = fs.statSync('/books/a.warqa/warqa.json');
    expect(st.isFile()).toBe(true);
    expect(st.size).toBe(10);
    expect(st.mtimeMs).toBeGreaterThan(0);
    expect(() => fs.readFileSync('/nope')).toThrow(/ENOENT/);
    expect(() => fs.writeFileSync('/missing/dir/x', 'x')).toThrow(/ENOENT/);
    expect(() => fs.mkdirSync('/books')).toThrow(/EEXIST/);
    expect(fs.statSync('/nope', { throwIfNoEntry: false })).toBeUndefined();
    fs.appendFileSync('/books/a.warqa/log', 'a\n');
    fs.appendFileSync('/books/a.warqa/log', 'b\n');
    expect(fs.readFileSync('/books/a.warqa/log', 'utf8')).toBe('a\nb\n');
  });

  it('renames files and whole folders, copies with a filter, removes recursively', async () => {
    const fs = await fresh();
    fs.mkdirSync('/books/b/x/y', { recursive: true });
    fs.writeFileSync('/books/b/x/y/f.txt', 'f');
    fs.writeFileSync('/books/b/t.tmp', 'new');
    fs.writeFileSync('/books/b/t.json', 'old');
    fs.renameSync('/books/b/t.tmp', '/books/b/t.json'); // atomic write: temp file then rename
    expect(fs.readFileSync('/books/b/t.json', 'utf8')).toBe('new');
    expect(fs.existsSync('/books/b/t.tmp')).toBe(false);
    fs.renameSync('/books/b/x', '/books/b/z');
    expect(fs.readFileSync('/books/b/z/y/f.txt', 'utf8')).toBe('f');
    expect(fs.existsSync('/books/b/x')).toBe(false);
    fs.writeFileSync('/books/b/z/y/f.map', 'map');
    fs.cpSync('/books/b/z', '/tmp/copy', { recursive: true, filter: (s) => !s.endsWith('.map') });
    expect(fs.readdirSync('/tmp/copy/y')).toEqual(['f.txt']);
    expect(() => fs.rmSync('/books/b')).toThrow(/EISDIR/);
    fs.rmSync('/books/b', { recursive: true, force: true });
    expect(fs.existsSync('/books/b/z/y/f.txt')).toBe(false);
    fs.rmSync('/books/b', { recursive: true, force: true }); // force: no error when missing
  });

  it('keeps /books and /home across a reload, and only them', async () => {
    const fs = await fresh();
    fs.mkdirSync('/books/c.warqa/source', { recursive: true });
    fs.writeFileSync('/books/c.warqa/source/book.pdf', new Uint8Array([37, 80, 68, 70]));
    fs.mkdirSync('/home/.warqa', { recursive: true });
    fs.writeFileSync('/home/.warqa/keys.json', '{"K":"v"}', { mode: 0o600 });
    fs.writeFileSync('/tmp/scratch', 'gone after reload');
    fs.writeFileSync('/books/c.warqa/gone.tmp', 'x');
    fs.rmSync('/books/c.warqa/gone.tmp');
    expect(fs.pending).toBeGreaterThan(0);
    await fs.flush();
    expect(fs.pending).toBe(0);

    const again = await fresh();
    expect(Array.from(again.readFileSync('/books/c.warqa/source/book.pdf') as Uint8Array)).toEqual([37, 80, 68, 70]);
    expect(again.readFileSync('/home/.warqa/keys.json', 'utf8')).toBe('{"K":"v"}');
    expect(again.existsSync('/books/c.warqa/gone.tmp')).toBe(false);
    expect(again.existsSync('/tmp/scratch')).toBe(false);

    await again.wipe('/books/c.warqa');
    expect((await fresh()).existsSync('/books/c.warqa')).toBe(false);
  });

  it('serves byte ranges as web streams (audio seeking)', async () => {
    const fs = await fresh();
    fs.writeFileSync('/books/r', new Uint8Array([0, 1, 2, 3, 4, 5]));
    const s = fs.createReadStream('/books/r', { start: 2, end: 4 });
    const bytes = new Uint8Array(await new Response(s.__web).arrayBuffer());
    expect(Array.from(bytes)).toEqual([2, 3, 4]);
  });
});
