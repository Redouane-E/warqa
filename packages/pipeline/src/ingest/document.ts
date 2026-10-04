// The ingested source document: text blocks with page/bbox anchors (for grounding and citations), the PDF
// outline, and a section (chapter) map. Written to <project>/source/document.json.
import * as z from 'zod';

export const DOCUMENT_SCHEMA = 'warqa.document/1' as const;

export const BlockKind = z.enum(['heading', 'paragraph', 'list', 'table', 'figure', 'caption', 'equation', 'other']);
export type BlockKind = z.infer<typeof BlockKind>;

export const Block = z.object({
  /** Stable id: "p<page>b<index>", e.g. "p12b3". */
  id: z.string(),
  page: z.number().int().min(1),
  kind: BlockKind,
  /** Text in logical (reading) order, presentation forms normalized. Empty for pure figures. */
  text: z.string(),
  /** [x0, y0, x1, y1] in PDF points, origin top-left of the page. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Heading level (1 = largest) for headings. */
  level: z.number().int().min(1).max(6).optional(),
  /** Detected language of the block (BCP-47 base: ar, fr, en, …). */
  lang: z.string().optional(),
  /** Average font size (points), for heading detection. */
  size: z.number().optional(),
});
export type Block = z.infer<typeof Block>;

export const PageInfo = z.object({
  n: z.number().int().min(1),
  width: z.number(),
  height: z.number(),
  /** How the text was obtained. */
  method: z.enum(['text', 'ocr-vision', 'ocr-worker', 'none']),
  /** Text-layer verdict before any fallback (see @warqa/i18n arabicTextQuality). */
  quality: z.enum(['ok', 'normalize', 'reversed', 'ocr', 'empty', 'not-arabic']).optional(),
  lang: z.string().optional(),
  chars: z.number().int().optional(),
});
export type PageInfo = z.infer<typeof PageInfo>;

export const OutlineItem = z.object({
  level: z.number().int().min(1),
  title: z.string(),
  page: z.number().int().min(1),
});
export type OutlineItem = z.infer<typeof OutlineItem>;

/** A contiguous page range: a chapter (ch01…), front matter (00_front) or back matter (99_back). */
export const Section = z.object({
  id: z.string(),
  title: z.string(),
  start: z.number().int().min(1),
  end: z.number().int().min(1),
  unit: z.string().optional(),
  /** First page of the chapter itself (the section may start with its unit's title pages). */
  chapterStart: z.number().int().optional(),
});
export type Section = z.infer<typeof Section>;

export const SourceDocument = z.object({
  schema: z.literal(DOCUMENT_SCHEMA).default(DOCUMENT_SCHEMA),
  source: z.object({ file: z.string(), pages: z.number().int(), sha1: z.string(), title: z.string().optional() }),
  /** Dominant language of the text. */
  lang: z.string(),
  outline: z.array(OutlineItem).default([]),
  pages: z.array(PageInfo),
  blocks: z.array(Block),
  sections: z.array(Section).default([]),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

/** Plain text of a page range (for prompts), with page markers. */
export function sectionText(
  doc: SourceDocument,
  start: number,
  end: number,
  opts: { markers?: boolean; maxChars?: number } = {},
): string {
  const out: string[] = [];
  let len = 0;
  for (let p = start; p <= end; p++) {
    const blocks = doc.blocks.filter((b) => b.page === p && b.text.trim());
    if (!blocks.length) continue;
    const page = blocks.map((b) => (b.kind === 'heading' ? `## ${b.text}` : b.text)).join('\n');
    const chunk = opts.markers === false ? page : `[page ${p}]\n${page}`;
    if (opts.maxChars && len + chunk.length > opts.maxChars) {
      out.push(chunk.slice(0, Math.max(0, opts.maxChars - len)));
      out.push(`[… truncated at ${opts.maxChars} characters]`);
      break;
    }
    out.push(chunk);
    len += chunk.length;
  }
  return out.join('\n\n');
}
