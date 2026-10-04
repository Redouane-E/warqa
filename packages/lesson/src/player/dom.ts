// Small DOM helpers for SVG and HTML, text measurement and rich text with inline math.
import { prettyMinus } from '@warqa/i18n';
import { inlineRuns } from '../core/text.js';
import { FONT_MATH, FONT_UI } from './theme.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function')
      e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Text with inline $math$: math runs become isolated left-to-right spans in the math font. */
export function rich(text: string, cls = ''): HTMLSpanElement {
  const span = h('span', { class: `wq-rich ${cls}`.trim() });
  for (const r of inlineRuns(text)) {
    if (r.math) span.append(h('bdi', { class: 'wq-math', dir: 'ltr' }, prettyMinus(r.text)));
    else span.append(r.text);
  }
  return span;
}

/** Plain string for SVG <text>: math runs wrapped in Unicode LTR isolates (works inside RTL text everywhere). */
export function svgText(text: string): string {
  return inlineRuns(text)
    .map((r) => (r.math ? `\u2066${prettyMinus(r.text)}\u2069` : r.text))
    .join('');
}

let ctx2d: CanvasRenderingContext2D | null = null;
/** Width of a string in a font, measured on a canvas (shapes Arabic correctly). */
export function textWidth(
  s: string,
  size: number,
  font: 'ui' | 'math' = 'ui',
  weight = 500,
  dir: 'ltr' | 'rtl' = 'ltr',
): number {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  if (!ctx2d) return s.length * size * 0.55;
  ctx2d.font = `${weight} ${size}px ${font === 'math' ? FONT_MATH : FONT_UI}`;
  ctx2d.direction = dir;
  return ctx2d.measureText(s).width;
}

/** SVG text element; math strings use the math font and stay left-to-right. */
export function svgLabel(
  parent: Element,
  str: string,
  opts: {
    x?: number;
    y?: number;
    size?: number;
    fill?: string;
    anchor?: 'start' | 'middle' | 'end';
    weight?: number;
    math?: boolean;
    dir?: 'ltr' | 'rtl';
  },
): SVGTextElement {
  const { x = 0, y = 0, size = 28, fill = '#ece8dc', anchor = 'middle', weight = 500, math = false, dir } = opts;
  const t = svg(
    'text',
    {
      x,
      y,
      'font-size': size,
      fill,
      'text-anchor': anchor,
      'font-weight': weight,
      'font-family': math ? FONT_MATH : FONT_UI,
      direction: math ? 'ltr' : dir,
    },
    parent,
  );
  t.textContent = math ? prettyMinus(str) : svgText(str);
  return t;
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
