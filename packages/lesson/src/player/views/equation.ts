// Equation: a row of math tokens that morphs between steps (matching tokens by id/position).
// Portions derived from Papermorph (MIT): the "collapse" idea — box the changed tokens, shrink them away,
// bring in the result, close the gap.
import { prettyMinus } from '@warqa/i18n';
import { type TokenInfo, tokenInfos } from '../../components/stem.js';
import { clamp, lerp, num, svg, svgLabel, textWidth } from '../dom.js';
import { color, FONT_MATH, MATH_SIZE } from '../theme.js';
import type { Box, Get, ViewFactory } from './types.js';

interface Placed {
  info: TokenInfo;
  cx: number;
  w: number;
  el: SVGGElement;
}

const io = (q: number) => (q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2);
const seg = (q: number, a: number, b: number) => clamp((q - a) / (b - a));

export const equation: ViewFactory = (ctx) => {
  const p = ctx.node.props as { steps: unknown[][]; size: keyof typeof MATH_SIZE };
  const size = MATH_SIZE[p.size] ?? 66;
  const steps = p.steps.map((s) => tokenInfos(s as never));
  const hasNotes = steps.some((s) => s.some((t) => t.note));
  const hasFrac = steps.some((s) => s.some((t) => t.frac));
  const gap = size * 0.06;
  const tokW = (t: TokenInfo) => {
    if (t.frac)
      return (
        Math.max(
          textWidth(prettyMinus(t.frac[0]), size * 0.72, 'math'),
          textWidth(prettyMinus(t.frac[1]), size * 0.72, 'math'),
        ) +
        size * 0.3
      );
    const extra = Math.max(
      t.sup ? textWidth(prettyMinus(t.sup), size * 0.6, 'math') : 0,
      t.sub ? textWidth(prettyMinus(t.sub), size * 0.6, 'math') : 0,
    );
    return textWidth(prettyMinus(t.t), size, 'math') + (extra ? extra + size * 0.04 : 0);
  };
  const widths = steps.map((s) => s.map(tokW));
  const rowW = widths.map((ws) => ws.reduce((a, b) => a + b + gap, -gap));
  const natW = Math.max(...rowW);
  const natH = size * (hasFrac ? 1.9 : 1.35) + (hasNotes ? size * 1.25 : 0);

  const ringLayer = svg('g', {}, ctx.g);
  const boxLayer = svg('g', {}, ctx.g);
  const tokLayer = svg('g', {}, ctx.g);
  const noteLayer = svg('g', {}, ctx.g);
  let placed: Placed[][] = [];
  let baseY = 0;
  const notes = new Map<string, SVGTextElement>();
  const noteW = new Map<string, number>();
  const rings = new Map<string, SVGRectElement>();
  const morphBoxes: SVGRectElement[] = [];

  function drawToken(info: TokenInfo, cx: number, w: number): SVGGElement {
    const g = svg('g', {}, tokLayer);
    const fill = color(info.c, color('chalk'));
    if (info.frac) {
      const s2 = size * 0.72;
      svgLabel(g, info.frac[0], { x: cx, y: baseY - size * 0.42, size: s2, fill, math: true });
      svg(
        'path',
        {
          d: `M${cx - w / 2 + size * 0.1} ${baseY - size * 0.3}H${cx + w / 2 - size * 0.1}`,
          stroke: fill,
          'stroke-width': Math.max(2, size * 0.045),
        },
        g,
      );
      svgLabel(g, info.frac[1], { x: cx, y: baseY + size * 0.42, size: s2, fill, math: true });
    } else {
      const el = svg(
        'text',
        {
          x: cx,
          y: baseY,
          'font-size': size,
          'font-family': FONT_MATH,
          fill,
          'text-anchor': 'middle',
          direction: 'ltr',
        },
        g,
      );
      el.setAttribute('xml:space', 'preserve');
      el.style.whiteSpace = 'pre';
      if (info.sup || info.sub) {
        // base, then a raised exponent and/or a lowered index in a smaller size
        el.textContent = '';
        const base = svg('tspan', {}, el);
        base.textContent = prettyMinus(info.t);
        if (info.sup) {
          const sp = svg('tspan', { 'font-size': size * 0.6, dy: -size * 0.42 }, el);
          sp.textContent = prettyMinus(info.sup);
        }
        if (info.sub) {
          const sb = svg('tspan', { 'font-size': size * 0.6, dy: info.sup ? size * 0.72 : size * 0.3 }, el);
          if (info.sup) sb.setAttribute('dx', String(-textWidth(prettyMinus(info.sup), size * 0.6, 'math')));
          sb.textContent = prettyMinus(info.sub);
        }
      } else el.textContent = prettyMinus(info.t);
    }
    g.style.visibility = 'hidden';
    return g;
  }

  function layout(box: Box) {
    for (const l of [tokLayer, boxLayer, noteLayer, ringLayer]) l.replaceChildren();
    notes.clear();
    rings.clear();
    morphBoxes.length = 0;
    // natural size, centred in the box (the renderer scales the node down if the box is smaller)
    const top = box.y + (box.h - natH) / 2;
    baseY = top + size * (hasFrac ? 1.25 : 0.95);
    const cxBox = box.x + box.w / 2;
    placed = steps.map((s, k) => {
      let x = cxBox - rowW[k]! / 2;
      return s.map((info, i) => {
        const w = widths[k]![i]!;
        const cx = x + w / 2;
        x += w + gap;
        return { info, cx, w, el: drawToken(info, cx, w) };
      });
    });
    const noteText = new Map<string, string>();
    for (const st of steps) for (const t of st) if (t.note && !noteText.has(t.id)) noteText.set(t.id, t.note);
    for (const [id, txt] of noteText) {
      notes.set(
        id,
        svgLabel(noteLayer, txt, {
          x: 0,
          y: baseY + size * 0.95,
          size: Math.round(size * 0.4),
          fill: color('task'),
          weight: 600,
          dir: ctx.dir,
        }),
      );
      noteW.set(id, textWidth(txt, Math.round(size * 0.4), 'ui', 600, ctx.dir));
    }
    const ids = new Set(steps.flatMap((st) => st.map((t) => t.id)));
    for (const id of ids)
      rings.set(id, svg('rect', { rx: 10, fill: 'none', 'stroke-width': 3, opacity: 0 }, ringLayer));
  }

  function hideAll() {
    for (const row of placed) for (const t of row) t.el.style.visibility = 'hidden';
    for (const b of morphBoxes) b.remove();
    morphBoxes.length = 0;
  }

  function show(t: Placed, x: number, o: number, s: number, get: Get) {
    const subO = num(get(`tok:${t.info.id}`, 'o'), 1);
    const subS = num(get(`tok:${t.info.id}`, 's'), 1);
    const opacity = o * subO;
    t.el.style.visibility = opacity < 0.01 ? 'hidden' : '';
    t.el.setAttribute('opacity', opacity.toFixed(3));
    const k = s * subS;
    const dx = x - t.cx;
    const cy = baseY - size * 0.33;
    t.el.setAttribute(
      'transform',
      `translate(${dx} 0)${k !== 1 ? ` translate(${t.cx} ${cy}) scale(${k.toFixed(4)}) translate(${-t.cx} ${-cy})` : ''}`,
    );
  }

  const posOf = new Map<string, { x: number; w: number }>();

  return {
    size: () => ({ w: natW, h: natH }),
    place: layout,
    update(get) {
      const last = steps.length - 1;
      const st = clamp(num(get('', 'step'), 0), 0, last);
      const k = Math.min(Math.floor(st), last);
      const q = k >= last ? 0 : st - k;
      hideAll();
      posOf.clear();
      const cur = placed[k]!;
      if (q <= 0) {
        for (const t of cur) {
          show(t, t.cx, 1, 1, get);
          posOf.set(t.info.id, { x: t.cx, w: t.w });
        }
      } else {
        const next = placed[k + 1]!;
        const nextById = new Map(next.map((t) => [t.info.id, t]));
        const curById = new Map(cur.map((t) => [t.info.id, t]));
        const same = (a: TokenInfo, b: TokenInfo) =>
          a.t === b.t &&
          a.c === b.c &&
          a.sup === b.sup &&
          a.sub === b.sub &&
          JSON.stringify(a.frac) === JSON.stringify(b.frac);
        // boxes around runs of changed/removed tokens
        const flagged = cur.map((t) => {
          const n = nextById.get(t.info.id);
          return !n || !same(t.info, n.info);
        });
        const runs: [number, number][] = [];
        flagged.forEach((f, i) => {
          if (!f) return;
          const r = runs[runs.length - 1];
          if (r && r[1] === i - 1) r[1] = i;
          else runs.push([i, i]);
        });
        const boxO = seg(q, 0, 0.18) * (1 - seg(q, 0.78, 0.95));
        for (const [a, b] of runs) {
          const left = cur[a]!.cx - cur[a]!.w / 2 - 8;
          const right = cur[b]!.cx + cur[b]!.w / 2 + 8;
          morphBoxes.push(
            svg(
              'rect',
              {
                x: left,
                y: baseY - size * 0.95,
                width: right - left,
                height: size * 1.3,
                rx: 10,
                fill: 'none',
                stroke: color('task'),
                'stroke-width': 3,
                opacity: boxO.toFixed(3),
              },
              boxLayer,
            ),
          );
        }
        const slide = io(seg(q, 0.6, 1));
        for (const t of cur) {
          const n = nextById.get(t.info.id);
          if (n && same(t.info, n.info)) {
            const x = lerp(t.cx, n.cx, slide);
            show(t, x, 1, 1, get);
            posOf.set(t.info.id, { x, w: lerp(t.w, n.w, slide) });
          } else {
            const fade = seg(q, 0.25, 0.55);
            show(t, t.cx, 1 - fade, 1 - 0.4 * fade, get);
          }
        }
        for (const n of next) {
          const c = curById.get(n.info.id);
          if (c && same(c.info, n.info)) continue;
          // replaced tokens appear where the old run was, then slide; new tokens appear in place
          const runCenter = (() => {
            if (!c) return n.cx;
            const i = cur.indexOf(c);
            const r = runs.find(([a, b]) => i >= a && i <= b);
            if (!r) return c.cx;
            return (cur[r[0]]!.cx - cur[r[0]]!.w / 2 + cur[r[1]]!.cx + cur[r[1]]!.w / 2) / 2;
          })();
          const o = seg(q, 0.45, 0.72);
          const x = lerp(runCenter, n.cx, slide);
          show(n, x, o, 0.85 + 0.15 * o, get);
          posOf.set(n.info.id, { x, w: n.w });
        }
      }
      // highlight rings and notes follow the token's current position
      for (const [id, ring] of rings) {
        const pos = posOf.get(id);
        const hl = num(get(`tok:${id}`, 'hl'), 0);
        if (!pos || hl < 0.01) {
          ring.setAttribute('opacity', '0');
          continue;
        }
        ring.setAttribute('x', String(pos.x - pos.w / 2 - 10));
        ring.setAttribute('y', String(baseY - size * 0.92));
        ring.setAttribute('width', String(pos.w + 20));
        ring.setAttribute('height', String(size * 1.25));
        ring.setAttribute('stroke', color(get(`tok:${id}`, 'hlc'), color('task')));
        ring.setAttribute('opacity', hl.toFixed(3));
      }
      // notes under their tokens; a note that would collide with the previous one drops to a second row
      let lastRight = -Infinity;
      const order = [...notes.entries()]
        .map(([id, el]) => ({ id, el, pos: posOf.get(id) }))
        .sort((a, b) => (a.pos?.x ?? 0) - (b.pos?.x ?? 0));
      for (const { id, el, pos } of order) {
        const o = num(get(`note:${id}`, 'o'), 0);
        if (!pos || o < 0.01) {
          el.setAttribute('opacity', '0');
          el.style.visibility = 'hidden';
          continue;
        }
        const w = noteW.get(id) ?? 0;
        const row2 = pos.x - w / 2 < lastRight + 10;
        if (!row2) lastRight = pos.x + w / 2;
        el.setAttribute('x', String(pos.x));
        el.setAttribute('y', String(baseY + size * (row2 ? 1.5 : 0.95)));
        el.setAttribute('opacity', o.toFixed(3));
        el.style.visibility = '';
      }
    },
    part(sub) {
      if (!sub.startsWith('tok:')) return null;
      const t = placed[0]?.find((x) => `tok:${x.info.id}` === sub);
      if (!t) return null;
      return { x: t.cx - t.w / 2, y: baseY - size, w: t.w, h: size * 1.3 };
    },
  };
};
