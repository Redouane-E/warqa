// Scene renderer: builds views for a compiled beat, lays nodes out in slots (mirrored for RTL) and applies
// channel values every frame.
import type { CompiledBeat } from '../core/compile.js';
import { tracks, visibility } from '../core/layout.js';
import type { NodeState, SceneState } from '../core/types.js';
import type { Slot } from '../schema/common.js';
import { clamp, h, num, svg } from './dom.js';
import { color, STAGE_W } from './theme.js';
import { conceptmap } from './views/concept.js';
import { equation } from './views/equation.js';
import { HTML_VIEWS } from './views/html.js';
import { map } from './views/map.js';
import { math } from './views/math.js';
import { MORE_VIEWS } from './views/more.js';
import { STEM_VIEWS } from './views/stem.js';
import type { Box, Get, View, ViewCtx, ViewFactory } from './views/types.js';
import { widget } from './views/widget.js';

export const VIEWS: Record<string, ViewFactory> = {
  ...HTML_VIEWS,
  ...STEM_VIEWS,
  ...MORE_VIEWS,
  equation,
  conceptmap,
  map,
  math,
  widget,
};

/** Register a view for a third-party component. */
export const registerView = (type: string, f: ViewFactory) => {
  VIEWS[type] = f;
};

export type CardPlace = 'band' | 'side' | 'top' | 'screen' | null;

const SLOTS: Record<Slot, Box> = {
  full: { x: 0, y: 0, w: 1600, h: 900 },
  title: { x: 80, y: 34, w: 1440, h: 120 },
  upper: { x: 80, y: 164, w: 1440, h: 266 },
  lower: { x: 80, y: 440, w: 1440, h: 240 },
  main: { x: 80, y: 164, w: 1440, h: 516 },
  start: { x: 80, y: 164, w: 700, h: 516 },
  end: { x: 820, y: 164, w: 700, h: 516 },
  band: { x: 80, y: 690, w: 1440, h: 180 },
};

const ROW_SLOTS = new Set<Slot>(['title', 'upper', 'lower', 'band']);

/** Slot boxes for a beat, avoiding the question card and mirrored for right-to-left languages. */
export function slotBoxes(dir: 'ltr' | 'rtl', card: CardPlace): Record<Slot, Box> {
  const out = structuredClone(SLOTS);
  if (card === 'side') {
    // the card takes the end column: everything else moves into the start part
    for (const k of ['title', 'upper', 'lower', 'main', 'band'] as Slot[]) out[k].w = 860;
    out.start = { x: 80, y: 164, w: 860, h: 516 };
    out.end = { x: 80, y: 430, w: 860, h: 250 };
  } else if (card === 'top') {
    out.title.w = 860;
    out.upper.w = 860;
  }
  if (dir === 'rtl') for (const b of Object.values(out)) b.x = STAGE_W - b.x - b.w;
  return out;
}

interface Placed {
  node: NodeState;
  view: View;
  outer: SVGGElement;
  g: SVGGElement;
  div: HTMLDivElement;
  ring: SVGRectElement;
  box: Box;
  from?: Box;
  fit: number;
}

export interface SceneEnv {
  lang: string;
  dir: 'ltr' | 'rtl';
  fmt(n: number): string;
  asset(path: string): string;
  math?(tex: string): string | undefined;
}

export class SceneRenderer {
  private placed = new Map<string, Placed>();
  private leaving = new Set<string>();
  /** Boxes of the nodes in the last built beat (for nodes that stay or fade out). */
  boxes = new Map<string, Box>();

  constructor(
    private svgScene: SVGGElement,
    private html: HTMLDivElement,
    private env: SceneEnv,
  ) {}

  setEnv(env: SceneEnv) {
    this.env = env;
  }

  /** The beat each node was last shown in (for nodes that fade out in the next beat). */
  private beatOf = new Map<string, NonNullable<ViewCtx['beat']>>();

  /** Build the DOM for a beat: every node present during it, laid out for the nodes that stay. */
  build(cb: CompiledBeat, card: CardPlace): void {
    const prevBoxes = this.boxes;
    this.svgScene.replaceChildren();
    this.html.replaceChildren();
    this.placed.clear();
    const st: SceneState = cb.start;
    const leaving = new Set(cb.leaving);
    this.leaving = leaving;
    const here: NonNullable<ViewCtx['beat']> = {
      narration: cb.beat.narration,
      captions: cb.timing.captions,
      ...(cb.timing.words ? { words: cb.timing.words } : {}),
      dur: cb.timing.dur,
    };
    for (const id of st.order) {
      const node = st.nodes[id]!;
      const factory = VIEWS[node.type];
      const outer = svg('g', { class: 'wq-node', 'data-id': id }, this.svgScene);
      const ring = svg('rect', { class: 'wq-ring', fill: 'none', 'stroke-width': 3, rx: 14, opacity: 0 }, outer);
      const g = svg('g', {}, outer);
      const div = h('div', { class: 'wq-node-html', 'data-id': id });
      this.html.append(div);
      const ctx: ViewCtx = {
        node,
        g,
        div,
        lang: this.env.lang,
        dir: this.env.dir,
        fmt: this.env.fmt,
        asset: this.env.asset,
        ...(this.env.math ? { math: this.env.math } : {}),
        // a node fading out keeps the narration of its own beat (a picture-book page keeps its text)
        beat: leaving.has(id) ? { narration: this.beatOf.get(id)?.narration ?? '', captions: [] } : here,
      };
      if (!leaving.has(id)) this.beatOf.set(id, here);
      const view: View = factory ? factory(ctx) : missingView(ctx);
      this.placed.set(id, { node, view, outer, g, div, ring, box: { x: 0, y: 0, w: 0, h: 0 }, fit: 1 });
    }
    // layout the nodes that are on stage at the end of the beat
    const slots = slotBoxes(this.env.dir, card);
    const bySlot = new Map<Slot, Placed[]>();
    for (const p of this.placed.values()) {
      if (leaving.has(p.node.id)) continue;
      const list = bySlot.get(p.node.slot) ?? [];
      list.push(p);
      bySlot.set(p.node.slot, list);
    }
    const vis = visibility(cb);
    for (const [slot, list] of bySlot) {
      const tr = tracks(
        list.map((p) => p.node.id),
        vis,
      );
      layoutSlot(slots[slot], ROW_SLOTS.has(slot), list, this.env.dir, tr);
    }
    for (const p of this.placed.values()) {
      if (leaving.has(p.node.id)) {
        const b = prevBoxes.get(p.node.id) ?? slots[p.node.slot];
        layoutSlot(b, false, [p], this.env.dir);
      }
      const prev = prevBoxes.get(p.node.id);
      if (prev && !leaving.has(p.node.id) && (Math.abs(prev.x - p.box.x) > 1 || Math.abs(prev.y - p.box.y) > 1))
        p.from = prev;
      p.view.place(p.box);
      Object.assign(p.div.style, {
        left: `${p.box.x}px`,
        top: `${p.box.y}px`,
        width: `${p.box.w}px`,
        height: `${p.box.h}px`,
      });
    }
    this.boxes = new Map(
      [...this.placed.values()].filter((p) => !leaving.has(p.node.id)).map((p) => [p.node.id, p.box]),
    );
  }

  /** Apply values at time t. */
  update(get: (node: string, sub: string, ch: string) => unknown, t: number): void {
    for (const p of this.placed.values()) {
      const id = p.node.id;
      const o = num(get(id, '', 'o'), 1);
      const s = num(get(id, '', 's'), 1);
      const hl = num(get(id, '', 'hl'), 0);
      let dx = 0;
      let dy = 0;
      if (p.from) {
        const q = clamp(t / 0.6);
        const e = 1 - (1 - q) ** 3;
        dx = (p.from.x - p.box.x) * (1 - e);
        dy = (p.from.y - p.box.y) * (1 - e);
      }
      const cx = p.box.x + p.box.w / 2;
      const cy = p.box.y + p.box.h / 2;
      const k = p.fit * s;
      const scale = k !== 1 ? ` translate(${cx} ${cy}) scale(${k.toFixed(4)}) translate(${-cx} ${-cy})` : '';
      const tr = `${dx || dy ? `translate(${dx.toFixed(1)} ${dy.toFixed(1)})` : ''}${scale}`.trim();
      if (tr) p.outer.setAttribute('transform', tr);
      else p.outer.removeAttribute('transform');
      p.outer.setAttribute('opacity', o.toFixed(3));
      p.outer.style.visibility = o < 0.01 ? 'hidden' : '';
      p.div.style.opacity = o.toFixed(3);
      p.div.style.visibility = o < 0.01 ? 'hidden' : '';
      p.div.style.transform =
        dx || dy || k !== 1 ? `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(4)})` : '';
      if (hl > 0.01) {
        Object.entries({
          x: p.box.x - 14,
          y: p.box.y - 14,
          width: p.box.w + 28,
          height: p.box.h + 28,
          stroke: color(get(id, '', 'hlc'), color('task')),
          opacity: hl.toFixed(3),
        }).forEach(([a, v]) => p.ring.setAttribute(a, String(v)));
      } else p.ring.setAttribute('opacity', '0');
      const sub: Get = (s2, ch) => get(id, s2, ch) as never;
      p.view.update(sub, t);
    }
  }

  partBox(node: string, sub: string): Box | null {
    const p = this.placed.get(node);
    if (!p) return null;
    const b = p.view.part?.(sub);
    if (!b) return null;
    if (p.fit === 1) return b;
    const cx = p.box.x + p.box.w / 2;
    const cy = p.box.y + p.box.h / 2;
    return { x: cx + (b.x - cx) * p.fit, y: cy + (b.y - cy) * p.fit, w: b.w * p.fit, h: b.h * p.fit };
  }

  /** Nodes whose content had to be scaled down to fit (for QA). */
  overflows(): { id: string; fit: number }[] {
    return [...this.placed.values()].filter((p) => p.fit < 0.999).map((p) => ({ id: p.node.id, fit: p.fit }));
  }

  /** Stage boxes of the visible nodes (for overlap checks). */
  layoutBoxes(): { id: string; slot: Slot; box: Box }[] {
    return [...this.placed.values()]
      .filter((p) => !this.leaving.has(p.node.id))
      .map((p) => {
        const cx = p.box.x + p.box.w / 2;
        const cy = p.box.y + p.box.h / 2;
        const w = p.box.w * p.fit;
        const hh = p.box.h * p.fit;
        return { id: p.node.id, slot: p.node.slot, box: { x: cx - w / 2, y: cy - hh / 2, w, h: hh } };
      });
  }
}

/** Lay out nodes sharing a slot: wide slots place them side by side (reading order), tall slots stack them. */
function layoutSlot(slot: Box, row: boolean, list: Placed[], dir: 'ltr' | 'rtl', track?: Map<string, number>) {
  const GAP = 28;
  if (!list.length) return;
  // nodes never visible at the same time share a place (one "track"); tracks are laid out side by side or stacked
  const groups: Placed[][] = [];
  for (const p of list) {
    const t = track?.get(p.node.id) ?? groups.length;
    (groups[t] ??= []).push(p);
  }
  const units = groups.filter((g) => g?.length);
  if (row && units.length > 1) {
    const cellW = (slot.w - GAP * (units.length - 1)) / units.length;
    units.forEach((g, i) => {
      const k = dir === 'rtl' ? units.length - 1 - i : i;
      const cell = { x: slot.x + k * (cellW + GAP), y: slot.y, w: cellW, h: slot.h };
      for (const p of g) fitInto(p, cell);
    });
    return;
  }
  const sizes = units.map((g) => g.map((p) => p.view.size(slot.w, slot.h)));
  const unitH = sizes.map((ss) => Math.max(...ss.map((x) => x.h)));
  const total = unitH.reduce((a, h) => a + h, 0) + GAP * (units.length - 1);
  const k = Math.min(1, slot.h / Math.max(1, total));
  let y = slot.y + Math.max(0, (slot.h - total * k) / 2);
  units.forEach((g, i) => {
    const hh = unitH[i]! * k;
    g.forEach((p, j) => {
      const own = sizes[i]![j]!;
      // each node is centred in its track's band
      const oh = Math.min(hh, own.h * k);
      fitInto(p, { x: slot.x, y: y + (hh - oh) / 2, w: slot.w, h: Math.max(oh, 1) }, own);
    });
    y += hh + GAP * k;
  });
}

function fitInto(p: Placed, cell: Box, known?: { w: number; h: number }) {
  const nat = known ?? p.view.size(cell.w, cell.h);
  const fit = Math.min(1, cell.w / Math.max(1, nat.w), cell.h / Math.max(1, nat.h));
  p.fit = fit < 0.999 ? fit : 1;
  // the view lays out at its natural size, centred on the cell; the renderer scales it to fit
  const w = fit < 0.999 ? nat.w : cell.w;
  const hh = fit < 0.999 ? nat.h : cell.h;
  p.box = { x: cell.x + cell.w / 2 - w / 2, y: cell.y + cell.h / 2 - hh / 2, w, h: hh };
}

function missingView(ctx: ViewCtx): View {
  const el = h('div', { class: 'wq-c wq-missing' }, `[${ctx.node.type}]`);
  ctx.div.append(el);
  return { size: (w) => ({ w, h: 60 }), place() {}, update() {} };
}
