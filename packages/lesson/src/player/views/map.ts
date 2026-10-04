// Map view: land outlines with highlighted countries, regions and markers. Geography is loaded on demand from
// script files (they work from file:// too): geo-world.js (1:110m) next to the player script, geo-world-50m.js
// for zoomed-in maps, and region layers from the book (assets/geo/<layer>.js, made by `warqa geo add`).
// Maps are never mirrored.
import { normalizeForMatch } from '@warqa/i18n';
import { MAP_AREAS } from '../../components/humanities.js';
import { num, svg, svgLabel, textWidth } from '../dom.js';
import { COLORS, color, mix } from '../theme.js';
import type { Box, Get, ViewFactory } from './types.js';

type Ring = [number, number][];
interface Geo {
  land: Ring[];
  countries: Record<string, Ring[]>;
}
export interface GeoLayer {
  name?: string;
  attribution?: string;
  regions: { name: string; iso?: string; rings: Ring[] }[];
}

declare global {
  interface Window {
    WARQA_GEO?: Geo;
    WARQA_GEO_50M?: Geo;
    WARQA_GEO_LAYERS?: Record<string, GeoLayer>;
  }
}

let base = '';
/** Where the player script lives (set by the standalone bundle). */
export const setAssetBase = (url: string) => {
  base = url.replace(/[^/]*$/, '');
};

const loading = new Map<string, Promise<void>>();
/** Load a data script once; resolves when it has run (or failed: the map then draws what it has). */
function loadScript(src: string): Promise<void> {
  let p = loading.get(src);
  if (!p) {
    p = new Promise((ok) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => ok();
      s.onerror = () => ok();
      document.head.append(s);
    });
    loading.set(src, p);
  }
  return p;
}

type Hl = { color?: string; label?: string };
type P = {
  area: string | [number, number, number, number];
  highlight: ({ country: string } & Hl)[];
  regions?: { layer: string; highlight: ({ region: string } & Hl)[]; outline: boolean };
  markers: { lon: number; lat: number; label?: string; color?: string }[];
  pov: 'morocco' | 'un';
  caption?: string;
};

const PALETTE = ['coral', 'sky', 'mint', 'gold', 'lilac', 'rose'];
const CAPTION_H = 46;

export const map: ViewFactory = (ctx) => {
  const p = ctx.node.props as P;
  const fixed = Array.isArray(p.area) ? p.area : p.area === 'fit' ? null : (MAP_AREAS[p.area] ?? MAP_AREAS.world!);
  const baseG = svg('g', {}, ctx.g);
  const dyn = svg('g', {}, ctx.g);
  let box: Box = { x: 0, y: 0, w: 0, h: 0 };
  // projection: equirectangular, x scaled by cos(mid latitude)
  let bb: [number, number, number, number] = fixed ?? MAP_AREAS.world!;
  let kx = 1;
  let W = 1;
  let H = 1;
  let s = 1;
  let ox = 0;
  let oy = 0;
  let lastGet: Get | null = null;
  let waiting = false;
  const asked = new Set<string>();
  const proj = (lon: number, lat: number): [number, number] => [ox + (lon - bb[0]) * kx * s, oy + (bb[3] - lat) * s];
  // SVG path of rings; an edge that jumps across the 180° meridian (Fiji, Chukotka) starts a new piece
  const path = (rings: Ring[]) => {
    let d = '';
    for (const r of rings) {
      let prev: number | null = null;
      for (const [lon, lat] of r) {
        const [x, y] = proj(lon, lat);
        d += `${prev === null || Math.abs(lon - prev) > 180 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        prev = lon;
      }
      d += 'Z';
    }
    return d;
  };

  const zoomed = () => bb[2] - bb[0] < 60;
  const world = (): Geo | undefined => (zoomed() ? (window.WARQA_GEO_50M ?? window.WARQA_GEO) : window.WARQA_GEO);
  const layer = (): GeoLayer | undefined => (p.regions ? window.WARQA_GEO_LAYERS?.[p.regions.layer] : undefined);

  const countryRings = (name: string, geo: Geo): Ring[] => {
    const own = geo.countries[name] ?? geo.countries[name.replace(/^the /i, '')] ?? [];
    // point of view: Morocco including its Sahara provinces, or Western Sahara drawn separately
    if (p.pov === 'morocco' && name === 'Morocco') return [...own, ...(geo.countries['W. Sahara'] ?? [])];
    return own;
  };
  const regionRings = (name: string): Ring[] => {
    const l = layer();
    if (!l) return [];
    const want = normalizeForMatch(name);
    const r =
      l.regions.find((x) => x.iso?.toLowerCase() === name.toLowerCase()) ??
      l.regions.find((x) => normalizeForMatch(x.name) === want) ??
      l.regions.find((x) => normalizeForMatch(x.name).includes(want) || want.includes(normalizeForMatch(x.name)));
    return r?.rings ?? [];
  };
  const centroid = (rings: Ring[]): [number, number] | null => {
    const big = rings.reduce<Ring | null>((a, r) => (!a || r.length > a.length ? r : a), null);
    if (!big?.length) return null;
    const [x, y] = big.reduce(([ax, ay], [lon, lat]) => [ax + lon, ay + lat], [0, 0]);
    return proj(x / big.length, y / big.length);
  };

  /** Area for "fit": the whole region layer (the country), highlighted countries and markers, with a margin. */
  const fitBox = (): [number, number, number, number] | null => {
    const pts: [number, number][] = [];
    const geo = window.WARQA_GEO;
    if (geo) for (const h of p.highlight) for (const r of countryRings(h.country, geo)) pts.push(...r);
    for (const r of layer()?.regions ?? []) for (const ring of r.rings) pts.push(...ring);
    for (const m of p.markers) pts.push([m.lon, m.lat]);
    if (!pts.length) return null;
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const m = Math.max(1, (x1 - x0) * 0.08, (y1 - y0) * 0.08);
    return [Math.max(-180, x0 - m), Math.max(-85, y0 - m), Math.min(180, x1 + m), Math.min(85, y1 + m)];
  };

  const layout = () => {
    bb = fixed ?? fitBox() ?? MAP_AREAS.world!;
    kx = Math.cos((((bb[1] + bb[3]) / 2) * Math.PI) / 180);
    W = (bb[2] - bb[0]) * kx;
    H = bb[3] - bb[1];
    const capH = p.caption ? CAPTION_H : 0;
    s = Math.min(box.w / W, (box.h - capH) / H);
    ox = box.x + (box.w - W * s) / 2;
    oy = box.y + (box.h - capH - H * s) / 2;
  };

  /** Everything this map needs; redraw when it has arrived. */
  const needs = (): string[] => {
    const out: string[] = [];
    if (!window.WARQA_GEO) out.push(`${base}geo-world.js`);
    if (zoomed() && !window.WARQA_GEO_50M) out.push(`${base}geo-world-50m.js`);
    if (p.regions && !layer()) out.push(ctx.asset(`assets/geo/${p.regions.layer}.js`));
    return out;
  };

  const clipId = `wq-map-${ctx.node.id}`;
  const drawBase = () => {
    layout();
    baseG.replaceChildren();
    const defs = svg('defs', {}, baseG);
    const cp = svg('clipPath', { id: clipId }, defs);
    svg('rect', { x: ox, y: oy, width: W * s, height: H * s, rx: 14 }, cp);
    svg(
      'rect',
      {
        x: ox,
        y: oy,
        width: W * s,
        height: H * s,
        rx: 14,
        fill: mix(COLORS.board!, COLORS.sky!, 0.12),
        stroke: COLORS.faint,
        'stroke-width': 2,
      },
      baseG,
    );
    // not loaded yet: wait (each file loads once, however many maps ask), then draw again
    const missing = needs().filter((src) => !asked.has(src));
    if (missing.length && !waiting) {
      waiting = true;
      for (const src of missing) asked.add(src); // a file that fails to load is not asked for again
      void Promise.all(missing.map(loadScript)).then(() => {
        waiting = false;
        drawBase();
        if (lastGet) update(lastGet);
      });
    }
    const geo = world();
    if (!geo) {
      svgLabel(baseG, '…', { x: ox + (W * s) / 2, y: oy + (H * s) / 2, size: 40, fill: COLORS.dim });
      return;
    }
    const clip = { 'clip-path': `url(#${clipId})` };
    svg(
      'path',
      {
        d: path(geo.land),
        fill: mix(COLORS.board!, COLORS.chalk!, 0.14),
        stroke: COLORS.dim,
        'stroke-width': 1.2,
        ...clip,
      },
      baseG,
    );
    const l = layer();
    if (l && p.regions?.outline !== false)
      svg(
        'path',
        {
          d: path(l.regions.flatMap((r) => r.rings)),
          fill: 'none',
          stroke: COLORS.dim,
          'stroke-width': 1,
          opacity: 0.8,
          ...clip,
        },
        baseG,
      );
    // credit the boundary data on the map itself (required by its licence)
    if (l?.attribution)
      svgLabel(baseG, l.attribution, {
        x: ox + W * s - 10 - textWidth(l.attribution, 14, 'ui', 400, 'ltr') / 2,
        y: oy + H * s - 10,
        size: 14,
        fill: COLORS.dim,
        dir: 'ltr',
      });
  };

  const fillShape = (layerG: SVGGElement, rings: Ring[], c: string, o: number, hl: number) => {
    // outline first, then an opaque fill on top: edges shared by merged shapes disappear, the outer edge stays
    const g = svg('g', { opacity: o }, layerG);
    const d = path(rings);
    svg('path', { d, fill: 'none', stroke: c, 'stroke-width': 2 * (2 + 3 * hl), 'stroke-linejoin': 'round' }, g);
    svg('path', { d, fill: mix(mix(COLORS.board!, COLORS.chalk!, 0.14), c, 0.55), stroke: 'none' }, g);
  };
  /**
   * A label on a shape: at its centre, or (if that would cover another label) beside the shape, with a
   * leader line. Labels are placed in order, so earlier ones never move when later ones appear.
   */
  const label = (labels: SVGGElement, placed: Box[], text: string, rings: Ring[], o: number) => {
    const at = centroid(rings);
    if (!at) return;
    const w = textWidth(text, 24, 'ui', 600, ctx.dir) + 16;
    const h = 32;
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    for (const r of rings)
      for (const [lon, lat] of r) {
        const [x] = proj(lon, lat);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    const frame = { x: ox, y: oy, w: W * s, h: H * s };
    const hit = (b: Box) =>
      placed.some((q) => b.x < q.x + q.w && q.x < b.x + b.w && b.y < q.y + q.h && q.y < b.y + b.h);
    // labels may reach past the map's frame, but stay in the node's box and clear of the credit line
    const inside = (b: Box) =>
      b.x >= box.x && b.x + b.w <= box.x + box.w && b.y >= frame.y + 6 && b.y + b.h <= frame.y + frame.h - 30;
    const centre: [number, number] = [at[0], at[1]];
    const beside: [number, number][] = [];
    for (const dy of [0, h + 6, -(h + 6), 2 * (h + 6), -2 * (h + 6)])
      beside.push([x0 - 14 - w / 2, at[1] + dy], [x1 + 14 + w / 2, at[1] + dy]);
    // a label wider than its shape would hide it: put it beside the shape first
    const candidates = w > (x1 - x0) * 0.8 ? [...beside, centre] : [centre, ...beside];
    const boxOf = ([cx, cy]: [number, number]): Box => ({ x: cx - w / 2, y: cy - 22, w, h });
    const pos = candidates.find((c) => !hit(boxOf(c)) && inside(boxOf(c))) ?? centre;
    const b = boxOf(pos);
    placed.push(b);
    if (pos !== centre)
      svg(
        'path',
        {
          d: `M${at[0]} ${at[1]}L${pos[0] + (pos[0] < at[0] ? w / 2 : -w / 2)} ${pos[1] - 6}`,
          stroke: COLORS.chalk,
          'stroke-width': 2,
          opacity: o * 0.8,
        },
        labels,
      );
    svg('rect', { x: b.x, y: b.y, width: w, height: h, rx: 8, fill: '#1d2b27cc', opacity: o }, labels);
    svgLabel(labels, text, {
      x: pos[0],
      y: pos[1] + 2,
      size: 24,
      fill: COLORS.chalk,
      weight: 600,
      dir: ctx.dir,
    }).setAttribute('opacity', String(o));
  };

  const update = (get: Get) => {
    lastGet = get;
    dyn.replaceChildren();
    const geo = world();
    if (!geo) return;
    const layerG = svg('g', { 'clip-path': `url(#${clipId})` }, dyn);
    const labels = svg('g', {}, dyn);
    const shapes: { sub: string; rings: Ring[]; h: Hl; i: number }[] = [
      ...p.highlight.map((h, i) => ({ sub: `c:${i}`, rings: countryRings(h.country, geo), h, i })),
      ...(p.regions?.highlight ?? []).map((h, i) => ({
        sub: `r:${i}`,
        rings: regionRings(h.region),
        h,
        i: i + p.highlight.length,
      })),
    ];
    const placed: Box[] = [];
    for (const { sub, rings, h, i } of shapes) {
      const o = num(get(sub, 'o'), 1);
      if (o < 0.01 || !rings.length) continue;
      const c = color(get(sub, 'c') ?? h.color ?? PALETTE[i % PALETTE.length]);
      fillShape(layerG, rings, c, o, num(get(sub, 'hl'), 0));
      if (h.label) label(labels, placed, h.label, rings, o);
    }
    const pins = [
      ...p.markers.map((m, i) => ({ sub: `pin:${i}`, ...m })),
      ...Object.entries(ctx.node.subs)
        .filter(([, sb]) => sb.mark)
        .map(([sub, sb]) => ({ sub, ...(sb.data as { lon: number; lat: number; label?: string; color?: string }) })),
    ];
    for (const m of pins) {
      const o = num(get(m.sub, 'o'), 1);
      if (o < 0.01) continue;
      const k = num(get(m.sub, 's'), 1);
      const [x, y] = proj(m.lon, m.lat);
      const c = color(get(m.sub, 'c') ?? m.color ?? 'task');
      const g = svg('g', { opacity: o }, labels);
      svg(
        'circle',
        {
          cx: 0,
          cy: 0,
          r: 10,
          fill: c,
          stroke: COLORS.board,
          'stroke-width': 3,
          transform: `translate(${x} ${y}) scale(${Math.max(0, k)})`,
        },
        g,
      );
      if (m.label) {
        const w = textWidth(m.label, 24, 'ui', 600, ctx.dir);
        svgLabel(g, m.label, { x: x + 18 + w / 2, y: y + 8, size: 24, fill: COLORS.chalk, weight: 600, dir: ctx.dir });
      }
    }
    if (p.caption)
      svgLabel(labels, p.caption, {
        x: box.x + box.w / 2,
        y: oy + H * s + 36,
        size: 24,
        fill: COLORS.dim,
        dir: ctx.dir,
      });
  };

  return {
    size: (maxW, maxH) => {
      // "fit" maps take the space they are given; others keep their area's shape
      if (!fixed) return { w: maxW, h: maxH };
      const w0 = (fixed[2] - fixed[0]) * Math.cos((((fixed[1] + fixed[3]) / 2) * Math.PI) / 180);
      const h0 = fixed[3] - fixed[1];
      const capH = p.caption ? CAPTION_H : 0;
      const k = Math.min(maxW / w0, (maxH - capH) / h0);
      return { w: w0 * k, h: h0 * k + capH };
    },
    place(b) {
      box = b;
      drawBase();
    },
    update,
    part(sub) {
      const geo = world();
      const c = /^c:(\d+)$/.exec(sub);
      const r = /^r:(\d+)$/.exec(sub);
      const rings =
        c && geo
          ? countryRings(p.highlight[Number(c[1])]?.country ?? '', geo)
          : r
            ? regionRings(p.regions?.highlight[Number(r[1])]?.region ?? '')
            : null;
      if (rings) {
        const at = centroid(rings);
        return at ? { x: at[0] - 30, y: at[1] - 30, w: 60, h: 60 } : null;
      }
      const pin = /^pin:(\d+)$/.exec(sub);
      if (pin) {
        const mk = p.markers[Number(pin[1])];
        if (!mk) return null;
        const [x, y] = proj(mk.lon, mk.lat);
        return { x: x - 18, y: y - 18, w: 36, h: 36 };
      }
      return null;
    },
  };
};
