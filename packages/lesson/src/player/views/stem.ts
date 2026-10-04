// SVG views for STEM components. Portions derived from Papermorph (MIT): number line, hops, landing dots,
// tiles, vertical axis and thermometer drawings.
import { compileExpr } from '../../core/expr.js';
import { clamp, lerp, num, svg, svgLabel, textWidth } from '../dom.js';
import { COLORS, color, mix } from '../theme.js';
import { applySvg } from './apply.js';
import type { Box, Get, View, ViewCtx, ViewFactory } from './types.js';

type P = Record<string, any>;
const drawOn = (el: SVGElement, d: number) => {
  el.setAttribute('pathLength', '1');
  el.setAttribute('stroke-dasharray', '1 1');
  el.setAttribute('stroke-dashoffset', String(1 - clamp(d)));
  el.style.visibility = d <= 0.001 ? 'hidden' : '';
};
const marks = (ctx: ViewCtx) => Object.entries(ctx.node.subs).filter(([, s]) => s.mark);
const ring = (parent: Element, get: Get, sub: string, x: number, y: number, r: number) => {
  const hl = num(get(sub, 'hl'), 0);
  if (hl < 0.01) return;
  svg(
    'circle',
    { cx: x, cy: y, r, fill: 'none', stroke: color(get(sub, 'hlc'), color('task')), 'stroke-width': 3, opacity: hl },
    parent,
  );
};

/* ---------- number line ---------- */

export const numberline: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const ticks: number[] = [];
  for (let i = 0; i <= Math.round((p.max - p.min) / p.step); i++) ticks.push(+(p.min + i * p.step).toFixed(6));
  let X = (v: number) => v;
  let Y0 = 0;
  let u = 0;
  const base = svg('g', {}, ctx.g);
  const dyn = svg('g', {}, ctx.g);
  let axis: SVGPathElement;
  let heads: SVGPathElement[] = [];
  const tickEls = new Map<number, SVGGElement>();
  const hopsBelow = 0;
  void hopsBelow;
  return {
    size: (maxW) => ({ w: maxW, h: 230 }),
    place(box: Box) {
      base.replaceChildren();
      const span = p.max - p.min + 1.4;
      u = Math.min(130, (box.w - 40) / span);
      const x0 = box.x + box.w / 2 - (span * u) / 2;
      X = (v) => x0 + (v - p.min + 0.7) * u;
      Y0 = box.y + box.h - 62;
      axis = svg(
        'path',
        { d: `M${X(p.min - 0.7)} ${Y0}H${X(p.max + 0.7)}`, stroke: COLORS.chalk, 'stroke-width': 3, fill: 'none' },
        base,
      );
      heads = [
        [X(p.max + 0.7), 1],
        [X(p.min - 0.7), -1],
      ].map(([x, d]) =>
        svg(
          'path',
          {
            d: `M${x! - 15 * d!} ${Y0 - 10}L${x} ${Y0}L${x! - 15 * d!} ${Y0 + 10}`,
            stroke: COLORS.chalk,
            'stroke-width': 3,
            fill: 'none',
          },
          base,
        ),
      );
      tickEls.clear();
      ticks.forEach((v, i) => {
        const g = svg('g', {}, base);
        svg(
          'path',
          { d: `M${X(v)} ${Y0 - 9}V${Y0 + 9}`, stroke: v === 0 ? COLORS.chalk : COLORS.dim, 'stroke-width': 2.5 },
          g,
        );
        const show = p.labels === 'all' || (p.labels === 'ends' && (i === 0 || i === ticks.length - 1 || v === 0));
        if (show)
          svgLabel(g, ctx.fmt(v), {
            x: X(v),
            y: Y0 + 44,
            size: u < 50 ? 22 : 28,
            fill: v === 0 ? COLORS.chalk : COLORS.dim,
            math: true,
          });
        tickEls.set(v, g);
      });
    },
    update(get: Get) {
      const d = num(get('', 'd'), 1);
      drawOn(axis, d);
      heads.forEach((hd) => hd.setAttribute('opacity', String(clamp((d - 0.85) * 7))));
      ticks.forEach((v) => {
        const g = tickEls.get(v)!;
        const at = Math.abs(v - (p.min + p.max) / 2) / Math.max(1, (p.max - p.min) / 2);
        const o = clamp((d - 0.15 - at * 0.6) * 4) * num(get(`tick:${v}`, 'o'), 1);
        applySvg(g, get, `tick:${v}`, X(v), Y0 + 30);
        g.setAttribute('opacity', o.toFixed(3));
      });
      dyn.replaceChildren();
      for (const v of ticks) ring(dyn, get, `tick:${v}`, X(v), Y0 + 32, 26);
      for (const [id, m] of marks(ctx)) {
        const data = m.data as P;
        const o = num(get(id, 'o'), 1);
        if (o < 0.01) continue;
        const g = svg('g', { opacity: o }, dyn);
        // a "color" cue on the mark overrides its colour
        const c = color(get(id, 'c') ?? data.color);
        if (data.kind === 'dot') {
          const s = num(get(id, 's'), 1);
          svg(
            'circle',
            {
              cx: 0,
              cy: 0,
              r: 12,
              fill: c,
              stroke: COLORS.board,
              'stroke-width': 2,
              transform: `translate(${X(data.at)} ${Y0}) scale(${Math.max(0, s)})`,
            },
            g,
          );
          if (data.label)
            svgLabel(g, data.label, { x: X(data.at), y: Y0 - 26, size: 24, fill: c, weight: 600, dir: ctx.dir });
        } else if (data.kind === 'hop') {
          const dd = num(get(id, 'd'), 0);
          if (dd <= 0) continue;
          const y = Y0 - 90 - (num(data.level, 1) - 1) * 80;
          const x1 = X(data.from);
          const x2 = X(data.to);
          const dir = Math.sign(x2 - x1) || 1;
          svg(
            'path',
            { d: `M${x1} ${y}H${lerp(x1, x2, dd)}`, stroke: c, 'stroke-width': 5, 'stroke-linecap': 'round' },
            g,
          );
          if (dd > 0.85)
            svg(
              'path',
              {
                d: `M${x2 - 15 * dir} ${y - 11}L${x2} ${y}L${x2 - 15 * dir} ${y + 11}`,
                stroke: c,
                'stroke-width': 5,
                fill: 'none',
                opacity: clamp((dd - 0.85) * 7),
              },
              g,
            );
          const delta = data.to - data.from;
          const lab = data.label ?? `${delta >= 0 ? '+' : '−'}${ctx.fmt(Math.abs(delta))}`;
          svgLabel(g, lab, {
            x: (x1 + x2) / 2,
            y: y - 16,
            size: 28,
            fill: c,
            math: !data.label,
            dir: ctx.dir,
          }).setAttribute('opacity', String(clamp((dd - 0.2) * 4)));
          if (dd >= 1)
            svg(
              'path',
              {
                d: `M${x2} ${y + 12}V${Y0 - 14}`,
                stroke: c,
                'stroke-width': 2,
                'stroke-dasharray': '5 6',
                opacity: 0.8,
              },
              g,
            );
        } else if (data.kind === 'arc') {
          const x1 = X(data.from);
          const x2 = X(data.to);
          const hgt = 40 + 9 * Math.abs(data.to - data.from) * (u / 82);
          const el = svg(
            'path',
            {
              d: `M${x1} ${Y0 - 16}Q${(x1 + x2) / 2} ${Y0 - 16 - 2 * hgt} ${x2} ${Y0 - 16}`,
              stroke: c,
              'stroke-width': 2.5,
              fill: 'none',
            },
            g,
          );
          drawOn(el, num(get(id, 'd'), 0));
        } else if (data.kind === 'vline') {
          const dd = num(get(id, 'd'), 0);
          const x = X(data.at);
          const el = svg('path', { d: `M${x} ${Y0 + 40}V${Y0 - 290}`, stroke: c, 'stroke-width': 2.5 }, g);
          drawOn(el, dd);
          if (data.label)
            svgLabel(g, data.label, { x, y: Y0 - 300, size: 24, fill: c, weight: 600, dir: ctx.dir }).setAttribute(
              'opacity',
              String(clamp((dd - 0.6) * 3)),
            );
        }
      }
    },
    part(sub) {
      if (!sub.startsWith('tick:')) return null;
      const v = Number(sub.slice(5));
      return { x: X(v) - Math.max(18, u / 2), y: Y0 - 30, w: Math.max(36, u), h: 100 };
    },
  };
};

/* ---------- counters ---------- */

export const counters: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const S = 54;
  const G = 16;
  const per = Math.min(p.perRow, p.count);
  const rows = Math.ceil(p.count / per);
  const natW = per * S + (per - 1) * G;
  const natH = rows * S + (rows - 1) * G;
  const items: { g: SVGGElement; cx: number; cy: number }[] = [];
  const c = color(p.color ?? (p.kind === 'pos' ? 'sky' : p.kind === 'neg' ? 'coral' : 'gold'));
  const sym = p.symbol ?? (p.kind === 'pos' ? '+' : p.kind === 'neg' ? '−' : '');
  return {
    size: () => ({ w: natW, h: natH }),
    place(box) {
      ctx.g.replaceChildren();
      items.length = 0;
      const x0 = box.x + box.w / 2 - natW / 2;
      const y0 = box.y + box.h / 2 - natH / 2;
      for (let i = 0; i < p.count; i++) {
        const col = i % per;
        const row = Math.floor(i / per);
        // reading order: first counter at the reading start
        const cx = ctx.dir === 'rtl' ? x0 + natW - (col * (S + G) + S / 2) : x0 + col * (S + G) + S / 2;
        const cy = y0 + row * (S + G) + S / 2;
        const g = svg('g', {}, ctx.g);
        if (p.kind === 'plain')
          svg('circle', { cx, cy, r: S / 2 - 4, fill: mix(COLORS.board!, c, 0.55), stroke: c, 'stroke-width': 2.5 }, g);
        else
          svg(
            'rect',
            {
              x: cx - S / 2,
              y: cy - S / 2,
              width: S,
              height: S,
              rx: 10,
              fill: mix(COLORS.board!, c, 0.45),
              stroke: c,
              'stroke-width': 2.5,
            },
            g,
          );
        if (sym) svgLabel(g, sym, { x: cx, y: cy + 13, size: 40, fill: COLORS.chalk, math: true });
        items.push({ g, cx, cy });
      }
    },
    update(get) {
      items.forEach((it, i) => {
        const sub = `item:${i}`;
        const gone = num(get(sub, 'gone'), 0);
        applySvg(it.g, get, sub, it.cx, it.cy, `translate(0 ${(-140 * gone).toFixed(1)})`);
        it.g.setAttribute('opacity', (num(get(sub, 'o'), 1) * (1 - gone)).toFixed(3));
        it.g.style.visibility = gone >= 0.999 ? 'hidden' : '';
      });
    },
    part(sub) {
      const it = items[Number(sub.split(':')[1])];
      return it ? { x: it.cx - S / 2, y: it.cy - S / 2, w: S, h: S } : null;
    },
  };
};

/* ---------- vertical scale / thermometer ---------- */

export const vscale: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const dyn = svg('g', {}, ctx.g);
  const base = svg('g', {}, ctx.g);
  ctx.g.insertBefore(base, dyn);
  let Yf = (v: number) => v;
  let ax = 0;
  let inward = 1; // +1: labels and braces to the right of the axis
  let merc: SVGRectElement | null = null;
  let bulbY = 0;
  const fmtU = (v: number) => `${ctx.fmt(v)}${p.unit ?? ''}`;
  return {
    size: (maxW, maxH) => ({ w: Math.min(maxW, 640), h: Math.min(maxH, 560) }),
    place(box) {
      base.replaceChildren();
      const thermo = p.style === 'thermometer';
      const top = box.y + 30;
      const bottom = box.y + box.h - (thermo ? 70 : 30);
      Yf = (v) => bottom - ((v - p.min) / (p.max - p.min)) * (bottom - top);
      // the axis sits on the outer side of the slot; labels point toward the middle of the stage
      const slotOnLeft = box.x + box.w / 2 < 800;
      inward = slotOnLeft ? 1 : -1;
      ax = slotOnLeft ? box.x + 150 : box.x + box.w - 150;
      for (const [i, z] of (p.zones as P[]).entries()) {
        const y1 = Yf(Math.max(z.from, z.to));
        const y2 = Yf(Math.min(z.from, z.to));
        const zx = slotOnLeft ? ax - 110 : ax - 380;
        const g = svg('g', { 'data-sub': `zone:${i}` }, base);
        svg('rect', { x: zx, y: y1, width: 490, height: y2 - y1, fill: color(z.color), 'fill-opacity': 0.12 }, g);
        if (z.label) {
          const w = textWidth(z.label, 22, 'ui', 500, ctx.dir);
          svgLabel(g, z.label, {
            x: ax + inward * (18 + w / 2),
            y: y2 - 10,
            size: 22,
            fill: color(z.color),
            dir: ctx.dir,
          });
        }
      }
      if (thermo) {
        const c = color(p.color ?? 'coral');
        bulbY = bottom + 32;
        svg(
          'rect',
          {
            x: ax - 18,
            y: top - 24,
            width: 36,
            height: bulbY - top + 24,
            rx: 18,
            fill: COLORS.board,
            stroke: COLORS.dim,
            'stroke-width': 2.5,
          },
          base,
        );
        svg('circle', { cx: ax, cy: bulbY, r: 26, fill: c }, base);
        merc = svg('rect', { x: ax - 9, width: 18, rx: 9, fill: c }, base);
      } else {
        merc = null;
        svg('path', { d: `M${ax} ${Yf(p.min) + 16}V${Yf(p.max) - 16}`, stroke: COLORS.chalk, 'stroke-width': 3 }, base);
      }
      for (let v = p.min; v <= p.max + 1e-9; v += p.step) {
        const y = Yf(v);
        // thermometer ticks sit on the outer side, next to their numbers
        const d = thermo ? `M${ax - inward * 30} ${y}H${ax - inward * 18}` : `M${ax - 9} ${y}H${ax + 9}`;
        svg('path', { d, stroke: COLORS.dim, 'stroke-width': 2.5 }, base);
        const lx = ax - inward * (thermo ? 40 : 24);
        const w = textWidth(fmtU(v), 24, 'math');
        svgLabel(base, fmtU(v), {
          x: lx - inward * (w / 2),
          y: y + 9,
          size: 24,
          fill: v === 0 ? COLORS.chalk : COLORS.dim,
          math: true,
        });
      }
    },
    update(get) {
      if (merc) {
        const v = num(get('', 'v'), p.value ?? p.min);
        const y = Yf(v);
        merc.setAttribute('y', String(y));
        merc.setAttribute('height', String(Math.max(0, bulbY - y)));
      }
      base.querySelectorAll<SVGGElement>('[data-sub]').forEach((g) => applySvg(g, get, g.dataset.sub!));
      dyn.replaceChildren();
      const braces: P[] = [];
      for (const [id, m] of marks(ctx)) {
        const data = m.data as P;
        const o = num(get(id, 'o'), 1);
        if (o < 0.01) continue;
        // a "color" cue on the mark overrides its colour
        const c = color(get(id, 'c') ?? data.color);
        const g = svg('g', { opacity: o }, dyn);
        if (data.kind === 'marker') {
          const s = num(get(id, 's'), 1);
          const y = Yf(data.at);
          svg(
            'circle',
            {
              cx: 0,
              cy: 0,
              r: 13,
              fill: c,
              stroke: COLORS.board,
              'stroke-width': 2,
              transform: `translate(${ax} ${y}) scale(${Math.max(0, s)})`,
            },
            g,
          );
          if (data.label) {
            const w = textWidth(data.label, 26, 'ui', 600, ctx.dir);
            svgLabel(g, data.label, {
              x: ax + inward * (26 + w / 2),
              y: y + 9,
              size: 26,
              fill: c,
              weight: 600,
              dir: ctx.dir,
            });
          }
        } else if (data.kind === 'brace') {
          const d = num(get(id, 'd'), 0);
          const lo = Math.min(data.from, data.to);
          const hi = Math.max(data.from, data.to);
          const col = braces.filter((b) => !(b.hi <= lo || b.lo >= hi)).length;
          braces.push({ lo, hi });
          const x = ax + inward * (300 + col * 120);
          const y1 = Yf(data.from);
          const y2 = Yf(data.to);
          const el = svg(
            'path',
            {
              d: `M${x - inward * 10} ${y1}H${x}V${y2}H${x - inward * 10}`,
              stroke: c,
              'stroke-width': 3,
              fill: 'none',
            },
            g,
          );
          drawOn(el, d);
          if (data.label) {
            const w = textWidth(data.label, 26, 'ui', 600, ctx.dir);
            svgLabel(g, data.label, {
              x: x + inward * (14 + w / 2),
              y: (y1 + y2) / 2 + 9,
              size: 26,
              fill: c,
              weight: 600,
              dir: ctx.dir,
            }).setAttribute('opacity', String(clamp((d - 0.5) * 2)));
          }
        }
      }
    },
  };
};

/* ---------- bar chart ---------- */

export const barchart: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const bars: {
    g: SVGGElement;
    rect: SVGRectElement;
    val: SVGTextElement;
    x: number;
    w: number;
    base: number;
    full: number;
  }[] = [];
  const max = p.max ?? Math.max(...(p.bars as P[]).map((b) => b.value), 1);
  return {
    size: (maxW, maxH) => ({ w: Math.min(maxW, 180 * p.bars.length + 120), h: Math.min(maxH, 460) }),
    place(box) {
      ctx.g.replaceChildren();
      bars.length = 0;
      const n = p.bars.length;
      const baseY = box.y + box.h - 56;
      const top = box.y + 50;
      const slot = (box.w - 40) / n;
      svg(
        'path',
        { d: `M${box.x + 10} ${baseY}H${box.x + box.w - 10}`, stroke: COLORS.chalk, 'stroke-width': 3 },
        ctx.g,
      );
      (p.bars as P[]).forEach((b, i) => {
        const k = ctx.dir === 'rtl' ? n - 1 - i : i;
        const w = Math.min(120, slot * 0.6);
        const x = box.x + 20 + slot * k + slot / 2 - w / 2;
        const full = ((baseY - top) * Math.max(0, b.value)) / max;
        const g = svg('g', {}, ctx.g);
        const c = color(b.color ?? ['sky', 'coral', 'gold', 'mint', 'lilac', 'rose'][i % 6]);
        const rect = svg(
          'rect',
          { x, width: w, rx: 6, fill: mix(COLORS.board!, c, 0.6), stroke: c, 'stroke-width': 2.5 },
          g,
        );
        const val = svgLabel(g, `${ctx.fmt(b.value)}${p.unit ? ` ${p.unit}` : ''}`, {
          x: x + w / 2,
          y: 0,
          size: 24,
          fill: c,
          math: true,
        });
        svgLabel(g, b.label, { x: x + w / 2, y: baseY + 36, size: 24, fill: COLORS.dim, dir: ctx.dir });
        bars.push({ g, rect, val, x, w, base: baseY, full });
      });
    },
    update(get) {
      bars.forEach((b, i) => {
        const sub = `bar:${i}`;
        const d = num(get(sub, 'd'), 1);
        const hgt = b.full * d;
        b.rect.setAttribute('y', String(b.base - hgt));
        b.rect.setAttribute('height', String(Math.max(0, hgt)));
        b.val.setAttribute('y', String(b.base - hgt - 12));
        b.val.setAttribute('opacity', String(clamp((d - 0.7) * 4)));
        applySvg(b.g, get, sub, b.x + b.w / 2, b.base);
        const hl = num(get(sub, 'hl'), 0);
        b.rect.setAttribute('stroke-width', String(2.5 + 3 * hl));
      });
    },
    part(sub) {
      const b = bars[Number(sub.split(':')[1])];
      return b ? { x: b.x, y: b.base - b.full, w: b.w, h: b.full } : null;
    },
  };
};

/* ---------- coordinate plane ---------- */

export const plane: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const base = svg('g', {}, ctx.g);
  const dyn = svg('g', {}, ctx.g);
  let PX = (x: number) => x;
  let PY = (y: number) => y;
  let unit = 0;
  const [x0, x1] = p.x as [number, number];
  const [y0, y1] = p.y as [number, number];
  return {
    size: (maxW, maxH) => {
      const s = Math.min(maxW, maxH, 620);
      const k = s / Math.max(x1 - x0, y1 - y0);
      return { w: (x1 - x0) * k, h: (y1 - y0) * k };
    },
    place(box) {
      base.replaceChildren();
      unit = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
      const cx = box.x + box.w / 2 - ((x0 + x1) / 2) * unit;
      const cy = box.y + box.h / 2 + ((y0 + y1) / 2) * unit;
      PX = (x) => cx + x * unit;
      PY = (y) => cy - y * unit;
      if (p.grid) {
        for (let x = Math.ceil(x0 / p.step) * p.step; x <= x1; x += p.step)
          svg('path', { d: `M${PX(x)} ${PY(y0)}V${PY(y1)}`, stroke: COLORS.faint, 'stroke-width': 1 }, base);
        for (let y = Math.ceil(y0 / p.step) * p.step; y <= y1; y += p.step)
          svg('path', { d: `M${PX(x0)} ${PY(y)}H${PX(x1)}`, stroke: COLORS.faint, 'stroke-width': 1 }, base);
      }
      svg(
        'path',
        { d: `M${PX(x0)} ${PY(0)}H${PX(x1)}M${PX(0)} ${PY(y0)}V${PY(y1)}`, stroke: COLORS.chalk, 'stroke-width': 2.5 },
        base,
      );
      svg(
        'path',
        {
          d: `M${PX(x1) - 12} ${PY(0) - 8}L${PX(x1)} ${PY(0)}L${PX(x1) - 12} ${PY(0) + 8}M${PX(0) - 8} ${PY(y1) + 12}L${PX(0)} ${PY(y1)}L${PX(0) + 8} ${PY(y1) + 12}`,
          stroke: COLORS.chalk,
          'stroke-width': 2.5,
          fill: 'none',
        },
        base,
      );
      svgLabel(base, 'x', { x: PX(x1) - 6, y: PY(0) - 16, size: 26, fill: COLORS.dim, math: true });
      svgLabel(base, 'y', { x: PX(0) + 18, y: PY(y1) + 10, size: 26, fill: COLORS.dim, math: true });
      if (p.labels) {
        const every = unit < 34 ? 2 : 1;
        for (let x = Math.ceil(x0); x <= x1; x++)
          if (x && x % every === 0)
            svgLabel(base, ctx.fmt(x), { x: PX(x), y: PY(0) + 26, size: 18, fill: COLORS.dim, math: true });
        for (let y = Math.ceil(y0); y <= y1; y++)
          if (y && y % every === 0)
            svgLabel(base, ctx.fmt(y), { x: PX(0) - 16, y: PY(y) + 6, size: 18, fill: COLORS.dim, math: true });
      }
    },
    update(get) {
      base.setAttribute('opacity', String(clamp(num(get('', 'd'), 1) * 1.5)));
      dyn.replaceChildren();
      for (const [id, m] of marks(ctx)) {
        const data = m.data as P;
        const o = num(get(id, 'o'), 1);
        if (o < 0.01) continue;
        // a "color" cue on the mark overrides its colour
        const c = color(get(id, 'c') ?? data.color);
        const g = svg('g', { opacity: o }, dyn);
        if (data.kind === 'point') {
          const s = num(get(id, 's'), 1);
          svg(
            'circle',
            {
              cx: 0,
              cy: 0,
              r: 9,
              fill: c,
              stroke: COLORS.board,
              'stroke-width': 2,
              transform: `translate(${PX(data.x)} ${PY(data.y)}) scale(${Math.max(0, s)})`,
            },
            g,
          );
          if (data.label)
            svgLabel(g, data.label, {
              x: PX(data.x) + 18,
              y: PY(data.y) - 14,
              size: 24,
              fill: c,
              weight: 600,
              math: /^[A-Za-z]\w?$/.test(data.label),
              dir: ctx.dir,
            });
        } else if (data.kind === 'plot') {
          const f = compileExpr(data.fn, ['x']);
          let d = '';
          let pen = false;
          const steps = 240;
          for (let i = 0; i <= steps; i++) {
            const x = x0 + ((x1 - x0) * i) / steps;
            const y = f({ x });
            if (!Number.isFinite(y) || y < y0 - (y1 - y0) || y > y1 + (y1 - y0)) {
              pen = false;
              continue;
            }
            d += `${pen ? 'L' : 'M'}${PX(x).toFixed(1)} ${PY(Math.max(y0 - 1, Math.min(y1 + 1, y))).toFixed(1)}`;
            pen = true;
          }
          const clip = `wq-clip-${ctx.node.id}`;
          if (!document.getElementById(clip)) {
            const cp = svg('clipPath', { id: clip }, dyn);
            svg('rect', { x: PX(x0), y: PY(y1), width: (x1 - x0) * unit, height: (y1 - y0) * unit }, cp);
          }
          const el = svg('path', { d, stroke: c, 'stroke-width': 4, fill: 'none', 'clip-path': `url(#${clip})` }, g);
          drawOn(el, num(get(id, 'd'), 0));
          if (data.label)
            svgLabel(g, data.label, {
              x: PX(x1) - 40,
              y: PY(Math.max(y0, Math.min(y1, f({ x: x1 - 40 / unit })))) - 14,
              size: 24,
              fill: c,
              math: true,
            });
        } else if (data.kind === 'line') {
          let [ax, ay] = data.from as [number, number];
          let [bx, by] = data.to as [number, number];
          if (data.extend && (ax !== bx || ay !== by)) {
            const k = 100;
            [ax, ay, bx, by] = [ax - (bx - ax) * k, ay - (by - ay) * k, bx + (bx - ax) * k, by + (by - ay) * k];
          }
          const el = svg(
            'path',
            { d: `M${PX(ax)} ${PY(ay)}L${PX(bx)} ${PY(by)}`, stroke: c, 'stroke-width': 3.5, fill: 'none' },
            g,
          );
          drawOn(el, num(get(id, 'd'), 0));
        }
      }
    },
    part(sub) {
      const m = /^pt:(-?[\d.]+),(-?[\d.]+)$/.exec(sub);
      if (!m) return null;
      return { x: PX(+m[1]!) - 14, y: PY(+m[2]!) - 14, w: 28, h: 28 };
    },
  };
};

export const STEM_VIEWS: Record<string, ViewFactory> = { numberline, counters, vscale, barchart, plane };
export type { View };
