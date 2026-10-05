// The self-learner's "one go": read the PDF → plan at the learner's level, approved automatically → build
// chapter 1 (narrated when a voice is available) → the chapter to open. Shared by `warqa learn`, the
// studio's and the web app's `learn` job.
//
// Large PDFs: the whole text layer is read first (cheap, no model). The vision model only reads the scanned
// pages of the chapter being made, so a 300-page scan costs one chapter's pages, not the whole book.
import type { SourceDocument } from '../ingest/document.js';
import { chooseSections, ingestPdf } from '../ingest/index.js';
import type { VisionOcr } from '../ingest/ocr.js';
import { pageLang } from '../ingest/pdf.js';
import { costOf } from '../models/catalog.js';
import { type Llm, ledgerSummary } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { VISION_OCR_SYSTEM } from '../prompts/index.js';
import { type NarrateReport, narrateLesson } from '../tts/narrate.js';
import type { TtsProvider } from '../tts/types.js';
import {
  buildChapter,
  type ChapterReport,
  ensurePlan,
  estimateBuild,
  loadDocument,
  type ProgressEvent,
} from './build.js';
import { LEARN_LEVELS, type LearnLevel } from './levels.js';
import { type BookPlan, loadPlan } from './plan.js';

export { LEARN_LEVELS, LEARNER_AUDIENCE, type LearnLevel, learnerAudience } from './levels.js';

/** Most scanned pages the vision model reads for one chapter (and before planning a scanned book). */
export const MAX_VISION_PAGES = 40;
/** Below this much text, a document's language is a guess (a cover page, a publisher's line). */
const MIN_LANG_CHARS = 500;
/** Below this much text, a chapter can't be taught: the model would make the lesson up. */
const MIN_CHAPTER_CHARS = 300;
/** Spending limit given to a learner's book that has none. */
export const LEARNER_BUDGET_USD = 1;

export const isLearnLevel = (v: unknown): v is LearnLevel => LEARN_LEVELS.includes(v as LearnLevel);

/** Mark a book as a learner's book at a level, with a spending limit unless one is set. */
export function startLearning(project: Project, level: LearnLevel): void {
  project.book.learn = { level };
  if (project.config.budget.usd === undefined) project.config.budget.usd = LEARNER_BUDGET_USD;
  project.saveBook();
}

/** A vision OCR function from the book's vision model, or undefined when none is configured. */
export function visionReader(project: Project, llm: Llm): VisionOcr | undefined {
  let model: string;
  try {
    model = resolveRole('vision', project.config);
  } catch {
    return undefined;
  }
  return (png, c) =>
    llm.text({
      stage: 'ingest',
      role: 'vision',
      model,
      system: VISION_OCR_SYSTEM,
      prompt: `Transcribe page ${c.page}${c.lang ? ` (language: ${c.lang})` : ''}.`,
      images: [{ data: png, mediaType: 'image/png' }],
    });
}

/** Read the text layer of the whole PDF (no model, no cost) into source/document.json. */
export async function readTextLayer(
  project: Project,
  opts: { onProgress?: (e: ProgressEvent) => void } = {},
): Promise<SourceDocument> {
  const pdf = project.sourcePdf();
  if (!pdf) throw new Error('This book has no PDF: add one to its source/ folder.');
  opts.onProgress?.({ stage: 'read', status: 'start', detail: pdf.split(/[\\/]/).pop() ?? '' });
  const doc = await ingestPdf(pdf, {
    ocr: 'never',
    onProgress: (e) =>
      opts.onProgress?.({
        stage: 'read',
        status: 'beat',
        detail: `page ${e.page}`,
        index: e.page - 1,
        total: e.total,
      } as ProgressEvent),
  });
  project.writeJson('source/document.json', doc);
  noteSourceLang(project, doc);
  opts.onProgress?.({ stage: 'read', status: 'done', detail: `${doc.source.pages} pages` });
  return doc;
}

const textChars = (doc: SourceDocument, pages?: [number, number]) =>
  doc.blocks
    .filter((b) => b.kind !== 'figure' && (!pages || (b.page >= pages[0] && b.page <= pages[1])))
    .reduce((n, b) => n + b.text.replace(/\s+/g, '').length, 0);

/** The PDF's language when there is enough text to tell; undefined for a scan nobody has read yet. */
export const documentLang = (doc: SourceDocument): string | undefined =>
  textChars(doc) >= MIN_LANG_CHARS ? doc.lang : undefined;

/** Most pages are scans: the text layer alone can't show the planner what the book is about. */
export const mostlyScanned = (doc: SourceDocument): boolean =>
  doc.pages.filter((p) => p.method === 'none').length * 2 > doc.pages.length;

/** Record the PDF's language on the book once it is known (it decides which words the lessons keep). */
function noteSourceLang(project: Project, doc: SourceDocument): void {
  const lang = documentLang(doc);
  if (project.book.sourceLang || !lang) return;
  project.book.sourceLang = lang;
  project.saveBook();
}

/** Scanned pages in a range that nobody has read yet, the first `max` of them. */
export function unreadPages(doc: SourceDocument, pages: [number, number], max = MAX_VISION_PAGES): number[] {
  return doc.pages
    .filter((p) => p.n >= pages[0] && p.n <= pages[1] && p.method === 'none')
    .map((p) => p.n)
    .slice(0, max);
}

export interface ScanRead {
  /** Pages read now. */
  read: number;
  /** Scanned pages of the range still unread (no model to read them, failures, or past the limit). */
  left: number;
  /** Why pages could not be read (one line per distinct reason). */
  errors: string[];
}

/**
 * Read the unread scanned pages of a range (at most MAX_VISION_PAGES) with the vision model, or the OCR
 * worker, and merge them into source/document.json. Only those pages change; with `resection`, the
 * sections are found again from the new text (a scanned book before its plan).
 */
export async function readScannedPages(
  project: Project,
  pages: [number, number],
  opts: { llm: Llm; resection?: boolean; onProgress?: (e: ProgressEvent) => void },
): Promise<ScanRead> {
  const doc = loadDocument(project);
  const pdf = project.sourcePdf();
  if (!doc || !pdf) return { read: 0, left: 0, errors: [] };
  const todo = unreadPages(doc, pages);
  const vision = visionReader(project, opts.llm);
  const worker = project.config.worker;
  const left = () => unreadPages(loadDocument(project) ?? doc, pages, Number.POSITIVE_INFINITY).length;
  if (!todo.length) return { read: 0, left: left(), errors: [] };
  if (!vision && !worker) return { read: 0, left: left(), errors: [] };
  const range: [number, number] = [todo[0]!, todo.at(-1)!];
  const by = vision ? resolveRole('vision', project.config) : 'the OCR worker';
  opts.onProgress?.({ stage: 'read', status: 'start', detail: `${todo.length} scanned pages with ${by}` });
  const errors = new Set<string>();
  const part = await ingestPdf(pdf, {
    ocr: 'auto',
    ...(vision ? { vision } : {}),
    ...(worker ? { worker } : {}),
    pages: range,
    onProgress: (e) => {
      if (e.error) errors.add(e.error);
      opts.onProgress?.({
        stage: 'read',
        status: 'beat',
        detail: `page ${e.page}`,
        index: e.page - range[0],
        total: e.total,
      } as ProgressEvent);
    },
  });
  // only the scanned pages change: the text pages keep what the whole-book reading found (headings, running heads)
  const wanted = new Set(todo);
  const fresh = new Map(part.pages.filter((p) => wanted.has(p.n)).map((p) => [p.n, p]));
  const blocks = [...doc.blocks.filter((b) => !wanted.has(b.page)), ...part.blocks.filter((b) => wanted.has(b.page))];
  blocks.sort((a, b) => a.page - b.page);
  const merged: SourceDocument = {
    ...doc,
    lang: pageLang(blocks) ?? doc.lang,
    pages: doc.pages.map((p) => fresh.get(p.n) ?? p),
    blocks,
  };
  if (opts.resection) merged.sections = chooseSections(merged.outline, blocks, merged.source.pages);
  project.writeJson('source/document.json', merged);
  noteSourceLang(project, merged);
  const read = [...fresh.values()].filter((p) => p.method === 'ocr-vision' || p.method === 'ocr-worker').length;
  const result = { read, left: left(), errors: [...errors] };
  opts.onProgress?.({
    stage: 'read',
    status: errors.size ? 'error' : 'done',
    detail: `${read} of ${todo.length} pages read${errors.size ? `: ${result.errors.join('; ')}` : ''}`,
  });
  return result;
}

export interface LearnEstimate {
  /** Model spend of this run: reading scans, the plan (while there is none) and one chapter (USD). */
  usd: { p50: number; p90: number };
  /** Rough duration in seconds. */
  seconds: number;
  pages: number;
  /** The chapter the run will make, once there is a plan. */
  chapter?: string;
  /** Scanned pages the vision model will read. */
  visionPages: number;
  /** The book's spending limit, and what the book has spent already (the limit counts both). */
  limit?: number;
  spent: number;
}

/**
 * What the one go (or making one more chapter) will cost and take: shown on the learner's summary before
 * "Teach me", and on "Make chapter N". The plan's cost counts only while there is no plan yet.
 */
export function estimateLearn(project: Project, opts: { chapter?: string } = {}): LearnEstimate {
  const doc = loadDocument(project);
  const plan = loadPlan(project);
  const build = estimateBuild(project, { chapters: 1 });
  if (plan) {
    const planUsd = costOf(resolveRole('planner', project.config), 20000, 4000);
    build.p50 = Math.max(0, build.p50 - planUsd);
    build.p90 = Math.max(0, build.p90 - planUsd * 2.2);
  }
  const chapter = plan ? nextChapter(project, plan, opts.chapter) : undefined;
  let visionPages = 0;
  if (doc && !plan && mostlyScanned(doc)) visionPages = unreadPages(doc, [1, doc.source.pages]).length;
  else if (doc) {
    const range = chapter?.pages ?? firstSection(doc);
    visionPages = range && !(chapter && project.hasLesson(chapter.id)) ? unreadPages(doc, range).length : 0;
  }
  // a page image is about 1,500 input tokens and its transcription about 600 output tokens
  let vision = 0;
  if (visionPages) {
    try {
      vision = costOf(resolveRole('vision', project.config), 1500 * visionPages, 600 * visionPages);
    } catch {
      vision = 0; // no vision model: scanned pages are skipped, nothing is spent on them
    }
  }
  const narrate = project.config.tts.provider !== 'none';
  return {
    usd: { p50: build.p50 + vision, p90: build.p90 + vision * 2 },
    seconds: Math.round((plan ? 15 : 45) + 14 * 9 + visionPages * 6 + (narrate ? 14 * 2 : 0)),
    pages: doc?.source.pages ?? 0,
    ...(chapter ? { chapter: chapter.id } : {}),
    visionPages,
    ...(project.config.budget.usd !== undefined ? { limit: project.config.budget.usd } : {}),
    spent: ledgerSummary(project.path('.ledger.jsonl')).total,
  };
}

function scansError([from, to]: [number, number], scan: ScanRead): Error {
  const why = scan.errors.length
    ? `the AI could not read them (${scan.errors[0]})`
    : 'no AI service that reads images (a vision model) is connected';
  return new Error(
    `Pages ${from}–${to} of this PDF are scanned images, and ${why}. Connect one that reads images, then try again.`,
  );
}

/** Before a plan: the pages of the first chapter section (chapter 1 is usually there). */
function firstSection(doc: SourceDocument): [number, number] {
  const s = doc.sections.find((x) => x.id.startsWith('ch')) ?? doc.sections[0];
  return s ? [s.chapterStart ?? s.start, s.end] : [1, doc.source.pages];
}

type PlanChapter = BookPlan['chapters'][number];

/** The chapter a run makes: the one asked for, else the next one not made yet, else the first again. */
export function nextChapter(project: Project, plan: BookPlan, id?: string): PlanChapter | undefined {
  if (id) return plan.chapters.find((c) => c.id === id);
  const included = plan.chapters.filter((c) => c.include);
  return included.find((c) => !project.hasLesson(c.id)) ?? included[0];
}

function storyboardTitles(project: Project, chapterId: string): Record<string, string> {
  const story = project.readJson<{ beats?: { id: string; title: string }[] } | undefined>(
    `lessons/${chapterId}/storyboard.json`,
    undefined,
  );
  return Object.fromEntries((story?.beats ?? []).map((b) => [b.id, b.title]));
}

/**
 * "Too easy" / "Too hard" after a chapter: move the level one step for the next chapters. `from` is the level
 * the chapter was made at: answering again (or changing the answer) moves from there, never two steps.
 */
export function adjustLevel(
  project: Project,
  feedback: 'too-easy' | 'right' | 'too-hard',
  from?: LearnLevel,
): LearnLevel | undefined {
  const current = project.book.learn?.level;
  if (!current) return undefined;
  const level = from ?? current;
  const i = LEARN_LEVELS.indexOf(level) + (feedback === 'too-easy' ? 1 : feedback === 'too-hard' ? -1 : 0);
  const next = LEARN_LEVELS[Math.max(0, Math.min(LEARN_LEVELS.length - 1, i))]!;
  if (next !== current) {
    project.book.learn = { level: next };
    project.saveBook();
  }
  return next;
}

export interface LearnOptions {
  llm: Llm;
  /** Make this chapter (default: the next chapter not made yet; chapter 1 the first time). */
  chapter?: string;
  /** Synthesize narration (default: when a voice is configured). A failing voice never fails the job. */
  narrate?: boolean;
  /** A speech engine to use instead of the book's (tests). */
  tts?: TtsProvider;
  onProgress?: (e: ProgressEvent) => void;
}

export interface LearnResult {
  /** The chapter to open. */
  chapter: string;
  plan: BookPlan;
  report: ChapterReport;
  /** Scanned pages read during this run (before the plan and for the chapter). */
  visionPages: number;
  /** Narration was asked for but failed; the lesson plays with captions. */
  narrationError?: string;
}

/**
 * Read → plan (approved automatically, at the learner's level) → make one chapter. Every stage saves its
 * result, so a stopped run keeps what is done and running again reuses it (and the model cache).
 */
export async function learnFromPdf(project: Project, opts: LearnOptions): Promise<LearnResult> {
  const start = opts.llm.totalUsd;
  // every event carries the spend so far; a written beat carries its title (the one-go screen lists them)
  let titles: Record<string, string> | undefined;
  let current = opts.chapter ?? '';
  const p = (e: ProgressEvent) => {
    let ev = e;
    if (e.stage === 'storyboard' && e.status !== 'start') titles = undefined;
    if (e.stage === 'write' && e.status === 'beat') {
      titles ??= storyboardTitles(project, current);
      const id = e.detail.split(' ')[0]!;
      ev = { ...e, detail: titles[id] ?? e.detail };
    }
    opts.onProgress?.({ ...ev, usd: +(opts.llm.totalUsd - start).toFixed(4) });
  };
  let doc = loadDocument(project);
  if (!doc) doc = await readTextLayer(project, { onProgress: p });
  else {
    noteSourceLang(project, doc);
    p({ stage: 'read', status: 'skip' });
  }
  // a scanned book: read its first pages before planning, so the plan sees real text, chapters and language
  let visionPages = 0;
  if (!loadPlan(project) && mostlyScanned(doc)) {
    const scan = await readScannedPages(project, [1, doc.source.pages], {
      llm: opts.llm,
      resection: true,
      onProgress: p,
    });
    visionPages += scan.read;
    // nothing readable at all: stop before paying for a plan of empty pages
    if (textChars(loadDocument(project) ?? doc) < MIN_CHAPTER_CHARS) throw scansError([1, doc.source.pages], scan);
  }
  const plan = await ensurePlan(project, { llm: opts.llm, approve: true, onProgress: p });
  const chapter = nextChapter(project, plan, opts.chapter);
  if (!chapter)
    throw new Error(opts.chapter ? `no chapter "${opts.chapter}" in the plan` : 'The plan has no chapter to make.');
  current = chapter.id;
  if (!project.hasLesson(chapter.id)) {
    const scan = await readScannedPages(project, chapter.pages, { llm: opts.llm, onProgress: p });
    visionPages += scan.read;
    // a chapter of unread scans: say so rather than spend on a lesson the model would have to make up
    if (scan.left && textChars(loadDocument(project) ?? doc, chapter.pages) < MIN_CHAPTER_CHARS)
      throw scansError(chapter.pages, scan);
  }

  const report = await buildChapter(project, chapter.id, {
    llm: opts.llm,
    approve: true,
    narrate: false,
    onProgress: p,
  });
  // the voice is optional: if it fails, the lesson plays with captions (Stop and other errors still stop the run)
  const narrate = opts.narrate ?? project.config.tts.provider !== 'none';
  const problems = new Set<string>();
  if (narrate)
    for (const lang of project.book.langs) {
      const stage = `narrate:${lang}`;
      p({ stage, status: 'start', detail: opts.tts?.id ?? project.config.tts.provider });
      // only the speech call is guarded: the progress events stay outside, so a Stop is never taken for a voice error
      let r: NarrateReport | undefined;
      let failed: string[];
      try {
        r = await narrateLesson(project, chapter.id, lang, opts.tts ? { provider: opts.tts } : {});
        failed = [...new Set(r.failed.map((f) => f.error))];
      } catch (e) {
        failed = [e instanceof Error ? e.message : String(e)];
      }
      if (r) report.narration.push(r);
      for (const f of failed) problems.add(f);
      if (r && !failed.length)
        p({ stage, status: 'done', detail: `${r.synthesized.length} new, ${r.cached.length} cached` });
      else p({ stage, status: 'error', detail: failed.join('; ') });
    }
  const narrationError = problems.size ? [...problems].join('; ') : undefined;
  return { chapter: chapter.id, plan, report, visionPages, ...(narrationError ? { narrationError } : {}) };
}
