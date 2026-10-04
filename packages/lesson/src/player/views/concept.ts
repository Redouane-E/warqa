// Concept map: HTML node labels laid out in layers, SVG arrows between them.
import { conceptLayers } from '../../components/humanities.js';
import { clamp, h, num, rich, svg } from '../dom.js';
import { COLORS, color } from '../theme.js';
import { applyHtml } from './apply.js';
import type { Box, ViewFactory } from './types.js';

type P = {
  nodes: { id: string; label: string; color?: string }[];
  edges: { from: string; to: string; label?: string }[];
};

export const conceptmap: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const layers = conceptLayers(p);
  const els = new Map<string, HTMLElement>();
  const root = h('div', { class: 'wq-c wq-c-conceptmap' });
  ctx.div.append(root);
  for (const n of p.nodes) {
    const el = h('div', { class: 'wq-cm-node', style: { borderColor: color(n.color ?? 'sky') } }, rich(n.label));
    els.set(n.id, el);
    root.append(el);
  }
  let pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const edgeG = svg('g', {}, ctx.g);
  let _box: Box = { x: 0, y: 0, w: 0, h: 0 };
  return {
    size: (maxW, maxH) => ({ w: maxW, h: Math.min(maxH, 130 * layers.length + 40) }),
    place(b) {
      _box = b;
      root.style.width = `${b.w}px`;
      root.style.height = `${b.h}px`;
      pos = new Map();
      const rowH = b.h / layers.length;
      layers.forEach((layer, r) => {
        const colW = b.w / layer.length;
        layer.forEach((id, c) => {
          const el = els.get(id)!;
          el.style.maxWidth = `${Math.min(340, colW - 24)}px`;
          const w = el.offsetWidth;
          const hh = el.offsetHeight;
          const k = ctx.dir === 'rtl' ? layer.length - 1 - c : c;
          const x = colW * k + colW / 2 - w / 2;
          const y = rowH * r + rowH / 2 - hh / 2;
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          pos.set(id, { x: b.x + x, y: b.y + y, w, h: hh });
        });
      });
    },
    update(get) {
      for (const [id, el] of els) applyHtml(el, get, `node:${id}`);
      edgeG.replaceChildren();
      p.edges.forEach((e, i) => {
        const a = pos.get(e.from);
        const bb = pos.get(e.to);
        if (!a || !bb) return;
        const o = num(get(`edge:${i}`, 'o'), 1);
        if (o < 0.01) return;
        const ax = a.x + a.w / 2;
        const ay = a.y + a.h / 2;
        const bx = bb.x + bb.w / 2;
        const by = bb.y + bb.h / 2;
        // clip the arrow to the node boxes
        const t0 = clip(a, bx - ax, by - ay);
        const t1 = clip(bb, ax - bx, ay - by);
        const sx = ax + (bx - ax) * t0;
        const sy = ay + (by - ay) * t0;
        const ex = bx + (ax - bx) * t1;
        const ey = by + (ay - by) * t1;
        const hl = num(get(`edge:${i}`, 'hl'), 0);
        const c = hl > 0.01 ? color(get(`edge:${i}`, 'hlc'), COLORS.task) : COLORS.dim!;
        const g = svg('g', { opacity: o }, edgeG);
        svg('path', { d: `M${sx} ${sy}L${ex} ${ey}`, stroke: c, 'stroke-width': 2.5 + 2 * hl }, g);
        const ang = Math.atan2(ey - sy, ex - sx);
        const hx = (k: number) => ex - 14 * Math.cos(ang + k);
        const hy = (k: number) => ey - 14 * Math.sin(ang + k);
        svg(
          'path',
          {
            d: `M${hx(0.45)} ${hy(0.45)}L${ex} ${ey}L${hx(-0.45)} ${hy(-0.45)}`,
            stroke: c,
            'stroke-width': 2.5,
            fill: 'none',
          },
          g,
        );
        if (e.label) {
          const lab = svg(
            'text',
            {
              x: (sx + ex) / 2,
              y: (sy + ey) / 2 - 8,
              'font-size': 20,
              fill: COLORS.dim,
              'text-anchor': 'middle',
              direction: ctx.dir,
            },
            g,
          );
          lab.textContent = e.label;
        }
      });
    },
    part(sub) {
      const id = sub.startsWith('node:') ? sub.slice(5) : '';
      return pos.get(id) ?? null;
    },
  };
  function clip(r: { w: number; h: number }, dx: number, dy: number) {
    const tx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
    const ty = dy ? r.h / 2 / Math.abs(dy) : Infinity;
    return clamp(Math.min(tx, ty) + 0.02, 0, 0.5);
  }
};
