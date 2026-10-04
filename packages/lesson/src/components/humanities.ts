// Humanities and "any document" components: timelines and concept maps.
import * as z from 'zod';
import type { ComponentDef } from '../core/types.js';
import { ColorName, Id, Text } from '../schema/common.js';

const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

type TimelineProps = { events: { date: string; title: string; text?: string; color?: z.infer<typeof ColorName> }[] };

export const timeline: ComponentDef<TimelineProps> = {
  type: 'timeline',
  pack: 'humanities',
  doc: 'A timeline of 2–8 dated events in order (it runs in the reading direction: right to left in Arabic). Each event: date (as written, e.g. "1956", "القرن 12"), a short title, optional one-line text. Parts: event:i, revealed in order unless cued.',
  props: z.object({
    events: z
      .array(
        z.object({ date: z.string().min(1).max(40), title: Text, text: Text.optional(), color: ColorName.optional() }),
      )
      .min(2)
      .max(8),
  }),
  defaultSlot: 'main',
  text: ['events.*.date', 'events.*.title', 'events.*.text'],
  subs: (p) => range(p.events.length, (i) => `event:${i}`),
  initSub: () => ({ o: 0, hl: 0 }),
  reveal: (p) => range(p.events.length, (i) => `event:${i}`),
  init: () => ({ d: 0 }),
  pickable: (p) => range(p.events.length, (i) => `event:${i}`),
  examples: [
    {
      title: 'Moroccan independence',
      props: {
        events: [
          { date: '1912', title: 'Protectorate begins' },
          { date: '1944', title: 'Manifesto of Independence' },
          { date: '1956', title: 'Independence' },
        ],
      },
    },
  ],
};

type MapNode = { id: string; label: string; color?: z.infer<typeof ColorName> };
type ConceptMapProps = { nodes: MapNode[]; edges: { from: string; to: string; label?: string }[] };

export const conceptmap: ComponentDef<ConceptMapProps> = {
  type: 'conceptmap',
  pack: 'humanities',
  doc: 'A concept map: 2–10 labelled ideas joined by arrows (cause → effect, part → whole, idea → example). Laid out in layers from the first node. Parts: node:<id>, edge:i; revealed in order unless cued.',
  props: z.object({
    nodes: z
      .array(z.object({ id: Id, label: Text, color: ColorName.optional() }))
      .min(2)
      .max(10),
    edges: z
      .array(z.object({ from: Id, to: Id, label: Text.optional() }))
      .max(16)
      .default([]),
  }),
  defaultSlot: 'main',
  text: ['nodes.*.label', 'edges.*.label'],
  subs: (p) => [...p.nodes.map((n) => `node:${n.id}`), ...range(p.edges.length, (i) => `edge:${i}`)],
  initSub: () => ({ o: 0, hl: 0 }),
  reveal: (p) => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const n of conceptLayers(p).flat()) {
      order.push(`node:${n}`);
      seen.add(n);
      p.edges.forEach((e, i) => {
        if (e.to === n && seen.has(e.from)) order.push(`edge:${i}`);
      });
    }
    p.edges.forEach((_, i) => {
      if (!order.includes(`edge:${i}`)) order.push(`edge:${i}`);
    });
    return order;
  },
  pickable: (p) => p.nodes.map((n) => `node:${n.id}`),
  examples: [
    {
      title: 'Causes of erosion',
      props: {
        nodes: [
          { id: 'erosion', label: 'Erosion' },
          { id: 'water', label: 'Water' },
          { id: 'wind', label: 'Wind' },
          { id: 'ice', label: 'Ice' },
        ],
        edges: [
          { from: 'erosion', to: 'water', label: 'caused by' },
          { from: 'erosion', to: 'wind' },
          { from: 'erosion', to: 'ice' },
        ],
      },
    },
  ],
};

/** Layers of a concept map by breadth-first distance from the first node (unreached nodes go last). */
export function conceptLayers(p: { nodes: { id: string }[]; edges: { from: string; to: string }[] }): string[][] {
  const ids = p.nodes.map((n) => n.id);
  const depth = new Map<string, number>([[ids[0]!, 0]]);
  const queue = [ids[0]!];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of p.edges) {
      const nb = e.from === cur ? e.to : e.to === cur ? e.from : undefined;
      if (nb && !depth.has(nb) && ids.includes(nb)) {
        depth.set(nb, depth.get(cur)! + 1);
        queue.push(nb);
      }
    }
  }
  const maxD = Math.max(0, ...depth.values());
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  for (const id of ids) {
    const d = depth.get(id);
    if (d === undefined) {
      layers.push([id]);
    } else layers[d]!.push(id);
  }
  return layers.filter((l) => l.length);
}

export const MAP_AREAS: Record<string, [number, number, number, number]> = {
  world: [-170, -58, 190, 84],
  africa: [-20, -36, 53, 38],
  europe: [-12, 34, 42, 72],
  mena: [-18, 10, 63, 43],
  maghreb: [-18, 19, 12, 38],
  morocco: [-17.5, 20.5, -0.5, 36.5],
  asia: [25, -12, 150, 60],
  americas: [-170, -58, -30, 75],
};

type MapHighlight = { color?: z.infer<typeof ColorName>; label?: string };
type MapProps = {
  area: string | [number, number, number, number];
  highlight: ({ country: string } & MapHighlight)[];
  regions?: { layer: string; highlight: ({ region: string } & MapHighlight)[]; outline: boolean };
  markers: { lon: number; lat: number; label?: string; color?: z.infer<typeof ColorName> }[];
  pov: 'morocco' | 'un';
  caption?: string;
};

const mapParts = (p: MapProps) => [
  ...range(p.highlight.length, (i) => `c:${i}`),
  ...range(p.regions?.highlight.length ?? 0, (i) => `r:${i}`),
  ...range(p.markers.length, (i) => `pin:${i}`),
];

export const map: ComponentDef<MapProps> = {
  type: 'map',
  pack: 'humanities',
  doc: 'A map (Natural Earth): an area ("world", "africa", "europe", "mena", "maghreb", "morocco", "asia", "americas", "fit" = around what is highlighted, or [lonMin, latMin, lonMax, latMax]) with highlighted countries (English Natural Earth names, e.g. "Morocco", "Egypt", "France") and markers {lon, lat, label}. regions {layer, highlight: [{region, color?, label?}]} draws the regions of a country from a layer added to the book with `warqa geo add <ISO3>` (e.g. layer "MAR-ADM1": Morocco\'s 12 regions; region = its name or ISO code such as "MA-09"). Highlights and markers appear in order unless cued; action pin {lon, lat, label?, color?} adds a marker. Parts: c:i (country i), r:i (region i), pin:i (marker i); all can be picked in a "pick" question. Maps are never mirrored. pov "morocco" (default) draws Morocco including the Sahara provinces; "un" draws Western Sahara separately.',
  props: z.object({
    area: z
      .union([
        z.enum(['fit', ...Object.keys(MAP_AREAS)] as [string, ...string[]]),
        z.tuple([z.number(), z.number(), z.number(), z.number()]),
      ])
      .default('world'),
    highlight: z
      .array(z.object({ country: z.string().min(2), color: ColorName.optional(), label: Text.optional() }))
      .max(12)
      .default([]),
    regions: z
      .object({
        layer: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/),
        highlight: z
          .array(z.object({ region: z.string().min(1), color: ColorName.optional(), label: Text.optional() }))
          .max(16)
          .default([]),
        outline: z.boolean().default(true),
      })
      .optional(),
    markers: z
      .array(
        z.object({
          lon: z.number().min(-180).max(180),
          lat: z.number().min(-90).max(90),
          label: Text.optional(),
          color: ColorName.optional(),
        }),
      )
      .max(12)
      .default([]),
    pov: z.enum(['morocco', 'un']).default('morocco'),
    caption: Text.optional(),
  }),
  defaultSlot: 'main',
  text: ['highlight.*.label', 'regions.highlight.*.label', 'markers.*.label', 'caption'],
  subs: mapParts,
  initSub: () => ({ o: 0, hl: 0 }),
  reveal: mapParts,
  pickable: mapParts,
  actions: {
    pin: {
      doc: 'Drop a marker on the map.',
      args: z.object({
        lon: z.number(),
        lat: z.number(),
        label: Text.optional(),
        color: ColorName.optional(),
        id: Id.optional(),
      }),
      text: ['label'],
      dur: 0.5,
      apply(ctx, a) {
        const s = ctx.addMark(
          (a.id as string | undefined) ?? ctx.markId('pin'),
          { kind: 'pin', ...a },
          { o: 0, s: 0.5 },
        );
        ctx.tween(s, 'o', 1, ctx.t0, ctx.dur);
        ctx.tween(s, 's', 1, ctx.t0, ctx.dur, 'back');
      },
    },
  },
  examples: [
    {
      title: 'The Maghreb',
      props: {
        area: 'maghreb',
        highlight: [
          { country: 'Morocco', color: 'coral', label: 'Morocco' },
          { country: 'Algeria', color: 'sky' },
          { country: 'Tunisia', color: 'mint' },
        ],
        markers: [{ lon: -6.84, lat: 34.02, label: 'Rabat' }],
      },
    },
  ],
};
