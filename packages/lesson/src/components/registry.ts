import type { ComponentDef } from '../core/types.js';
import { callout, compare, definition, flow, image, keyfigures, list, table, text, title, widget } from './core.js';
import { conceptmap, map, timeline } from './humanities.js';
import { areagrid, balance, fractionbar, storypage } from './more.js';
import { barchart, counters, equation, math, numberline, plane, vscale } from './stem.js';

/** Every built-in component. Third-party packs can add more with registerComponent(). */
export const COMPONENTS: Record<string, ComponentDef<any>> = {};

export function registerComponent(def: ComponentDef<any>): void {
  if (COMPONENTS[def.type]) throw new Error(`component "${def.type}" is already registered`);
  COMPONENTS[def.type] = def;
}

for (const def of [
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
  equation,
  math,
  numberline,
  counters,
  vscale,
  barchart,
  plane,
  fractionbar,
  areagrid,
  balance,
  timeline,
  conceptmap,
  map,
  storypage,
  widget,
]) {
  registerComponent(def);
}

export const componentDef = (type: string): ComponentDef<any> | undefined => COMPONENTS[type];

// Narrowest readable widths (stage px), used by the generation-time layout check.
const MIN_WIDTH: Record<string, (p: any) => number> = {
  title: () => 600,
  list: () => 560,
  definition: () => 480,
  callout: () => 420,
  compare: () => 880,
  table: (p) => 130 * p.columns.length,
  flow: (p) => (p.direction === 'column' ? 260 : 190 * p.steps.length),
  keyfigures: (p) => 280 * p.items.length,
  timeline: (p) => 170 * p.events.length,
  conceptmap: () => 700,
  numberline: (p) => Math.min(1440, 34 * (Math.round((p.max - p.min) / (p.step || 1)) + 2)),
  counters: (p) => 70 * Math.min(p.count, p.perRow ?? 10),
  vscale: () => 420,
  barchart: (p) => 110 * p.bars.length + 80,
  plane: () => 320,
  fractionbar: () => 520,
  areagrid: (p) => 28 * p.cols + 60,
  balance: () => 760,
  storypage: () => 900,
  map: () => 560,
  equation: (p) => {
    const size = ({ sm: 40, md: 52, lg: 66, xl: 84 } as Record<string, number>)[p.size ?? 'lg'] ?? 66;
    const len = (st: unknown[] | string) =>
      typeof st === 'string'
        ? st.replace(/\\[a-z]+|[{}^_]/gi, '').length
        : st.reduce<number>(
            (a, t) => a + String(typeof t === 'string' ? t : ((t as { t?: string }).t ?? '')).length,
            0,
          );
    return Math.max(...(p.steps as unknown[][]).map(len)) * size * 0.5 * 0.6; // can shrink to 60 % and stay readable
  },
};
for (const [type, f] of Object.entries(MIN_WIDTH)) {
  const def = COMPONENTS[type];
  if (def && !def.minWidth) def.minWidth = f;
}

// Usual heights (stage px), used to check that nodes stacked in a slot fit.
const NAT_HEIGHT: Record<string, (p: any) => number> = {
  title: (p) => 220 + 70 * (p.lines?.length ?? 0),
  text: (p) => (p.size === 'xl' ? 90 : p.size === 'lg' ? 70 : 55) * Math.ceil(String(p.text).length / 70),
  list: (p) => 95 * p.items.length,
  definition: (p) => (p.example ? 190 : 140),
  callout: () => 110,
  compare: (p) => 90 + 50 * Math.max(p.left.items.length, p.right.items.length),
  table: (p) => 70 + 55 * p.rows.length,
  flow: (p) => (p.direction === 'column' ? 95 * p.steps.length : 120),
  keyfigures: () => 200,
  timeline: () => 220,
  conceptmap: (p) => 130 * Math.min(4, Math.ceil(p.nodes.length / 3)) + 40,
  numberline: () => 230,
  counters: (p) => 70 * Math.ceil(p.count / (p.perRow ?? 10)),
  vscale: () => 460,
  barchart: () => 420,
  plane: () => 560,
  fractionbar: (p) => 98 * p.bars.length,
  areagrid: (p) => Math.min(p.rows * (p.unit ?? 46), 480) + 60,
  balance: () => 400,
  image: () => 420,
  storypage: () => 820,
  map: () => 480,
  equation: (p) =>
    (({ sm: 40, md: 52, lg: 66, xl: 84 }) as Record<string, number>)[p.size ?? 'lg']! * 1.4 +
    (JSON.stringify(p.steps).includes('"note"') ? 60 : 0),
};
for (const [type, f] of Object.entries(NAT_HEIGHT)) {
  const def = COMPONENTS[type];
  if (def && !def.natHeight) def.natHeight = f;
}
