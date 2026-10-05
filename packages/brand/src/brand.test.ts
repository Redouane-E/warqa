// The tokens keep their promises: text and UI contrast (WCAG 2.2) in both schemes, the icon set, the mark.
import { describe, expect, it } from 'vitest';
import { ICONS, iconSvg, MIRRORED } from './icons.js';
import { appIconSvg, drawAppIcon, MARK, markSvg } from './logo.js';
import { COLORS, type ColorName, STAGE, tokensCss } from './tokens.js';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('colour contrast', () => {
  // [foreground, background, minimum]: 4.5 for text, 3 for borders that identify a control
  const pairs: [ColorName, ColorName, number][] = [
    ['text', 'ground', 4.5],
    ['text', 'sheet', 4.5],
    ['text', 'raised', 4.5],
    ['text-2', 'ground', 4.5],
    ['text-2', 'sheet', 4.5],
    ['text-2', 'raised', 4.5],
    ['text-3', 'ground', 4.5],
    ['text-3', 'sheet', 4.5],
    ['ink', 'ground', 4.5],
    ['ink', 'sheet', 4.5],
    ['on-ink', 'ink', 4.5],
    ['on-ink', 'ink-hover', 4.5],
    ['text', 'ink-tint', 4.5],
    ['ink', 'ink-tint', 4.5],
    ['pen', 'sheet', 4.5],
    ['pen', 'pen-tint', 4.5],
    ['text', 'pen-tint', 4.5],
    ['good', 'sheet', 4.5],
    ['good', 'good-tint', 4.5],
    ['on-fluo', 'fluo', 4.5],
    ['fluo-text', 'fluo-tint', 4.5],
    ['text', 'fluo-tint', 4.5],
    ['input-border', 'sheet', 3],
    ['input-border', 'raised', 3],
    ['margin', 'sheet', 3],
    ['mark', 'ground', 3],
  ];
  for (const scheme of [0, 1] as const)
    for (const [fg, bg, min] of pairs)
      it(`${fg} on ${bg} (${scheme ? 'dark' : 'light'}) ≥ ${min}:1`, () => {
        expect(contrast(COLORS[fg][scheme], COLORS[bg][scheme])).toBeGreaterThanOrEqual(min);
      });

  it('the stage text colours read on their stage', () => {
    for (const theme of ['sheet', 'board'] as const) {
      const stage = STAGE[theme].board[1];
      for (const name of [
        'chalk',
        'dim',
        'task',
        'good',
        'bad',
        'sky',
        'coral',
        'gold',
        'rose',
        'mint',
        'lilac',
      ] as const)
        expect(contrast(STAGE[theme][name][0], stage), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('tokens.css', () => {
  const css = tokensCss();
  it('defines every colour for light, the system dark setting and data-theme="dark"', () => {
    for (const name of Object.keys(COLORS)) expect(css.match(new RegExp(`--wq-${name}:`, 'g'))).toHaveLength(3);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });
  it('keeps the easings apart from the ink colour', () => {
    expect(css).toContain('--wq-ink: #2A3CD1;');
    expect(css).toContain('--wq-ease-ink: cubic-bezier(.6,0,.2,1);');
    expect(css).toContain('--wq-t-sheet: 240ms;');
  });
});

describe('icons', () => {
  it('has the Kit set', () => {
    for (const name of [
      'play',
      'pause',
      'back',
      'next',
      'restart',
      'captions',
      'transcript',
      'speed',
      'language',
      'fullscreen',
      'voice',
      'add-pdf',
      'download',
      'key',
      'regenerate',
      'edit',
      'locked',
      'cue-thread',
      'book',
      'settings',
      'search',
      'stop',
      'open',
      'board-theme',
    ])
      expect(ICONS).toHaveProperty([name]);
  });
  it('stays on the 24 grid', () => {
    for (const [name, def] of Object.entries(ICONS)) {
      const numbers = `${def.d} ${'fill' in def ? def.fill : ''}`.match(/-?\d*\.?\d+/g)!.map(Number);
      expect(Math.max(...numbers), name).toBeLessThanOrEqual(24);
    }
  });
  it('mirrors only back and next', () => {
    expect([...MIRRORED].sort()).toEqual(['back', 'next']);
    expect(iconSvg('back')).toContain('wq-icon-mirror');
    expect(iconSvg('play')).not.toContain('mirror');
  });
});

describe('the mark', () => {
  it('is the folded sheet, decorative unless titled', () => {
    expect(markSvg()).toContain(MARK.sheet);
    expect(markSvg()).toContain('aria-hidden="true"');
    expect(markSvg({ title: 'Warqa & co' })).toContain('aria-label="Warqa &amp; co"');
    expect(markSvg({ variant: 'mono' })).toContain('stroke="#13172E"');
    expect(appIconSvg()).toContain('rx="28"');
  });
  it('draws the app icon on a canvas, the maskable one inside the safe circle', () => {
    const calls: string[] = [];
    const g = {
      fillStyle: '' as unknown,
      beginPath: () => calls.push('begin'),
      roundRect: (_x: number, _y: number, _w: number, _h: number, r: number) => calls.push(`rect r=${r}`),
      fill: (p?: string) => calls.push(`fill ${p ?? ''}`),
      save: () => {},
      restore: () => {},
      translate: (x: number, y: number) => calls.push(`at ${x.toFixed(1)},${y.toFixed(1)}`),
      scale: (s: number) => calls.push(`scale ${s.toFixed(3)}`),
    };
    drawAppIcon(g, 512, (d) => d, { maskable: true });
    expect(calls).toContain('rect r=0');
    const scale = Number(calls.find((c) => c.startsWith('scale'))!.split(' ')[1]);
    // the mark's half-diagonal stays inside a circle of radius 0.4 × 512
    expect(Math.hypot(MARK.width * scale, MARK.height * scale) / 2).toBeLessThanOrEqual(0.4 * 512);
  });
});
