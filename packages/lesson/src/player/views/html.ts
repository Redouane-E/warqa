// Text-heavy components rendered as HTML over the stage: real line wrapping, bidi and fonts for every language.
import { h, rich } from '../dom.js';
import { color, TEXT_SIZE } from '../theme.js';
import { applyHtml } from './apply.js';
import type { Box, Get, View, ViewCtx, ViewFactory } from './types.js';

type P = Record<string, any>;

/** Common shape of HTML views: build content into ctx.div, measure it, and apply channels to named parts. */
function htmlView(
  ctx: ViewCtx,
  build: (root: HTMLDivElement) => Record<string, HTMLElement>,
  opts: { stretch?: boolean } = {},
): View {
  const root = h('div', { class: `wq-c wq-c-${ctx.node.type}` });
  ctx.div.append(root);
  const parts = build(root);
  let box: Box = { x: 0, y: 0, w: 0, h: 0 };
  return {
    size(maxW, maxH) {
      root.style.width = opts.stretch ? `${maxW}px` : '';
      root.style.maxWidth = `${maxW}px`;
      root.style.maxHeight = '';
      const w = Math.min(maxW, Math.ceil(root.scrollWidth) + 1);
      const hh = Math.ceil(root.scrollHeight);
      void maxH;
      return { w: opts.stretch ? maxW : w, h: hh };
    },
    place(b) {
      box = b;
      root.style.width = `${b.w}px`;
      root.style.maxWidth = `${b.w}px`;
    },
    update(get: Get) {
      for (const [sub, el] of Object.entries(parts)) applyHtml(el, get, sub);
    },
    part(sub) {
      const el = parts[sub];
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
}

const title: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    const parts: Record<string, HTMLElement> = {};
    if (p.kicker) root.append((parts.kicker = h('p', { class: 'wq-kicker' }, rich(p.kicker))));
    root.append((parts.title = h('h2', { class: 'wq-title' }, rich(p.title))));
    if (p.subtitle) root.append((parts.subtitle = h('p', { class: 'wq-subtitle' }, rich(p.subtitle))));
    (p.lines as string[]).forEach((l, i) => root.append((parts[`line:${i}`] = h('p', { class: 'wq-line' }, rich(l)))));
    return parts;
  });

const text: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    root.style.fontSize = `${TEXT_SIZE[p.size as keyof typeof TEXT_SIZE] ?? 34}px`;
    root.style.color = color(p.tone);
    root.style.fontWeight = p.weight === 'normal' ? '400' : '600';
    root.style.textAlign = p.align === 'start' ? 'start' : 'center';
    root.append(rich(p.text));
    return {};
  });

const list: ViewFactory = (ctx) =>
  htmlView(
    ctx,
    (root) => {
      const p = ctx.node.props as P;
      const ol = h(p.style === 'numbered' ? 'ol' : 'ul', { class: `wq-list wq-list-${p.style}` });
      root.append(ol);
      const parts: Record<string, HTMLElement> = {};
      (p.items as { text: string; sub?: string }[]).forEach((it, i) => {
        const li = h(
          'li',
          {},
          h('span', { class: 'wq-list-n', 'aria-hidden': 'true' }, p.style === 'numbered' ? ctx.fmt(i + 1) : '•'),
          h(
            'div',
            {},
            h('p', { class: 'wq-list-t' }, rich(it.text)),
            it.sub ? h('p', { class: 'wq-list-sub' }, rich(it.sub)) : null,
          ),
        );
        ol.append(li);
        parts[`item:${i}`] = li;
      });
      return parts;
    },
    { stretch: true },
  );

const definition: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    const parts: Record<string, HTMLElement> = {};
    root.append(
      (parts.term = h('p', { class: 'wq-term' }, rich(p.term))),
      (parts.text = h('p', { class: 'wq-def' }, rich(p.text))),
    );
    if (p.example) root.append((parts.example = h('p', { class: 'wq-example' }, rich(p.example))));
    return parts;
  });

const ICON: Record<string, string> = { info: 'ℹ', tip: '★', warn: '!', mistake: '✗', good: '✓' };
const callout: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    root.classList.add(`wq-tone-${p.tone}`);
    root.append(
      h('span', { class: 'wq-callout-i', 'aria-hidden': 'true' }, ICON[p.tone] ?? 'ℹ'),
      h('div', {}, p.title ? h('p', { class: 'wq-callout-t' }, rich(p.title)) : null, h('p', {}, rich(p.text))),
    );
    return {};
  });

const compare: ViewFactory = (ctx) =>
  htmlView(
    ctx,
    (root) => {
      const p = ctx.node.props as P;
      const parts: Record<string, HTMLElement> = {};
      (['left', 'right'] as const).forEach((side, k) => {
        const s = p[side];
        const tag = k === 0 ? 'a' : 'b';
        const col = h(
          'div',
          { class: `wq-col wq-tone-${s.tone}` },
          h('p', { class: 'wq-col-t' }, s.tone === 'bad' ? '✗ ' : s.tone === 'good' ? '✓ ' : '', rich(s.title)),
        );
        (s.items as string[]).forEach((it, i) =>
          col.append((parts[`${tag}:${i}`] = h('p', { class: 'wq-col-i' }, rich(it)))),
        );
        root.append(col);
        parts[tag] = col;
      });
      return parts;
    },
    { stretch: true },
  );

const table: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    const parts: Record<string, HTMLElement> = {};
    const tbl = h('table', { class: 'wq-table' });
    if (p.caption) tbl.append(h('caption', {}, rich(p.caption)));
    tbl.append(
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          (p.columns as string[]).map((c, j) => (parts[`col:${j}`] = h('th', { scope: 'col' }, rich(c)))),
        ),
      ),
    );
    const body = h('tbody');
    (p.rows as string[][]).forEach((r, i) => {
      const tr = h(
        'tr',
        {},
        r.map((c, j) => (parts[`cell:${i}:${j}`] = h('td', {}, rich(c)))),
      );
      parts[`row:${i}`] = tr;
      body.append(tr);
    });
    tbl.append(body);
    root.append(tbl);
    return parts;
  });

const flow: ViewFactory = (ctx) =>
  htmlView(ctx, (root) => {
    const p = ctx.node.props as P;
    root.classList.add(`wq-flow-${p.direction}`);
    const parts: Record<string, HTMLElement> = {};
    const n = (p.steps as string[]).length;
    (p.steps as string[]).forEach((s, i) => {
      root.append((parts[`step:${i}`] = h('div', { class: 'wq-step' }, rich(s))));
      if (i < n - 1 || p.cycle)
        root.append(
          (parts[`arrow:${i}`] = h(
            'div',
            { class: 'wq-arrow', 'aria-hidden': 'true' },
            i === n - 1 ? '↺' : p.direction === 'column' ? '↓' : '→',
          )),
        );
    });
    return parts;
  });

const keyfigures: ViewFactory = (ctx) =>
  htmlView(
    ctx,
    (root) => {
      const p = ctx.node.props as P;
      const parts: Record<string, HTMLElement> = {};
      (p.items as { value: string; label: string; tone?: string }[]).forEach((it, i) => {
        root.append(
          (parts[`item:${i}`] = h(
            'div',
            { class: 'wq-fig' },
            h(
              'p',
              { class: 'wq-fig-v', style: { color: color(it.tone ?? 'task') } },
              rich(`$${it.value.replace(/\$/g, '')}$`),
            ),
            h('p', { class: 'wq-fig-l' }, rich(it.label)),
          )),
        );
      });
      return parts;
    },
    { stretch: true },
  );

const image: ViewFactory = (ctx) =>
  htmlView(
    ctx,
    (root) => {
      const p = ctx.node.props as P;
      const img = h('img', { src: ctx.asset(p.src), alt: p.alt, class: `wq-img wq-fit-${p.fit}`, loading: 'eager' });
      root.append(h('figure', {}, img, p.caption ? h('figcaption', {}, rich(p.caption)) : null));
      return {};
    },
    { stretch: true },
  );

const timeline: ViewFactory = (ctx) =>
  htmlView(
    ctx,
    (root) => {
      const p = ctx.node.props as P;
      const parts: Record<string, HTMLElement> = {};
      const line = h('div', { class: 'wq-tl-line', 'aria-hidden': 'true' });
      root.append(line);
      const row = h('ol', { class: 'wq-tl' });
      (p.events as { date: string; title: string; text?: string; color?: string }[]).forEach((e, i) => {
        const li = h(
          'li',
          { class: 'wq-tl-e' },
          h('span', { class: 'wq-tl-dot', style: { background: color(e.color ?? 'task') }, 'aria-hidden': 'true' }),
          h('p', { class: 'wq-tl-d' }, rich(e.date)),
          h('p', { class: 'wq-tl-t' }, rich(e.title)),
          e.text ? h('p', { class: 'wq-tl-x' }, rich(e.text)) : null,
        );
        row.append(li);
        parts[`event:${i}`] = li;
      });
      root.append(row);
      return parts;
    },
    { stretch: true },
  );

export const HTML_VIEWS: Record<string, ViewFactory> = {
  title,
  text,
  list,
  definition,
  callout,
  compare,
  table,
  flow,
  keyfigures,
  image,
  timeline,
};
