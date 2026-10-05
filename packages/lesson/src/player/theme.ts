// Stage colours by name, per theme. Lessons name their colours (chalk, sky, coral…), never hex values, so every
// lesson works in both themes: the Sheet (white paper, the default) and the Board (navy). "chalk", the old
// green chalkboard, is shown as the Board. Values: @warqa/brand (STAGE), from REDESIGN.md's stage table.
import { STAGE } from '@warqa/brand';

export type Theme = 'sheet' | 'board';
export const THEMES: readonly Theme[] = ['sheet', 'board'];

/** A book's or a link's theme name → the player's theme (undefined when it names none). */
export const themeOf = (name: unknown): Theme | undefined =>
  name === 'sheet' ? 'sheet' : name === 'board' || name === 'chalk' ? 'board' : undefined;

/**
 * The active theme's text and line colours, by name. The object stays the same (views and component packs keep a
 * reference to it); setTheme refills it, then the player redraws the scene.
 */
export const COLORS: Record<string, string> = {};
const FILLS: Record<string, string> = {};
let active: Theme = 'sheet';

export function setTheme(theme: Theme): void {
  active = theme;
  for (const [name, [text, fill]] of Object.entries(STAGE[theme])) {
    COLORS[name] = text;
    FILLS[name] = fill;
  }
}
setTheme('sheet');

export const activeTheme = (): Theme => active;

const isHex = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v);

/** A named colour for text and lines (a hex value passes through). */
export const color = (name: unknown, fallback = COLORS.chalk!): string =>
  (typeof name === 'string' && (COLORS[name] ?? (isHex(name) ? name : undefined))) || fallback;

/** A named colour for filled areas: on the Sheet, task and gold fill with the highlighter yellow. */
export const fill = (name: unknown, fallback = COLORS.chalk!): string =>
  (typeof name === 'string' && (FILLS[name] ?? (isHex(name) ? name : undefined))) || fallback;

/** Mix two hex colours (q = share of b). */
export function mix(a: string, b: string, q: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * q)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const FONT_UI = '"Readex Pro", "Noto Naskh Arabic", "Segoe UI", system-ui, sans-serif';
export const FONT_MATH = '"STIX Two Text", "Cambria Math", "Times New Roman", serif';
export const FONT_READ = '"Noto Naskh Arabic", "Readex Pro", system-ui, serif';

export const TEXT_SIZE = { sm: 26, md: 34, lg: 44, xl: 60 } as const;
export const MATH_SIZE = { sm: 40, md: 52, lg: 66, xl: 84 } as const;

export const STAGE_W = 1600;
export const STAGE_H = 900;
