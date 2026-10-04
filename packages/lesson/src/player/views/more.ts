// Views for fraction bars, area grids, the balance scale and picture-book pages.
import { normalizeForMatch, splitSentences, splitWords } from '@warqa/i18n';
import { parseMarks } from '../../core/text.js';
import { spokenText, wordAt } from '../../core/timing.js';
import { clamp, h, num, rich, svg, svgLabel, svgText, textWidth } from '../dom.js';
import { COLORS, color, mix } from '../theme.js';
import { applyHtml, applySvg } from './apply.js';
import type { Box, ViewFactory } from './types.js';

type P = Record<string, any>;

/* ---------- fraction bars ---------- */

const fractionbar: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const bars = p.bars as { parts: number; shaded: number; color?: string; label?: string }[];
  const BAR_H = 64;
  const GAP = 34;
  let geo: { x: number; y: number; w: number }[] = [];
  const layer = svg('g', {}, ctx.g);
  return {
    size: (maxW) => ({ w: Math.min(maxW, 1100), h: bars.length * BAR_H + (bars.length - 1) * GAP }),
    place(box: Box) {
      const labelW = bars.some((b) => b.label) ? 150 : 0;
      const w = Math.min(box.w, 1100) - labelW;
      const x0 = box.x + (box.w - w - labelW) / 2 + (ctx.dir === 'rtl' ? 0 : labelW);
      const y0 = box.y + (box.h - (bars.length * BAR_H + (bars.length - 1) * GAP)) / 2;
      geo = bars.map((_, i) => ({ x: x0, y: y0 + i * (BAR_H + GAP), w }));
    },
    update(get) {
      layer.replaceChildren();
      bars.forEach((b, i) => {
        const g = geo[i]!;
        const parts = Math.max(1, Math.round(num(get('', `pt${i}`), b.parts)));
        const shaded = clamp(num(get('', `sh${i}`), b.shaded), 0, parts);
        const c = color(b.color ?? 'sky');
        const grp = svg('g', {}, layer);
        svg(
          'rect',
          {
            x: g.x,
            y: g.y,
            width: g.w,
            height: BAR_H,
            rx: 8,
            fill: COLORS.board,
            stroke: COLORS.dim,
            'stroke-width': 2,
          },
          grp,
        );
        // shading fills from the reading start
        const sw = (g.w * shaded) / parts;
        svg(
          'rect',
          {
            x: ctx.dir === 'rtl' ? g.x + g.w - sw : g.x,
            y: g.y,
            width: sw,
            height: BAR_H,
            rx: 8,
            fill: mix(COLORS.board!, c, 0.65),
          },
          grp,
        );
        for (let k = 1; k < parts; k++)
          svg(
            'path',
            {
              d: `M${g.x + (g.w * k) / parts} ${g.y}V${g.y + BAR_H}`,
              stroke: COLORS.chalk,
              'stroke-width': 2,
              opacity: 0.8,
            },
            grp,
          );
        if (b.label) {
          const lx = ctx.dir === 'rtl' ? g.x + g.w + 75 : g.x - 75;
          const t = svgLabel(grp, b.label, {
            x: lx,
            y: g.y + BAR_H / 2 + 14,
            size: 40,
            fill: c,
            math: false,
            dir: ctx.dir,
          });
          t.setAttribute('font-family', '"STIX Two Text", serif');
        }
        applySvg(grp, get, `bar:${i}`, g.x + g.w / 2, g.y + BAR_H / 2);
        const hl = num(get(`bar:${i}`, 'hl'), 0);
        if (hl > 0.01)
          svg(
            'rect',
            {
              x: g.x - 8,
              y: g.y - 8,
              width: g.w + 16,
              height: BAR_H + 16,
              rx: 12,
              fill: 'none',
              stroke: color(get(`bar:${i}`, 'hlc'), COLORS.task),
              'stroke-width': 3,
              opacity: hl,
            },
            layer,
          );
      });
    },
    part(sub) {
      const g = geo[Number(sub.split(':')[1])];
      return g ? { x: g.x, y: g.y, w: g.w, h: BAR_H } : null;
    },
  };
};

/* ---------- area grid ---------- */

const areagrid: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const base = svg('g', {}, ctx.g);
  const dyn = svg('g', {}, ctx.g);
  let u = p.unit as number;
  let x0 = 0;
  let y0 = 0;
  const cells = new Map<string, SVGRectElement>();
  const LABEL = 60;
  return {
    size: (maxW, maxH) => {
      const k = Math.min(
        1,
        (maxW - LABEL) / (p.cols * p.unit),
        (maxH - LABEL - (p.caption ? 50 : 0)) / (p.rows * p.unit),
      );
      return { w: p.cols * p.unit * k + LABEL, h: p.rows * p.unit * k + LABEL + (p.caption ? 50 : 0) };
    },
    place(box) {
      base.replaceChildren();
      cells.clear();
      u = Math.min(p.unit, (box.w - LABEL) / p.cols, (box.h - LABEL - (p.caption ? 50 : 0)) / p.rows);
      const W = p.cols * u;
      const H = p.rows * u;
      x0 = box.x + (box.w - W) / 2 + LABEL / 2;
      y0 = box.y + (box.h - H - (p.caption ? 50 : 0)) / 2 + LABEL / 2;
      for (let r = 0; r < p.rows; r++)
        for (let c = 0; c < p.cols; c++) {
          const cell = svg(
            'rect',
            {
              x: x0 + c * u,
              y: y0 + r * u,
              width: u,
              height: u,
              fill: 'none',
              stroke: COLORS.faint,
              'stroke-width': 1.5,
            },
            base,
          );
          cells.set(`${r}:${c}`, cell);
        }
      svg('rect', { x: x0, y: y0, width: W, height: H, fill: 'none', stroke: COLORS.chalk, 'stroke-width': 3 }, base);
      (p.colLabels as string[]).forEach((l, i, a) =>
        svgLabel(base, l, { x: x0 + (W * (i + 0.5)) / a.length, y: y0 - 16, size: 30, fill: COLORS.chalk, math: true }),
      );
      (p.rowLabels as string[]).forEach((l, i, a) =>
        svgLabel(base, l, {
          x: x0 - 28,
          y: y0 + (H * (i + 0.5)) / a.length + 10,
          size: 30,
          fill: COLORS.chalk,
          math: true,
        }),
      );
      if (p.caption)
        svgLabel(base, p.caption, { x: x0 + W / 2, y: y0 + H + 44, size: 26, fill: COLORS.dim, dir: ctx.dir });
    },
    update(get) {
      base.setAttribute('opacity', String(clamp(num(get('', 'd'), 1) * 1.4)));
      dyn.replaceChildren();
      for (const [id, m] of Object.entries(ctx.node.subs)) {
        if (!m.mark) continue;
        const d = m.data as P;
        const o = num(get(id, 'o'), 1);
        if (o < 0.01) continue;
        const c = color(get(id, 'c') ?? d.color);
        const [r0, r1] = [Math.min(d.r0, d.r1), Math.max(d.r0, d.r1)];
        const [c0, c1] = [Math.min(d.c0, d.c1), Math.max(d.c0, d.c1)];
        const g = svg('g', { opacity: o }, dyn);
        svg(
          'rect',
          {
            x: x0 + c0 * u,
            y: y0 + r0 * u,
            width: (c1 - c0 + 1) * u,
            height: (r1 - r0 + 1) * u,
            fill: c,
            'fill-opacity': 0.35,
            stroke: c,
            'stroke-width': 3,
          },
          g,
        );
        if (d.label)
          svgLabel(g, d.label, {
            x: x0 + ((c0 + c1 + 1) * u) / 2,
            y: y0 + ((r0 + r1 + 1) * u) / 2 + 12,
            size: 34,
            fill: COLORS.chalk,
            weight: 600,
            math: /^[\d\s+−\-×x=.]+$/.test(d.label),
            dir: ctx.dir,
          });
      }
      for (const [k, rect] of cells) {
        const hl = num(get(`cell:${k}`, 'hl'), 0);
        rect.setAttribute('fill', hl > 0.01 ? color(get(`cell:${k}`, 'hlc'), COLORS.task) : 'none');
        rect.setAttribute('fill-opacity', String(0.45 * hl));
      }
    },
    part(sub) {
      const m = /^cell:(\d+):(\d+)$/.exec(sub);
      return m ? { x: x0 + Number(m[2]) * u, y: y0 + Number(m[1]) * u, w: u, h: u } : null;
    },
  };
};

/* ---------- balance scale ---------- */

const balance: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const layer = svg('g', {}, ctx.g);
  let cx = 0;
  let cy = 0;
  const L = 300;
  const itemsOf = (side: 'left' | 'right') =>
    (p[side] as string[]).map((text, i) => ({ id: `${side}:${i}`, text, color: 'chalk' }));
  return {
    size: (maxW, maxH) => ({ w: Math.min(maxW, 900), h: Math.min(maxH, 420) }),
    place(box) {
      cx = box.x + box.w / 2;
      cy = box.y + 110;
    },
    update(get) {
      layer.replaceChildren();
      const tilt = num(get('', 'tilt'), 0);
      const rad = (tilt * Math.PI) / 180;
      // the stand
      svg(
        'path',
        {
          d: `M${cx} ${cy}L${cx - 70} ${cy + 260}H${cx + 70}Z`,
          fill: mix(COLORS.board!, COLORS.dim!, 0.25),
          stroke: COLORS.dim,
          'stroke-width': 2.5,
        },
        layer,
      );
      const lx = cx - L * Math.cos(rad);
      const ly = cy + L * Math.sin(rad);
      const rx = cx + L * Math.cos(rad);
      const ry = cy - L * Math.sin(rad);
      svg(
        'path',
        { d: `M${lx} ${ly}L${rx} ${ry}`, stroke: COLORS.chalk, 'stroke-width': 6, 'stroke-linecap': 'round' },
        layer,
      );
      svg('circle', { cx, cy, r: 10, fill: COLORS.task }, layer);
      const pan = (x: number, y: number, side: 'left' | 'right') => {
        svg(
          'path',
          {
            d: `M${x} ${y}L${x - 110} ${y + 110}M${x} ${y}L${x + 110} ${y + 110}`,
            stroke: COLORS.dim,
            'stroke-width': 2,
          },
          layer,
        );
        svg(
          'path',
          {
            d: `M${x - 130} ${y + 110}Q${x} ${y + 150} ${x + 130} ${y + 110}Z`,
            fill: mix(COLORS.board!, COLORS.sky!, 0.3),
            stroke: COLORS.sky,
            'stroke-width': 2.5,
          },
          layer,
        );
        const items = [
          ...itemsOf(side),
          ...Object.entries(ctx.node.subs)
            .filter(([, s]) => s.mark && (s.data as P).side === side)
            .map(([id, s]) => ({ id, text: (s.data as P).text as string, color: (s.data as P).color as string })),
        ];
        let k = 0;
        for (const it of items) {
          const gone = num(get(it.id, 'gone'), 0);
          const o = num(get(it.id, 'o'), 1) * (1 - gone);
          if (o < 0.01) continue;
          const t = svgText(it.text);
          const w = Math.max(70, textWidth(t, 38, 'math') + 36);
          const ix = x - ((items.length - 1) * 58) / 2 + k * 58;
          const iy = y + 88 - k * 4 - gone * 120;
          const g = svg('g', { opacity: o }, layer);
          svg(
            'rect',
            {
              x: ix - w / 2,
              y: iy - 34,
              width: w,
              height: 52,
              rx: 10,
              fill: mix(COLORS.board!, color(get(it.id, 'c') ?? it.color), 0.25),
              stroke: color(get(it.id, 'c') ?? it.color),
              'stroke-width': 2,
            },
            g,
          );
          const label = svg(
            'text',
            {
              x: ix,
              y: iy + 4,
              'font-size': 34,
              'text-anchor': 'middle',
              fill: COLORS.chalk,
              'font-family': '"STIX Two Text", serif',
              direction: 'ltr',
            },
            g,
          );
          label.textContent = t;
          const hl = num(get(it.id, 'hl'), 0);
          if (hl > 0.01)
            svg(
              'rect',
              {
                x: ix - w / 2 - 6,
                y: iy - 40,
                width: w + 12,
                height: 64,
                rx: 12,
                fill: 'none',
                stroke: color(get(it.id, 'hlc'), COLORS.task),
                'stroke-width': 3,
                opacity: hl,
              },
              g,
            );
          const s = num(get(it.id, 's'), 1);
          if (s !== 1) g.setAttribute('transform', `translate(${ix} ${iy}) scale(${s}) translate(${-ix} ${-iy})`);
          k++;
        }
      };
      pan(lx, ly, 'left');
      pan(rx, ry, 'right');
    },
  };
};

/* ---------- picture-book page ---------- */

const storypage: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const root = h('div', { class: `wq-c wq-c-storypage wq-story-${p.layout}` });
  ctx.div.append(root);
  const src = p.image ? ctx.asset(p.image) : '';
  const picture = h(
    'figure',
    { class: 'wq-story-pic' },
    src
      ? h('img', { src, alt: p.alt })
      : h('div', { class: 'wq-story-placeholder', role: 'img', 'aria-label': p.alt }, p.alt),
  );
  const spoken = spokenText(ctx.beat?.narration ?? '').clean;
  const text = p.text ?? parseMarks(ctx.beat?.narration ?? '').clean;
  const sentences = splitSentences(text);
  const timed = ctx.beat?.words;
  // word by word when the narration has word times and the page text is plain (no inline math)
  const byWord = p.readAlong && !!timed?.length && !text.includes('$');
  const textEl = h('div', { class: `wq-story-text${byWord ? ' wq-byword' : ''}` });
  const wordEls: HTMLElement[] = [];
  const spans = sentences.map((s) => {
    if (!byWord) return h('span', { class: 'wq-story-s' }, rich(`${s.text} `));
    const span = h('span', { class: 'wq-story-s' });
    let at = s.start;
    for (const w of splitWords(text).filter((x) => x.start >= s.start && x.end <= s.end)) {
      if (w.start > at) span.append(text.slice(at, w.start));
      const el = h('span', { class: 'wq-w' }, text.slice(w.start, w.end));
      wordEls.push(el);
      span.append(el);
      at = w.end;
    }
    span.append(`${text.slice(at, s.end)} `);
    return span;
  });
  textEl.append(...spans);
  root.append(picture, textEl);
  // spoken word i → page word: the same words in order (the page may differ slightly from what is said)
  const pageOf: number[] = [];
  if (byWord) {
    const page = splitWords(text).map((w) => normalizeForMatch(w.text));
    let cursor = 0;
    for (const [, a, b] of timed!) {
      const said = normalizeForMatch(spoken.slice(a, b));
      let found = -1;
      for (let k = cursor; k < Math.min(page.length, cursor + 5); k++)
        if (page[k] === said || page[k]!.startsWith(said) || said.startsWith(page[k]!)) {
          found = k;
          break;
        }
      pageOf.push(found);
      if (found >= 0) cursor = found + 1;
    }
  }
  let lit: HTMLElement | undefined;
  return {
    size: (maxW, maxH) => ({ w: maxW, h: maxH }),
    place(box) {
      root.style.width = `${box.w}px`;
      root.style.height = `${box.h}px`;
    },
    update(get, t) {
      applyHtml(picture, get, 'picture');
      applyHtml(textEl, get, 'text');
      if (!p.readAlong) return;
      const caps = ctx.beat?.captions ?? [];
      let cur = -1;
      caps.forEach(([at], i) => {
        if (at <= t + 0.05) cur = i;
      });
      const end = ctx.beat?.dur ?? (caps.at(-1)?.[0] ?? 0) + 30;
      spans.forEach((s, i) => s.classList.toggle('wq-reading', i === cur && t <= end + 0.3));
      if (!byWord) return;
      const k = wordAt(timed, t, end);
      const el = k >= 0 ? wordEls[pageOf[k] ?? -1] : undefined;
      if (el !== lit) {
        lit?.classList.remove('wq-now');
        el?.classList.add('wq-now');
        lit = el;
      }
    },
  };
};

export const MORE_VIEWS: Record<string, ViewFactory> = { fractionbar, areagrid, balance, storypage };
