// Long-running work (read the PDF, plan, build, translate, narrate, export, QA, regenerate a beat, improve with
// the judge, add map regions, export a teacher review kit) runs as jobs: one at a time per project (a queue),
// with an event log that the browser follows over SSE.
// Cancelling is best effort: the job stops at the next stage boundary.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import * as P from '@warqa/pipeline';
import type { JobEvent, JobInfo, JobStatus, JobType } from '../shared/types.js';
import { docSummary, loadPlanSafe, type Registry } from './projects.js';
import { panelDir, panelZipPath, zipPath } from './zip.js';

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

interface Job extends JobInfo {
  events: JobEvent[];
  listeners: Set<(e: JobEvent) => void>;
  cancelRequested: boolean;
  seq: number;
}

export interface JobCtx {
  projectId: string;
  project: P.Project;
  args: Record<string, unknown>;
  /** Pipeline progress (also a cancellation point at stage boundaries). */
  progress(
    e: P.ProgressEvent | { stage: string; status: string; detail?: string; index?: number; total?: number },
    chapter?: string,
  ): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  /** Throws CancelledError when the job was cancelled. */
  checkpoint(): void;
  llm(): P.Llm;
}

export type Runner = (ctx: JobCtx) => Promise<unknown>;

/* ---------- helpers ---------- */

const strList = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v && v !== 'all')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
};

function chaptersOf(p: P.Project, arg: unknown): string[] {
  const explicit = strList(arg);
  if (explicit) return explicit;
  const plan = loadPlanSafe(p);
  if (plan) return plan.chapters.filter((c) => c.include).map((c) => c.id);
  return p.lessonIds();
}

/** True when the installed @warqa/pipeline can read PDFs. */
export const ingestAvailable = (): boolean => typeof (P as { ingestPdf?: unknown }).ingestPdf === 'function';

/* ---------- runners (mirror apps/cli) ---------- */

export const RUNNERS: Record<JobType, Runner> = {
  async ingest(ctx) {
    if (!ingestAvailable())
      throw new Error(
        'Reading PDFs is not available in this build of @warqa/pipeline (ingestPdf is missing). Update Warqa and try again.',
      );
    const p = ctx.project;
    const pdf = p.sourcePdf();
    if (!pdf) throw new Error('This book has no PDF. Add one to the source/ folder of the project.');
    const llm = ctx.llm();
    let vision: P.VisionOcr | undefined;
    try {
      const model = P.resolveRole('vision', p.config);
      vision = async (png, c) =>
        llm.text({
          stage: 'ingest',
          role: 'vision',
          model,
          system: P.VISION_OCR_SYSTEM,
          prompt: `Transcribe page ${c.page}${c.lang ? ` (language: ${c.lang})` : ''}.`,
          images: [{ data: png, mediaType: 'image/png' }],
        });
      ctx.log(`page images are read with ${model} when the text layer is missing or broken`);
    } catch {
      vision = undefined;
      ctx.log('no vision model configured: scanned pages will be skipped (add a key in Settings)', 'warn');
    }
    const a = ctx.args;
    const pages =
      typeof a.pages === 'string' && /^\d+-\d+$/.test(a.pages)
        ? (a.pages.split('-').map(Number) as [number, number])
        : undefined;
    ctx.progress({ stage: 'read', status: 'start', detail: pdf.split('/').pop() ?? '' });
    const doc = await P.ingestPdf(pdf, {
      ocr: a.ocr === 'never' || a.ocr === 'always' ? a.ocr : 'auto',
      ...(vision ? { vision } : {}),
      ...(p.config.worker ? { worker: p.config.worker } : {}),
      ...(pages ? { pages } : {}),
      ...(typeof a.level === 'number' ? { level: a.level } : {}),
      onProgress: (e) => {
        ctx.progress({
          stage: 'read',
          status: 'beat',
          detail: `page ${e.page} · ${e.method}`,
          index: e.page - 1,
          total: e.total,
        });
        if (e.error) ctx.log(`page ${e.page}: ${e.error}`, 'warn');
      },
    });
    p.writeJson('source/document.json', doc);
    const s = docSummary(p);
    ctx.progress({
      stage: 'read',
      status: 'done',
      detail: `${doc.source.pages} pages, ${doc.sections.filter((x) => x.id.startsWith('ch')).length} chapters`,
    });
    return s;
  },

  async plan(ctx) {
    const p = ctx.project;
    if (ctx.args.redo) p.writeJson('plan.json', null);
    const plan = await P.ensurePlan(p, { llm: ctx.llm(), approve: false, onProgress: (e) => ctx.progress(e) });
    return { chapters: plan.chapters.filter((c) => c.include).length, status: plan.status };
  },

  async build(ctx) {
    const p = ctx.project;
    const plan = loadPlanSafe(p);
    if (!plan) throw new Error('There is no plan yet: make the plan first.');
    if (plan.status !== 'approved') throw new Error('The plan is a draft: review it and approve it first.');
    const llm = ctx.llm();
    const langs = strList(ctx.args.langs);
    const force = strList(ctx.args.force) as P.BuildOptions['force'];
    const out: { chapter: string; errors: number; warnings: number; usd: number }[] = [];
    for (const id of chaptersOf(p, ctx.args.chapters)) {
      ctx.checkpoint();
      ctx.log(`▸ ${id}`);
      const r = await P.buildChapter(p, id, {
        llm,
        ...(langs ? { langs } : {}),
        ...(typeof ctx.args.narrate === 'boolean' ? { narrate: ctx.args.narrate } : {}),
        ...(force ? { force } : {}),
        onProgress: (e) => ctx.progress(e, id),
      });
      const errors = r.issues.filter((i) => i.level === 'error').length;
      const warnings = r.issues.filter((i) => i.level === 'warn').length;
      out.push({ chapter: id, errors, warnings, usd: r.usd });
      ctx.log(
        `${id}: ${errors ? `${errors} errors` : 'valid'}, ${warnings} warnings, $${r.usd.toFixed(3)}`,
        errors ? 'warn' : 'info',
      );
    }
    return { chapters: out, total: llm.totalUsd };
  },

  async translate(ctx) {
    const p = ctx.project;
    const langs = strList(ctx.args.langs) ?? strList(ctx.args.lang);
    if (!langs?.length) throw new Error('Choose a language to translate into.');
    const llm = ctx.llm();
    const plan = loadPlanSafe(p);
    const ids = chaptersOf(p, ctx.args.chapters).filter((id) => p.hasLesson(id));
    for (const lang of langs) {
      for (const id of ids) {
        ctx.checkpoint();
        const lesson = p.loadLesson(id);
        if (lesson.lang === lang) continue;
        const stage = `translate:${lang}`;
        ctx.progress({ stage, status: 'start', detail: P.resolveRole('translator', p.config) }, id);
        await P.translateLesson(p, id, lang, {
          llm,
          ...(plan ? { plan: plan as unknown as P.BookPlan } : {}),
          force: !!ctx.args.force,
          onChunk: (e) =>
            ctx.progress(
              { stage, status: 'beat', detail: `${e.keys} strings`, index: e.chunk - 1, total: e.total },
              id,
            ),
        });
        ctx.progress({ stage, status: 'done' }, id);
      }
      if (!p.book.langs.includes(lang)) {
        p.book.langs.push(lang);
        p.saveBook();
      }
    }
    return { langs, lessons: ids };
  },

  async narrate(ctx) {
    const p = ctx.project;
    const langs = strList(ctx.args.langs) ?? strList(ctx.args.lang) ?? p.book.langs;
    const ids = chaptersOf(p, ctx.args.chapters).filter((id) => p.hasLesson(id));
    const out: { lesson: string; lang: string; synthesized: number; cached: number; failed: number }[] = [];
    for (const id of ids) {
      const lesson = p.loadLesson(id);
      for (const lang of langs) {
        ctx.checkpoint();
        if (lang !== lesson.lang && !p.loadStrings(id, lang)) {
          ctx.log(`${id}: no ${lang} translation yet, skipped`, 'warn');
          continue;
        }
        const stage = `narrate:${lang}`;
        const total = lesson.beats.length;
        let i = 0;
        ctx.progress({ stage, status: 'start', detail: String(ctx.args.engine ?? p.config.tts.provider) }, id);
        const r = await P.narrateLesson(p, id, lang, {
          ...(typeof ctx.args.engine === 'string' ? { provider: ctx.args.engine } : {}),
          ...(typeof ctx.args.voice === 'string' && ctx.args.voice ? { voice: ctx.args.voice } : {}),
          force: !!ctx.args.force,
          onProgress: (e) =>
            ctx.progress(
              {
                stage,
                status: 'beat',
                detail: `${e.beat} · ${e.status}${e.error ? `: ${e.error}` : ''}`,
                index: i++,
                total,
              },
              id,
            ),
        });
        out.push({
          lesson: id,
          lang,
          synthesized: r.synthesized.length,
          cached: r.cached.length,
          failed: r.failed.length,
        });
        for (const f of r.failed.slice(0, 5)) ctx.log(`${id} ${lang} ${f.beat}: ${f.error}`, 'error');
        ctx.progress(
          {
            stage,
            status: r.failed.length ? 'error' : 'done',
            detail: `${r.provider}/${r.voice}: ${r.synthesized.length} new, ${r.cached.length} cached${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
          },
          id,
        );
      }
    }
    return { clips: out };
  },

  async export(ctx) {
    const p = ctx.project;
    ctx.progress({ stage: 'export', status: 'start' });
    const r = P.exportSite(p);
    const zip = zipPath(p.root);
    mkdirSync(dirname(zip), { recursive: true });
    rmSync(zip, { force: true });
    let zipped = false;
    try {
      zipped = spawnSync('zip', ['-qr', zip, '.'], { cwd: r.out, stdio: 'ignore' }).status === 0 && existsSync(zip);
    } catch {
      zipped = false;
    }
    if (!zipped) ctx.log('zip is not installed: the book folder is ready, but no .zip was made', 'warn');
    ctx.progress({
      stage: 'export',
      status: 'done',
      detail: `${r.lessons.length} lessons, ${r.langs.join('/')}, ${r.audio} audio clips`,
    });
    return { lessons: r.lessons, langs: r.langs, audio: r.audio, zip: zipped, url: `/books/${ctx.projectId}/` };
  },

  async qa(ctx) {
    const p = ctx.project;
    ctx.progress({ stage: 'export', status: 'start' });
    const out = P.exportSite(p).out;
    ctx.progress({ stage: 'export', status: 'done' });
    const { server, url } = await P.serveStatic(out, 0);
    const results: { lesson: string; lang: string; beats: number; issues: P.QaIssue[] }[] = [];
    try {
      const langs = strList(ctx.args.langs) ?? p.book.langs;
      for (const id of chaptersOf(p, ctx.args.chapters).filter((x) => p.hasLesson(x))) {
        for (const lang of langs) {
          ctx.checkpoint();
          ctx.progress({ stage: `qa:${lang}`, status: 'start' }, id);
          const r = await P.checkLesson({ url: `${url}${id}/index.html`, lang });
          results.push({ lesson: id, lang, beats: r.beats, issues: r.issues });
          for (const i of r.issues.slice(0, 8))
            ctx.log(`${id} ${lang} ${i.kind} ${i.id ? `${i.id}: ` : ''}${i.message}`, 'warn');
          ctx.progress(
            { stage: `qa:${lang}`, status: 'done', detail: r.issues.length ? `${r.issues.length} issues` : 'clean' },
            id,
          );
        }
      }
    } finally {
      server.close();
    }
    return { results };
  },

  async rewrite(ctx) {
    const p = ctx.project;
    const lessonId = String(ctx.args.lesson ?? '');
    const beatId = String(ctx.args.beat ?? '');
    if (!p.hasLesson(lessonId)) throw new Error(`There is no lesson "${lessonId}".`);
    const doc = P.loadDocument(p);
    if (!doc) throw new Error('Regenerating a beat needs the read PDF (source/document.json). Read the PDF first.');
    const plan = P.loadPlan(p);
    if (!plan) throw new Error('Regenerating a beat needs the book plan. Make the plan first.');
    ctx.progress({ stage: 'rewrite', status: 'start', detail: `${lessonId} › ${beatId}` });
    await P.rewriteBeat(p, doc, plan, lessonId, beatId, {
      llm: ctx.llm(),
      ...(typeof ctx.args.instruction === 'string' && ctx.args.instruction.trim()
        ? { instruction: ctx.args.instruction.trim() }
        : {}),
    });
    ctx.progress({ stage: 'rewrite', status: 'done' });
    return { lesson: lessonId, beat: beatId };
  },

  async estimate(ctx) {
    return P.estimateBuild(ctx.project);
  },

  improve: improveRunner(),
  geo: geoRunner(),

  async panel(ctx) {
    const p = ctx.project;
    const ids = chaptersOf(p, ctx.args.chapters).filter((id) => p.hasLesson(id));
    if (!ids.length) throw new Error('Make at least one lesson first.');
    const kit = `${p.book.id}-${new Date().toISOString().slice(0, 10)}`;
    ctx.progress({ stage: 'panel', status: 'start', detail: kit });
    // not blind: one book, its chapters are named by their ids
    const r = P.exportPanelKit(
      ids.map((id) => ({ project: p, lesson: id, label: id })),
      { out: panelDir(p.root), kit, blind: false },
    );
    const zip = panelZipPath(p.root);
    mkdirSync(dirname(zip), { recursive: true });
    rmSync(zip, { force: true });
    P.zipFolder(r.out, zip);
    ctx.progress({ stage: 'panel', status: 'done', detail: `${ids.length} lessons` });
    return { kit, lessons: ids };
  },
};

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/**
 * Judge in the loop: render each lesson, ask the vision judge, rewrite the beats it scores below the threshold,
 * judge again. `judge` replaces the Playwright judge (tests).
 */
export function improveRunner(deps: { judge?: P.ImproveOptions['judge'] } = {}): Runner {
  return async (ctx) => {
    const p = ctx.project;
    const ids = chaptersOf(p, ctx.args.chapters ?? ctx.args.lesson).filter((id) => p.hasLesson(id));
    if (!ids.length) throw new Error('Make at least one lesson first.');
    const threshold = clamp(ctx.args.threshold, 1, 5, 4);
    const rounds = Math.round(clamp(ctx.args.rounds, 1, 3, 1));
    const lang = typeof ctx.args.lang === 'string' && ctx.args.lang ? ctx.args.lang : undefined;
    const llm = ctx.llm();
    const lessons = [];
    for (const id of ids) {
      ctx.checkpoint();
      ctx.progress({ stage: 'improve', status: 'start', detail: P.resolveRole('judge', p.config) }, id);
      const r = await P.improveLesson(p, id, {
        llm,
        threshold,
        rounds,
        ...(lang ? { lang } : {}),
        ...(deps.judge ? { judge: deps.judge } : {}),
        onBeat: (e) =>
          ctx.progress(
            {
              stage: 'improve',
              status: 'beat',
              detail: `${e.id} · ${e.status} (${e.score}/5)${e.detail ? `: ${e.detail}` : ''}`,
            },
            id,
          ),
      });
      lessons.push({ lesson: id, ...r });
      for (const f of r.failed) ctx.log(`${id} ${f.id}: ${f.error}`, 'error');
      ctx.progress(
        {
          stage: 'improve',
          status: r.failed.length ? 'error' : 'done',
          detail: `${r.rewritten.length} rewritten${r.failed.length ? `, ${r.failed.length} failed` : ''}`,
        },
        id,
      );
    }
    return { lessons };
  };
}

/** The regions of a country (geoBoundaries) as a map layer of the book. `fetch` replaces the network (tests). */
export function geoRunner(deps: { fetch?: typeof fetch } = {}): Runner {
  return async (ctx) => {
    const country = String(ctx.args.country ?? '')
      .trim()
      .toUpperCase();
    const level = Number(ctx.args.level) === 2 ? 2 : 1;
    ctx.progress({ stage: 'geo', status: 'start', detail: `${country} · ADM${level}` });
    const l = await P.addGeoLayer(ctx.project, { country, level, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
    ctx.progress({ stage: 'geo', status: 'done', detail: `${l.id}: ${l.regions.length} regions` });
    return {
      id: l.id,
      name: l.name,
      source: l.source,
      license: l.license,
      attribution: l.attribution,
      regions: l.regions.length,
    };
  };
}

/* ---------- the queue ---------- */

const KEEP = 30;

export class Jobs {
  private jobs = new Map<string, Job>();
  private chains = new Map<string, Promise<void>>();

  constructor(
    private registry: Registry,
    private runners: Record<string, Runner> = RUNNERS,
    /** Extra model-client options for every job (e.g. a fake model in tests and the web app's test mode). */
    private llmOptions: Partial<P.LlmOptions> = {},
  ) {}

  private info(j: Job): JobInfo {
    const { events: _e, listeners: _l, cancelRequested: _c, seq: _s, ...rest } = j;
    return rest;
  }

  get(id: string): JobInfo | undefined {
    const j = this.jobs.get(id);
    return j ? this.info(j) : undefined;
  }

  list(projectId: string): JobInfo[] {
    return [...this.jobs.values()]
      .filter((j) => j.projectId === projectId)
      .map((j) => this.info(j))
      .sort((a, b) => b.created - a.created);
  }

  events(id: string): JobEvent[] {
    return this.jobs.get(id)?.events ?? [];
  }

  subscribe(id: string, fn: (e: JobEvent) => void): () => void {
    const j = this.jobs.get(id);
    if (!j) return () => {};
    j.listeners.add(fn);
    return () => j.listeners.delete(fn);
  }

  isOver(id: string): boolean {
    const s = this.jobs.get(id)?.status;
    return s === 'done' || s === 'error' || s === 'cancelled' || s === undefined;
  }

  private emit(j: Job, e: Omit<JobEvent, 'seq' | 'ts'>) {
    const ev: JobEvent = { seq: ++j.seq, ts: Date.now(), ...e };
    j.events.push(ev);
    if (j.events.length > 5000) j.events.splice(0, j.events.length - 5000);
    if (e.kind === 'progress')
      j.last = [e.chapter, e.stage, e.status === 'beat' ? `${(e.index ?? 0) + 1}/${e.total}` : e.status, e.detail]
        .filter(Boolean)
        .join(' · ');
    for (const l of j.listeners) {
      try {
        l(ev);
      } catch {
        /* a broken listener must not stop the job */
      }
    }
  }

  private setStatus(j: Job, s: JobStatus) {
    j.status = s;
    if (s === 'running') j.started = Date.now();
    if (s === 'done' || s === 'error' || s === 'cancelled') j.finished = Date.now();
    this.emit(j, { kind: 'status', jobStatus: s });
  }

  enqueue(projectId: string, type: JobType, args: Record<string, unknown> = {}): JobInfo {
    const runner = this.runners[type];
    if (!runner) throw new Error(`unknown job type "${type}"`);
    const dir = this.registry.dir(projectId);
    if (!dir) throw new Error(`no project "${projectId}"`);
    const j: Job = {
      id: randomUUID(),
      projectId,
      type,
      args,
      status: 'queued',
      created: Date.now(),
      events: [],
      listeners: new Set(),
      cancelRequested: false,
      seq: 0,
    };
    this.jobs.set(j.id, j);
    this.emit(j, { kind: 'status', jobStatus: 'queued' });
    this.prune(projectId);
    const prev = this.chains.get(projectId) ?? Promise.resolve();
    const run = prev.then(() => this.run(j, dir, runner));
    this.chains.set(projectId, run);
    void run.finally(() => {
      if (this.chains.get(projectId) === run) this.chains.delete(projectId);
    });
    return this.info(j);
  }

  cancel(id: string): JobInfo | undefined {
    const j = this.jobs.get(id);
    if (!j) return undefined;
    if (j.status === 'queued') {
      j.cancelRequested = true;
      this.setStatus(j, 'cancelled');
    } else if (j.status === 'running') {
      j.cancelRequested = true;
      this.emit(j, { kind: 'log', level: 'warn', message: 'stopping after the current step…' });
    }
    return this.info(j);
  }

  /** Wait for every queued job of a project (tests). */
  async idle(projectId: string): Promise<void> {
    while (this.chains.get(projectId)) await this.chains.get(projectId);
  }

  private prune(projectId: string) {
    const mine = [...this.jobs.values()]
      .filter((j) => j.projectId === projectId && this.isOver(j.id))
      .sort((a, b) => a.created - b.created);
    for (const j of mine.slice(0, Math.max(0, mine.length - KEEP))) this.jobs.delete(j.id);
  }

  private async run(j: Job, dir: string, runner: Runner): Promise<void> {
    if (j.cancelRequested) return;
    this.setStatus(j, 'running');
    let project: P.Project;
    try {
      project = new P.Project(dir);
    } catch (e) {
      j.error = (e as Error).message;
      this.emit(j, { kind: 'error', error: j.error });
      this.setStatus(j, 'error');
      return;
    }
    const checkpoint = () => {
      if (j.cancelRequested) throw new CancelledError();
    };
    const ctx: JobCtx = {
      projectId: j.projectId,
      project,
      args: j.args,
      progress: (e, chapter) => {
        this.emit(j, {
          kind: 'progress',
          stage: e.stage,
          status: e.status,
          ...(e.detail !== undefined ? { detail: e.detail } : {}),
          ...('index' in e && e.index !== undefined ? { index: e.index, total: e.total } : {}),
          ...(chapter ? { chapter } : {}),
        });
        if (e.status === 'done' || e.status === 'skip') checkpoint();
      },
      log: (message, level = 'info') => this.emit(j, { kind: 'log', message, level }),
      checkpoint,
      llm: () =>
        P.projectLlm(project, {
          ...this.llmOptions,
          onEvent: (e) => {
            if (e.type === 'repair')
              this.emit(j, { kind: 'log', level: 'warn', message: `repair · ${e.model}: ${e.detail ?? ''}` });
            else if (e.type === 'fallback')
              this.emit(j, {
                kind: 'log',
                level: 'warn',
                message: `${e.model} rejected the JSON schema; using JSON instructions`,
              });
            else if (e.type === 'call')
              this.emit(j, {
                kind: 'log',
                level: 'info',
                message: `${e.stage} · ${e.model}${e.detail ? ` · ${e.detail}` : ''}`,
              });
          },
        }),
    };
    try {
      const result = await runner(ctx);
      j.result = result;
      this.emit(j, { kind: 'result', result });
      this.setStatus(j, j.cancelRequested ? 'cancelled' : 'done');
    } catch (e) {
      if (e instanceof CancelledError || j.cancelRequested) {
        this.setStatus(j, 'cancelled');
      } else {
        j.error = (e as Error).message || String(e);
        this.emit(j, { kind: 'error', error: j.error });
        this.setStatus(j, 'error');
      }
    }
  }
}
