// Apply the generic channels (o, s, hl/hlc, c) to parts of a view.

import { num } from '../dom.js';
import { color } from '../theme.js';
import type { Get } from './types.js';

/** Opacity, scale (about the element centre) and highlight ring for an HTML part. */
export function applyHtml(el: HTMLElement, get: Get, sub: string): void {
  const o = num(get(sub, 'o'), 1);
  const s = num(get(sub, 's'), 1);
  const hl = num(get(sub, 'hl'), 0);
  el.style.opacity = String(o);
  el.style.visibility = o < 0.01 ? 'hidden' : '';
  el.style.transform = s !== 1 ? `scale(${s.toFixed(4)})` : '';
  if (hl > 0.01) {
    const c = color(get(sub, 'hlc'), color('task'));
    el.style.boxShadow = `0 0 0 ${(3 * hl).toFixed(2)}px ${c}, 0 0 ${(18 * hl).toFixed(1)}px ${c}55`;
    el.style.borderRadius = el.style.borderRadius || '10px';
  } else el.style.boxShadow = '';
  const c = get(sub, 'c');
  if (typeof c === 'string') el.style.color = color(c);
}

/** Opacity and scale (about cx, cy) for an SVG part. */
export function applySvg(el: SVGElement, get: Get, sub: string, cx = 0, cy = 0, extra = ''): void {
  const o = num(get(sub, 'o'), 1);
  const s = num(get(sub, 's'), 1);
  el.setAttribute('opacity', o.toFixed(3));
  el.style.visibility = o < 0.01 ? 'hidden' : '';
  const scale = s !== 1 ? ` translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})` : '';
  const tr = (extra + scale).trim();
  if (tr) el.setAttribute('transform', tr);
  else el.removeAttribute('transform');
}

/** A highlight ring (rounded rect) whose opacity follows the part's hl channel. */
export function ringOpacity(get: Get, sub: string): { o: number; color: string } {
  return { o: num(get(sub, 'hl'), 0), color: color(get(sub, 'hlc'), color('task')) };
}
