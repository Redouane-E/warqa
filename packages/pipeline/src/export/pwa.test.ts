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
  });
});
