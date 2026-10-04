// Fixtures come from test-fixtures/make-pdfs.mjs (Chromium print-to-PDF): run it again after changing them.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Block,
  closePdf,
  cropRegion,
  detectLang,
  detectSections,
  headingKind,
  ingestPdf,
  listMarker,
  type OutlineItem,
  openPdf,
  outlineSummary,
  renderPage,
  type SourceDocument,
  sectionsFromOutline,
  sectionText,
  textToBlocks,
  validateSections,
  workerOcr,
} from './index.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test-fixtures/${name}`, import.meta.url));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b: Uint8Array) => PNG.every((v, i) => b[i] === v);
const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};
const onPage = (doc: SourceDocument, page: number) => doc.blocks.filter((b) => b.page === page);
const texts = (blocks: Block[]) => blocks.map((b) => b.text);
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-\ufeff]/;

describe('English textbook', () => {
  let doc: SourceDocument;
  const progress: { page: number; total: number; method: string }[] = [];
  beforeAll(async () => {
    doc = await ingestPdf(fixture('textbook-en.pdf'), { onProgress: (e) => progress.push(e) });
  }, 60_000);

  it('reads every page from the text layer', () => {
    expect(doc.source).toMatchObject({ file: 'textbook-en.pdf', pages: 6, title: 'Numbers and Operations' });
    expect(doc.source.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(doc.lang).toBe('en');
    expect(doc.pages.map((p) => p.method)).toEqual(Array(6).fill('text'));
    expect(progress.map((e) => e.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress.every((e) => e.total === 6)).toBe(true);
  });

  it('builds blocks in reading order with kinds', () => {
    const page = onPage(doc, 2);
    expect(page.map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Chapter 1: Integers'],
      [
        'paragraph',
        'Integers are the whole numbers together with their opposites. They let us describe temperatures below zero, debts and depths under the sea level.',
      ],
      ['heading', '1.1 Opposite numbers'],
      ['paragraph', 'Every integer has an opposite at the same distance from zero on the number line.'],
      ['list', '• The opposite of 3 is −3.'],
      ['list', '• The opposite of −7 is 7.'],
      ['list', '• Zero is its own opposite.'],
      ['equation', '3 + (−3) = 0'],
      ['paragraph', 'The sum of a number and its opposite is always zero.'],
      ['other', '- 2 -'],
    ]);
    expect(page.map((b) => b.id)).toEqual(page.map((_, i) => `p2b${i + 1}`));
    // Printed page numbers in the footer are page furniture, on every page.
    for (const n of [1, 2, 3, 4, 5, 6])
      expect(onPage(doc, n).at(-1)).toMatchObject({ kind: 'other', text: `- ${n} -` });
    // Chapter titles share a level, sub-headings sit below them.
    const [chapter, sub] = page.filter((b) => b.kind === 'heading');
    expect(chapter!.level).toBeLessThan(sub!.level!);
    expect(onPage(doc, 4)[0]).toMatchObject({ kind: 'heading', level: chapter!.level });
    // bbox: top-left origin, inside the A5 page, top to bottom.
    for (const b of page) {
      expect(b.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(b.bbox[2]).toBeLessThanOrEqual(420);
      expect(b.bbox[1]).toBeLessThan(b.bbox[3]);
    }
    expect(page.map((b) => b.bbox[1])).toEqual([...page.map((b) => b.bbox[1])].sort((a, b) => a - b));
    expect(page.find((b) => b.kind === 'paragraph')?.lang).toBe('en');
    expect(texts(onPage(doc, 4))).toContain('1. Find a common denominator.');
    expect(onPage(doc, 4).find((b) => b.text.startsWith('2.'))?.kind).toBe('list');
  });

  it('finds the raster figure and its caption', () => {
    const page = onPage(doc, 3);
    const figure = page.find((b) => b.kind === 'figure');
    expect(figure).toBeDefined();
    expect(figure!.text).toBe('');
    expect(figure!.bbox[2] - figure!.bbox[0]).toBeCloseTo(240, 0);
    const i = page.indexOf(figure!);
    expect(page[i + 1]).toMatchObject({ kind: 'caption', text: 'Figure 1: The number line from −5 to 5.' });
  });

  it('maps chapters from the bookmarks', () => {
    expect(doc.outline.filter((o) => o.level === 1).map((o) => [o.title, o.page])).toEqual([
      ['Chapter 1: Integers', 2],
      ['Chapter 2: Fractions', 4],
      ['Chapter 3: Decimals', 6],
    ]);
    expect(outlineSummary(doc.outline).suggested).toBe(1);
    expect(doc.sections).toEqual([
      { id: '00_front', title: 'Front matter', start: 1, end: 1 },
      { id: 'ch01', title: 'Chapter 1: Integers', start: 2, end: 3, chapterStart: 2 },
      { id: 'ch02', title: 'Chapter 2: Fractions', start: 4, end: 5, chapterStart: 4 },
      { id: 'ch03', title: 'Chapter 3: Decimals', start: 6, end: 6, chapterStart: 6 },
    ]);
    expect(validateSections(doc.sections, 6)).toEqual([]);
  });

  it('gives section text for prompts', () => {
    const text = sectionText(doc, 2, 3);
    expect(text.startsWith('[page 2]\n## Chapter 1: Integers\nIntegers are')).toBe(true);
    expect(text).toContain('\n\n[page 3]\n## 1.2 The number line');
    expect(sectionText(doc, 2, 3, { markers: false })).not.toContain('[page');
    expect(sectionText(doc, 2, 6, { maxChars: 100 })).toMatch(/\[… truncated at 100 characters\]$/);
  });

  it('pages option limits extraction but not the section map', async () => {
    const part = await ingestPdf(fixture('textbook-en.pdf'), { pages: [4, 5] });
    expect(part.pages.map((p) => p.n)).toEqual([4, 5]);
    expect(new Set(part.blocks.map((b) => b.page))).toEqual(new Set([4, 5]));
    expect(part.sections.map((s) => s.id)).toEqual(['00_front', 'ch01', 'ch02', 'ch03']);
  }, 30_000);
});

describe('Arabic textbook (RTL)', () => {
  let doc: SourceDocument;
  beforeAll(async () => {
    doc = await ingestPdf(fixture('textbook-ar.pdf'));
  }, 60_000);

  it('detects Arabic and a clean text layer', () => {
    expect(doc.lang).toBe('ar');
    expect(doc.pages.every((p) => p.method === 'text' && p.quality === 'ok' && p.lang === 'ar')).toBe(true);
  });

  it('reads Arabic sentences right to left, with lam-alef ligatures intact', () => {
    const page = onPage(doc, 2);
    expect(page[0]).toMatchObject({ kind: 'heading', text: 'الفصل الأول: الأعداد الصحيحة', lang: 'ar' });
    expect(page[1]).toMatchObject({
      kind: 'paragraph',
      text: 'الأعداد الصحيحة هي الأعداد الطبيعية مع مقابلاتها. نستعملها للتعبير عن درجات الحرارة تحت الصفر وعن الديون.',
    });
    // pdf.js alone gives "األعداد" and "مقابالتها" (ligature glyphs reversed with the run).
    const all = doc.blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(/األ|إلإ|مقابالت/);
    expect(all).not.toMatch(PRESENTATION_FORMS);
  });

  it('keeps numbers, list markers and math in logical order', () => {
    const page = onPage(doc, 2);
    expect(page.filter((b) => b.kind === 'list').map((b) => b.text)).toEqual([
      'أ- مقابل العدد 3 هو العدد −3.',
      'ب- مقابل العدد −7 هو العدد 7.',
      'ج- الصفر هو مقابل نفسه.',
    ]);
    expect(page.find((b) => b.kind === 'equation')?.text).toBe('3 + (−3) = 0');
    expect(page.find((b) => b.kind === 'equation')?.lang).toBeUndefined();
    expect(onPage(doc, 3).find((b) => b.kind === 'caption')?.text).toBe('شكل 1: المستقيم العددي من −5 إلى 5.');
    expect(onPage(doc, 4).find((b) => b.kind === 'equation')?.text).toBe('1/2 + 1/4 = 3/4');
  });

  it('repairs bookmark titles stored in visual order and maps chapters', () => {
    expect(doc.outline.filter((o) => o.level === 1).map((o) => o.title)).toEqual([
      'الفصل الأول: الأعداد الصحيحة',
      'الفصل الثاني: الكسور',
      'الفصل الثالث: الأعداد العشرية',
    ]);
    expect(doc.sections.map((s) => [s.id, s.start, s.end])).toEqual([
      ['00_front', 1, 1],
      ['ch01', 2, 3],
      ['ch02', 4, 4],
      ['ch03', 5, 5],
    ]);
    expect(doc.source.title).toBe('الأعداد والعمليات');
  });

  it('finds the same chapters from Arabic headings when there are no bookmarks', () => {
    const sections = detectSections(doc.blocks, 5);
    expect(sections.map((s) => [s.id, s.title, s.start, s.end])).toEqual([
      ['00_front', 'Front matter', 1, 1],
      ['ch01', 'الفصل الأول: الأعداد الصحيحة', 2, 3],
      ['ch02', 'الفصل الثاني: الكسور', 4, 4],
      ['ch03', 'الفصل الثالث: الأعداد العشرية', 5, 5],
    ]);
    expect(validateSections(sections, 5)).toEqual([]);
  });
});

describe('Arabic stored as presentation forms', () => {
  it('normalizes them back to ordinary letters', async () => {
    const doc = await ingestPdf(fixture('garbled-ar.pdf'));
    expect(doc.pages[0]).toMatchObject({ method: 'text', quality: 'normalize', lang: 'ar' });
    const all = doc.blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(PRESENTATION_FORMS);
    expect(doc.blocks[0]).toMatchObject({ kind: 'heading', text: 'الدرس الأول: الجمع' });
    expect(doc.blocks[1]!.text).toBe(
      'الجمع هو العملية التي نحسب بها مجموع عددين أو أكثر. في هذا الدرس نتعلم كيف نجمع الأعداد الصحيحة.',
    );
    // The lam-alef presentation form (U+FEFB) becomes two letters in reading order.
    expect(doc.blocks[2]!.text.startsWith('لا يتغير المجموع')).toBe(true);
  }, 30_000);
});

describe('pages without a usable text layer', () => {
  const OCR_TEXT = '# Chapter 1: Scanned page\n\nThis page is only an image of text.\n\n- It has no text layer at all.';

  it('routes scans and broken Arabic layers to the vision OCR', async () => {
    const calls: { page: number; lang?: string; png: boolean }[] = [];
    const doc = await ingestPdf(fixture('scanned.pdf'), {
      vision: async (png, ctx) => {
        calls.push({ ...ctx, png: isPng(png) });
        return OCR_TEXT;
      },
    });
    expect(calls.map((c) => c.page)).toEqual([2, 3]);
    expect(calls.every((c) => c.png)).toBe(true);
    // Page 3 is Arabic set in a font whose glyphs have no Unicode mapping: letters are lost, so OCR it.
    expect(calls[1]!.lang).toBe('ar');
    expect(doc.pages.map((p) => [p.method, p.quality])).toEqual([
      ['text', 'not-arabic'],
      ['ocr-vision', 'empty'],
      ['ocr-vision', 'ocr'],
    ]);
    expect(onPage(doc, 2).map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Chapter 1: Scanned page'],
      ['paragraph', 'This page is only an image of text.'],
      ['list', '• It has no text layer at all.'],
    ]);
    // OCR replaces everything extracted from the page, including the scan image itself.
    expect(doc.blocks.some((b) => b.kind === 'figure')).toBe(false);
  }, 30_000);

  it('keeps the page with method "none" when no OCR is available or allowed', async () => {
    const doc = await ingestPdf(fixture('scanned.pdf'));
    expect(doc.pages.map((p) => p.method)).toEqual(['text', 'none', 'none']);
    // The scan stays available as a figure region (for cropRegion); the broken Arabic text is dropped.
    expect(onPage(doc, 2).map((b) => [b.kind, b.text])).toEqual([['figure', '']]);
    expect(onPage(doc, 3)).toEqual([]);
    let called = false;
    const never = await ingestPdf(fixture('scanned.pdf'), {
      ocr: 'never',
      vision: async () => {
        called = true;
        return '';
      },
    });
    expect(called).toBe(false);
    expect(never.pages[1]!.method).toBe('none');
  }, 30_000);

  it('falls back to the worker when the vision function fails', async () => {
    const bodies: { image_base64: string; lang: string | null }[] = [];
    const server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        expect(req.method).toBe('POST');
        expect(req.url).toBe('/ocr');
        bodies.push(JSON.parse(data));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: 'نص من العامل' }));
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    try {
      const doc = await ingestPdf(fixture('scanned.pdf'), {
        pages: [2, 2],
        vision: async () => {
          throw new Error('model unavailable');
        },
        worker: `http://127.0.0.1:${port}/`,
      });
      expect(doc.pages[0]).toMatchObject({ n: 2, method: 'ocr-worker', lang: 'ar' });
      expect(onPage(doc, 2)[0]).toMatchObject({ kind: 'paragraph', text: 'نص من العامل', lang: 'ar' });
      expect(bodies).toHaveLength(1);
      expect(isPng(new Uint8Array(Buffer.from(bodies[0]!.image_base64, 'base64')))).toBe(true);
    } finally {
      server.close();
    }
  }, 30_000);

  it('workerOcr reports HTTP errors', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 503;
      res.end('busy');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const ocr = workerOcr(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      await expect(ocr(new Uint8Array(PNG), { page: 1 })).rejects.toThrow(/HTTP 503 busy/);
    } finally {
      server.close();
    }
  });
});

describe('rendering', () => {
  it('renders a page and a figure region to PNG', async () => {
    const page = await renderPage(fixture('textbook-ar.pdf'), 2, { scale: 1 });
    expect(isPng(page)).toBe(true);
    expect(pngSize(page)).toEqual({ width: 420, height: 595 });
    const pdf = await openPdf(fixture('textbook-en.pdf'));
    try {
      const crop = await cropRegion(pdf, 3, [90, 132.7, 330, 173.2], { scale: 2 });
      expect(isPng(crop)).toBe(true);
      expect(pngSize(crop)).toEqual({ width: 480, height: 81 });
      const big = await renderPage(pdf, 1);
      expect(pngSize(big).width).toBe(840);
    } finally {
      await closePdf(pdf);
    }
  }, 30_000);
});

describe('sections from bookmarks', () => {
  const outline: OutlineItem[] = [
    { level: 1, title: 'Contents', page: 2 },
    { level: 1, title: 'Unit 1: Numbers', page: 5 },
    { level: 2, title: 'Chapter 1: Integers', page: 6 },
    { level: 2, title: 'Chapter 2: Fractions', page: 12 },
    { level: 3, title: '2.1 Halves', page: 13 },
    { level: 1, title: 'Unit 2: Geometry', page: 20 },
    { level: 2, title: 'Chapter 3: Angles', page: 21 },
    { level: 2, title: 'Chapter 4: Triangles', page: 28 },
    { level: 1, title: 'Index', page: 36 },
  ];

  it('folds unit title pages into the first chapter and adds front and back matter', () => {
    const sections = sectionsFromOutline(outline, 40, 2);
    expect(sections).toEqual([
      { id: '00_front', title: 'Front matter', start: 1, end: 4 },
      { id: 'ch01', title: 'Chapter 1: Integers', start: 5, end: 11, unit: 'Unit 1: Numbers', chapterStart: 6 },
      { id: 'ch02', title: 'Chapter 2: Fractions', start: 12, end: 19, unit: 'Unit 1: Numbers', chapterStart: 12 },
      { id: 'ch03', title: 'Chapter 3: Angles', start: 20, end: 27, unit: 'Unit 2: Geometry', chapterStart: 21 },
      { id: 'ch04', title: 'Chapter 4: Triangles', start: 28, end: 35, unit: 'Unit 2: Geometry', chapterStart: 28 },
      { id: '99_back', title: 'Back matter', start: 36, end: 40 },
    ]);
    expect(validateSections(sections, 40)).toEqual([]);
  });

  it('suggests the level whose titles look like chapters', () => {
    const summary = outlineSummary(outline);
    expect(summary.levels.map((l) => [l.level, l.count])).toEqual([
      [1, 4],
      [2, 4],
      [3, 1],
    ]);
    expect(summary.suggested).toBe(2);
    expect(outlineSummary([{ level: 1, title: 'Only one', page: 1 }]).suggested).toBeUndefined();
  });

  it('keeps one or two named chapters whole instead of cutting at numbered subsections', () => {
    const short = [
      { level: 1, title: 'الفصل الأول: الأعداد العشرية النسبية', page: 2 },
      { level: 2, title: '1. تعريف', page: 2 },
      { level: 2, title: '2. المستقيم المدرج', page: 2 },
      { level: 2, title: '3. مقابل عدد', page: 3 },
      { level: 1, title: 'الفصل الثاني: جمع وطرح الأعداد النسبية', page: 3 },
      { level: 2, title: '1. جمع عددين نسبيين', page: 3 },
      { level: 2, title: '2. طرح عددين نسبيين', page: 4 },
    ];
    expect(outlineSummary(short).suggested).toBe(1);
    expect(outlineSummary([{ level: 1, title: "Chapitre 3 : Le cycle de l'eau", page: 2 }, ...short.slice(1, 3)]).suggested).toBe(1);
  });

  it('merges chapters that start on the same page and never leaves a gap', () => {
    const sections = sectionsFromOutline(
      [
        { level: 1, title: 'A', page: 1 },
        { level: 1, title: 'B', page: 3 },
        { level: 1, title: 'C', page: 3 },
        { level: 1, title: 'D', page: 5 },
      ],
      6,
      1,
    );
    expect(sections.map((s) => [s.id, s.title, s.start, s.end])).toEqual([
      ['ch01', 'A', 1, 2],
      ['ch02', 'B · C', 3, 4],
      ['ch03', 'D', 5, 6],
    ]);
    expect(sectionsFromOutline(outline, 40, 5)).toEqual([]);
  });

  it('validateSections reports gaps, overlaps and bad ranges', () => {
    const errors = validateSections(
      [
        { id: 'ch01', title: 'a', start: 1, end: 3 },
        { id: 'ch02', title: 'b', start: 3, end: 5 },
        { id: 'ch02', title: 'c', start: 7, end: 12, chapterStart: 6 },
      ],
      10,
    );
    expect(errors.join('\n')).toMatch(/overlap: ch02 starts at 3/);
    expect(errors.join('\n')).toMatch(/repeated section id: ch02/);
    expect(errors.join('\n')).toMatch(/gap: pages 6-6/);
    expect(errors.join('\n')).toMatch(/ends at 12, the PDF has 10 pages/);
    expect(errors.join('\n')).toMatch(/chapterStart 6 is outside 7-12/);
  });
});

describe('sections without bookmarks', () => {
  const block = (page: number, text: string, level = 1): Block => ({
    id: `p${page}b1`,
    page,
    kind: 'heading',
    text,
    bbox: [0, 0, 1, 1],
    level,
  });

  it('uses lesson headings in French with units as parents, and an index as back matter', () => {
    const blocks = [
      block(1, 'Mathématiques 1re année'),
      block(3, 'Sommaire'),
      block(4, 'Unité 1 : Les nombres'),
      block(5, 'Leçon 1 : Les entiers', 2),
      block(9, 'Leçon 2 : Les fractions', 2),
      block(14, 'Unité 2 : La géométrie'),
      block(15, 'Leçon 3 : Les angles', 2),
      block(19, 'Index'),
    ];
    const sections = detectSections(blocks, 20);
    expect(sections.map((s) => [s.id, s.start, s.end, s.unit ?? '', s.chapterStart ?? 0])).toEqual([
      ['00_front', 1, 3, '', 0],
      ['ch01', 4, 8, 'Unité 1 : Les nombres', 5],
      ['ch02', 9, 13, 'Unité 1 : Les nombres', 9],
      ['ch03', 14, 18, 'Unité 2 : La géométrie', 15],
      ['99_back', 19, 20, '', 0],
    ]);
  });

  it('ignores a table of contents page and running heads, and covers everything when nothing looks like a chapter', () => {
    const toc = [block(2, 'الدرس الأول'), block(2, 'الدرس الثاني'), block(2, 'الدرس الثالث')];
    const lessons = [block(4, 'الدرس الأول: الجمع'), block(8, 'الدرس الثاني: الطرح'), block(12, 'الدرس الثالث: الضرب')];
    const heads = [3, 5, 6, 7].map((p) => block(p, 'رياضيات'));
    const sections = detectSections([...toc, ...heads, ...lessons], 14);
    expect(sections.map((s) => [s.id, s.start, s.end])).toEqual([
      ['00_front', 1, 3],
      ['ch01', 4, 7],
      ['ch02', 8, 11],
      ['ch03', 12, 14],
    ]);
    expect(detectSections([], 3)).toEqual([{ id: 'ch01', title: 'Document', start: 1, end: 3, chapterStart: 1 }]);
  });
});

describe('text heuristics', () => {
  it('detects language per block', () => {
    expect(detectLang('Les nombres relatifs sont utilisés pour mesurer la température.')).toBe('fr');
    expect(detectLang('The numbers are used to measure the temperature.')).toBe('en');
    expect(detectLang('الأعداد الصحيحة النسبية')).toBe('ar');
    expect(detectLang('3 + (−3) = 0')).toBeUndefined();
  });

  it('recognizes list markers and chapter headings in three languages', () => {
    expect(
      ['• item', '- item', '1. item', '2) item', 'أ- بند', 'ب) بند', '١- بند', '(a) item'].map((s) => !!listMarker(s)),
    ).toEqual(Array(8).fill(true));
    expect(['1.1 Section', 'Chapter 1', 'الدرس'].map((s) => !!listMarker(s))).toEqual([false, false, false]);
    expect(headingKind('Chapter 3: Decimals')).toBe('chapter');
    expect(headingKind('Chapitre deux')).toBe('chapter');
    expect(headingKind('Leçon 4 - Les angles')).toBe('chapter');
    expect(headingKind('الفصل الثالث: الأعداد العشرية')).toBe('chapter');
    expect(headingKind('الدرس ٣')).toBe('chapter');
    expect(headingKind('الوحدة الثانية')).toBe('unit');
    expect(headingKind('المحور الأول')).toBe('unit');
    expect(headingKind('Unit 2')).toBe('unit');
    expect(headingKind('The chapter we read')).toBeUndefined();
  });
});

describe('OCR text to blocks', () => {
  it('turns Markdown into blocks with estimated positions', () => {
    const blocks = textToBlocks(
      '# الدرس الأول\n\nالجمع هو **العملية** التي نحسب بها المجموع.\nسطر ثان.\n\n- أولا\n- ثانيا\n\n$$ 3 + 4 = 7 $$\n\n## Exercices\n\n| 1 | 2 |\n|---|---|\n| 3 | 4 |',
      7,
      400,
      600,
    );
    expect(blocks.map((b) => [b.id, b.kind, b.text, b.level ?? 0, b.lang ?? ''])).toEqual([
      ['p7b1', 'heading', 'الدرس الأول', 1, 'ar'],
      ['p7b2', 'paragraph', 'الجمع هو العملية التي نحسب بها المجموع. سطر ثان.', 0, 'ar'],
      ['p7b3', 'list', '• أولا', 0, 'ar'],
      ['p7b4', 'list', '• ثانيا', 0, 'ar'],
      ['p7b5', 'equation', '3 + 4 = 7', 0, ''],
      ['p7b6', 'heading', 'Exercices', 2, 'en'],
      ['p7b7', 'table', '1 | 2\n3 | 4', 0, ''],
    ]);
    for (const b of blocks) {
      expect(b.bbox[0]).toBe(0);
      expect(b.bbox[2]).toBe(400);
      expect(b.bbox[3]).toBeLessThanOrEqual(600);
    }
    const tops = blocks.map((b) => b.bbox[1]);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });
});
