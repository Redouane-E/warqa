import type { ChValue, NodeState } from '../../core/types.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Get = (sub: string, ch: string) => ChValue | undefined;

export interface ViewCtx {
  node: NodeState;
  /** SVG group for drawings (stage coordinates). */
  g: SVGGElement;
  /** HTML container positioned over the node's box (stage coordinates). */
  div: HTMLDivElement;
  lang: string;
  dir: 'ltr' | 'rtl';
  /** Format a number for display (digits per book settings, true minus). */
  fmt(n: number): string;
  /** Resolve an asset path relative to the book. */
  asset(path: string): string;
  /** Typeset math (SVG markup) for a TeX source, when the export provided it. */
  math?(tex: string): string | undefined;
  /** The beat being shown (narration, caption and word times, for read-along). */
  beat?: {
    narration: string;
    captions: [number, string][];
    /** Word times [seconds, start, end] with offsets into the spoken text of the narration. */
    words?: [number, number, number][];
    dur?: number;
  };
}

export interface View {
  /** Natural size within a maximum width/height. */
  size(maxW: number, maxH: number): { w: number; h: number };
  /** Lay out inside a box (called once per beat). */
  place(box: Box): void;
  /** Apply channel values. */
  update(get: Get, t: number): void;
  /** Stage box of a part (for pick questions and highlights). */
  part?(sub: string): Box | null;
}

export type ViewFactory = (ctx: ViewCtx) => View;
