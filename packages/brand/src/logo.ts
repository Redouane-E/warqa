// The mark: an ink-blue portrait sheet whose top-left corner is folded down, showing the highlighter-yellow
// underside (the corner an Arabic reader lifts to turn the page). It never mirrors. It replaces the ∞ sign
// everywhere: the finish mascot, "Made with Warqa", app and book icons, favicons.
import { COLORS } from './tokens.js';

export const MARK = {
  viewBox: '0 0 56 64',
  width: 56,
  height: 64,
  sheet: 'M20 4h28a4 4 0 0 1 4 4v48a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V20z',
  fold: 'M20 4L4 20h16z',
} as const;

const INK = COLORS.ink[0];
const FLUO = COLORS.fluo[0];
const TEXT = COLORS.text[0];

/** Colour variants: ink on paper, paper on ink, on the Board, and one colour for print and stamps. */
export const MARK_VARIANTS = {
  ink: { sheet: INK, fold: FLUO },
  paper: { sheet: '#FFFFFF', fold: FLUO },
  board: { sheet: COLORS.mark[1], fold: FLUO },
  mono: { sheet: TEXT, fold: '#FFFFFF', stroke: TEXT },
  /** the sheet takes the text colour around it (CSS `color`) */
  current: { sheet: 'currentColor', fold: FLUO },
} as const satisfies Record<string, { sheet: string; fold: string; stroke?: string }>;

export type MarkVariant = keyof typeof MARK_VARIANTS;

/** The mark as an SVG string (decorative unless a title is given). Paths carry classes for CSS overrides. */
export function markSvg(opts: { variant?: MarkVariant; height?: number; title?: string } = {}): string {
  const v: { sheet: string; fold: string; stroke?: string } = MARK_VARIANTS[opts.variant ?? 'ink'];
  const h = opts.height ?? 64;
  const w = Math.round(((h * MARK.width) / MARK.height) * 100) / 100;
  const a11y = opts.title ? `role="img" aria-label="${escapeXml(opts.title)}"` : 'aria-hidden="true" focusable="false"';
  const stroke = v.stroke ? ` stroke="${v.stroke}" stroke-width="2.5" stroke-linejoin="round"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="wq-mark" width="${w}" height="${h}" viewBox="${MARK.viewBox}" ${a11y}>` +
    `<path class="wq-mark-sheet" d="${MARK.sheet}" fill="${v.sheet}"/>` +
    `<path class="wq-mark-fold" d="${MARK.fold}" fill="${v.fold}"${stroke}/></svg>`
  );
}

/** App icon geometry on a 128 grid: an ink rounded square, the paper mark centred in it. */
export const APP_ICON = { grid: 128, radius: 28, markWidth: 68, markHeight: 78 } as const;

/** The app icon (installed studio, web app and books) as an SVG string. */
export function appIconSvg(size = 512): string {
  const { grid, radius, markWidth, markHeight } = APP_ICON;
  const s = markWidth / MARK.width;
  const x = (grid - markWidth) / 2;
  const y = (grid - markHeight) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${grid} ${grid}">` +
    `<rect width="${grid}" height="${grid}" rx="${radius}" fill="${INK}"/>` +
    `<g transform="translate(${x} ${y}) scale(${+s.toFixed(4)})">` +
    `<path d="${MARK.sheet}" fill="#FFFFFF"/><path d="${MARK.fold}" fill="${FLUO}"/></g></svg>`
  );
}

/** The favicon: the ink mark alone, which reads better than the square at 16 and 32 px. */
export const faviconSvg = (): string =>
  markSvg({ variant: 'ink' })
    .replace(' class="wq-mark"', '')
    .replace(/ class="wq-mark-(sheet|fold)"/g, '');

/** The parts of a 2D canvas context the app icon needs (@napi-rs/canvas in Node, OffscreenCanvas in a browser). */
export interface IconContext<P> {
  fillStyle: unknown;
  beginPath(): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  fill(path?: P): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
}

/**
 * Draw the app icon on a canvas of `size` pixels; `path` turns SVG path data into a Path2D. A maskable icon
 * (Android crops it to any shape) fills the square and keeps the mark inside the safe circle (80% wide).
 */
export function drawAppIcon<P>(
  g: IconContext<P>,
  size: number,
  path: (d: string) => P,
  opts: { maskable?: boolean } = {},
): void {
  const { grid, radius, markWidth, markHeight } = APP_ICON;
  const k = size / grid;
  // maskable: the mark's corners stay within a circle of radius 0.4 × size (its half-diagonal is 0.66 × height)
  const scale = opts.maskable ? (0.58 * size) / MARK.height : (markWidth / MARK.width) * k;
  const w = MARK.width * scale;
  const h = opts.maskable ? MARK.height * scale : markHeight * k;
  g.fillStyle = INK;
  g.beginPath();
  g.roundRect(0, 0, size, size, opts.maskable ? 0 : radius * k);
  g.fill();
  g.save();
  g.translate((size - w) / 2, (size - h) / 2);
  g.scale(scale, scale);
  g.fillStyle = '#FFFFFF';
  g.fill(path(MARK.sheet));
  g.fillStyle = FLUO;
  g.fill(path(MARK.fold));
  g.restore();
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
