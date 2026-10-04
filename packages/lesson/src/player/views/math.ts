// Display math typeset by MathJax at export (the export puts an SVG per TeX source in the book data). Steps
// cross-fade ("replace") or appear line by line in an aligned derivation ("stack"); \part{name}{…} parts can
// be highlighted. Without typeset SVGs (e.g. an un-exported preview) the TeX is shown as plain text.
import { mathSources, texText } from '../../core/tex.js';
import { clamp, h, num } from '../dom.js';
import { COLORS, color, MATH_SIZE } from '../theme.js';
import type { Box, Get, ViewFactory } from './types.js';

type P = { steps: string[]; mode: 'replace' | 'stack'; size: keyof typeof MATH_SIZE; color?: string };

/** Parse an SVG string into an element, keeping only the <svg> (MathJax wraps it in mjx-container). */
function svgEl(markup: string): SVGSVGElement | null {
  const t = document.createElement('template');
  t.innerHTML = markup;
  const svg = t.content.querySelector('svg');
  if (!svg) return null;
  // nothing interactive may come from the typesetter
  for (const a of svg.querySelectorAll('a, script, foreignObject')) a.remove();
  svg.removeAttribute('style');
  return svg as SVGSVGElement;
}

export const math: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const em = MATH_SIZE[p.size] ?? MATH_SIZE.lg;
  const root = h('div', { class: 'wq-c wq-c-math', role: 'img', 'aria-label': p.steps.map(texText).join('; ') });
  root.style.color = p.color ? color(p.color) : COLORS.chalk!;
  ctx.div.append(root);
  const layers: { el: HTMLElement; w: number; h: number }[] = [];
  for (const src of mathSources(p)) {
    const layer = h('div', { class: 'wq-math-step' });
    const markup = ctx.math?.(src);
    const svg = markup ? svgEl(markup) : null;
    let w = 0;
    let hh = 0;
    if (svg) {
      const vb = (svg.getAttribute('viewBox') ?? '0 0 1000 1000').split(/\s+/).map(Number);
      w = ((vb[2] ?? 1000) / 1000) * em;
      hh = ((vb[3] ?? 1000) / 1000) * em;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(hh));
      layer.append(svg);
    } else {
      // not typeset: readable plain text
      layer.classList.add('wq-math-plain');
      layer.style.fontSize = `${em * 0.8}px`;
      layer.textContent = p.mode === 'stack' ? '' : texText(src.replace(/\\class\{wq-p-[\w-]+\}/g, ''));
      if (p.mode === 'stack') for (const s of p.steps) layer.append(h('div', { class: 'wq-math-line' }, texText(s)));
    }
    root.append(layer);
    layers.push({ el: layer, w, h: hh });
  }
  // rows of a stacked derivation (MathJax draws each table row as an mtr group)
  const rows = (): Element[] => {
    const l = layers[0]?.el;
    if (!l) return [];
    const svgRows = [...l.querySelectorAll('g[data-mml-node="mtr"]')];
    return svgRows.length ? svgRows : [...l.querySelectorAll('.wq-math-line')];
  };
  const partsOf = (name: string): Element[] => [...root.querySelectorAll(`.wq-p-${CSS.escape(name)}`)];
  let fit = 1;
  let box: Box = { x: 0, y: 0, w: 0, h: 0 };
  return {
    size(maxW) {
      const w = Math.max(...layers.map((l) => l.w || maxW * 0.6));
      const hh = Math.max(...layers.map((l) => l.h || em * 1.4 * (p.mode === 'stack' ? p.steps.length : 1)));
      fit = Math.min(1, maxW / Math.max(1, w));
      return { w: Math.min(maxW, w * fit), h: hh * fit };
    },
    place(b: Box) {
      box = b;
      Object.assign(root.style, { width: `${b.w}px`, height: `${b.h}px` });
      for (const l of layers) {
        const svg = l.el.querySelector('svg');
        if (svg && l.w) {
          const k = Math.min(1, b.w / l.w, b.h / Math.max(1, l.h));
          svg.setAttribute('width', String(l.w * k));
          svg.setAttribute('height', String(l.h * k));
        }
      }
    },
    update(get: Get) {
      root.style.opacity = String(num(get('', 'o'), 1));
      if (p.mode === 'stack') {
        rows().forEach(
          (r, i) =>
            ((r as SVGElement | HTMLElement).style.opacity = String(clamp(num(get(`line:${i}`, 'o'), 1), 0, 1))),
        );
      } else {
        const step = num(get('', 'step'), 0);
        layers.forEach((l, i) => (l.el.style.opacity = String(clamp(1 - Math.abs(step - i), 0, 1))));
      }
      for (const name of new Set(p.steps.flatMap((s) => [...s.matchAll(/\\part\{([\w-]+)\}/g)].map((m) => m[1]!)))) {
        const hl = num(get(`part:${name}`, 'hl'), 0);
        const c = get(`part:${name}`, 'c');
        const col =
          c !== undefined ? color(String(c)) : hl > 0.01 ? color(String(get(`part:${name}`, 'hlc') ?? 'task')) : '';
        for (const el of partsOf(name)) {
          (el as SVGElement).style.color = col;
          (el as SVGElement).style.filter = hl > 0.01 ? `drop-shadow(0 0 ${6 * hl}px ${col})` : '';
        }
      }
    },
    part(sub) {
      const m = /^part:(.+)$/.exec(sub);
      const el = m ? partsOf(m[1]!)[0] : /^line:(\d+)$/.test(sub) ? rows()[Number(sub.slice(5))] : undefined;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const base = ctx.div.getBoundingClientRect();
      const k = base.width && ctx.div.offsetWidth ? base.width / ctx.div.offsetWidth : 1;
      return {
        x: box.x + (r.left - base.left) / k,
        y: box.y + (r.top - base.top) / k,
        w: r.width / k,
        h: r.height / k,
      };
    },
  };
};
