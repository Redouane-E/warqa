// The studio's HTTP API (Hono). createApp() is used by the server entry and by the tests.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import {
  checkStrings,
  collectStrings,
  completeTimings,
  type Lesson,
  type Issue as LessonIssue,
  localize,
  ltext,
  MOVES,
  Strings,
  safeParseLesson,
  type Timings,
  validateLesson,
} from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import * as z from 'zod';
import type {
  Capabilities,
  Issue,
  JobType,
  LessonDetail,
  ReviewImportResult,
  ReviewInfo,
  ReviewItem,
  ReviewState,
  StatusInfo,
} from '../shared/types.js';
import { JOB_TYPES } from '../shared/types.js';
import { safeJoin, sendFile } from './files.js';
import { ingestAvailable, Jobs, type Runner } from './jobs.js';
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
      qa: !caps.jobsUnavailable.includes('qa'),
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

  app.get('/api/projects/:id/estimate', (c) => {
    const p = project(c.req.param('id'));
    try {
      return c.json(P.estimateBuild(p));
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
    const engine = typeof args.engine === 'string' ? args.engine : project(id).config.tts.provider;
    if (caps.ttsUnavailable.includes(engine)) {
      if (body.type === 'narrate')
        throw new ApiError(400, `the "${engine}" voice needs the desktop version of Warqa: choose another voice`, {
          desktopOnly: true,
        });
      if (body.type === 'build') args.narrate = false;
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
    };
    return c.json(detail);
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
    if (dry) return c.json({ saved: false, issues, stringIssues, entries: collectStrings(lesson) });
    if (blocking.length && !force)
      return c.json(
        { error: `${blocking.length} errors: fix them or save anyway`, saved: false, issues, stringIssues },
        422,
      );
    p.saveLesson(lid, raw);
    return c.json({ saved: true, issues, stringIssues, entries: collectStrings(lesson) });
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
    p.saveStrings(lid, lang, clean);
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
    const lesson = parsed.data as Lesson;
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
      langs.push(lang);
      if (s) strings[lang] = s;
      const localized = localize(lesson, s);
      let t: Timings | undefined;
      try {
        t = p.loadTimings(lid, lang);
      } catch {
        t = undefined;
      }
      timings[lang] = completeTimings(localized, lang, t);
      const beatIds = new Set(localized.beats.map((b) => b.id));
      for (const [b, f] of Object.entries(p.audioFiles(lid, lang))) {
        if (!beatIds.has(b)) continue;
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

  function reviewInfo(p: P.Project, lang: string): ReviewInfo {
    const lessons = reviewLessons(p).filter((l) => l.lang !== lang);
    const plan = planOf(p);
    const items = lessons.length
      ? (P.reviewQueue(p, lang, { lessons: lessons.map((l) => l.id), ...(plan ? { plan } : {}) }) as ReviewItem[])
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
    return {
      lang,
      sourceLangs: Object.fromEntries(lessons.map((l) => [l.id, l.lang])),
      lessons: lessons.map((l) => ({ id: l.id, title: l.title })),
      items,
      counts,
    };
  }

  app.get('/api/projects/:id/review/:lang', (c) => {
    const id = c.req.param('id');
    const p = project(id);
    const raw = c.req.param('lang');
    if (raw.endsWith('.csv')) {
      const lang = reviewLang(raw.slice(0, -4));
      const csv = P.reviewCsv(reviewInfo(p, lang).items as P.ReviewItem[]);
      return c.body(csv, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${p.book.id.replace(/[^\w.-]+/g, '_')}-review-${lang}.csv"`,
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
      .object({ items: z.array(z.object({ lesson: z.string().max(64), key: z.string().min(1).max(300) })).max(5000) })
      .parse(await jsonBody(c));
    const known = new Set(p.lessonIds());
    let approved = 0;
    const errors: ReviewImportResult['errors'] = [];
    for (const it of body.items) {
      try {
        if (!LESSON_ID.test(it.lesson) || !known.has(it.lesson)) throw new Error(`no lesson "${it.lesson}"`);
        P.reviewString(p, it.lesson, lang, it.key, {});
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
      let r: ReviewImportResult;
      try {
        r = P.importReviewCsv(p, lang, csv);
      } catch (e) {
        throw new ApiError(422, (e as Error).message);
      }
      return c.json({ edited: r.edited, approved: r.approved, errors: [...errors, ...r.errors] });
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

  // exported books and the studio share this icon: the sheet with its amber fold
  app.get('/favicon.ico', (c) =>
    c.body(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><path d="M5 3.5h11l5 5v14H5z" fill="#1d2b27"/><path d="M16 3.5v5h5" fill="#f0b45a"/></svg>`,
      200,
      { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
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
