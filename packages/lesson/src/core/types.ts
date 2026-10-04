import type * as z from 'zod';
import type { Slot } from '../schema/common.js';

/** Animatable channels of a node or of one of its parts: numbers tween, strings switch. */
export type ChValue = number | string;
export type Ch = Record<string, ChValue>;

/** A part of a node: a fixed sub-target (a token, an item, a tick) or a mark created by an action (a hop, a dot). */
export interface SubState {
  ch: Ch;
  /** Data of a mark created by an action (e.g. {kind:'hop', from:0, to:7}). */
  data?: Record<string, unknown>;
  mark?: boolean;
}

export interface NodeState {
  id: string;
  type: string;
  slot: Slot;
  props: Record<string, unknown>;
  /** Node-level channels: o (opacity), s (scale pulse), hl/hlc (highlight), c (colour), plus component channels. */
  ch: Ch;
  subs: Record<string, SubState>;
}

export interface SceneState {
  nodes: Record<string, NodeState>;
  /** Paint order. */
  order: string[];
}

export type EaseName = 'io' | 'out' | 'in' | 'back' | 'lin';

/** One channel tweening between two values. `amp` adds a bump (sin π·q) for transient effects like pulses. */
export interface Segment {
  node: string;
  sub: string;
  ch: string;
  t0: number;
  dur: number;
  from: ChValue;
  to: ChValue;
  ease: EaseName;
  amp?: number;
}

export const key = (node: string, sub: string, ch: string): string => `${node}\u0001${sub}\u0001${ch}`;

export interface ActionCtx {
  /** The targeted node as it is at this moment of the beat. */
  node: NodeState;
  /** Sub-target named in the cue ("node#sub"), if any. */
  sub: string;
  t0: number;
  dur: number;
  lang: string;
  dir: 'ltr' | 'rtl';
  /** Animate a channel of the node ("" sub) or of a sub-target / mark. */
  tween(sub: string, ch: string, to: ChValue, t0?: number, dur?: number, ease?: EaseName, amp?: number): void;
  /** Current value of a channel at this point of the compile walk. */
  get(sub: string, ch: string): ChValue | undefined;
  /** Create a mark (exists from the beat start with these channels; animate it with tween). Returns its sub name. */
  addMark(id: string, data: Record<string, unknown>, ch: Ch): string;
  /** A fresh mark id with a prefix, e.g. "hop1". */
  markId(prefix: string): string;
  error(message: string): void;
}

export interface ActionDef {
  doc: string;
  args: z.ZodType;
  /** Localizable string arguments (e.g. "label"). */
  text?: string[];
  dur?: number;
  apply(ctx: ActionCtx, args: Record<string, unknown>): void;
}

export interface ComponentExample {
  title: string;
  props: Record<string, unknown>;
  /** Cues with target "x" (the example node) to demonstrate actions. */
  cues?: { at: number; do: string; target: string; args?: Record<string, unknown> }[];
}

export type Pack = 'core' | 'stem' | 'humanities' | 'document' | 'kids' | 'custom' | (string & {});

/** Node-safe definition of a component: its props schema, LLM-facing doc, sub-targets and actions. */
export interface ComponentDef<P = Record<string, unknown>> {
  type: string;
  pack: Pack;
  /** Short LLM-facing description: what it shows and when to use it. */
  doc: string;
  props: z.ZodType<P>;
  defaultSlot: Slot;
  /** Localizable prop paths ("title", "items.*.text"). */
  text: string[];
  /** Named parts that cues can target. */
  subs(props: P): string[];
  /** Initial channels of a sub (default {o: 1}). */
  initSub?(props: P, sub: string): Ch;
  /** Subs hidden at first and revealed in order at the beat start unless a cue shows them. */
  reveal?(props: P): string[];
  /** Extra initial node channels. */
  init?(props: P): Ch;
  /** Narrowest width (stage px) the component needs to stay readable; used by layout checks. */
  minWidth?(props: P): number;
  /** Usual height (stage px) of the component; used by layout checks. */
  natHeight?(props: P): number;
  /** Parts a reader can pick in a "pick" question. */
  pickable?(props: P): string[];
  actions?: Record<string, ActionDef>;
  examples: ComponentExample[];
  /** Added by a third-party pack (always offered to the writer once the book installs it). */
  external?: boolean;
}
