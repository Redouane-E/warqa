// An exported book becomes an installable app: Warqa's icons (any, maskable, Apple), a manifest in the brand's
// colours, theme-color for light and dark, and a service worker that pre-caches every file.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEME_COLOR } from '@warqa/brand';
import { describe, expect, it } from 'vitest';
import { addPwa } from './pwa.js';

const PNG = [0x89, 0x50, 0x4e, 0x47];

describe('installable books', () => {
  it('writes the icons, the manifest and the service worker, and links them from every page', () => {
    const out = mkdtempSync(join(tmpdir(), 'warqa-pwa-'));
    writeFileSync(join(out, 'index.html'), '<html><head></head><body></body></html>');
    mkdirSync(join(out, 'ch01'));
    writeFileSync(join(out, 'ch01', 'index.html'), '<html><head></head><body></body></html>');
    addPwa(out, { title: 'الأعداد الصحيحة', lang: 'ar', dir: 'rtl' });

    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'])
      expect([...readFileSync(join(out, f)).subarray(0, 4)], f).toEqual(PNG);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({
      lang: 'ar',
      dir: 'rtl',
      theme_color: THEME_COLOR[0],
      background_color: THEME_COLOR[0],
    });
    expect(manifest.icons.map((i: { src: string; purpose: string }) => `${i.src} ${i.purpose}`)).toEqual([
      'icon-192.png any',
      'icon-512.png any',
      'icon-maskable-512.png maskable',
    ]);

    const page = readFileSync(join(out, 'ch01', 'index.html'), 'utf8');
    expect(page).toContain('<link rel="manifest" href="../manifest.webmanifest">');
    expect(page).toContain('<link rel="apple-touch-icon" href="../apple-touch-icon.png">');
    expect(page).toContain(`content="${THEME_COLOR[1]}" media="(prefers-color-scheme: dark)"`);
    const sw = readFileSync(join(out, 'sw.js'), 'utf8');
    expect(sw).toContain('"icon-maskable-512.png"');
    expect(sw).toContain('"ch01/index.html"');
    // after "Delete it from this device" the pages do not save that book again by themselves (a flag per book)
    expect(page).toContain("localStorage.getItem('warqa:offline:'+b.pathname)!=='off'");
    expect(page).toContain("new URL('../',location.href)");
    // the book's home is at its folder's root: the same key as the page's own ("/demo/", not "/demo/index.html")
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain("new URL('./',location.href)");
  });

  it('saves the book file by file, telling the page how far it is, and answers how much is saved', async () => {
    const out = mkdtempSync(join(tmpdir(), 'warqa-pwa-'));
    writeFileSync(join(out, 'index.html'), '<html><head></head><body></body></html>');
    writeFileSync(join(out, 'audio.mp3'), Buffer.alloc(5000));
    addPwa(out, { title: 'Book', lang: 'en', dir: 'ltr' });
    const files = JSON.parse(/const FILES = (.*);/.exec(readFileSync(join(out, 'sw.js'), 'utf8'))![1]!) as [
      string,
      number,
    ][];
    // each file with its size, the pages as they are served (with the worker's script)
    expect(files).toContainEqual(['audio.mp3', 5000]);
    expect(files.find(([f]) => f === 'index.html')![1]).toBe(readFileSync(join(out, 'index.html')).byteLength);
    const total = files.reduce((a, [, n]) => a + n, 0);

    // the worker, run against caches and a network of this test's own, served from https://x.test/demo/
    const run = (fail?: string) => {
      const on: Record<string, (e: unknown) => void> = {};
      const posted: { done: number; total: number; ready?: boolean; failed?: boolean }[] = [];
      const stores = new Map<string, Map<string, string>>();
      const base = 'https://x.test/demo/sw.js';
      class Req {
        readonly url: string;
        constructor(u: string) {
          this.url = new URL(u, base).href;
        }
      }
      const self = {
        location: { href: base },
        addEventListener: (t: string, f: (e: unknown) => void) => {
          on[t] = f;
        },
        clients: { matchAll: async () => [{ postMessage: (m: (typeof posted)[number]) => posted.push(m) }] },
        skipWaiting: async () => {},
      };
      const caches = {
        open: async (name: string) => {
          const store = stores.get(name) ?? new Map<string, string>();
          stores.set(name, store);
          return {
            keys: async () => [...store.keys()].map((u) => new Req(u)),
            put: async (r: Req) => {
              store.set(r.url, 'saved');
            },
          };
        },
      };
      const fetch = async (r: Req) => ({ ok: !fail || !r.url.endsWith(fail) });
      new Function('self', 'caches', 'fetch', 'Request', readFileSync(join(out, 'sw.js'), 'utf8'))(
        self,
        caches,
        fetch,
        Req,
      );
      const wait = async (event: string, extra: Record<string, unknown> = {}) => {
        let p: Promise<unknown> | undefined;
        on[event]!({ ...extra, waitUntil: (x: Promise<unknown>) => (p = x) });
        return p;
      };
      return { posted, stores, wait };
    };

    const w = run();
    await w.wait('install');
    // one cache, named after the book's own folder: books sharing a site keep their own copies
    expect([...w.stores.keys()]).toEqual([expect.stringMatching(/^warqa:\/demo\/:[0-9a-f]{10}$/)]);
    expect([...w.stores.values()][0]!.size).toBe(files.length);
    // progress only grows, and ends ready with the whole size
    const dones = w.posted.map((m) => m.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(w.posted.at(-1)).toEqual({ t: 'warqa-cache', done: total, total, ready: true });

    // a later visit asks: everything is saved
    let answer: unknown;
    await w.wait('message', { data: { t: 'warqa-status' }, source: { postMessage: (m: unknown) => (answer = m) } });
    expect(answer).toEqual({ t: 'warqa-cache', done: total, total, ready: true });

    // a copy found incomplete (cleared by the browser) is topped up
    [...w.stores.values()][0]!.clear();
    w.posted.length = 0;
    await w.wait('message', { data: { t: 'warqa-status' }, source: { postMessage: (m: unknown) => (answer = m) } });
    expect(answer).toMatchObject({ done: 0, ready: false });
    expect(w.posted.at(-1)).toEqual({ t: 'warqa-cache', done: total, total, ready: true });

    // a file that cannot be fetched: the install fails, and the page is told
    const bad = run('audio.mp3');
    await expect(bad.wait('install')).rejects.toThrow(/audio\.mp3: HTTP/);
    expect(bad.posted.at(-1)).toMatchObject({ failed: true, total });
  });
});
