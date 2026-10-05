// Orchestration: ingest → plan → storyboard → write → translate → narrate → export → QA.
// Every stage writes its result into the project folder, so a run can stop and resume at any point.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Lesson, validateLesson } from '@warqa/lesson';
import { SourceDocument } from '../ingest/document.js';
import { costOf } from '../models/catalog.js';
import { Llm, type LlmOptions } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { type NarrateReport, narrateLesson } from '../tts/narrate.js';
import { learnerAudience } from './levels.js';
import { applyPlan, type BookPlan, loadPlan, planBook } from './plan.js';
import { type Storyboard, storyboardChapter } from './storyboard.js';
import { translateLesson } from './translate.js';
import { unfinishedDraft, writeChapter } from './write.js';

export type ProgressEvent = (
  | { stage: string; status: 'start' | 'done' | 'skip'; detail?: string }
  | {
      stage: string;
      status: 'beat';
      detail: string;
      index: number;
      total: number;
      /** A written beat's title, from the storyboard (the Make screen and the tray list beats as they come). */
      title?: string;
    }
  | { stage: string; status: 'error'; detail: string }
) & {
  /** Model spend of the run so far, in USD (the learner's one-go screen shows it). */
  usd?: number;
};

export function projectLlm(project: Project, extra: Partial<LlmOptions> = {}): Llm {
  return new Llm({
    cacheDir: project.path('cache', 'llm'),
    ledger: project.path('.ledger.jsonl'),
    ...(project.config.budget.usd !== undefined ? { budgetUsd: project.config.budget.usd } : {}),
    ...extra,
  });
}

export function loadDocument(project: Project): SourceDocument | undefined {
  const p = project.path('source', 'document.json');
  return existsSync(p) ? SourceDocument.parse(JSON.parse(readFileSync(p, 'utf8'))) : undefined;
}

export interface BuildOptions {
  llm?: Llm;
  /** Languages to translate into and narrate (default: all book languages). */
  langs?: string[];
  /** Synthesize narration (default: when a speech engine is configured). */
  narrate?: boolean;
  /** Redo stages even if their output exists. */
  force?: ('storyboard' | 'write' | 'translate' | 'narrate')[];
  /** Approve the plan automatically (CLI --yes). */
  approve?: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

export interface ChapterReport {
  chapter: string;
  lesson: Lesson;
  issues: { level: string; message: string; beat?: string }[];
  narration: NarrateReport[];
  usd: number;
}

/** Make sure there is a plan; create it if missing. */
export async function ensurePlan(project: Project, opts: BuildOptions = {}): Promise<BookPlan> {
  const llm = opts.llm ?? projectLlm(project);
  let plan = loadPlan(project);
  if (!plan) {
    const doc = loadDocument(project);
    if (!doc) throw new Error('no source/document.json: run `warqa ingest` first');
    opts.onProgress?.({ stage: 'plan', status: 'start' });
    plan = await planBook(project, doc, { llm });
    opts.onProgress?.({
      stage: 'plan',
      status: 'done',
      detail: `${plan.chapters.filter((c) => c.include).length} chapters`,
    });
  }
  if (opts.approve && plan.status !== 'approved') {
    plan.status = 'approved';
    project.writeJson('plan.json', plan);
  }
  if (plan.status === 'approved') applyPlan(project, plan);
  return plan;
}

/** Build one chapter end to end. */
export async function buildChapter(
  project: Project,
  chapterId: string,
  opts: BuildOptions = {},
): Promise<ChapterReport> {
  const llm = opts.llm ?? projectLlm(project);
  const before = llm.totalUsd;
  const doc = loadDocument(project);
  if (!doc) throw new Error('no source/document.json: run `warqa ingest` first');
  const plan = await ensurePlan(project, { ...opts, llm });
  if (plan.status !== 'approved')
    throw new Error('the book plan is a draft: review plan.json (or the studio) and approve it, or pass --yes');
  const chapter = plan.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`no chapter "${chapterId}" in the plan (${plan.chapters.map((c) => c.id).join(', ')})`);
  const force = new Set(opts.force ?? []);
  const p = opts.onProgress ?? (() => {});
  // a learner's book follows the current level ("Too easy" / "Too hard" changes it between chapters)
  const audience = learnerAudience(project.book);

  // storyboard
  let story = project.readJson<Storyboard | undefined>(`lessons/${chapterId}/storyboard.json`, undefined);
  if (!story || force.has('storyboard')) {
    p({ stage: 'storyboard', status: 'start', detail: resolveRole('storyboard', project.config) });
    story = await storyboardChapter(project, doc, plan, chapter, { llm, ...(audience ? { audience } : {}) });
    // beats written for an earlier storyboard are not this one's (beat ids repeat from one storyboard to the
    // next): the draft starts empty, so a Stop from here on leaves a chapter that goes on with the new beats
    project.writeJson(`lessons/${chapterId}/draft.json`, { beats: [], total: story.beats.length });
    p({ stage: 'storyboard', status: 'done', detail: `${story.beats.length} beats` });
  } else p({ stage: 'storyboard', status: 'skip' });

  // beats (a chapter stopped partway goes on from its last written beat)
  let lesson: Lesson;
  const replaced = project.hasLesson(chapterId);
  const wrote = !replaced || force.has('write') || force.has('storyboard') || !!unfinishedDraft(project, chapterId);
  if (wrote) {
    p({ stage: 'write', status: 'start', detail: resolveRole('writer', project.config) });
    lesson = await writeChapter(project, doc, plan, chapter, story, {
      llm,
      ...(audience ? { audience } : {}),
      force: force.has('write') || force.has('storyboard'),
      onBeat: (e) => {
        const title = story.beats.find((b) => b.id === e.id)?.title;
        p({
          stage: 'write',
          status: 'beat',
          detail: `${e.id}${e.repairs ? ` (${e.repairs} repairs)` : ''}`,
          index: e.index,
          total: e.total,
          ...(title ? { title } : {}),
        });
      },
    });
    // the strings of a lesson written over belong to its old beats: every translation is redone, and the list
    // of those left survives a Stop, so the next build finishes them
    if (replaced)
      markStale(
        project,
        chapterId,
        project.book.langs.filter((l) => l !== lesson.lang),
      );
    p({ stage: 'write', status: 'done' });
  } else {
    lesson = project.loadLesson(chapterId);
    p({ stage: 'write', status: 'skip' });
  }
  // link chapters in order
  const order = plan.chapters.filter((c) => c.include).map((c) => c.id);
  const next = order[order.indexOf(chapterId) + 1];
  if (next && lesson.next !== next) {
    lesson.next = next;
    project.saveLesson(chapterId, lesson);
  }
  const v = validateLesson(lesson, { pacing: true, requireSources: true });

  // translations
  const langs = opts.langs ?? project.book.langs;
  for (const lang of langs.filter((l) => l !== lesson.lang)) {
    const redo = force.has('translate') || staleTranslations(project, chapterId).includes(lang);
    if (project.loadStrings(chapterId, lang) && !redo) {
      p({ stage: `translate:${lang}`, status: 'skip' });
      continue;
    }
    p({ stage: `translate:${lang}`, status: 'start', detail: resolveRole('translator', project.config) });
    await translateLesson(project, chapterId, lang, { llm, plan, force: redo });
    markStale(
      project,
      chapterId,
      staleTranslations(project, chapterId).filter((l) => l !== lang),
    );
    p({ stage: `translate:${lang}`, status: 'done' });
  }

  // narration
  const narration: NarrateReport[] = [];
  const doNarrate = opts.narrate ?? project.config.tts.provider !== 'none';
  if (doNarrate) {
    for (const lang of langs) {
      p({ stage: `narrate:${lang}`, status: 'start', detail: project.config.tts.provider });
      const r = await narrateLesson(project, chapterId, lang, { force: force.has('narrate') });
      narration.push(r);
      p({
        stage: `narrate:${lang}`,
        status: r.failed.length ? 'error' : 'done',
        detail: r.failed.length
          ? r.failed.map((f) => `${f.beat}: ${f.error}`).join('; ')
          : `${r.synthesized.length} new, ${r.cached.length} cached`,
      });
    }
  }
  return { chapter: chapterId, lesson, issues: v.issues, narration, usd: llm.totalUsd - before };
}

/**
 * Languages whose strings still belong to the beats a lesson had before it was written again ("Make again"
 * stopped before its translations were all redone). The next build of the chapter translates them again.
 */
export function staleTranslations(project: Project, chapterId: string): string[] {
  return project.readJson<{ langs?: string[] }>(`lessons/${chapterId}/stale.json`, {}).langs ?? [];
}

function markStale(project: Project, chapterId: string, langs: string[]): void {
  if (langs.length || staleTranslations(project, chapterId).length)
    project.writeJson(`lessons/${chapterId}/stale.json`, { langs });
}

/** Rough cost estimate of building chapters (tokens per stage × model prices), p50 and p90. */
export function estimateBuild(
  project: Project,
  opts: { chapters?: number; charsPerChapter?: number; langs?: number } = {},
): { p50: number; p90: number; lines: string[] } {
  const doc = loadDocument(project);
  const plan = loadPlan(project);
  const chapters =
    opts.chapters ??
    plan?.chapters.filter((c) => c.include).length ??
    doc?.sections.filter((s) => s.id.startsWith('ch')).length ??
    10;
  const chars =
    opts.charsPerChapter ??
    (doc ? Math.round(doc.blocks.reduce((a, b) => a + b.text.length, 0) / Math.max(1, chapters)) : 20000);
  const langs = opts.langs ?? project.book.langs.length;
  const rows: [string, string, number, number][] = [
    ['plan', resolveRole('planner', project.config), 20000, 4000],
    ...chapterRows(project, chapters, chars, langs),
  ];
  let total = 0;
  const lines = rows.map(([stage, model, i, o]) => {
    const usd = costOf(model, i, o);
    total += usd;
    return `${stage.padEnd(11)} ${model.padEnd(40)} ~${Math.round(i / 1000)}k in / ${Math.round(o / 1000)}k out  $${usd.toFixed(2)}`;
  });
  lines.push(`narration  ${project.config.tts.provider} ~${Math.round((6000 * langs * chapters) / 1000)}k characters`);
  return { p50: total, p90: total * 2.2, lines };
}

/** The model calls of making `chapters` chapters of about `chars` characters each: storyboard, beats, translation. */
function chapterRows(
  project: Project,
  chapters: number,
  chars: number,
  langs: number,
): [string, string, number, number][] {
  const tok = (c: number) => c / 3.5;
  const role = (r: Parameters<typeof resolveRole>[0]) => resolveRole(r, project.config);
  const beats = 14;
  const writerIn = 9000 + tok(Math.min(chars, 16000));
  const rows: [string, string, number, number][] = [
    ['storyboard', role('storyboard'), (4000 + tok(Math.min(chars, 60000))) * chapters, 3500 * chapters],
    ['write', role('writer'), writerIn * beats * 1.4 * chapters, 1600 * beats * 1.4 * chapters],
  ];
  // a one-language book (a learner's book) needs no translator model
  if (langs > 1)
    rows.push(['translate', role('translator'), 9000 * (langs - 1) * chapters, 7000 * (langs - 1) * chapters]);
  return rows;
}

/**
 * What drafting the plan costs, and what making each chapter of the plan costs (storyboard, beats, translation;
 * from the text of its own pages, and the book's average for pages not read yet), so the plan screen can add up
 * the ticked chapters as they change. The high end of a range is `spread` times the estimate.
 */
export function estimateChapters(project: Project): {
  plan: number;
  chapters: Record<string, number>;
  spread: number;
  visionPage?: number;
} {
  const doc = loadDocument(project);
  const plan = loadPlan(project);
  const langs = project.book.langs.length;
  const perPage = new Map<number, number>();
  for (const b of doc?.blocks ?? []) perPage.set(b.page, (perPage.get(b.page) ?? 0) + b.text.length);
  const read = new Set(doc?.pages.map((p) => p.n) ?? []);
  const average = read.size ? [...perPage.values()].reduce((a, n) => a + n, 0) / read.size : 2500;
  const chapters: Record<string, number> = {};
  for (const c of plan?.chapters ?? []) {
    let chars = 0;
    for (let n = c.pages[0]; n <= c.pages[1]; n++) chars += read.has(n) ? (perPage.get(n) ?? 0) : average;
    chapters[c.id] = chapterRows(project, 1, Math.max(chars, 2000), langs).reduce(
      (a, [, m, i, o]) => a + costOf(m, i, o),
      0,
    );
  }
  // a page read from its image: about 1,500 tokens in, 600 out (no vision model: nothing is read, nothing paid)
  let visionPage: number | undefined;
  try {
    visionPage = costOf(resolveRole('vision', project.config), 1500, 600);
  } catch {
    visionPage = undefined;
  }
  return {
    plan: costOf(resolveRole('planner', project.config), 20000, 4000),
    chapters,
    spread: 2.2,
    ...(visionPage !== undefined ? { visionPage } : {}),
  };
}

export const lessonDir = (project: Project, id: string) => join(project.root, 'lessons', id);
