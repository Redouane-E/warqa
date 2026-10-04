// Read PDFs with pdf.js in Node: text blocks in reading order (right-to-left aware), a text-layer quality
// verdict per page, figure regions, the bookmark outline, and page/region rendering to PNG (@napi-rs/canvas).
// Outside Node (a browser tab or a Web Worker) the host sets a PdfPlatform first: see setPdfPlatform.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { arabicTextQuality, hasArabic, normalizePresentationForms, unreverseArabicLine } from '@warqa/i18n';
import type { PageViewport, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectLang, headingKind, isCaption, isMathLike, isTocLine, listMarker, scriptCounts } from './classify.js';
import type { Block, BlockKind, OutlineItem, PageInfo } from './document.js';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type PdfDocument = PDFDocumentProxy;
export type BBox = [number, number, number, number];

const require = createRequire(import.meta.url);
// A variable specifier: the worker has no type declarations, and we only hand it to pdf.js.
const WORKER_MODULE = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
let lib: Promise<Pdfjs> | undefined;

/** A canvas to render a page on, and its PNG encoder. */
export interface PdfCanvas {
  /** Handed to pdf.js's page.render({ canvas }) (an OffscreenCanvas in a browser). */
  canvas: unknown;
  png(): Promise<Uint8Array>;
}

/**
 * How pdf.js runs on this host. Node needs none of it (the defaults: @napi-rs/canvas, the installed pdfjs-dist
 * folders, the worker code loaded from pdfjs-dist). A browser or Web Worker provides its own.
 */
export interface PdfPlatform {
  /** Load pdf.js's worker module, which then runs on this thread (default: import it from pdfjs-dist). */
  loadWorker?: () => Promise<unknown>;
  /** URL of a folder holding pdfjs-dist's cmaps/, standard_fonts/, wasm/ and iccs/ (with a trailing slash). */
  assets?: string;
  /** Extra getDocument() parameters (CanvasFactory, FilterFactory, useWorkerFetch…), applied last. */
  documentParams?: Record<string, unknown>;
  /** A canvas for page rendering (default: @napi-rs/canvas). */
  createCanvas?: (width: number, height: number) => PdfCanvas;
}

let platform: PdfPlatform = {};

/** Set how pdf.js runs here, before the first PDF is opened (browsers and Web Workers; Node needs nothing). */
export function setPdfPlatform(p: PdfPlatform): void {
  platform = { ...p };
}

/** pdf.js, loaded on first use (it is large). */
function pdfjs(): Promise<Pdfjs> {
  lib ??= (async () => {
    // Node has no Web Workers, so pdf.js runs its worker code on the main thread. Handing it the module up front
    // replaces its relative `import('./pdf.worker.mjs')`, which breaks once the CLI is bundled.
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= await (platform.loadWorker ? platform.loadWorker() : import(WORKER_MODULE));
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return lib;
}

/** Folder of the installed pdfjs-dist (CMaps, standard fonts, wasm decoders), with the trailing slash pdf.js wants. */
function asset(sub: string): string {
  if (platform.assets) return `${platform.assets.replace(/\/*$/, '/')}${sub}/`;
  return `${join(dirname(require.resolve('pdfjs-dist/package.json')), sub)}/`;
}

function makeCanvas(width: number, height: number): PdfCanvas {
  if (platform.createCanvas) return platform.createCanvas(width, height);
  const canvas = createCanvas(width, height);
  return { canvas, png: async () => new Uint8Array(await canvas.encode('png')) };
}

/** Open a PDF from a path or bytes. The caller owns the document: `closePdf(pdf)` when done. */
export async function openPdf(file: string | Uint8Array, opts: { password?: string } = {}): Promise<PdfDocument> {
  const { getDocument, VerbosityLevel } = await pdfjs();
  // pdf.js may transfer (detach) the buffer it is given, so it always gets its own copy.
  const data = typeof file === 'string' ? new Uint8Array(readFileSync(file)) : file.slice();
  return getDocument({
    data,
    ...(opts.password ? { password: opts.password } : {}),
    disableFontFace: true,
    useSystemFonts: false,
    // Font names (e.g. "ABCDEF+Font-Bold") are only exported with this flag; they tell us which lines are bold.
    fontExtraProperties: true,
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
    verbosity: VerbosityLevel.ERRORS,
    ...platform.documentParams,
  }).promise;
}

/** Release a document opened with openPdf (its parsed data and the in-process worker state). */
export const closePdf = (pdf: PdfDocument): Promise<void> => pdf.loadingTask.destroy();

/* ---------------------------------------------------------------------------------------------------------- */
/* Text pieces and lines                                                                                       */
/* ---------------------------------------------------------------------------------------------------------- */

interface TextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

/** One pdf.js text item, positioned in top-left page coordinates. */
interface Piece {
  str: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Baseline (y, top-left origin). */
  base: number;
  size: number;
  bold: boolean;
  /** Whitespace only: a word gap pdf.js saw. */
  ws: boolean;
}

interface Line {
  pieces: Piece[];
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  base: number;
  size: number;
  bold: boolean;
  rtl: boolean;
}

const ARABIC_RUN_G = /[ؐ-ؚؠ-ٟٮ-ۓە-ۯۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]+/g;
const MARKS_ONLY = /^[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿ]+$/;
// NUL and other C0 controls: glyphs the PDF's ToUnicode map does not cover (lost letters).
const isControl = (c: number) => c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d;
const replaceControls = (s: string, by: string) => [...s].map((ch) => (isControl(ch.charCodeAt(0)) ? by : ch)).join('');
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const BOLD_FONT = /bold|black|heavy|semibold|demibold|demi\b|extrabold|ultrabold|[-,]bd\b|w[6-9]\b/i;
// Symbol and Wingdings fonts map into the private use area on purpose (Word bullets, the pieces of tall equation
// brackets); a few of those are symbols, not a broken text layer.
const SYMBOL_PUA_G = /[\uf000-\uf0ff\uf8e5-\uf8ff]/g;
const PUA_BULLETS_G = /[\uf06c\uf06e\uf076\uf0a7\uf0a8\uf0b7\uf0d8\uf0fc]/g;
const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
};
const mirror = (s: string) => s.replace(/[()[\]{}<>«»]/g, (c) => MIRROR[c] ?? c);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Median weighted by character count: the body text size of a set of lines or blocks. */
export function weightedMedian(values: { value: number; weight: number }[]): number {
  const s = values.filter((v) => v.weight > 0 && v.value > 0).sort((a, b) => a.value - b.value);
  const total = s.reduce((a, v) => a + v.weight, 0);
  let acc = 0;
  for (const v of s) {
    acc += v.weight;
    if (acc >= total / 2) return v.value;
  }
  return 0;
}

function toPiece(
  lib: Pdfjs,
  it: TextItem,
  styles: Record<string, { ascent?: number; descent?: number }>,
  vp: PageViewport,
  bold: boolean,
): Piece | undefined {
  // Text matrix in viewport space: origin top-left, y down, page rotation applied.
  const m = lib.Util.transform(vp.transform, it.transform) as number[];
  const size = Math.hypot(m[2]!, m[3]!) || Math.hypot(m[0]!, m[1]!);
  if (!size || !it.str) return undefined;
  const st = styles[it.fontName];
  const ascent = st?.ascent && st.ascent > 0 ? st.ascent : 0.8;
  const descent = st?.descent && st.descent < 0 ? st.descent : -0.2;
  const x = m[4]!;
  const base = m[5]!;
  const upright = m[0]! >= 0;
  const x0 = upright ? x : x - it.width;
  return {
    str: it.str,
    x0,
    x1: x0 + Math.max(it.width, 0),
    y0: base - ascent * size,
    y1: base - descent * size,
    base,
    size,
    bold,
    ws: !it.str.trim(),
  };
}

/**
 * pdf.js reverses right-to-left runs character by character, which also flips glyphs that stand for several
 * characters (ligatures such as لأ, لا, لم: "الأعداد" comes out as "األعداد"). The operator list still has the
 * glyphs in drawing order, so each Arabic word is looked up there and rebuilt glyph by glyph.
 */
function ligatureFixer(
  lib: Pdfjs,
  ops: { fnArray: number[]; argsArray: unknown[][] },
): ((s: string) => string) | undefined {
  let text = '';
  const starts = new Set<number>();
  let ligatures = false;
  const showText = new Set([lib.OPS.showText, lib.OPS.showSpacedText]);
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (!showText.has(ops.fnArray[i]!)) continue;
    const glyphs = ops.argsArray[i]?.[0];
    if (!Array.isArray(glyphs)) continue;
    for (const g of glyphs) {
      const u = g && typeof g === 'object' && 'unicode' in g ? lib.normalizeUnicode(String(g.unicode)) : '';
      starts.add(text.length);
      if (!u.trim()) {
        text += '\u0001'; // word break: matches never span it
        continue;
      }
      text += u;
      if (u.length > 1 && hasArabic(u)) ligatures = true;
    }
    // No break between operators: producers that position glyphs one by one (Chromium) split words across them.
  }
  if (!ligatures) return undefined;
  starts.add(text.length);
  return (s) =>
    s.replace(ARABIC_RUN_G, (run) => {
      if (run.length < 2) return run;
      const visual = [...run].reverse().join('');
      for (let at = text.indexOf(visual); at >= 0; at = text.indexOf(visual, at + 1)) {
        const end = at + visual.length;
        if (!starts.has(at) || !starts.has(end)) continue;
        const glyphs: string[] = [];
        let from = at;
        for (let k = at + 1; k <= end; k++) {
          if (starts.has(k)) {
            glyphs.push(text.slice(from, k));
            from = k;
          }
        }
        return glyphs.reverse().join('');
      }
      return run;
    });
}

/** Font ids whose PostScript name says bold (only known after the operator list has loaded the fonts). */
function boldFonts(page: PDFPageProxy, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    try {
      if (!page.commonObjs.has(id)) continue;
      const font = page.commonObjs.get(id) as { name?: string; bold?: boolean; black?: boolean } | null;
      if (font && (font.bold || font.black || BOLD_FONT.test(font.name ?? ''))) out.add(id);
    } catch {
      // not resolved: treat as regular
    }
  }
  return out;
}

/** Group pieces into rows by baseline, then split rows at wide horizontal gaps (columns, table cells). */
function buildRows(pieces: Piece[]): Piece[][] {
  const sorted = [...pieces].sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rows: Piece[][] = [];
  let row: Piece[] = [];
  let anchor: Piece | undefined;
  for (const p of sorted) {
    // Superscripts and subscripts sit within ~0.4 em of the baseline and join their line.
    if (anchor && Math.abs(p.base - anchor.base) <= 0.45 * Math.max(p.size, anchor.size)) {
      row.push(p);
      if (!p.ws && p.size * p.str.length > anchor.size * anchor.str.length) anchor = p;
      continue;
    }
    if (row.length) rows.push(row);
    row = [p];
    anchor = p;
  }
  if (row.length) rows.push(row);

  const out: Piece[][] = [];
  for (const r of rows) {
    attachMarks(r);
    const byX = r.filter((p) => p.str).sort((a, b) => a.x0 - b.x0);
    let frag: Piece[] = [];
    let right = -Infinity;
    for (const p of byX) {
      if (!p.ws && frag.some((q) => !q.ws) && p.x0 - right > 2 * Math.max(p.size, 6)) {
        out.push(frag);
        frag = [];
        right = -Infinity;
      }
      frag.push(p);
      if (!p.ws) right = Math.max(right, p.x1);
    }
    if (frag.some((q) => !q.ws)) out.push(frag);
  }
  return out;
}

/**
 * Some producers draw Arabic diacritics (tashkeel) as separate zero-width items. Put each one back into the word
 * it sits on, after the letter under it, instead of letting it float between words.
 */
function attachMarks(row: Piece[]): void {
  for (const m of row) {
    if (!MARKS_ONLY.test(m.str)) continue;
    const cx = m.x0 + (m.x1 - m.x0) / 2;
    const base = row.find((p) => p !== m && !p.ws && !MARKS_ONLY.test(p.str) && p.x0 - 0.5 <= cx && cx <= p.x1 + 0.5);
    if (base) {
      const chars = [...base.str];
      // Letter index under the mark: counted from the right in Arabic words.
      const frac = base.x1 > base.x0 ? (hasArabic(base.str) ? base.x1 - cx : cx - base.x0) / (base.x1 - base.x0) : 1;
      let k = Math.min(chars.length - 1, Math.max(0, Math.floor(frac * chars.length)));
      while (k + 1 < chars.length && MARKS_ONLY.test(chars[k + 1]!)) k++;
      chars.splice(k + 1, 0, m.str);
      base.str = chars.join('');
    }
    m.str = ''; // dropped when it has no letter under it
  }
}

type Bidi = 'R' | 'L' | 'EN' | 'N';
const bidiClass = (s: string): Bidi => {
  const { arabic, latin } = scriptCounts(s);
  if (arabic) return 'R';
  if (latin) return 'L';
  return /[0-9٠-٩۰-۹]/.test(s) ? 'EN' : 'N';
};

/** Reverse a neutral/number item that sits in a right-to-left run: digit groups stay as they are, the rest flips. */
function flipWeak(s: string): string {
  const parts = s.match(/[0-9٠-٩۰-۹]+(?:[.,:/٫٬][0-9٠-٩۰-۹]+)*|[\s\S]/g) ?? [];
  return parts
    .reverse()
    .map((p) => mirror(p))
    .join('');
}

/**
 * Put a line's pieces in reading order. Items arrive in drawing order; on a right-to-left line the visual order
 * is reversed (an approximation of the inverse Unicode bidi algorithm): Latin runs keep their left-to-right
 * order, numbers and punctuation between Arabic words are re-ordered digit group by digit group, and brackets
 * are mirrored. On a left-to-right line, embedded Arabic runs of several items are reversed.
 */
function logicalOrder(visual: Piece[], rtl: boolean): Piece[] {
  const cls = visual.map((p) => (p.ws ? 'N' : bidiClass(p.str)));
  if (!rtl) {
    const out = [...visual];
    for (let i = 0; i < out.length; i++) {
      if (cls[i] !== 'R') continue;
      let j = i;
      for (let k = i + 1; k < out.length && cls[k] !== 'L'; k++) if (cls[k] === 'R') j = k;
      if (j > i) {
        const run = out.slice(i, j + 1).reverse();
        out.splice(i, run.length, ...run);
      }
      i = j;
    }
    return out;
  }
  // Latin runs: from a Latin piece to the last Latin piece (or a number right after one) before Arabic resumes.
  const units: Piece[][] = [];
  for (let i = 0; i < visual.length; i++) {
    if (cls[i] !== 'L') {
      units.push([visual[i]!]);
      continue;
    }
    let j = i;
    for (let k = i + 1; k < visual.length && cls[k] !== 'R'; k++) {
      if (cls[k] === 'L') j = k;
      else if (cls[k] === 'EN' && cls.slice(j + 1, k).every((c) => c === 'N')) j = k;
    }
    units.push(visual.slice(i, j + 1));
    i = j;
  }
  units.reverse();
  return units.flatMap((u) => {
    if (u.length > 1 || cls[visual.indexOf(u[0]!)] === 'L') return u;
    const p = u[0]!;
    if (p.ws) return u;
    const c = bidiClass(p.str);
    return [{ ...p, str: c === 'R' ? mirror(p.str) : flipWeak(p.str) }];
  });
}

function makeLine(pieces: Piece[]): Line {
  const visual = [...pieces].sort((a, b) => a.x0 - b.x0);
  const all = visual.map((p) => p.str).join('');
  const { arabic, latin } = scriptCounts(all);
  const rtl = arabic > latin;
  let text = '';
  let prev: Piece | undefined;
  let space = false;
  for (const p of logicalOrder(visual, rtl)) {
    if (p.ws) {
      space = true;
      continue;
    }
    if (prev && text && !/\s$/.test(text) && !/^\s/.test(p.str)) {
      const gap = Math.max(p.x0 - prev.x1, prev.x0 - p.x1);
      if (space || gap > 0.25 * Math.min(p.size, prev.size)) text += ' ';
    }
    text += p.str;
    prev = p;
    space = false;
  }
  const solid = pieces.filter((p) => !p.ws);
  const weights = solid.map((p) => ({ value: p.size, weight: p.str.length }));
  return {
    pieces,
    text: text.replace(/\s+/g, ' ').trim(),
    x0: Math.min(...solid.map((p) => p.x0)),
    x1: Math.max(...solid.map((p) => p.x1)),
    y0: Math.min(...solid.map((p) => p.y0)),
    y1: Math.max(...solid.map((p) => p.y1)),
    base: median(solid.map((p) => p.base)),
    size: weightedMedian(weights) || solid[0]!.size,
    bold: solid.every((p) => p.bold),
    rtl,
  };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* Blocks                                                                                                      */
/* ---------------------------------------------------------------------------------------------------------- */

interface Draft {
  lines: Line[];
  kind?: BlockKind;
  bbox: BBox;
}

/** Typical baseline pitch as a multiple of font size, from consecutive lines of the same column and size. */
function leading(lines: Line[]): number {
  const ratios: number[] = [];
  const sorted = [...lines].sort((a, b) => a.base - b.base);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 0) continue;
    if (Math.abs(a.size - b.size) > 0.15 * a.size) continue;
    const r = (b.base - a.base) / a.size;
    if (r >= 0.9 && r <= 3) ratios.push(Math.round(r * 20) / 20);
  }
  if (!ratios.length) return 1.5;
  // The smallest pitch that occurs at least twice is the in-paragraph leading; larger ones are paragraph gaps.
  const seen = new Map<number, number>();
  for (const r of ratios) seen.set(r, (seen.get(r) ?? 0) + 1);
  const repeated = [...seen].filter(([, n]) => n >= 2).map(([r]) => r);
  return Math.min(2.2, Math.max(1, repeated.length ? Math.min(...repeated) : Math.min(...ratios)));
}

const startsOwnBlock = (l: Line) => !!listMarker(l.text) || isCaption(l.text) || isMathLike(l.text);

function groupBlocks(lines: Line[]): Draft[] {
  const lead = leading(lines);
  const sorted = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const drafts: Draft[] = [];
  for (const l of sorted) {
    let best: Draft | undefined;
    let bestGap = Infinity;
    if (!startsOwnBlock(l)) {
      for (const d of drafts) {
        const last = d.lines.at(-1)!;
        const pitch = l.base - last.base;
        if (pitch <= 0 || pitch > lead * 1.3 * Math.max(l.size, last.size)) continue;
        if (Math.abs(l.size - last.size) > 0.15 * Math.max(l.size, last.size)) continue;
        if (l.bold !== last.bold && (l.text.length < 120 || last.text.length < 120)) continue;
        if (Math.min(l.x1, d.bbox[2]) - Math.max(l.x0, d.bbox[0]) <= 0) continue;
        if (isMathLike(last.text) && !listMarker(d.lines[0]!.text)) continue;
        if (pitch < bestGap) {
          best = d;
          bestGap = pitch;
        }
      }
    }
    if (best) {
      best.lines.push(l);
      best.bbox = [
        Math.min(best.bbox[0], l.x0),
        Math.min(best.bbox[1], l.y0),
        Math.max(best.bbox[2], l.x1),
        Math.max(best.bbox[3], l.y1),
      ];
    } else drafts.push({ lines: [l], bbox: [l.x0, l.y0, l.x1, l.y1] });
  }
  return drafts;
}

function joinLines(lines: Line[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l.text;
    // A hyphen at a line end stays (we cannot tell "well-known" from a split word) but gets no space after it.
    else if (/[A-Za-zÀ-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(l.text)) out += l.text;
    else out += ` ${l.text}`;
  }
  return out;
}

/** Recursive XY-cut: split at the widest clean horizontal or vertical gap; columns read right to left on RTL pages. */
export function readingOrder<T extends { bbox: BBox }>(items: T[], rtl: boolean): T[] {
  if (items.length <= 1) return items;
  const cut = (axis: 0 | 1) => {
    const lo = axis === 1 ? 1 : 0;
    const hi = axis === 1 ? 3 : 2;
    const sorted = [...items].sort((a, b) => a.bbox[lo] - b.bbox[lo]);
    let reach = sorted[0]!.bbox[hi];
    let best = { gap: -Infinity, at: -1 };
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]!.bbox[lo] - reach;
      if (gap > -0.5 && gap > best.gap) best = { gap, at: i };
      reach = Math.max(reach, sorted[i]!.bbox[hi]);
    }
    return { ...best, sorted };
  };
  const h = cut(1);
  const v = cut(0);
  if (h.at > 0 && (v.at < 0 || h.gap >= v.gap)) {
    return [...readingOrder(h.sorted.slice(0, h.at), rtl), ...readingOrder(h.sorted.slice(h.at), rtl)];
  }
  if (v.at > 0) {
    const left = readingOrder(v.sorted.slice(0, v.at), rtl);
    const right = readingOrder(v.sorted.slice(v.at), rtl);
    return rtl ? [...right, ...left] : [...left, ...right];
  }
  return [...items].sort((a, b) => a.bbox[1] - b.bbox[1] || (rtl ? b.bbox[0] - a.bbox[0] : a.bbox[0] - b.bbox[0]));
}

/** Blocks whose lines are all set in a bold font (kept outside the schema, for the document-wide heading pass). */
const boldBlocks = new WeakSet<Block>();

/**
 * Decide block kinds from text and size. Headings: noticeably larger than the body text (≥ 1.25×), or bold and
 * short, or a short "Chapter 3" / "الدرس الأول" line; levels follow distinct heading sizes (largest = 1).
 * Used per page by extractPage and again over the whole document (with the document's body size) by ingestPdf.
 */
export function classifyBlocks(
  blocks: Block[],
  bodySize: number,
  bold: (b: Block) => boolean = (b) => boldBlocks.has(b),
): void {
  const headings: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'figure' || b.kind === 'table' || !b.text) continue;
    const text = b.text;
    const size = b.size ?? bodySize;
    const ratio = bodySize ? size / bodySize : 1;
    const short = text.length <= 160 && !isTocLine(text);
    let kind: BlockKind = 'paragraph';
    if (isCaption(text)) kind = 'caption';
    else if (listMarker(text) && !(ratio >= 1.25 && short && headingKind(text))) kind = 'list';
    else if (isMathLike(text)) kind = 'equation';
    else if (short && ratio >= 1.25) kind = 'heading';
    else if (short && text.length <= 100 && bold(b) && ratio >= 0.95 && !/[.!?؟:،,;]$/.test(text)) kind = 'heading';
    else if (text.length <= 80 && ratio >= 0.95 && (headingKind(text) === 'chapter' || headingKind(text) === 'unit'))
      kind = 'heading';
    b.kind = kind;
    if (kind === 'heading') headings.push(b);
    else delete b.level;
  }
  const sizes = [...new Set(headings.map((b) => Math.round((b.size ?? bodySize) * 2) / 2))].sort((a, b) => b - a);
  for (const b of headings) b.level = Math.min(6, sizes.indexOf(Math.round((b.size ?? bodySize) * 2) / 2) + 1);
}

/* ---------------------------------------------------------------------------------------------------------- */
/* Figures                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** Raster images drawn on the page (bbox in top-left points), merged when they overlap. Vector drawings are not found. */
function findImages(lib: Pdfjs, ops: { fnArray: number[]; argsArray: unknown[][] }, vp: PageViewport): BBox[] {
  const { OPS, Util } = lib;
  const paint = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
  ]);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const boxes: BBox[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && args) ctm = Util.transform(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0];
      if (Array.isArray(m) && m.length === 6) ctm = Util.transform(ctm, m as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn !== undefined && paint.has(fn)) {
      const m = Util.transform(vp.transform, ctm);
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => {
        const p = [x!, y!];
        Util.applyTransform(p, m); // in place
        return p;
      });
      const xs = pts.map((p) => p[0]!);
      const ys = pts.map((p) => p[1]!);
      boxes.push([
        Math.max(0, Math.min(...xs)),
        Math.max(0, Math.min(...ys)),
        Math.min(vp.width, Math.max(...xs)),
        Math.min(vp.height, Math.max(...ys)),
      ]);
    }
  }
  // Merge overlapping or touching tiles into one figure.
  const merged: BBox[] = [];
  for (const b of boxes.filter((b) => b[2] - b[0] >= 1 && b[3] - b[1] >= 1)) {
    const hit = merged.find((m) => b[0] <= m[2] + 2 && m[0] <= b[2] + 2 && b[1] <= m[3] + 2 && m[1] <= b[3] + 2);
    if (hit) {
      hit[0] = Math.min(hit[0], b[0]);
      hit[1] = Math.min(hit[1], b[1]);
      hit[2] = Math.max(hit[2], b[2]);
      hit[3] = Math.max(hit[3], b[3]);
    } else merged.push([...b]);
  }
  return merged;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* Pages                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------- */

export interface ExtractOptions {
  /** Body text size of the document (points); defaults to this page's own median. */
  bodySize?: number;
  /** Find raster figures (needs the page's operator list). Default true. */
  figures?: boolean;
}

export interface ExtractedPage {
  info: PageInfo;
  blocks: Block[];
}

const r1 = (b: BBox): BBox => [round1(b[0]), round1(b[1]), round1(b[2]), round1(b[3])];

/** Text blocks (and figure regions) of one page in reading order, with the page's text-layer verdict. */
export async function extractPage(pdf: PdfDocument, n: number, opts: ExtractOptions = {}): Promise<ExtractedPage> {
  const lib = await pdfjs();
  const page = await pdf.getPage(n);
  try {
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.filter((it): it is TextItem => 'str' in it);
    const raw = items.map((it) => it.str).join(' ');
    const arabic = hasArabic(raw);
    const ops = opts.figures !== false || arabic ? await page.getOperatorList() : undefined;
    const fix = ops && arabic ? ligatureFixer(lib, ops) : undefined;
    const bold = ops ? boldFonts(page, new Set(items.map((it) => it.fontName))) : new Set<string>();

    const pieces: Piece[] = [];
    for (const it of items) {
      const p = toPiece(
        lib,
        it,
        content.styles as Record<string, { ascent?: number; descent?: number }>,
        vp,
        bold.has(it.fontName),
      );
      if (!p) continue;
      if (fix && !p.ws) p.str = fix(p.str);
      pieces.push(p);
    }

    const symbols = pieces.reduce((a, p) => a + (p.str.match(SYMBOL_PUA_G)?.length ?? 0), 0);
    const total = pieces.reduce((a, p) => a + p.str.replace(/\s+/g, '').length, 0);
    if (symbols && symbols <= 0.1 * total) {
      for (const p of pieces) p.str = p.str.replace(PUA_BULLETS_G, '•').replace(SYMBOL_PUA_G, '');
    }
    // Verdict on the text as the PDF gives it (ligatures already rebuilt); missing glyph mappings count as broken.
    const layer = pieces.map((p) => p.str).join(' ');
    const chars = layer.replace(/\s+/g, '').length;
    const quality: PageInfo['quality'] =
      chars < 20 ? 'empty' : arabicTextQuality(replaceControls(layer, REPLACEMENT_CHAR)).verdict;
    for (const p of pieces) p.str = replaceControls(p.str, '');

    let lines = buildRows(pieces.filter((p) => p.str))
      .map(makeLine)
      .filter((l) => l.text);
    if (quality === 'reversed') lines = lines.map((l) => (hasArabic(l.text) ? { ...l, text: betterOrder(l.text) } : l));
    for (const l of lines) l.text = normalizePresentationForms(l.text).normalize('NFC');

    const drafts = groupBlocks(lines);
    const pageW = vp.width;
    const pageH = vp.height;
    if (ops && opts.figures !== false) {
      for (const box of findImages(lib, ops, vp)) {
        const w = box[2] - box[0];
        const h = box[3] - box[1];
        // Icons and rules are not figures; a page-sized image is a scan or a background.
        if (w < 24 || h < 24 || (w * h) / (pageW * pageH) > 0.8) continue;
        drafts.push({ lines: [], kind: 'figure', bbox: box });
      }
    }
    const { arabic: ar, latin } = scriptCounts(lines.map((l) => l.text).join(' '));
    const ordered = readingOrder(drafts, ar > latin);

    const blocks: Block[] = ordered.map((d, i) => {
      const text = d.kind === 'figure' ? '' : joinLines(d.lines);
      const size = weightedMedian(d.lines.map((l) => ({ value: l.size, weight: l.text.length })));
      const lang = detectLang(text);
      return {
        id: `p${n}b${i + 1}`,
        page: n,
        kind: d.kind ?? 'paragraph',
        text,
        bbox: r1(d.bbox),
        ...(lang ? { lang } : {}),
        ...(size ? { size: round1(size) } : {}),
      };
    });
    ordered.forEach((d, i) => {
      if (d.lines.length && d.lines.every((l) => l.bold)) boldBlocks.add(blocks[i]!);
    });
    const body = opts.bodySize ?? weightedMedian(lines.map((l) => ({ value: l.size, weight: l.text.length })));
    classifyBlocks(blocks, body);

    const info: PageInfo = {
      n,
      width: round1(pageW),
      height: round1(pageH),
      method: 'text',
      quality,
      chars,
      ...(pageLang(blocks) ? { lang: pageLang(blocks)! } : {}),
    };
    return { info, blocks };
  } finally {
    page.cleanup();
  }
}

/** Visually ordered Arabic: un-reverse the line, but keep whichever reading has more real Arabic words. */
function betterOrder(text: string): string {
  const score = (s: string) => {
    const q = arabicTextQuality(s);
    return q.forwardHits + q.forwardArticle - q.reversedHits - q.reversedArticle;
  };
  const fixed = unreverseArabicLine(text);
  return score(fixed) > score(text) ? fixed : text;
}

/** Dominant language of some blocks, weighted by text length. */
export function pageLang(blocks: Pick<Block, 'text' | 'lang'>[]): string | undefined {
  const w = new Map<string, number>();
  for (const b of blocks) if (b.lang) w.set(b.lang, (w.get(b.lang) ?? 0) + b.text.length);
  return [...w].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* Rendering                                                                                                   */
/* ---------------------------------------------------------------------------------------------------------- */

async function withPdf<T>(src: PdfDocument | string | Uint8Array, fn: (pdf: PdfDocument) => Promise<T>): Promise<T> {
  if (typeof src !== 'string' && !(src instanceof Uint8Array)) return fn(src);
  const pdf = await openPdf(src);
  try {
    return await fn(pdf);
  } finally {
    await closePdf(pdf);
  }
}

async function renderArea(pdf: PdfDocument, n: number, scale: number, area?: BBox): Promise<Uint8Array> {
  const page = await pdf.getPage(n);
  try {
    const vp = page.getViewport({ scale });
    const [x0, y0, x1, y1] = area ?? [0, 0, vp.width / scale, vp.height / scale];
    const w = Math.max(1, Math.ceil((x1 - x0) * scale));
    const h = Math.max(1, Math.ceil((y1 - y0) * scale));
    const target = makeCanvas(w, h);
    await page.render({
      canvas: target.canvas as HTMLCanvasElement,
      viewport: vp,
      // Shift the page so the requested region lands at the canvas origin.
      ...(area ? { transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] } : {}),
      background: '#ffffff',
    }).promise;
    return await target.png();
  } finally {
    page.cleanup();
  }
}

/** Render a page to PNG (scale 2 ≈ 144 dpi). */
export function renderPage(
  src: PdfDocument | string | Uint8Array,
  n: number,
  opts: { scale?: number } = {},
): Promise<Uint8Array> {
  return withPdf(src, (pdf) => renderArea(pdf, n, opts.scale ?? 2));
}

/** Render a region of a page (bbox in points, top-left origin, as in Block.bbox) to PNG, e.g. a figure. */
export function cropRegion(
  src: PdfDocument | string | Uint8Array,
  n: number,
  bbox: BBox,
  opts: { scale?: number; margin?: number } = {},
): Promise<Uint8Array> {
  const m = opts.margin ?? 0;
  return withPdf(src, (pdf) =>
    renderArea(pdf, n, opts.scale ?? 2, [Math.max(0, bbox[0] - m), Math.max(0, bbox[1] - m), bbox[2] + m, bbox[3] + m]),
  );
}

/* ---------------------------------------------------------------------------------------------------------- */
/* Outline                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

/** The bookmark tree, flattened in document order, with destinations resolved to 1-based page numbers. */
export async function getOutline(pdf: PdfDocument): Promise<OutlineItem[]> {
  const tree = ((await pdf.getOutline()) ?? []) as OutlineNode[];
  const pageOf = async (dest: OutlineNode['dest']): Promise<number | undefined> => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return undefined;
      const ref = explicit[0];
      const index =
        typeof ref === 'number'
          ? ref
          : ref && typeof ref === 'object'
            ? await pdf.getPageIndex(ref as Parameters<PdfDocument['getPageIndex']>[0])
            : undefined;
      return index === undefined || index < 0 || index >= pdf.numPages ? undefined : index + 1;
    } catch {
      return undefined; // broken destination
    }
  };
  const out: OutlineItem[] = [];
  const walk = async (nodes: OutlineNode[], level: number): Promise<number | undefined> => {
    let first: number | undefined;
    for (const node of nodes) {
      const at = out.length;
      const own = await pageOf(node.dest);
      const child = await walk(node.items ?? [], level + 1);
      // A bookmark without a target (a bare grouping entry) points where its first child does.
      const page = own ?? child;
      const title = normalizePresentationForms(String(node.title ?? ''))
        .replace(/\s+/g, ' ')
        .trim();
      if (page !== undefined && title) out.splice(at, 0, { level, title, page });
      first ??= page;
    }
    return first;
  };
  await walk(tree, 1);
  return out;
}

/** Title from the document information dictionary or XMP metadata, unless it is a placeholder. */
export async function metadataTitle(pdf: PdfDocument): Promise<string | undefined> {
  try {
    const { info, metadata } = await pdf.getMetadata();
    const candidates = [metadata?.get('dc:title'), (info as { Title?: unknown }).Title];
    for (const c of candidates) {
      const t = typeof c === 'string' ? normalizePresentationForms(c).replace(/\s+/g, ' ').trim() : '';
      const placeholder =
        /^(untitled|sans titre|document\d*|microsoft word|title)\b|\.(docx?|pdf|indd|tex|odt|pptx?)$/i.test(t) ||
        (/^[\w.-]+$/.test(t) && /[_\d]/.test(t)); // an identifier such as "BacCor16SP1_KACH"
      if (t && !placeholder) return t;
    }
  } catch {
    // no metadata
  }
  return undefined;
}
