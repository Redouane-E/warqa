// Fingers on a phone (redesign phase 5): tap the picture to pause or play, swipe as if turning a page, press and
// hold a word, drag a bottom sheet. Pointer Events only, no dependency; the pure parts (what a move was, which way
// is next, where a sheet settles) are exported for the tests.

/** A tap: up within this time… */
export const TAP_MS = 300;
/** …and this far from where it went down (px). Also the slop of a press and hold. */
export const SLOP = 10;
/** A swipe: at least this far sideways (px), or 15 % of the surface, whichever is smaller… */
export const SWIPE_MIN = 48;
/** …clearly more sideways than up or down… */
export const SWIPE_RATIO = 1.5;
/** …within this time (ms). */
export const SWIPE_MS = 600;
/** Press and hold (ms). */
export const HOLD_MS = 500;
/** A sheet let go faster than this (px/ms) goes the way it was moving. */
export const FLING = 0.5;

export type Move = 'tap' | 'left' | 'right' | null;

/** What a finished pointer move was. `width`: the surface's width (the swipe threshold shrinks with it). */
export function classify(dx: number, dy: number, ms: number, width = Infinity): Move {
  const dist = Math.hypot(dx, dy);
  if (dist <= SLOP && ms <= TAP_MS) return 'tap';
  const min = Math.min(SWIPE_MIN, width * 0.15);
  if (ms <= SWIPE_MS && Math.abs(dx) >= min && Math.abs(dx) > SWIPE_RATIO * Math.abs(dy))
    return dx < 0 ? 'left' : 'right';
  return null;
}

/** A swipe turns the page: to the left is the next step in left-to-right languages, to the right in Arabic. */
export function stepOf(move: 'left' | 'right', dir: 'ltr' | 'rtl'): 1 | -1 {
  const next = dir === 'rtl' ? 'right' : 'left';
  return move === next ? 1 : -1;
}

/**
 * Where a dragged sheet settles. `heights`: its stops from low to high (0 = closed); `h`: its height when let go;
 * `v`: the speed in px/ms, positive when moving up. A fling goes to the next stop that way; otherwise the nearest
 * stop, except that below 60 % of the lowest open stop it closes.
 */
export function settle(heights: number[], h: number, v = 0): number {
  const stops = [...heights].sort((a, b) => a - b);
  if (Math.abs(v) > FLING) {
    if (v > 0) return stops.find((s) => s > h + 1) ?? stops.at(-1)!;
    return [...stops].reverse().find((s) => s < h - 1) ?? stops[0]!;
  }
  const open = stops.filter((s) => s > 0);
  if (open.length && stops[0] === 0 && h < open[0]! * 0.6) return 0;
  let best = stops[0]!;
  for (const s of stops) if (Math.abs(s - h) < Math.abs(best - h)) best = s;
  return best === 0 && open.length && h >= open[0]! * 0.6 ? open[0]! : best;
}

/** Touch or pen: the gestures are for fingers (a mouse keeps its clicks, except a tap on the stage). */
const finger = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';

export interface SurfaceGestures {
  /** A tap (a finger, or a mouse click) that should count: not on a control, a card, a part that answers. */
  tap?: (e: PointerEvent) => void;
  /** A sideways swipe: +1 next, −1 previous (already mirrored for the reading direction). */
  swipe?: (step: 1 | -1) => void;
  /** Where gestures do not apply (controls, question cards, pick targets…). */
  ignore?: (target: Element) => boolean;
  /** The reading direction now (it changes with the language). */
  dir: () => 'ltr' | 'rtl';
  /** Swipes are off (a pick question is open: touches are answers). */
  swipeOff?: () => boolean;
}

/** Tap and swipe on a surface (the stage, the caption). Returns a function that removes the listeners. */
export function onSurface(el: HTMLElement, g: SurfaceGestures): () => void {
  let start: { x: number; y: number; t: number; id: number; finger: boolean } | null = null;
  const down = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (g.ignore?.(e.target as Element)) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, finger: finger(e) };
  };
  const up = (e: PointerEvent) => {
    const s = start;
    start = null;
    if (!s || e.pointerId !== s.id) return;
    const move = classify(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t, el.clientWidth || Infinity);
    if (move === 'tap') g.tap?.(e);
    else if (move && s.finger && !g.swipeOff?.()) g.swipe?.(stepOf(move, g.dir()));
  };
  const cancel = () => {
    start = null;
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}

/**
 * Press and hold an element matching `selector` inside `el` (a finger only). `hold` gets the element; `active`
 * says whether holding means anything now (a word with a recording).
 */
export function onHold(
  el: HTMLElement,
  selector: string,
  hold: (target: HTMLElement) => void,
  active: () => boolean,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let at: { x: number; y: number; id: number } | null = null;
  // a finger was on a word lately: its long-press menu is ours (a mouse keeps its right-click menu)
  let touched = 0;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    at = null;
  };
  const down = (e: PointerEvent) => {
    if (!finger(e) || !e.isPrimary || !active()) return;
    const target = (e.target as Element).closest<HTMLElement>(selector);
    if (!target || !el.contains(target)) return;
    touched = performance.now();
    at = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = setTimeout(() => {
      at = null;
      hold(target);
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    if (at && e.pointerId === at.id && Math.hypot(e.clientX - at.x, e.clientY - at.y) > SLOP) stop();
  };
  // the browser's own long-press menu and text selection stay out of the way on the words
  const menu = (e: Event) => {
    if (performance.now() - touched < 1500 && active() && (e.target as Element).closest?.(selector)) e.preventDefault();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('contextmenu', menu);
  return () => {
    stop();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', stop);
    el.removeEventListener('pointercancel', stop);
    el.removeEventListener('contextmenu', menu);
  };
}

export interface SheetDrag {
  /** The sheet's stops now, in px from low to high (0 = closed). */
  stops: () => number[];
  /** Its height now. */
  height: () => number;
  /** While dragging: follow the finger (the sheet's height in px). */
  follow: (h: number) => void;
  /** Let go: settle at this stop (0 closes). */
  done: (h: number) => void;
  /** Whether it is a bottom sheet now (a desktop side panel is not dragged). */
  active?: () => boolean;
}

/** Drag a bottom sheet by its handle or head: it follows, then settles at a stop. Returns a remover. */
export function dragSheet(grip: HTMLElement, s: SheetDrag): () => void {
  let at: { y: number; h: number; id: number; t: number; lastY: number; lastT: number } | null = null;
  let moved = false;
  const down = (e: PointerEvent) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || s.active?.() === false) return;
    if ((e.target as Element).closest('button:not([data-grip]), a, input, select, [role="radio"], [role="switch"]'))
      return;
    const t = performance.now();
    at = { y: e.clientY, h: s.height(), id: e.pointerId, t, lastY: e.clientY, lastT: t };
    moved = false;
    grip.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!at || e.pointerId !== at.id) return;
    const dy = e.clientY - at.y;
    if (!moved && Math.abs(dy) <= SLOP) return;
    moved = true;
    const top = Math.max(...s.stops());
    s.follow(Math.max(0, Math.min(top, at.h - dy)));
    at.lastY = e.clientY;
    at.lastT = performance.now();
  };
  const up = (e: PointerEvent) => {
    if (!at || e.pointerId !== at.id) return;
    const a = at;
    at = null;
    if (!moved) return;
    const dy = e.clientY - a.y;
    const dt = Math.max(1, performance.now() - a.t);
    // speed over the whole drag, up positive
    s.done(settle(s.stops(), a.h - dy, -dy / dt));
  };
  // a drag that ends on the handle must not also count as its click
  const click = (e: MouseEvent) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  };
  const cancel = () => {
    if (at && moved) s.done(settle(s.stops(), s.height()));
    at = null;
  };
  grip.addEventListener('pointerdown', down);
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  grip.addEventListener('click', click, true);
  return () => {
    grip.removeEventListener('pointerdown', down);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', cancel);
    grip.removeEventListener('click', click, true);
  };
}
