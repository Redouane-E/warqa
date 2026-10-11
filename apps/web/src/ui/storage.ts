// How full this browser's storage is (redesign 4h). Measured in the page, not in the worker: at start, every five
// minutes, after a job ends and after an import. Low means 85 % of the quota used, or less than 100 MB left.
import { useSyncExternalStore } from 'react';

export interface Space {
  usage: number;
  quota: number;
}

const LOW_SHARE = 0.85;
const LOW_FREE = 100 * 1024 * 1024;

export const isLow = (s: Space | null): s is Space =>
  !!s && s.quota > 0 && (s.usage / s.quota >= LOW_SHARE || s.quota - s.usage < LOW_FREE);

/** The share where the meter turns from ink to the warning colour. */
export const WARN_SHARE = LOW_SHARE;

let space: Space | null = null;
const subs = new Set<() => void>();

export async function checkSpace(): Promise<void> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.quota) space = { usage: e.usage ?? 0, quota: e.quota };
  } catch {
    /* no estimate in this browser: nothing is said */
  }
  for (const f of subs) f();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useSpace(): Space | null {
  return useSyncExternalStore(subscribe, () => space);
}

/** Start measuring (once, when the books are open). */
let timer: ReturnType<typeof setInterval> | undefined;
export function watchSpace(): void {
  if (timer) return;
  void checkSpace();
  timer = setInterval(() => void checkSpace(), 5 * 60_000);
}
