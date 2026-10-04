// Ingest a PDF into a SourceDocument: per-page text blocks (OCR where the text layer is missing or broken),
// the dominant language, the outline and the chapter map.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { hasArabic, normalizeDigits } from '@warqa/i18n';
import {
  type Block,
  DOCUMENT_SCHEMA,
  type OutlineItem,
  type PageInfo,
  type Section,
  SourceDocument,
} from './document.js';
import { textToBlocks, type VisionOcr, workerOcr } from './ocr.js';
import {
  classifyBlocks,
  closePdf,
  extractPage,
  getOutline,
  metadataTitle,
  openPdf,
  pageLang,
  renderPage,
  weightedMedian,
} from './pdf.js';
import { detectSections, outlineSummary, sectionsFromOutline, validateSections } from './sections.js';

export * from './classify.js';
export * from './document.js';
export * from './ocr.js';
export * from './pdf.js';
export * from './sections.js';

export interface IngestOptions {
  /** 'auto' (default): OCR pages whose text layer is empty or broken; 'always': every page; 'never': none. */
  ocr?: 'auto' | 'never' | 'always';
  /** Vision-model OCR (preferred). */
  vision?: VisionOcr;
  /** Base URL of the Warqa worker, used for OCR when no vision function is given (or it fails). */
  worker?: string;
  /** Only these pages (inclusive, 1-based). Sections still cover the whole PDF. */
  pages?: [number, number];
  /** Bookmark depth of chapters; picked automatically when omitted. */
  level?: number;
  /** Name stored as source.file when `file` is bytes (default "document.pdf"). */
  name?: string;
  onProgress?: (e: { page: number; total: number; method: PageInfo['method']; error?: string }) => void;
}

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
const words = (s: string) =>
  s
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(' ');

/**
 * Some producers (Chromium among them) store right-to-left bookmark titles in visual word order. When a
 * heading on the target page has exactly the same words, its text (rebuilt in reading order) is used instead.
 */
function repairOutline(outline: OutlineItem[], blocks: Block[]): OutlineItem[] {
  return outline.map((o) => {
    if (!hasArabic(o.title)) return o;
    const key = words(o.title);
    const match = blocks.find((b) => b.page === o.page && b.text !== o.title && words(b.text) === key);
    return match ? { ...o, title: match.text } : o;
  });
}

/**
 * Running heads, running feet and page numbers: small blocks in the top or bottom 8% of a page that are a bare page
 * number, or that repeat (numbers aside) on three pages or more. Marked 'other' so prompts and the section
 * detector can skip them; the text stays for grounding.
 */
function markPageFurniture(blocks: Block[], pages: PageInfo[], body: number): void {
  const height = new Map(pages.map((p) => [p.n, p.height]));
  const inMargin = (b: Block) => {
    const h = height.get(b.page) ?? 0;
    return h > 0 && (b.bbox[3] <= h * 0.08 || b.bbox[1] >= h * 0.92);
  };
  const key = (t: string) => normalizeDigits(t).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const candidates = blocks.filter(
    (b) => b.kind !== 'figure' && b.text && b.text.length <= 120 && (b.size ?? body) <= body * 1.15 && inMargin(b),
  );
  const pagesOf = new Map<string, Set<number>>();
  for (const b of candidates) pagesOf.set(key(b.text), (pagesOf.get(key(b.text)) ?? new Set()).add(b.page));
  for (const b of candidates) {
    const k = key(b.text);
    const pageNumber = /^[\s\-–—|•.]*(?:page|p\.|صفحة|الصفحة)?\s*#(?:\s*(?:\/|of|sur|من)\s*#)?[\s\-–—|•.]*$/i.test(k);
    if (pageNumber || (pagesOf.get(k)?.size ?? 0) >= 3) {
      b.kind = 'other';
      delete b.level;
    }
  }
}

/** Extract text, OCR what needs it, and map chapters. */
export async function ingestPdf(file: string | Uint8Array, opts: IngestOptions = {}): Promise<SourceDocument> {
  const bytes = typeof file === 'string' ? new Uint8Array(readFileSync(file)) : file;
  const pdf = await openPdf(bytes);
  try {
    const total = pdf.numPages;
    const [from, to] = opts.pages ?? [1, total];
    const first = Math.max(1, Math.min(from, to));
    const last = Math.min(total, Math.max(from, to));
    const mode = opts.ocr ?? 'auto';
    const ocrs: { method: PageInfo['method']; run: VisionOcr }[] = [];
    if (opts.vision) ocrs.push({ method: 'ocr-vision', run: opts.vision });
    if (opts.worker) ocrs.push({ method: 'ocr-worker', run: workerOcr(opts.worker) });

    const pages: PageInfo[] = [];
    const blocks: Block[] = [];
    const textPages = new Set<number>();
    for (let n = first; n <= last; n++) {
      const { info, blocks: found } = await extractPage(pdf, n);
      const unusable = info.quality === 'ocr' || info.quality === 'empty';
      let pageBlocks = found;
      let error: string | undefined;
      let ocred = false;
      if (mode === 'always' || (mode === 'auto' && unusable)) {
        const lang = info.lang ?? pageLang(blocks);
        let png: Uint8Array | undefined;
        for (const o of ocrs) {
          try {
            png ??= await renderPage(pdf, n, { scale: 2 });
            const text = await o.run(png, { page: n, ...(lang ? { lang } : {}) });
            pageBlocks = textToBlocks(text, n, info.width, info.height);
            info.method = o.method;
            ocred = true;
            error = undefined;
            break;
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }
      }
      // Not OCR'd (none available, failed, or not allowed): a broken text layer is worse than nothing, keep the figures.
      if (!ocred && unusable) {
        info.method = 'none';
        pageBlocks = found.filter((b) => b.kind === 'figure');
      }
      if (info.method === 'text') textPages.add(n);
      const lang = pageLang(pageBlocks);
      if (lang) info.lang = lang;
      else delete info.lang;
      info.chars = pageBlocks.reduce((a, b) => a + b.text.replace(/\s+/g, '').length, 0);
      pages.push(info);
      blocks.push(...pageBlocks);
      opts.onProgress?.({ page: n, total: last - first + 1, method: info.method, ...(error ? { error } : {}) });
    }

    // Headings again, against the whole book's body size: a chapter title page has no body text of its own.
    const fromText = blocks.filter((b) => textPages.has(b.page));
    const body = weightedMedian(
      fromText.filter((b) => b.kind !== 'figure').map((b) => ({ value: b.size ?? 0, weight: b.text.length })),
    );
    if (body) {
      classifyBlocks(fromText, body);
      markPageFurniture(fromText, pages, body);
    }

    const outline = repairOutline(await getOutline(pdf), blocks);
    const lang = pageLang(blocks) ?? 'en';
    const level = opts.level ?? outlineSummary(outline).suggested;
    let sections: Section[] = level ? sectionsFromOutline(outline, total, level) : [];
    if (!sections.length || validateSections(sections, total).length) sections = detectSections(blocks, total);

    const heading = (page: number) =>
      blocks.filter((b) => b.page === page && b.kind === 'heading').sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
        ?.text;
    const title =
      (await metadataTitle(pdf)) ??
      heading(1) ??
      outline.find((o) => o.page === 1)?.title ??
      blocks.find((b) => b.kind === 'heading')?.text ??
      outline[0]?.title;

    return SourceDocument.parse({
      schema: DOCUMENT_SCHEMA,
      source: {
        file: typeof file === 'string' ? basename(file) : (opts.name ?? 'document.pdf'),
        pages: total,
        sha1: sha1(bytes),
        ...(title ? { title } : {}),
      },
      lang,
      outline,
      pages,
      blocks,
      sections,
    });
  } finally {
    await closePdf(pdf);
  }
}
