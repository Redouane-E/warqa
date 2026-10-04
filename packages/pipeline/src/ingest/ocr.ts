// OCR for pages without a usable text layer (scans, broken Arabic fonts). Warqa does not call a model here:
// the caller passes a vision function (any provider), or the URL of the optional Python worker.
import { normalizePresentationForms } from '@warqa/i18n';
import { detectLang, isCaption, isMathLike, listMarker } from './classify.js';
import type { Block, BlockKind } from './document.js';

/** Turn a rendered page (PNG) into text, ideally Markdown (# headings, - lists). */
export type VisionOcr = (png: Uint8Array, ctx: { page: number; lang?: string }) => Promise<string>;

/** OCR through the Warqa worker: POST {base}/ocr with { image_base64, lang } → { text }. */
export function workerOcr(baseUrl: string): VisionOcr {
  const url = `${baseUrl.replace(/\/+$/, '')}/ocr`;
  return async (png, ctx) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_base64: Buffer.from(png).toString('base64'), lang: ctx.lang ?? null }),
    });
    if (!res.ok) throw new Error(`OCR worker: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { text?: unknown };
    if (typeof body.text !== 'string') throw new Error('OCR worker: response has no "text"');
    return body.text;
  };
}

interface Para {
  kind: BlockKind;
  text: string;
  level?: number;
  lines: number;
}

/** Strip Markdown emphasis, links and inline code, keeping the words. */
const plain = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Blocks from OCR output (Markdown or plain text): "#" headings, list items, $$…$$ or math-only lines as
 * equations, "|" tables, captions and paragraphs (blank lines separate them). The OCR gives no geometry, so
 * each block spans the page width and gets a vertical slot proportional to its length.
 */
export function textToBlocks(text: string, page: number, width: number, height: number): Block[] {
  const paras: Para[] = [];
  let buf: string[] = [];
  let table: string[] = [];
  let math: string[] | undefined;
  const flush = () => {
    if (buf.length) {
      const t = plain(buf.join(' '));
      if (t)
        paras.push({
          kind: isCaption(t) ? 'caption' : isMathLike(t) ? 'equation' : 'paragraph',
          text: t,
          lines: buf.length,
        });
    }
    buf = [];
  };
  const flushTable = () => {
    const rows = table
      .filter((r) => !/^\|?\s*:?-{2,}/.test(r))
      .map((r) =>
        r
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => plain(c))
          .join(' | '),
      );
    if (rows.length) paras.push({ kind: 'table', text: rows.join('\n'), lines: rows.length });
    table = [];
  };
  for (const raw of normalizePresentationForms(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (math) {
      if (line.endsWith('$$')) {
        math.push(line.slice(0, -2));
        paras.push({ kind: 'equation', text: math.join(' ').trim(), lines: math.length });
        math = undefined;
      } else math.push(line);
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      table.push(line);
      continue;
    }
    if (table.length) flushTable();
    if (!line || /^(?:-{3,}|\*{3,}|_{3,})$/.test(line) || /^```/.test(line)) {
      flush();
      continue;
    }
    if (line.startsWith('$$')) {
      flush();
      const rest = line.slice(2);
      if (rest.endsWith('$$') && rest.length >= 2)
        paras.push({ kind: 'equation', text: rest.slice(0, -2).trim(), lines: 1 });
      else math = [rest];
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const t = plain(h[2]!.replace(/\s#+$/, ''));
      if (t) paras.push({ kind: 'heading', text: t, level: h[1]!.length, lines: 1 });
      continue;
    }
    // "- item" / "* item" (Markdown bullets) and any marker the text layer would recognize.
    const md = /^[-*+]\s+(.*)$/.exec(line);
    if (md || listMarker(line)) {
      flush();
      const t = plain(md ? `• ${md[1]}` : line);
      if (t) paras.push({ kind: 'list', text: t, lines: 1 });
      continue;
    }
    // A wrapped list item continues on an indented line.
    if (/^\s{2,}\S/.test(raw) && paras.at(-1)?.kind === 'list' && !buf.length) {
      paras.at(-1)!.text += ` ${plain(line)}`;
      paras.at(-1)!.lines++;
      continue;
    }
    buf.push(line);
  }
  if (math) paras.push({ kind: 'equation', text: math.join(' ').trim(), lines: math.length });
  if (table.length) flushTable();
  flush();

  const total = paras.reduce((a, p) => a + p.lines + 1, 0) || 1;
  const margin = height * 0.06;
  const usable = height - 2 * margin;
  let at = 0;
  return paras.map((p, i) => {
    const y0 = margin + (at / total) * usable;
    at += p.lines + 1;
    const y1 = margin + ((at - 1) / total) * usable;
    const lang = detectLang(p.text);
    return {
      id: `p${page}b${i + 1}`,
      page,
      kind: p.kind,
      text: p.text,
      bbox: [0, Math.round(y0 * 10) / 10, Math.round(width * 10) / 10, Math.round(Math.max(y1, y0 + 1) * 10) / 10],
      ...(p.level ? { level: p.level } : {}),
      ...(lang ? { lang } : {}),
    } satisfies Block;
  });
}
