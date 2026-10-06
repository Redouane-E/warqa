// The studio's HTTP API (Hono). createApp() is used by the server entry and by the tests.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { faviconSvg, webManifest } from '@warqa/brand';
import {
  Card,
  ColorName,
  checkStrings,
  collectStrings,
  compileLesson,
  completeTimings,
  componentsFor,
  GENERIC_ACTIONS,
  type Lesson,
  type Issue as LessonIssue,
  localize,
  ltext,
  MOVES,
  Question,
  Slot,
  Strings,
  safeParseLesson,
  type Timings,
  validateLesson,
} from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import * as z from 'zod';
import type {
  Capabilities,
  CheckDetail,
  EditorCatalog,
  Issue,
  JobType,
  LanguageInfo,
  LessonDetail,
  ReviewImportResult,
  ReviewInfo,
  ReviewItem,
  ReviewState,
  StagePart,
  StatusInfo,
} from '../shared/types.js';
import { JOB_TYPES } from '../shared/types.js';
import { checkDetail } from './checks.js';
import { safeJoin, sendFile } from './files.js';
import { ingestAvailable, Jobs, type Runner } from './jobs.js';
import { checkKey } from './keycheck';
import { keysFile, maskedKeys, saveKeys } from './keys.js';
import { lessonLangs, projectDetail, projectSummary, Registry } from './projects.js';
import { panelDir, panelKeyPath, panelZipPath, zipPath, zipReady } from './zip.js';

const require = createRequire(import.meta.url);

export interface AppOptions {
  root: string;
  host?: string;
  /** Built React app (dist/client). */
  clientDir?: string;
  /** Override job runners (tests, the web app). */
  runners?: Record<string, Runner>;
  /** Path prefix of the URLs the API hands out (audio, assets, exported books). Default "/"; the web app passes its base. */
  urlBase?: string;
  /** What this host can run (the web app turns off what needs local programs). Default: everything. */
  capabilities?: Partial<Capabilities>;
  /** Extra options for the model client of every job (the web app's test-only fake model). */
  llm?: Partial<P.LlmOptions>;
  /** Speech engine of new projects (default "edge"). */
  defaultTts?: string;
}

const DESKTOP: Capabilities = {
  platform: 'desktop',
  ttsUnavailable: [],
  jobsUnavailable: [],
  keyStore: 'file',
  worker: true,
};

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 500,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
const LESSON_ID = /^[a-z][a-z0-9_-]{0,31}$/;

function studioVersion(): string {
  for (const p of ['../../package.json', '../package.json']) {
    try {
      const pkg = require(p) as { name?: string; version?: string };
      if (pkg.name === '@warqa/studio') return pkg.version ?? '0.0.0';
    } catch {
      /* try the next */
    }
  }
  return '0.0.0';
}

function playerDir(): string {
  const pkg = dirname(require.resolve('@warqa/lesson/package.json'));
  return join(pkg, 'dist', 'bundle');
}

/** The app icons @warqa/brand builds (PNG and SVG). */
function brandIconsDir(): string {
  return join(dirname(require.resolve('@warqa/brand/package.json')), 'dist', 'icons');
}

const isLoopback = (h: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h);

/** Lesson issues → API issues, tagged with a language. */
const tag = (issues: LessonIssue[], lang?: string): Issue[] =>
  issues.map((i) => ({
    level: i.level,
    message: i.message,
    ...(i.beat ? { beat: i.beat } : {}),
    ...(lang ? { lang } : {}),
  }));

function schemaIssues(raw: unknown, error: z.ZodError): Issue[] {
  const beats = (raw as { beats?: { id?: unknown }[] })?.beats;
  return error.issues.slice(0, 50).map((i) => {
    const path = i.path.map(String).join('.');
    const beat = i.path[0] === 'beats' && typeof i.path[1] === 'number' ? beats?.[i.path[1]]?.id : undefined;
    return {
      level: 'error' as const,
      message: `${path || '(lesson)'}: ${i.message}`,
      path,
      ...(typeof beat === 'string' ? { beat } : {}),
    };
  });
}

/** checkStrings messages look like "[fr] beat.x.narration: …" or "[fr] missing translation for key (…)". */
function stringIssueMap(issues: LessonIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) {
    const m = /^\[[\w-]+\] (?:missing translation for )?([^\s:]+)/.exec(i.message);
    if (m) (out[m[1]!] ??= []).push(i.message.replace(/^\[[\w-]+\] /, ''));
  }
  return out;
}

export function createApp(opts: AppOptions) {
  const registry = new Registry(opts.root, opts.defaultTts);
  const jobs = new Jobs(registry, opts.runners, opts.llm);
  const host = opts.host ?? '127.0.0.1';
  const caps: Capabilities = { ...DESKTOP, ...opts.capabilities };
  // the desktop: can Playwright's browser and ffmpeg run here (checks, the judge, videos)? Asked once.
  if (caps.platform === 'desktop') {
    if (caps.playwright === undefined) {
      caps.playwright = P.hasPlaywright();
    }
    if (caps.ffmpeg === undefined) {
      try {
        caps.ffmpeg = P.hasFfmpeg();
      } catch {
        caps.ffmpeg = false;
      }
    }
  }
  const urlBase = (opts.urlBase ?? '/').replace(/^\/*/, '/').replace(/\/*$/, '/');
  /** "/api/…" → the same path under urlBase ("/warqa/api/…" in the web app). */
  const url = (path: string) => urlBase + path.replace(/^\/+/, '');
  const app = new Hono();

  const project = (id: string): P.Project => {
    const p = registry.open(id);
    if (!p) throw new ApiError(404, `no project "${id}"`);
    return p;
  };
  const lessonIdOf = (p: P.Project, lid: string) => {
    if (!LESSON_ID.test(lid) || !p.hasLesson(lid)) throw new ApiError(404, `no lesson "${lid}"`);
    return lid;
  };
  const jsonBody = async (c: { req: { json: () => Promise<unknown> } }): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new ApiError(400, 'the request body is not valid JSON');
    }
  };

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, ...err.extra }, err.status);
    if (err instanceof z.ZodError)
      return c.json({ error: err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }, 400);
    console.error(err);
    return c.json({ error: (err as Error).message || 'server error' }, 500);
  });

  // Local-only guard: refuse other sites' pages (CSRF) and DNS-rebinding hosts while bound to loopback.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    const hostHeader = (c.req.header('host') ?? url.host).replace(/:\d+$/, '');
    if (isLoopback(host) && !isLoopback(hostHeader))
      return c.json({ error: 'the studio only answers on localhost' }, 403);
    const origin = c.req.header('origin');
    if (origin && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      let ok = false;
      try {
        ok = new URL(origin).host === (c.req.header('host') ?? url.host);
      } catch {
        ok = false;
      }
      if (!ok) return c.json({ error: 'cross-site requests are not allowed' }, 403);
    }
    await next();
  });

  /* ---------- status and keys ---------- */

  app.get('/api/status', (c) => {
    const keys = process.env;
    const avail = new Set(P.availablePresets(keys).map((p) => p.id));
    const status: StatusInfo = {
      version: studioVersion(),
      host,
      localOnly: isLoopback(host),
      keysFile: keysFile(),
      providers: P.providerStatus(keys).map((s) => {
        const info = P.PROVIDERS.find((x) => x.id === s.id)!;
        return { ...s, env: info.env, docs: info.docs };
      }),
      presets: P.PRESETS.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        roles: p.roles,
        needs: p.needs,
        available: avail.has(p.id),
        missing: p.needs.filter((g) => !g.some((k) => keys[k]?.trim())).map((g) => g[0]!),
      })),
      roles: P.ROLES.map((r) => ({ id: r, info: P.ROLE_INFO[r] })),
      models: P.listModels().map((m) => ({
        id: m.id,
        ...(m.name ? { name: m.name } : {}),
        tier: m.tier,
        vision: m.vision,
        structured: m.structured,
        context: m.context,
        input: m.input,
        output: m.output,
        ...(m.openWeights ? { openWeights: true } : {}),
        ...(m.license ? { license: m.license } : {}),
        ...(m.notes ? { notes: m.notes } : {}),
      })),
      tts: P.TTS_IDS.map((id) => {
        let t: P.TtsProvider | undefined;
        try {
          t = P.ttsProvider(id, { worker: 'http://localhost:8790' });
        } catch {
          t = undefined;
        }
        const voices: Record<string, string> = {};
        for (const l of ['ar', 'fr', 'en']) {
          const v = t?.defaultVoice(l);
          if (v) voices[l] = v;
        }
        const keyNames: Record<string, string[]> = {
          azure: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'],
          openai: ['OPENAI_API_KEY'],
          elevenlabs: ['ELEVENLABS_API_KEY'],
          google: ['GOOGLE_TTS_API_KEY'],
          gemini: ['GEMINI_API_KEY'],
        };
        return {
          id,
          ...(t?.note ? { note: t.note } : {}),
          ...(t?.costPerMChars !== undefined ? { costPerMChars: t.costPerMChars } : {}),
          wordTimes: !!t?.wordTimes,
          voices,
          keys: keyNames[id] ?? [],
        };
      }),
      ingest: ingestAvailable(),
      qa: !caps.jobsUnavailable.includes('qa') && caps.playwright !== false,
      capabilities: caps,
    };
    return c.json(status);
  });

  app.get('/api/keys', (c) => c.json({ keys: maskedKeys(), file: keysFile() }));
  app.put('/api/keys', async (c) => {
    const body = await jsonBody(c);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new ApiError(400, 'send an object like {"ANTHROPIC_API_KEY": "…"}');
    try {
      saveKeys(body as Record<string, unknown>);
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
    return c.json({ keys: maskedKeys(), file: keysFile() });
  });
  /** The start guide checks a key without spending anything before saving it (this call stores nothing). */
  app.post('/api/keys/check', async (c) => {
    const body = (await jsonBody(c)) as { provider?: string; key?: string } | null;
    const r = await checkKey(String(body?.provider ?? ''), String(body?.key ?? ''), !!opts.llm?.fake);
    if (!r) throw new ApiError(400, `unknown provider "${body?.provider}"`);
    return c.json(r);
  });

  /* ---------- projects ---------- */

  app.get('/api/projects', (c) => {
    const out = [];
    for (const [id, dir] of registry.scan()) {
      try {
        out.push(projectSummary(id, new P.Project(dir)));
      } catch (e) {
        out.push({
          id,
          error: (e as Error).message,
          title: { en: id },
          langs: [],
          defaultLang: 'en',
          chapters: 0,
          built: 0,
          updated: 0,
          hasPdf: false,
          exported: false,
          steps: {},
          spent: 0,
        });
      }
    }
    out.sort((a, b) => b.updated - a.updated);
    return c.json({ projects: out, root: registry.root });
  });

  app.post(
    '/api/projects',
    bodyLimit({ maxSize: 512 * 1024 * 1024, onError: (c) => c.json({ error: 'the PDF is larger than 512 MB' }, 413) }),
    async (c) => {
      const body = await c.req.parseBody();
      const pdf = body.pdf;
      let file: { name: string; data: Uint8Array } | undefined;
      if (pdf instanceof File && pdf.size > 0) {
        const data = new Uint8Array(await pdf.arrayBuffer());
        if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') throw new ApiError(400, 'this file is not a PDF');
        file = { name: pdf.name || 'book.pdf', data };
      }
      const langs = String(body.langs ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const bad = langs.filter((l) => !LANG.test(l));
      if (bad.length) throw new ApiError(400, `not a language code: ${bad.join(', ')}`);
      const created = registry.create({
        title: String(body.title ?? '').slice(0, 200),
        langs,
        defaultLang: String(body.defaultLang ?? langs[0] ?? ''),
        ...(body.audience ? { audience: String(body.audience).slice(0, 300) } : {}),
        ...(file ? { pdf: file } : {}),
      });
      return c.json(projectDetail(created.id, project(created.id), jobs.list(created.id)), 201);
    },
  );

  app.get('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    return c.json(projectDetail(id, project(id), jobs.list(id)));
  });

  const Settings = z.object({
    langs: z.array(z.string().regex(LANG)).min(1).max(20).optional(),
    defaultLang: z.string().regex(LANG).optional(),
    audience: z.string().max(300).optional(),
    tone: z.string().max(300).optional(),
    preset: z.string().max(40).nullable().optional(),
    models: z.record(z.string(), z.string().max(200)).optional(),
    tts: z
      .object({
        provider: z.enum(P.TTS_IDS).optional(),
        voices: z.record(z.string(), z.string().max(120)).optional(),
        rate: z
          .string()
          .regex(/^[+-]?\d{1,2}%$/)
          .nullable()
          .optional(),
        tashkeel: z.boolean().optional(),
      })
      .optional(),
    budget: z.object({ usd: z.number().positive().max(100000).nullable().optional() }).optional(),
    worker: z.string().max(300).nullable().optional(),
    digits: z.enum(['latn', 'arab']).optional(),
    title: z.record(z.string(), z.string().max(300)).optional(),
    subtitle: z.record(z.string(), z.string().max(500)).optional(),
    author: z.string().max(200).optional(),
  });

  app.put('/api/projects/:id/settings', async (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const s = Settings.parse(await jsonBody(c));
    const book = p.book;
    const cfg = p.config;
    if (s.langs) book.langs = [...new Set(s.langs)];
    if (s.defaultLang) {
      if (!book.langs.includes(s.defaultLang))
        throw new ApiError(400, `the main language (${s.defaultLang}) must be one of the book languages`);
      book.defaultLang = s.defaultLang;
    } else if (book.defaultLang && !book.langs.includes(book.defaultLang)) book.defaultLang = book.langs[0];
    if (s.audience !== undefined) {
      cfg.audience = s.audience || undefined;
      book.audience = s.audience || undefined;
    }
    if (s.tone !== undefined) cfg.tone = s.tone || undefined;
    if (s.preset !== undefined) {
      if (s.preset && !P.PRESETS.some((x) => x.id === s.preset))
        throw new ApiError(400, `unknown preset "${s.preset}"`);
      cfg.preset = s.preset || undefined;
    }
    if (s.models) {
      const models: Record<string, string> = {};
      for (const [role, m] of Object.entries(s.models)) {
        if (!(P.ROLES as string[]).includes(role)) throw new ApiError(400, `unknown role "${role}"`);
        const v = m.trim();
        if (!v) continue;
        if (!/^[a-z][a-z0-9-]*:.+$/.test(v))
          throw new ApiError(400, `model ids look like "provider:model", got "${v}"`);
        models[role] = v;
      }
      cfg.models = models;
    }
    if (s.tts) {
      if (s.tts.provider) cfg.tts.provider = s.tts.provider;
      if (s.tts.voices)
        cfg.tts.voices = Object.fromEntries(
          Object.entries(s.tts.voices)
            .filter(([k, v]) => LANG.test(k) && v.trim())
            .map(([k, v]) => [k, v.trim()]),
        );
      if (s.tts.rate !== undefined) cfg.tts.rate = s.tts.rate || undefined;
      if (s.tts.tashkeel !== undefined) cfg.tts.tashkeel = s.tts.tashkeel;
    }
    if (s.budget) cfg.budget.usd = s.budget.usd ?? undefined;
    if (s.worker !== undefined) {
      const w = (s.worker ?? '').trim();
      if (w && !/^https?:\/\/[^\s]+$/.test(w))
        throw new ApiError(400, 'the worker address must start with http:// or https://');
      cfg.worker = w || undefined;
    }
    if (s.digits) book.digits = s.digits;
    const mergeText = (cur: typeof book.title | undefined, patch: Record<string, string>) => {
      const base: Record<string, string> =
        typeof cur === 'string' ? { [book.defaultLang ?? book.langs[0]!]: cur } : { ...(cur ?? {}) };
      for (const [l, t] of Object.entries(patch)) {
        if (!LANG.test(l)) continue;
        if (t.trim()) base[l] = t.trim();
        else delete base[l];
      }
      return base;
    };
    if (s.title) {
      const t = mergeText(book.title, s.title);
      if (!Object.keys(t).length) throw new ApiError(400, 'the book needs a title');
      book.title = t;
    }
    if (s.subtitle) {
      const t = mergeText(book.subtitle, s.subtitle);
      book.subtitle = Object.keys(t).length ? t : undefined;
    }
    if (s.author !== undefined) book.author = s.author.trim() || undefined;
    // drop undefined fields so warqa.json stays clean
    for (const k of Object.keys(cfg))
      if ((cfg as Record<string, unknown>)[k] === undefined) delete (cfg as Record<string, unknown>)[k];
    for (const k of Object.keys(book))
      if ((book as Record<string, unknown>)[k] === undefined) delete (book as Record<string, unknown>)[k];
    P.PipelineConfig.parse(cfg);
    p.saveBook();
    return c.json(projectDetail(id, new P.Project(p.root), jobs.list(id)));
  });

  /* ---------- plan ---------- */

  app.get('/api/projects/:id/plan', (c) => {
    const p = project(c.req.param('id'));
    const plan = P.loadPlan(p);
    return c.json({ plan: plan ?? null });
  });

  app.put('/api/projects/:id/plan', async (c) => {
    const p = project(c.req.param('id'));
    const parsed = P.BookPlan.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new ApiError(
        422,
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    const plan = parsed.data;
    const ids = plan.chapters.map((ch) => ch.id);
    if (new Set(ids).size !== ids.length) throw new ApiError(422, 'two chapters have the same id');
    p.writeJson('plan.json', plan);
    if (plan.status === 'approved') P.applyPlan(p, plan);
    return c.json({ plan });
  });

  app.post('/api/projects/:id/plan/approve', (c) => {
    const p = project(c.req.param('id'));
    const plan = P.loadPlan(p);
    if (!plan) throw new ApiError(409, 'there is no plan to approve yet');
    if (!plan.chapters.some((ch) => ch.include)) throw new ApiError(422, 'include at least one chapter');
    plan.status = 'approved';
    p.writeJson('plan.json', plan);
    P.applyPlan(p, plan);
    return c.json({ plan });
  });

  // "How was this chapter?" on the learner's finish card: too easy or too hard moves the level one step for the
  // next chapters (the book must be a learner's book)
  app.post('/api/projects/:id/learn/feedback', async (c) => {
    const p = project(c.req.param('id'));
    // `from`: the level the chapter was made at, so a changed answer moves from there (never two steps)
    const body = (await jsonBody(c)) as { feedback?: string; from?: string } | null;
    const feedback = body?.feedback;
    if (feedback !== 'too-easy' && feedback !== 'right' && feedback !== 'too-hard')
      throw new ApiError(400, 'feedback must be too-easy, right or too-hard');
    const level = P.adjustLevel(p, feedback, P.isLearnLevel(body?.from) ? body.from : undefined);
    if (!level) throw new ApiError(409, "this book is not a learner's book");
    return c.json({ level });
  });

  app.get('/api/projects/:id/estimate', async (c) => {
    const p = project(c.req.param('id'));
    // ?learn=1[&chapter=ch02]: the learner's summary. Reads the PDF's text layer first if needed (free, no
    // model): it gives the page count and the PDF's language ("Your PDF is in French").
    if (c.req.query('learn')) {
      let doc: P.SourceDocument;
      try {
        doc = P.loadDocument(p) ?? (await P.readTextLayer(p));
      } catch (e) {
        throw new ApiError(422, (e as Error).message);
      }
      const chapter = c.req.query('chapter');
      try {
        const sourceLang = P.documentLang(doc); // unknown for a scan nobody has read yet
        return c.json({ ...P.estimateLearn(p, chapter ? { chapter } : {}), ...(sourceLang ? { sourceLang } : {}) });
      } catch (e) {
        // no AI service connected yet: the summary still shows the PDF, and asks to connect one
        const sourceLang = P.documentLang(doc);
        return c.json({
          pages: doc.source.pages,
          ...(sourceLang ? { sourceLang } : {}),
          visionPages: 0,
          usd: { p50: 0, p90: 0 },
          seconds: 0,
          ...(p.config.budget.usd !== undefined ? { limit: p.config.budget.usd } : {}),
          spent: P.ledgerSummary(p.path('.ledger.jsonl')).total,
          error: (e as Error).message,
        });
      }
    }
    try {
      return c.json({ ...P.estimateBuild(p), ...P.estimateChapters(p) });
    } catch (e) {
      return c.json({ p50: 0, p90: 0, lines: [], error: (e as Error).message });
    }
  });

  /* ---------- jobs ---------- */

  app.get('/api/projects/:id/jobs', (c) => {
    const id = c.req.param('id');
    project(id);
    return c.json({ jobs: jobs.list(id) });
  });

  app.post('/api/projects/:id/jobs', async (c) => {
    const id = c.req.param('id');
    project(id);
    const body = (await jsonBody(c)) as { type?: string; args?: Record<string, unknown> };
    if (!body || !JOB_TYPES.includes(body.type as JobType))
      throw new ApiError(400, `type must be one of ${JOB_TYPES.join(', ')}`);
    const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    if (caps.jobsUnavailable.includes(body.type as JobType))
      throw new ApiError(400, `"${body.type}" needs the desktop version of Warqa`, { desktopOnly: true });
    // the desktop without the programs these jobs drive: said before anything runs
    if ((body.type === 'qa' || body.type === 'improve' || body.type === 'video') && caps.playwright === false)
      throw new ApiError(
        400,
        'checks need Playwright’s Chromium on this computer: run `npx playwright install chromium`',
        {
          needs: 'playwright',
        },
      );
    if (body.type === 'video' && caps.ffmpeg === false)
      throw new ApiError(400, 'videos need ffmpeg on this computer', { needs: 'ffmpeg' });
    const engine = typeof args.engine === 'string' ? args.engine : project(id).config.tts.provider;
    if (caps.ttsUnavailable.includes(engine)) {
      if (body.type === 'narrate')
        throw new ApiError(400, `the "${engine}" voice needs the desktop version of Warqa: choose another voice`, {
          desktopOnly: true,
        });
      if (body.type === 'build' || body.type === 'learn') args.narrate = false;
    }
    const job = jobs.enqueue(id, body.type as JobType, args);
    return c.json({ jobId: job.id, job }, 202);
  });

  app.get('/api/jobs/:id', (c) => {
    const j = jobs.get(c.req.param('id'));
    if (!j) throw new ApiError(404, 'no such job');
    return c.json({ job: j, events: jobs.events(j.id) });
  });

  app.post('/api/jobs/:id/cancel', (c) => {
    const j = jobs.cancel(c.req.param('id'));
    if (!j) throw new ApiError(404, 'no such job');
    return c.json({ job: j });
  });

  app.get('/api/jobs/:id/events', (c) => {
    const id = c.req.param('id');
    if (!jobs.get(id)) throw new ApiError(404, 'no such job');
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const queue: import('../shared/types.js').JobEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = jobs.subscribe(id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      try {
        for (const e of jobs.events(id)) if (e.seq > after) queue.push(e);
        let lastSeq = after;
        while (!stream.aborted) {
          while (queue.length) {
            const e = queue.shift()!;
            if (e.seq <= lastSeq) continue;
            lastSeq = e.seq;
            await stream.writeSSE({ id: String(e.seq), event: e.kind, data: JSON.stringify(e) });
          }
          if (jobs.isOver(id)) {
            await stream.writeSSE({ event: 'end', data: JSON.stringify(jobs.get(id) ?? {}) });
            break;
          }
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 15000);
          });
          wake = null;
          if (!queue.length && !jobs.isOver(id) && !stream.aborted)
            await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  /* ---------- lessons ---------- */

  /** String key → the beat it belongs to (so translation problems show on their beat). */
  function beatOfKey(lesson: Lesson): (key: string) => string | undefined {
    const map = new Map<string, string>();
    for (const b of lesson.beats) {
      map.set(`beat.${b.id}`, b.id);
      for (const n of b.scene.add) map.set(`node.${n.id}`, b.id);
      for (const q of b.questions ?? []) map.set(`q.${q.id}`, b.id);
    }
    return (key) => {
      const parts = key.split('.');
      return map.get(`${parts[0]}.${parts[1]}`);
    };
  }

  function lessonIssues(
    p: P.Project,
    lid: string,
    lesson: Lesson,
  ): { issues: Issue[]; stringIssues: Record<string, Record<string, string[]>> } {
    const issues: Issue[] = [];
    const beatOf = beatOfKey(lesson);
    const stringIssues: Record<string, Record<string, string[]>> = {};
    const authorTimings = p.loadTimings(lid, lesson.lang);
    const base = validateLesson(lesson, {
      lang: lesson.lang,
      pacing: true,
      ...(authorTimings ? { timings: authorTimings } : {}),
    }).issues;
    issues.push(...tag(base));
    const seen = new Set(base.map((i) => `${i.beat}|${i.message}`));
    for (const lang of lessonLangs(p, lid, lesson)) {
      if (lang === lesson.lang) continue;
      let strings: ReturnType<P.Project['loadStrings']>;
      try {
        strings = p.loadStrings(lid, lang);
      } catch (e) {
        issues.push({ level: 'error', message: `strings.${lang}.json: ${(e as Error).message.slice(0, 200)}`, lang });
        continue;
      }
      if (!strings) continue;
      const cs = checkStrings(lesson, strings, lang);
      stringIssues[lang] = stringIssueMap(cs);
      for (const i of tag(cs, lang)) {
        const key = /^\[[\w-]+\] (?:missing translation for )?([^\s:]+)/.exec(i.message)?.[1];
        const beat = key ? beatOf(key) : undefined;
        issues.push(beat ? { ...i, beat } : i);
      }
      const timings = p.loadTimings(lid, lang);
      const v = validateLesson(localize(lesson, strings), {
        lang,
        pacing: true,
        ...(timings ? { timings } : {}),
      }).issues;
      issues.push(
        ...tag(
          v.filter((i) => !seen.has(`${i.beat}|${i.message}`)),
          lang,
        ),
      );
    }
    return { issues, stringIssues };
  }

  /** What is on the stage during each beat: its nodes (not those fading out), their parts, the beat that added them. */
  function stageParts(lesson: Lesson): Record<string, StagePart[]> {
    const out: Record<string, StagePart[]> = {};
    try {
      const compiled = compileLesson(lesson, undefined, { strict: false });
      const added = new Map<string, number>();
      compiled.beats.forEach((cb, i) => {
        for (const n of lesson.beats[i]!.scene.add) added.set(n.id, i);
        const leaving = new Set(cb.leaving);
        out[cb.id] = cb.start.order
          .filter((id) => !leaving.has(id))
          .map((id) => {
            const n = cb.start.nodes[id]!;
            return { id, type: n.type, parts: Object.keys(n.subs), from: added.get(id) ?? i };
          });
      });
    } catch {
      /* a lesson that does not compile shows no parts; its problems say why */
    }
    return out;
  }

  /** The editor's catalog: every component (the book's packs too) with its props and actions as JSON Schema. */
  app.get('/api/projects/:id/components', (c) => {
    const p = project(c.req.param('id')); // opening the book registers its component packs
    // the registry holds every pack opened in this process: a book offers its own and the built-in ones
    const own = new Set(P.loadPacks(p.root, p.config.components).flatMap((x) => x.types));
    const js = (schema: z.ZodType): Record<string, unknown> => {
      try {
        const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
        delete out.$schema;
        return out;
      } catch {
        return {};
      }
    };
    const catalog: EditorCatalog = {
      components: componentsFor()
        .filter((d) => !d.external || own.has(d.type))
        .map((d) => ({
          type: d.type,
          pack: d.pack,
          defaultSlot: d.defaultSlot,
          text: d.text,
          props: js(d.props),
          actions: Object.fromEntries(
            Object.entries(d.actions ?? {}).map(([name, a]) => [
              name,
              { args: js(a.args), ...(a.text ? { text: a.text } : {}), ...(a.dur !== undefined ? { dur: a.dur } : {}) },
            ]),
          ),
          example: d.examples[0]?.props ?? {},
        })),
      generic: [...GENERIC_ACTIONS],
      question: js(Question),
      card: js(Card),
      colors: [...ColorName.options],
      slots: [...Slot.options],
    };
    return c.json(catalog);
  });

  /**
   * What writing one beat again costs. It reads the document and the plan: kept until they or the models change,
   * and left out (not an error) when either cannot be read.
   */
  const rewriteCosts = new Map<string, { key: string; usd: number | undefined }>();
  function rewriteCost(p: P.Project): number | undefined {
    const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);
    const key = [p.path('source', 'document.json'), p.path('plan.json'), p.path('warqa.json')].map(mtime).join('|');
    const hit = rewriteCosts.get(p.root);
    if (hit?.key === key) return hit.usd;
    let usd: number | undefined;
    try {
      usd = P.estimateBeat(p);
    } catch {
      usd = undefined;
    }
    rewriteCosts.set(p.root, { key, usd });
    return usd;
  }

  /** What the editor shows besides the lesson: waiting new versions of beats, the judge's notes, a rewrite's cost. */
  function lessonExtras(
    p: P.Project,
    lid: string,
    lang: string,
    saved?: Lesson,
  ): Pick<LessonDetail, 'candidates' | 'judge' | 'rewriteUsd'> {
    const candidates: NonNullable<LessonDetail['candidates']> = {};
    const dir = p.path('lessons', lid, 'candidates');
    if (existsSync(dir))
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        const c = p.readJson<
          { at?: number; instruction?: string; beat?: Record<string, unknown>; base?: unknown } | undefined
        >(`lessons/${lid}/candidates/${f}`, undefined);
        const bid = f.slice(0, -5);
        // the beat was saved with changes after this version was written: keeping it replaces them
        const now = saved?.beats.find((b) => b.id === bid);
        if (c)
          candidates[bid] = {
            at: c.at ?? 0,
            ...(c.instruction ? { instruction: c.instruction } : {}),
            ...(c.beat ? { beat: c.beat } : {}),
            ...(c.base && now && JSON.stringify(now) !== JSON.stringify(c.base) ? { changed: true } : {}),
          };
      }
    // the judge looks at one language: the lesson's own when it was judged in it, else any
    const judged = [lang, ...p.book.langs].find((l) => existsSync(p.path('qa', lid, `${l}-judge.json`)));
    const judge: NonNullable<LessonDetail['judge']> = {};
    if (judged)
      for (const v of p.readJson<{ id: string; score: number; problem?: string; fix?: string }[]>(
        `qa/${lid}/${judged}-judge.json`,
        [],
      ))
        judge[v.id] = {
          score: v.score,
          ...(v.problem ? { problem: v.problem } : {}),
          ...(v.fix ? { fix: v.fix } : {}),
        };
    const rewriteUsd = rewriteCost(p);
    return {
      ...(Object.keys(candidates).length ? { candidates } : {}),
      ...(Object.keys(judge).length ? { judge } : {}),
      ...(rewriteUsd !== undefined ? { rewriteUsd } : {}),
    };
  }

  /** "Chapter 5 · Unit 2": the lesson's number among the chapters to make, and the book unit holding it. */
  function lessonPlace(p: P.Project, lid: string): Pick<LessonDetail, 'chapter' | 'unit'> {
    let plan: ReturnType<typeof P.loadPlan>;
    try {
      plan = P.loadPlan(p);
    } catch {
      plan = undefined;
    }
    const n = (plan?.chapters.filter((c) => c.include) ?? []).findIndex((c) => c.id === lid) + 1;
    const u = p.book.units.findIndex((x) => x.chapters.includes(lid));
    return {
      ...(n > 0 ? { chapter: n } : {}),
      ...(u >= 0 ? { unit: { index: u + 1, title: p.book.units[u]!.title } } : {}),
    };
  }

  app.get('/api/projects/:id/lessons/:lid', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const raw = p.loadLessonRaw(lid) as LessonDetail['lesson'];
    const parsed = safeParseLesson(raw);
    const strings: LessonDetail['strings'] = {};
    const timings: LessonDetail['timings'] = {};
    const audio: LessonDetail['audio'] = {};
    for (const lang of p.book.langs) {
      try {
        const s = p.loadStrings(lid, lang);
        if (s) strings[lang] = s;
      } catch {
        /* reported below */
      }
      try {
        const t = p.loadTimings(lid, lang);
        if (t) timings[lang] = t;
      } catch {
        /* ignore */
      }
      const files = Object.keys(p.audioFiles(lid, lang));
      if (files.length) audio[lang] = files;
    }
    if (!parsed.success) {
      const detail: LessonDetail = {
        id: lid,
        lesson: raw,
        langs: [raw.lang],
        strings,
        timings,
        entries: [],
        issues: schemaIssues(raw, parsed.error),
        stringIssues: {},
        audio,
        moves: [...MOVES],
        bookLangs: p.book.langs,
        bookId: p.book.id,
        ...lessonPlace(p, lid),
      };
      return c.json(detail);
    }
    const lesson = parsed.data as Lesson;
    const { issues, stringIssues } = lessonIssues(p, lid, lesson);
    const detail: LessonDetail = {
      id: lid,
      lesson: raw,
      langs: lessonLangs(p, lid, lesson),
      strings,
      timings,
      entries: collectStrings(lesson),
      issues,
      stringIssues,
      audio,
      moves: [...MOVES],
      bookLangs: p.book.langs,
      bookId: p.book.id,
      ...lessonPlace(p, lid),
      parts: stageParts(lesson),
      ...lessonExtras(p, lid, lesson.lang, lesson),
    };
    return c.json(detail);
  });

  /* ---------- a beat written again (Regenerate): compare, keep the new version or the old one, undo ---------- */

  const candidatePath = (lid: string, bid: string) => `lessons/${lid}/candidates/${bid}.json`;
  const historyPath = (lid: string, bid: string) => `lessons/${lid}/history/${bid}.json`;
  const beatParam = (c: Context) => {
    const bid = c.req.param('bid') ?? '';
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(bid)) throw new ApiError(400, `not a beat id: ${bid}`);
    return bid;
  };

  app.post('/api/projects/:id/lessons/:lid/beats/:bid/accept', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const bid = beatParam(c);
    const cand = p.readJson<{ beat?: unknown } | undefined>(candidatePath(lid, bid), undefined);
    if (!cand?.beat) throw new ApiError(404, `no new version of "${bid}" is waiting`);
    const beat = cand.beat as Lesson['beats'][number];
    // the later beats may have changed since it was written: it goes in only if it breaks nothing that worked
    const parsed = safeParseLesson(p.loadLessonRaw(lid));
    if (!parsed.success)
      throw new ApiError(422, 'the lesson does not match the lesson format; fix it in the editor first');
    const now = parsed.data as Lesson;
    if (!now.beats.some((b) => b.id === bid)) throw new ApiError(404, `there is no beat "${bid}" any more`);
    const errors = (l: Lesson) =>
      validateLesson(l, { lang: l.lang })
        .issues.filter((i) => i.level === 'error')
        .map((i) => `${i.beat ?? ''}: ${i.message}`);
    const before = new Set(errors(now));
    const added = errors({ ...now, beats: now.beats.map((b) => (b.id === bid ? beat : b)) }).filter(
      (e) => !before.has(e),
    );
    if (added.length)
      throw new ApiError(409, `the new version no longer fits the beats after it: ${added.slice(0, 3).join('; ')}`);
    const swap = P.applyBeat(p, lid, beat);
    // the judge's notes were about the old version: they go, and come back with it
    const verdicts: Record<string, unknown> = {};
    for (const lang of p.book.langs) {
      const f = `qa/${lid}/${lang}-judge.json`;
      if (!existsSync(p.path(f))) continue;
      const all = p.readJson<{ id: string }[]>(f, []);
      const v = all.find((x) => x.id === bid);
      if (!v) continue;
      verdicts[lang] = v;
      p.writeJson(
        f,
        all.filter((x) => x.id !== bid),
      );
    }
    // kept until the next swap of this beat: Undo puts the old version, its translations and notes back
    p.writeJson(historyPath(lid, bid), { ...swap, verdicts });
    rmSync(p.path(candidatePath(lid, bid)), { force: true });
    return c.json({ ok: true, langs: Object.keys(swap.dropped).filter((l) => Object.keys(swap.dropped[l]!).length) });
  });

  app.delete('/api/projects/:id/lessons/:lid/beats/:bid/candidate', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    rmSync(p.path(candidatePath(lid, beatParam(c))), { force: true });
    return c.json({ ok: true });
  });

  app.post('/api/projects/:id/lessons/:lid/beats/:bid/restore', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const bid = beatParam(c);
    const swap = p.readJson<(P.BeatSwap & { verdicts?: Record<string, { id: string }> }) | undefined>(
      historyPath(lid, bid),
      undefined,
    );
    if (!swap?.previous) throw new ApiError(404, `there is no earlier version of "${bid}"`);
    P.restoreBeat(p, lid, swap);
    for (const [lang, v] of Object.entries(swap.verdicts ?? {})) {
      const f = `qa/${lid}/${lang}-judge.json`;
      p.writeJson(f, [...p.readJson<{ id: string }[]>(f, []).filter((x) => x.id !== bid), v]);
    }
    rmSync(p.path(historyPath(lid, bid)), { force: true });
    return c.json({ ok: true });
  });

  app.put('/api/projects/:id/lessons/:lid', async (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const raw = await jsonBody(c);
    const force = c.req.query('force') === '1';
    const dry = c.req.query('dry') === '1';
    const parsed = safeParseLesson(raw);
    if (!parsed.success)
      return c.json(
        { error: 'the lesson does not match the lesson format', saved: false, issues: schemaIssues(raw, parsed.error) },
        422,
      );
    const lesson = parsed.data as Lesson;
    if (lesson.id !== lid)
      return c.json(
        {
          error: `the lesson id must stay "${lid}"`,
          saved: false,
          issues: [{ level: 'error', message: `id: must be "${lid}"`, path: 'id' }],
        },
        422,
      );
    const { issues, stringIssues } = lessonIssues(p, lid, lesson);
    // translation problems never block saving the author lesson; they are follow-ups for the translations
    const blocking = issues.filter((i) => i.level === 'error' && !i.lang);
    if (dry)
      return c.json({ saved: false, issues, stringIssues, entries: collectStrings(lesson), parts: stageParts(lesson) });
    if (blocking.length && !force)
      return c.json(
        { error: `${blocking.length} errors: fix them or save anyway`, saved: false, issues, stringIssues },
        422,
      );
    p.saveLesson(lid, raw);
    return c.json({ saved: true, issues, stringIssues, entries: collectStrings(lesson) });
  });

  /**
   * After ids changed in the editor (a part, a question, a beat) or cues were removed, the translations' keys follow:
   * batches in order, each applied at once (keys starting with `from` start with `to`, or go when `to` is null).
   */
  app.post('/api/projects/:id/lessons/:lid/strings/move', async (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const body = (await jsonBody(c)) as { batches?: unknown };
    const ok = (m: unknown): m is { from: string; to: string | null } =>
      !!m &&
      typeof (m as { from?: unknown }).from === 'string' &&
      (m as { from: string }).from.endsWith('.') &&
      ((m as { to?: unknown }).to === null || typeof (m as { to?: unknown }).to === 'string');
    const batches = (Array.isArray(body.batches) ? (body.batches as unknown[]) : [])
      .filter((b): b is unknown[] => Array.isArray(b))
      .map((b) => b.filter(ok));
    // the translations move with their people's checks and the records of what they were made from
    return c.json({ moved: P.moveStringKeys(p, lid, batches) });
  });

  app.put('/api/projects/:id/lessons/:lid/strings/:lang', async (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const lang = c.req.param('lang');
    if (!LANG.test(lang)) throw new ApiError(400, `not a language code: ${lang}`);
    const lesson = p.loadLesson(lid);
    if (lang === lesson.lang)
      throw new ApiError(400, `${lang} is the language the lesson is written in: edit the lesson itself`);
    const parsed = Strings.safeParse(await jsonBody(c));
    if (!parsed.success) throw new ApiError(422, 'translations must be an object of "key": "text"');
    const known = new Set(collectStrings(lesson).map((e) => e.key));
    const clean = Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([k, v]) => known.has(k) && (typeof v === 'string' ? v.length : v.text.length),
      ),
    );
    // typed by hand: recorded as made from the original as it is now (the next translation run keeps it)
    P.saveTypedStrings(p, lid, lang, clean);
    if (!p.book.langs.includes(lang)) {
      p.book.langs.push(lang);
      p.saveBook();
    }
    const issues = checkStrings(lesson, clean, lang);
    return c.json({ saved: true, issues: tag(issues, lang), stringIssues: { [lang]: stringIssueMap(issues) } });
  });

  app.get('/api/projects/:id/lessons/:lid/player', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const lid = lessonIdOf(p, c.req.param('lid'));
    const parsed = safeParseLesson(p.loadLessonRaw(lid));
    if (!parsed.success)
      throw new ApiError(422, 'the lesson does not match the lesson format; fix it in the editor first');
    let lesson = parsed.data as Lesson;
    // ?candidate=<beat>: the lesson with the new version of that beat in it (the editor's Compare, "After"); that
    // beat's translations, recording and timing were for the old version: it shows untranslated, timed by its text
    let swapped: { id: string; stale: (k: string) => boolean } | undefined;
    const candidate = c.req.query('candidate');
    if (candidate && /^[a-z][a-z0-9_-]{0,31}$/.test(candidate)) {
      const cand = p.readJson<{ beat?: Lesson['beats'][number] } | undefined>(candidatePath(lid, candidate), undefined);
      const old = lesson.beats.find((b) => b.id === candidate);
      if (cand?.beat && old) {
        lesson = { ...lesson, beats: lesson.beats.map((b) => (b.id === candidate ? cand.beat! : b)) };
        swapped = { id: candidate, stale: P.staleKeys(old, cand.beat) };
      }
    }
    const langs: string[] = [];
    const strings: Record<string, Strings> = {};
    const timings: Record<string, Timings> = {};
    const audio: Record<string, Record<string, string>> = {};
    for (const lang of p.book.langs) {
      let s: ReturnType<P.Project['loadStrings']>;
      try {
        s = lang === lesson.lang ? undefined : p.loadStrings(lid, lang);
      } catch {
        continue;
      }
      if (lang !== lesson.lang && !s) continue;
      if (s && swapped) s = Object.fromEntries(Object.entries(s).filter(([k]) => !swapped.stale(k)));
      langs.push(lang);
      if (s) strings[lang] = s;
      const localized = localize(lesson, s);
      let t: Timings | undefined;
      try {
        t = p.loadTimings(lid, lang);
      } catch {
        t = undefined;
      }
      if (t && swapped) {
        const { [swapped.id]: _old, ...rest } = t;
        t = rest;
      }
      timings[lang] = completeTimings(localized, lang, t);
      const beatIds = new Set(localized.beats.map((b) => b.id));
      for (const [b, f] of Object.entries(p.audioFiles(lid, lang))) {
        if (!beatIds.has(b) || b === swapped?.id) continue;
        const v = Math.round(statSync(join(p.audioDir(lid, lang), f)).mtimeMs);
        (audio[lang] ??= {})[b] = url(
          `/api/projects/${encodeURIComponent(id)}/files/lessons/${lid}/audio/${encodeURIComponent(lang)}/${encodeURIComponent(f)}?v=${v}`,
        );
      }
    }
    if (!langs.includes(lesson.lang)) langs.unshift(lesson.lang);
    const want = c.req.query('lang');
    const def =
      want && langs.includes(want) ? want : langs.includes(p.book.defaultLang ?? '') ? p.book.defaultLang! : langs[0]!;
    // display math typeset to SVG (MathJax, only when the lesson has "math" nodes; a broken formula shows as TeX)
    let math: Record<string, string> | undefined;
    try {
      math = P.lessonMath(lesson);
    } catch {
      math = undefined;
    }
    // the book's component packs: the preview loads them before mounting the player
    const packs = (p.config.components ?? []).map((f) =>
      url(`/api/projects/${encodeURIComponent(id)}/packs/${encodeURIComponent(basename(f))}`),
    );
    return c.json({
      lesson,
      langs,
      lang: def,
      strings,
      timings,
      audio,
      book: { id: p.book.id, title: ltext(p.book.title, def), digits: p.book.digits },
      assetsBase: url(`/api/projects/${encodeURIComponent(id)}/files/assets/`),
      ...(math ? { math } : {}),
      ...(packs.length ? { packs } : {}),
    });
  });

  /** A component pack listed in the book's settings (pipeline.components); no other file. */
  app.get('/api/projects/:id/packs/:file', (c) => {
    const p = project(c.req.param('id'));
    const file = c.req.param('file');
    const listed = (p.config.components ?? []).find((f) => basename(f) === file);
    if (!listed || !/\.m?js$/i.test(listed)) throw new ApiError(404, `no component pack "${file}" in this book`);
    const abs = safeJoin(p.root, listed);
    if (!abs) throw new ApiError(403, 'this path is not allowed');
    return sendFile(c.req.raw, abs, { cache: 'no-cache' });
  });

  /* ---------- translation review (book-wide) ---------- */

  const reviewLang = (lang: string): string => {
    if (!LANG.test(lang)) throw new ApiError(400, `not a language code: ${lang}`);
    return lang;
  };
  const planOf = (p: P.Project): P.BookPlan | undefined => {
    try {
      return P.loadPlan(p);
    } catch {
      return undefined;
    }
  };
  /** Lessons that parse (a broken one is left out of the queue rather than failing it). */
  const reviewLessons = (p: P.Project): Lesson[] =>
    p.lessonIds().flatMap((lid) => {
      try {
        return [p.loadLesson(lid)];
      } catch {
        return [];
      }
    });

  /** Each lesson's number among the chapters to make (as Make and the editor's kicker say it). */
  const chapterNumbers = (plan: P.BookPlan | undefined): Map<string, number> =>
    new Map((plan?.chapters ?? []).filter((c) => c.include).map((c, i) => [c.id, i + 1]));

  function reviewInfo(p: P.Project, lang: string, only?: string): ReviewInfo {
    const lessons = reviewLessons(p).filter((l) => l.lang !== lang && (!only || l.id === only));
    const plan = planOf(p);
    const numbers = chapterNumbers(plan);
    const items = lessons.length
      ? (P.reviewQueue(p, lang, { lessons: lessons.map((l) => l.id), ...(plan ? { plan } : {}) }) as ReviewItem[]).map(
          (i) => (numbers.has(i.lesson) ? { ...i, chapter: numbers.get(i.lesson)! } : i),
        )
      : [];
    const counts: ReviewInfo['counts'] = {
      machine: 0,
      approved: 0,
      edited: 0,
      stale: 0,
      missing: 0,
      flagged: 0,
      total: 0,
    };
    for (const i of items) {
      counts[i.state]++;
      if (i.flags.length) counts.flagged++;
      counts.total++;
    }
    // "Translate again · about $0.001": one string of an average length
    let perString: number | undefined;
    try {
      const chars = items.length ? items.reduce((a, i) => a + i.source.length, 0) / items.length : 0;
      perString = chars ? P.costOf(P.resolveRole('translator', p.config), 1500 + chars / 3.5, chars / 3) : undefined;
    } catch {
      perString = undefined;
    }
    return {
      lang,
      sourceLangs: Object.fromEntries(lessons.map((l) => [l.id, l.lang])),
      lessons: lessons.map((l) => ({
        id: l.id,
        title: l.title,
        ...(numbers.has(l.id) ? { n: numbers.get(l.id)! } : {}),
      })),
      items,
      counts,
      ...(perString !== undefined ? { perString } : {}),
    };
  }

  /* ---------- the book's languages (Translate & narrate) ---------- */

  /** "ar-MA-MounaNeural" → "Mouna"; other engines' voice ids stay as they are. */
  const voiceName = (id: string) => /^[a-z]{2,3}-[A-Z]{2}-(.+?)(?:Multilingual)?Neural$/.exec(id)?.[1] ?? id;
  /** What a voice reads when the book has no recording of its own yet (the Models board's sentences). */
  const SAMPLE_TEXT: Record<string, string> = {
    ar: 'طرح عدد يعني إضافة مقابله.',
    ary: 'الطرح هو نزيدو المقابل ديال العدد.',
    fr: 'Soustraire, c’est ajouter l’opposé.',
    en: 'Subtracting is adding the opposite.',
  };
  const engineOf = (p: P.Project) => {
    try {
      return P.ttsProvider(p.config.tts.provider, p.config.worker ? { worker: p.config.worker } : {});
    } catch {
      return undefined;
    }
  };
  /** The book's first recording in a language that still matches the voice chosen (a sample that costs nothing). */
  function sampleClip(p: P.Project, lessons: Lesson[], lang: string): string | undefined {
    for (const l of lessons) {
      const clips = p.audioFiles(l.id, lang);
      if (!Object.keys(clips).length) continue;
      const changed = new Set(P.changedBeats(p, l.id, lang, undefined, l));
      const beat = l.beats.find((b) => clips[b.id] && !changed.has(b.id));
      if (beat) return join(p.audioDir(l.id, lang), clips[beat.id]!);
    }
    return undefined;
  }

  function languagesInfo(p: P.Project): LanguageInfo[] {
    // each lesson is parsed once for the whole summary (it asks about every language)
    const lessons = reviewLessons(p);
    const loaded = new Map(lessons.map((l) => [l.id, l]));
    const plan = planOf(p);
    const engine = engineOf(p);
    const engineId = p.config.tts.provider;
    const free = !engine?.costPerMChars;
    const available = !caps.ttsUnavailable.includes(engineId);
    const originals = new Set(lessons.map((l) => l.lang));
    return p.book.langs.map((lang): LanguageInfo => {
      const mine = lessons.filter((l) => l.lang !== lang);
      const original = !mine.length && lessons.length > 0;
      let texts = 0;
      let translated = 0;
      let checked = 0;
      let stale = 0;
      let problems = 0;
      let missing = 0;
      if (original || !lessons.length)
        for (const l of lessons) {
          texts += collectStrings(l).length;
          translated = texts;
        }
      else
        for (const i of P.reviewQueue(p, lang, { lessons: mine.map((l) => l.id), loaded, ...(plan ? { plan } : {}) })) {
          texts++;
          if (i.state === 'missing') missing++;
          else translated++;
          if (i.state === 'approved' || i.state === 'edited') checked++;
          if (i.state === 'stale') stale++;
          if (i.problems.length) problems++;
        }
      // narration: every lesson written in this language or translated into it
      const audio = { chapters: 0, narrated: 0, changed: 0, unrecorded: 0, seconds: 0 };
      let toNarrate = 0;
      const voiced = engineId !== 'none';
      const voice = voiced ? P.voiceFor(p, lang) : undefined;
      for (const l of lessons) {
        if (l.lang !== lang && !p.loadStrings(l.id, lang)) continue;
        audio.chapters++;
        // a book with no voice has nothing recorded to compare
        if (!voiced) continue;
        const clips = p.audioFiles(l.id, lang);
        const changed = P.changedBeats(p, l.id, lang, voice, l);
        audio.changed += changed.length;
        const unrecorded = l.beats.filter((b) => !clips[b.id]);
        audio.unrecorded += unrecorded.length;
        if (!unrecorded.length) audio.narrated++;
        let t: ReturnType<P.Project['loadTimings']>;
        try {
          t = p.loadTimings(l.id, lang);
        } catch {
          t = undefined;
        }
        for (const b of l.beats) if (clips[b.id] && t?.[b.id]) audio.seconds += t[b.id]!.dur;
        if (!free) {
          const loc = l.lang === lang ? l : localize(l, p.loadStrings(l.id, lang));
          const redo = new Set([...changed, ...unrecorded.map((b) => b.id)]);
          for (const b of loc.beats) if (redo.has(b.id)) toNarrate += (b.speak ?? b.narration).length;
        }
      }
      const v = P.voiceFor(p, lang);
      let translateUsd: number | undefined;
      if (!original && lessons.length && (missing || stale)) {
        try {
          translateUsd = P.estimateTranslate(p, lang, { lessons: mine.map((l) => l.id), loaded })?.usd;
        } catch {
          translateUsd = undefined;
        }
      }
      const narrateUsd = !free && engine?.costPerMChars ? (toNarrate * engine.costPerMChars) / 1e6 : undefined;
      return {
        lang,
        role:
          original || (!lessons.length && originals.size === 0 && lang === p.book.defaultLang)
            ? 'original'
            : 'translation',
        texts,
        chapters: original ? lessons.length : mine.length,
        translated,
        checked,
        stale,
        problems,
        missing,
        audio,
        voice: {
          engine: engineId,
          id: v.voice,
          name: engineId === 'none' ? '' : voiceName(v.voice),
          free,
          available,
          sample:
            engineId !== 'none' &&
            (!!sampleClip(p, lessons, lang) || (available && free && !!SAMPLE_TEXT[lang.split('-')[0]!])),
        },
        ...(translateUsd !== undefined || narrateUsd !== undefined
          ? {
              estimate: {
                ...(translateUsd !== undefined ? { translate: translateUsd } : {}),
                ...(narrateUsd !== undefined ? { narrate: narrateUsd } : {}),
              },
            }
          : {}),
      };
    });
  }

  app.get('/api/projects/:id/languages', (c) => c.json({ languages: languagesInfo(project(c.req.param('id'))) }));

  /**
   * A sample of a language's voice: the book's own recording when it has one that matches the voice chosen, else a
   * free engine reading one sentence (kept). A paid engine is never asked for a sample.
   */
  app.get('/api/projects/:id/voices/:lang/sample', async (c) => {
    const p = project(c.req.param('id'));
    const lang = reviewLang(c.req.param('lang'));
    if (p.config.tts.provider === 'none') throw new ApiError(404, 'this book has no voice');
    const clip = sampleClip(p, reviewLessons(p), lang);
    if (clip) return sendFile(c.req.raw, clip, { cache: 'no-store' });
    const engine = engineOf(p);
    const text = SAMPLE_TEXT[lang.split('-')[0]!];
    if (!engine || engine.costPerMChars || !text) throw new ApiError(404, 'no sample of this voice yet');
    if (caps.ttsUnavailable.includes(p.config.tts.provider))
      throw new ApiError(409, `the "${p.config.tts.provider}" voice needs the desktop version of Warqa`, {
        desktopOnly: true,
      });
    const v = P.voiceFor(p, lang);
    const dir = p.path('cache', 'tts', 'samples');
    const base = `${v.provider}-${v.voice}-${lang}`.replace(/[^\w.-]+/g, '_');
    for (const ext of ['mp3', 'wav']) {
      const f = join(dir, `${base}.${ext}`);
      if (existsSync(f)) return sendFile(c.req.raw, f, { cache: 'no-store' });
    }
    let r: Awaited<ReturnType<typeof engine.synth>>;
    try {
      r = await engine.synth(text, { voice: v.voice, lang, rate: v.rate });
    } catch (e) {
      throw new ApiError(500, `the voice could not read the sample: ${(e as Error).message}`);
    }
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `${base}.${r.ext}`);
    writeFileSync(f, r.audio);
    return sendFile(c.req.raw, f, { cache: 'no-store' });
  });

  app.get('/api/projects/:id/review/:lang', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const raw = c.req.param('lang');
    if (raw.endsWith('.csv')) {
      const lang = reviewLang(raw.slice(0, -4));
      // one chapter (?lesson=ch05) or the whole book
      const only = c.req.query('lesson');
      const lid = only ? lessonIdOf(p, only) : undefined;
      const csv = P.reviewCsv(reviewInfo(p, lang, lid).items as P.ReviewItem[]);
      const name = `${p.book.id.replace(/[^\w.-]+/g, '_')}-review-${lang}${lid ? `-${lid}` : ''}.csv`;
      return c.body(csv, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
      });
    }
    return c.json(reviewInfo(p, reviewLang(raw)));
  });

  const ReviewEdit = z.object({
    lesson: z.string().max(64),
    key: z.string().min(1).max(300),
    text: z.string().max(20000).optional(),
    approve: z.boolean().optional(),
    keep: z.boolean().optional(),
  });

  /** A person approves a string, or saves their own wording (state "edited"); approve: false withdraws it. */
  app.post('/api/projects/:id/review/:lang/strings', async (c) => {
    const p = project(c.req.param('id'));
    const lang = reviewLang(c.req.param('lang'));
    const body = ReviewEdit.parse(await jsonBody(c));
    const lid = lessonIdOf(p, body.lesson);
    let state: ReviewState;
    try {
      state = P.reviewString(p, lid, lang, body.key, {
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.approve !== undefined ? { approve: body.approve } : {}),
        ...(body.keep ? { keep: true } : {}),
        by: 'studio',
      });
    } catch (e) {
      throw new ApiError(422, (e as Error).message);
    }
    const plan = planOf(p);
    const item = (P.reviewQueue(p, lang, { lessons: [lid], ...(plan ? { plan } : {}) }) as ReviewItem[]).find(
      (i) => i.key === body.key,
    );
    return c.json({ state, item });
  });

  /** Approve many strings at once (the ones a person has read on screen). */
  app.post('/api/projects/:id/review/:lang/approve', async (c) => {
    const p = project(c.req.param('id'));
    const lang = reviewLang(c.req.param('lang'));
    const body = z
      .object({
        items: z.array(z.object({ lesson: z.string().max(64), key: z.string().min(1).max(300) })).max(5000),
        // false: withdraw these approvals (Undo of approving many)
        approve: z.boolean().optional(),
      })
      .parse(await jsonBody(c));
    const known = new Set(p.lessonIds());
    let approved = 0;
    const errors: ReviewImportResult['errors'] = [];
    for (const it of body.items) {
      try {
        if (!LESSON_ID.test(it.lesson) || !known.has(it.lesson)) throw new Error(`no lesson "${it.lesson}"`);
        P.reviewString(p, it.lesson, lang, it.key, body.approve === false ? { approve: false } : { by: 'studio' });
        approved++;
      } catch (e) {
        errors.push({ key: `${it.lesson}/${it.key}`, error: (e as Error).message });
      }
    }
    return c.json({ approved, errors });
  });

  /** A reviewed spreadsheet (CSV text): changed translations become "edited", rows marked ok "approved". */
  app.post(
    '/api/projects/:id/review/:lang/import',
    bodyLimit({ maxSize: 20 * 1024 * 1024, onError: (c) => c.json({ error: 'the file is larger than 20 MB' }, 413) }),
    async (c) => {
      const p = project(c.req.param('id'));
      const lang = reviewLang(c.req.param('lang'));
      const text = await c.req.text();
      const rows = P.parseCsv(text);
      const head = rows[0];
      if (!head) throw new ApiError(422, 'the file is empty');
      const li = head.findIndex((h) => h.trim().toLowerCase() === 'lesson');
      if (li < 0) throw new ApiError(422, 'the sheet needs the columns lesson, key and translation');
      // rows must name lessons of this book: they are written to its lesson folders
      const known = new Set(p.lessonIds());
      const errors: ReviewImportResult['errors'] = [];
      const kept = rows.filter((r, i) => {
        if (i === 0) return true;
        const lid = r[li]?.trim() ?? '';
        if (!lid || (LESSON_ID.test(lid) && known.has(lid))) return true;
        errors.push({ key: lid, error: `no lesson "${lid}" in this book` });
        return false;
      });
      const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const csv = kept.map((r) => r.map(cell).join(',')).join('\r\n');
      // ?dry=1: what the file would change, nothing written (the side sheet shows it before Apply)
      const dry = c.req.query('dry') === '1';
      let r: ReturnType<typeof P.importReviewCsv>;
      try {
        r = P.importReviewCsv(p, lang, csv, { dry });
      } catch (e) {
        throw new ApiError(422, (e as Error).message);
      }
      return c.json({
        edited: r.edited,
        approved: r.approved,
        errors: [...errors, ...r.errors],
        ...(dry ? { changes: r.changes } : {}),
      } satisfies ReviewImportResult);
    },
  );

  /* ---------- map region layers ---------- */

  app.get('/api/projects/:id/geo', (c) => c.json({ layers: P.listGeoLayers(project(c.req.param('id'))) }));

  /* ---------- teacher review kit ---------- */

  app.get('/api/projects/:id/panel/kit.zip', (c) => {
    const p = project(c.req.param('id'));
    const zip = panelZipPath(p.root);
    if (!existsSync(zip)) {
      if (!existsSync(join(panelDir(p.root), 'index.html'))) throw new ApiError(404, 'export a review kit first');
      mkdirSync(dirname(zip), { recursive: true });
      P.zipFolder(panelDir(p.root), zip);
    }
    return sendFile(c.req.raw, zip, { download: `${p.book.id}-review-kit.zip` });
  });

  app.get('/api/projects/:id/panel/key.json', (c) => {
    const p = project(c.req.param('id'));
    if (!existsSync(panelKeyPath(p.root))) throw new ApiError(404, 'export a review kit first');
    return sendFile(c.req.raw, panelKeyPath(p.root), { download: `${p.book.id}-review-kit-key.json` });
  });

  /* ---------- files ---------- */

  const filePath = (c: { req: { url: string } }, prefix: string): string => {
    const pathname = new URL(c.req.url).pathname;
    return pathname.slice(prefix.length);
  };

  app.on(['GET', 'HEAD'], '/api/projects/:id/files/*', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const rel = filePath(c, `/api/projects/${id}/files/`);
    const abs = safeJoin(p.root, rel);
    if (!abs) throw new ApiError(403, 'this path is not allowed');
    const parts = abs.slice(p.root.length + 1).split('/');
    // only lesson files (audio, images) and assets; never the source PDF, caches, the ledger or dot files
    const allowed =
      (parts[0] === 'lessons' || parts[0] === 'assets') &&
      !parts.some((s) => s.startsWith('.')) &&
      !/\.pdf$/i.test(abs);
    if (!allowed) throw new ApiError(403, 'this file is private');
    return sendFile(c.req.raw, abs);
  });

  app.get('/api/projects/:id/download', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    if (!zipReady(p.root)) throw new ApiError(404, 'export the book first');
    return sendFile(c.req.raw, zipPath(p.root), { download: `${p.book.id}.zip` });
  });

  /* ---------- Check and Share (redesign 4f) ---------- */

  /** A chapter's check in one language: each beat's picture, findings and score, merged with the lesson. */
  app.get('/api/projects/:id/check/:lid', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const lid = lessonIdOf(p, c.req.param('lid'));
    const lesson = p.loadLesson(lid);
    const want = c.req.query('lang');
    const lang = want && LANG.test(want) ? want : lesson.lang;
    const place = lessonPlace(p, lid);
    const rewriteUsd = rewriteCost(p);
    const d = checkDetail(p, lid, lang, {
      ...(place.chapter ? { chapter: place.chapter } : {}),
      link: (file, at) =>
        url(
          `/api/projects/${encodeURIComponent(id)}/qa/${encodeURIComponent(lid)}/${encodeURIComponent(lang)}/${file}?v=${Math.round(at)}`,
        ),
    });
    return c.json({ ...d, ...(rewriteUsd !== undefined ? { rewriteUsd } : {}) } satisfies CheckDetail);
  });

  /** A check's end pictures, and nothing else of qa/. */
  app.on(['GET', 'HEAD'], '/api/projects/:id/qa/:lid/:lang/:file', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const lang = c.req.param('lang') ?? '';
    const file = c.req.param('file') ?? '';
    if (!LANG.test(lang) || !/^b\d{2}_end\.(png|jpg)$/.test(file)) throw new ApiError(403, 'not a check picture');
    const f = safeJoin(p.path('qa', lid, lang), file);
    if (!f) throw new ApiError(403, 'not a check picture');
    return sendFile(c.req.raw, f, { cache: 'no-cache' });
  });

  /** The book's questions as flashcards in one language: Anki (tab-separated) or CSV. */
  app.get('/api/projects/:id/flashcards/:lang', (c) => {
    const p = project(c.req.param('id'));
    const lang = c.req.param('lang');
    if (!LANG.test(lang)) throw new ApiError(400, `not a language code: ${lang}`);
    const csv = c.req.query('format') === 'csv';
    const name = `${p.book.id.replace(/[^\w.-]+/g, '_')}-flashcards-${lang}.${csv ? 'csv' : 'txt'}`;
    return c.body(csv ? P.csvText(p, lang) : P.ankiText(p, lang), 200, {
      'content-type': csv ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    });
  });

  /** The SCORM package, once the scorm job has made it. */
  app.get('/api/projects/:id/scorm.zip', (c) => {
    const p = project(c.req.param('id'));
    const f = p.path('dist-scorm.zip');
    if (!existsSync(f)) throw new ApiError(404, 'make the SCORM package first');
    return sendFile(c.req.raw, f, { download: `${p.book.id}-scorm.zip` });
  });

  /** A chapter's video in a language, once the video job has made it. */
  app.get('/api/projects/:id/videos/:lid/:lang', (c) => {
    const p = project(c.req.param('id'));
    const lid = lessonIdOf(p, c.req.param('lid'));
    const lang = c.req.param('lang');
    if (!LANG.test(lang)) throw new ApiError(400, `not a language code: ${lang}`);
    const f = p.path(`${lid}.${lang}.mp4`);
    if (!existsSync(f)) throw new ApiError(404, 'make the video first');
    return sendFile(c.req.raw, f, { download: `${p.book.id}-${lid}-${lang}.mp4` });
  });

  /** The whole book as a zip (a backup), without what is made again from it. */
  app.get('/api/projects/:id/archive', (c) => {
    const p = project(c.req.param('id'));
    const zip = new Uint8Array(P.archiveProject(p));
    const name = basename(p.root).replace(/[^\w.-]+/g, '_');
    return c.body(zip, 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${name}.zip"`,
      'content-length': String(zip.byteLength),
    });
  });

  app.all('/api/*', () => {
    throw new ApiError(404, 'no such API endpoint');
  });

  /* ---------- the player bundle and exported books ---------- */

  app.on(['GET', 'HEAD'], '/player/*', (c) => {
    const abs = safeJoin(playerDir(), filePath(c, '/player/'));
    if (!abs) throw new ApiError(403, 'this path is not allowed');
    return sendFile(c.req.raw, abs, { cache: 'no-cache' });
  });

  app.get('/books/:id', (c) => c.redirect(`/books/${c.req.param('id')}/`, 301));
  app.on(['GET', 'HEAD'], '/books/:id/*', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const dist = p.path('dist');
    if (!existsSync(join(dist, 'index.html')))
      return c.html(
        `<!doctype html><meta charset="utf-8"><title>Not exported</title><p style="font-family:system-ui;padding:2rem">This book has not been exported yet. Open the studio and choose <b>Export</b>.</p>`,
        404,
      );
    let abs = safeJoin(dist, filePath(c, `/books/${id}/`));
    if (!abs) throw new ApiError(403, 'this path is not allowed');
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      if (!new URL(c.req.url).pathname.endsWith('/')) return c.redirect(`${new URL(c.req.url).pathname}/`, 301);
      abs = join(abs, 'index.html');
    }
    return sendFile(c.req.raw, abs);
  });

  /* ---------- the studio's icons and install manifest (the web app serves its own as static files) ---------- */

  // exported books opened from the studio share the favicon: Warqa's mark
  const favicon = (c: Context) =>
    c.body(faviconSvg(), 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
  app.get('/favicon.ico', favicon);
  app.get('/favicon.svg', favicon);
  app.on(['GET', 'HEAD'], '/icons/*', (c) => {
    const abs = safeJoin(brandIconsDir(), filePath(c, '/icons/'));
    if (!abs) throw new ApiError(403, 'this path is not allowed');
    return sendFile(c.req.raw, abs, { cache: 'public, max-age=86400' });
  });
  app.get('/manifest.webmanifest', (c) =>
    c.body(
      JSON.stringify(
        webManifest({
          name: 'Warqa studio',
          shortName: 'Warqa',
          description: 'Turn a PDF into animated, narrated, interactive lessons.',
          startUrl: '/',
          icons: '/icons/',
        }),
      ),
      200,
      { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' },
    ),
  );

  /* ---------- the React app ---------- */

  const clientDir = opts.clientDir ? resolve(opts.clientDir) : undefined;
  app.on(['GET', 'HEAD'], '*', (c) => {
    if (!clientDir || !existsSync(join(clientDir, 'index.html')))
      return c.text('The studio UI is not built: run `pnpm --filter @warqa/studio build`.', 503);
    const path = new URL(c.req.url).pathname;
    if (path !== '/' && path.includes('.')) {
      const abs = safeJoin(clientDir, path);
      if (abs && existsSync(abs) && statSync(abs).isFile())
        return sendFile(c.req.raw, abs, {
          cache: path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
      return c.json({ error: 'not found' }, 404);
    }
    return c.html(readFileSync(join(clientDir, 'index.html'), 'utf8'));
  });

  return { app, jobs, registry };
}
