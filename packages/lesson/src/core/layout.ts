// Time-aware layout: nodes in the same slot that are never on screen at the same time share one place.
// Shared by the player's layout and the generation-time layout check.
import type { CompiledBeat } from './compile.js';
import { key } from './types.js';

/** When each node is visible during a beat: [from, to] seconds (to = Infinity if still visible at the end). */
export function visibility(cb: CompiledBeat): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const id of cb.start.order) {
    if (cb.leaving.includes(id)) continue;
    const list = cb.segs.get(key(id, '', 'o')) ?? [];
    const o0 = Number(cb.start.nodes[id]?.ch.o ?? 1);
    let from = o0 > 0.01 ? 0 : Number.POSITIVE_INFINITY;
    for (const s of list) if (Number(s.to) > 0.01) from = Math.min(from, s.t0);
    const oEnd = Number(cb.out.nodes[id]?.ch.o ?? o0);
    let to = Number.POSITIVE_INFINITY;
    if (oEnd <= 0.01) {
      to = 0;
      for (const s of list) if (Number(s.to) <= 0.01) to = Math.max(to, s.t0 + s.dur);
    }
    if (from === Number.POSITIVE_INFINITY) from = to = 0; // never visible
    out.set(id, [from, to]);
  }
  return out;
}

/**
 * Group the nodes of a slot into tracks: nodes in the same track are never visible together, so they can
 * take the same place. Returns track index per node id, in first-appearance order.
 */
export function tracks(ids: string[], vis: Map<string, [number, number]>): Map<string, number> {
  const order = [...ids].sort(
    (a, b) => (vis.get(a)?.[0] ?? 0) - (vis.get(b)?.[0] ?? 0) || ids.indexOf(a) - ids.indexOf(b),
  );
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const id of order) {
    const [from, to] = vis.get(id) ?? [0, Number.POSITIVE_INFINITY];
    // a cross-fade (one node fading out while the next fades in) can share the place
    let t = ends.findIndex((e) => e <= from + 0.6);
    if (t < 0) {
      t = ends.length;
      ends.push(to);
    } else ends[t] = to;
    out.set(id, t);
  }
  // keep the authored order of tracks (first node of each track) for placement
  return out;
}

/** Are two nodes on screen at the same time (beyond a cross-fade)? */
export const together = (a: [number, number] | undefined, b: [number, number] | undefined): boolean =>
  !!a && !!b && a[0] < b[1] - 0.6 && b[0] < a[1] - 0.6;
