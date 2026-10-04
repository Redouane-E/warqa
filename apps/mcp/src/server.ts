#!/usr/bin/env node
// Warqa as an MCP server. Coding agents can drive the whole pipeline, or author lessons themselves:
// read the source, write lesson JSON, get validator feedback, render frames to look at, narrate, export.
//   claude mcp add warqa -- npx warqa-mcp        (or: node apps/mcp/dist/server.js)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  checkStrings,
  componentCatalog,
  lessonJsonSchema,
  localize,
  safeParseLesson,
  stringTable,
  validateLesson,
} from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import * as z from 'zod';

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
const server = new McpServer({ name: 'warqa', version: VERSION });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const open = (dir: string) => {
  const root = resolve(dir);
  for (const f of [resolve('.env'), `${root}/.env`]) if (existsSync(f)) process.loadEnvFile(f);
  return new P.Project(root);
};
const previews = new Map<string, string>();

const AUTHORING = `Authoring Warqa lessons yourself:
1. warqa_read_source for the chapter pages; plan beats: intro (title card) → lesson beats (one idea each, a visual change per sentence) with quick checks every 2–3 beats → summary (list) → 1–3 practice sets → finish.
2. Write the lesson JSON (schema: warqa_lesson_schema; components: warqa_component_catalog). Narration uses [[marks]] before the words a cue waits for; cues target nodes or parts ("eq#tok:1").
3. warqa_validate_lesson until there are no errors; then warqa_save_lesson.
4. warqa_render to look at frames and fix overlaps or empty openings; warqa_save_strings for other languages; warqa_narrate; warqa_export.`;

server.registerTool(
  'warqa_guide',
  { description: 'How to make Warqa lessons with these tools (read first).' },
  async () => text(AUTHORING),
);

server.registerTool(
  'warqa_component_catalog',
  {
    description: 'The components a lesson can use, with props, actions and examples.',
    inputSchema: {
      packs: z.array(z.enum(['core', 'stem', 'humanities', 'document', 'kids'])).optional(),
      types: z.array(z.string()).optional(),
    },
  },
  async ({ packs, types }) => text(componentCatalog({ ...(packs ? { packs } : {}), ...(types ? { types } : {}) })),
);

server.registerTool('warqa_lesson_schema', { description: 'JSON Schema of a Warqa lesson.' }, async () =>
  json(lessonJsonSchema()),
);

server.registerTool(
  'warqa_create_project',
  {
    description: 'Create a book project folder (optionally copying a source PDF).',
    inputSchema: {
      dir: z.string(),
      pdf: z.string().optional(),
      title: z.string().optional(),
      langs: z.array(z.string()).default(['ar', 'fr', 'en']),
      defaultLang: z.string().optional(),
      audience: z.string().optional(),
      tts: z.string().default('edge'),
    },
  },
  async ({ dir, pdf, title, langs, defaultLang, audience, tts }) => {
    const root = resolve(dir);
    const p = P.Project.create(root, {
      id:
        (root.split('/').pop() ?? 'book')
          .toLowerCase()
          .replace(/\.warqa$/, '')
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^[^a-z]+/, '') || 'book',
      title: title ?? 'Book',
      langs,
      defaultLang: defaultLang ?? langs[0],
      ...(audience ? { audience } : {}),
    });
    p.config.tts.provider = tts;
    p.saveBook();
    if (pdf) {
      const { copyFileSync } = await import('node:fs');
      copyFileSync(resolve(pdf), p.path('source', pdf.split('/').pop()!));
    }
    return text(`created ${root}`);
  },
);

server.registerTool(
  'warqa_ingest',
  {
    description: 'Read the project PDF (text, Arabic repairs, chapter map). OCR needs a vision model or the worker.',
    inputSchema: { project: z.string(), ocr: z.enum(['auto', 'never', 'always']).default('auto') },
  },
  async ({ project, ocr }) => {
    const p = open(project);
    const pdf = p.sourcePdf();
    if (!pdf) return text('no PDF in source/');
    let vision: P.VisionOcr | undefined;
    try {
      const model = P.resolveRole('vision', p.config);
      const llm = P.projectLlm(p);
      vision = (png, ctx) =>
        llm.text({
          stage: 'ingest',
          role: 'vision',
          model,
          system: P.VISION_OCR_SYSTEM,
          prompt: `Transcribe page ${ctx.page}.`,
          images: [{ data: png, mediaType: 'image/png' }],
        });
    } catch {
      vision = undefined;
    }
    const doc = await P.ingestPdf(pdf, {
      ocr,
      ...(vision ? { vision } : {}),
      ...(p.config.worker ? { worker: p.config.worker } : {}),
    });
    p.writeJson('source/document.json', doc);
    return json({
      pages: doc.source.pages,
      lang: doc.lang,
      blocks: doc.blocks.length,
      sections: doc.sections.map((s) => ({ id: s.id, title: s.title, pages: [s.start, s.end] })),
    });
  },
);

server.registerTool(
  'warqa_read_source',
  {
    description: 'Text of source pages (with [page n] markers), from source/document.json.',
    inputSchema: {
      project: z.string(),
      start: z.number().int(),
      end: z.number().int(),
      maxChars: z.number().int().default(40000),
    },
  },
  async ({ project, start, end, maxChars }) => {
    const doc = P.loadDocument(open(project));
    if (!doc) return text('no source/document.json: run warqa_ingest first');
    return text(P.sectionText(doc, start, end, { maxChars }));
  },
);

server.registerTool(
  'warqa_validate_lesson',
  {
    description:
      'Validate a lesson (JSON) without saving: schema, marks, cue targets against the scene, answers, pacing. Fix every error.',
    inputSchema: { lesson: z.unknown(), lang: z.string().optional() },
  },
  async ({ lesson, lang }) => {
    const parsed = safeParseLesson(lesson);
    if (!parsed.success)
      return json({
        ok: false,
        errors: parsed.error.issues.slice(0, 40).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const v = validateLesson(parsed.data as never, { pacing: true, ...(lang ? { lang } : {}) });
    return json({
      ok: v.ok,
      errors: v.issues.filter((i) => i.level === 'error'),
      warnings: v.issues.filter((i) => i.level === 'warn'),
    });
  },
);

server.registerTool(
  'warqa_save_lesson',
  {
    description: 'Validate and save a lesson as lessons/<id>/lesson.json (refuses on errors unless force).',
    inputSchema: { project: z.string(), lesson: z.unknown(), force: z.boolean().default(false) },
  },
  async ({ project, lesson, force }) => {
    const p = open(project);
    const parsed = safeParseLesson(lesson);
    if (!parsed.success)
      return json({
        saved: false,
        errors: parsed.error.issues.slice(0, 40).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const v = validateLesson(parsed.data as never);
    if (!v.ok && !force) return json({ saved: false, errors: v.issues.filter((i) => i.level === 'error') });
    p.saveLesson(parsed.data.id, lesson);
    return json({ saved: true, id: parsed.data.id, warnings: v.issues.filter((i) => i.level === 'warn').length });
  },
);

server.registerTool(
  'warqa_strings',
  {
    description: 'The localizable strings of a saved lesson (keys and author-language text), to translate.',
    inputSchema: { project: z.string(), id: z.string() },
  },
  async ({ project, id }) => json(stringTable(open(project).loadLesson(id))),
);

server.registerTool(
  'warqa_save_strings',
  {
    description: 'Save a translation (strings.<lang>.json) after checking marks, answer boxes and math.',
    inputSchema: {
      project: z.string(),
      id: z.string(),
      lang: z.string(),
      strings: z.record(
        z.string(),
        z.union([z.string(), z.object({ text: z.string(), speak: z.string().optional() })]),
      ),
    },
  },
  async ({ project, id, lang, strings }) => {
    const p = open(project);
    const issues = checkStrings(p.loadLesson(id), strings, lang);
    if (issues.some((i) => i.level === 'error')) return json({ saved: false, issues });
    p.saveStrings(id, lang, strings);
    const loc = localize(p.loadLesson(id), strings);
    return json({ saved: true, validation: validateLesson(loc, { lang }).issues.filter((i) => i.level === 'error') });
  },
);

server.registerTool(
  'warqa_build_chapter',
  {
    description:
      'Run the pipeline for a chapter with the project models (plan → storyboard → write → translate → narrate).',
    inputSchema: {
      project: z.string(),
      chapter: z.string(),
      narrate: z.boolean().default(true),
      approve: z.boolean().default(false),
    },
  },
  async ({ project, chapter, narrate, approve }) => {
    const p = open(project);
    const log: string[] = [];
    const r = await P.buildChapter(p, chapter, {
      narrate,
      approve,
      onProgress: (e) => log.push(`${e.stage} ${e.status} ${'detail' in e && e.detail ? e.detail : ''}`),
    });
    return json({ beats: r.lesson.beats.length, usd: r.usd, issues: r.issues.slice(0, 30), log });
  },
);

server.registerTool(
  'warqa_narrate',
  {
    description: 'Synthesize narration for a lesson in a language.',
    inputSchema: {
      project: z.string(),
      id: z.string(),
      lang: z.string(),
      engine: z.string().optional(),
      voice: z.string().optional(),
    },
  },
  async ({ project, id, lang, engine, voice }) =>
    json(
      await P.narrateLesson(open(project), id, lang, {
        ...(engine ? { provider: engine } : {}),
        ...(voice ? { voice } : {}),
      }),
    ),
);

server.registerTool(
  'warqa_render',
  {
    description:
      'Render frames of a lesson (headless) and return them as images with the QA issues (blank openings, overlaps, overflow, errors).',
    inputSchema: {
      project: z.string(),
      id: z.string(),
      lang: z.string().optional(),
      moments: z.array(z.enum(['open', 'mid', 'end'])).default(['end']),
      maxSheets: z.number().int().default(4),
    },
  },
  async ({ project, id, lang, moments, maxSheets }) => {
    const p = open(project);
    const site = P.exportSite(p, { lessons: [id], out: p.path('cache', 'mcp-render') });
    const { server: srv, url } = await P.serveStatic(site.out, 0);
    try {
      const r = await P.checkLesson({
        url: `${url}${id}/index.html`,
        ...(lang ? { lang } : {}),
        shots: p.path('qa', id, lang ?? 'default'),
        moments,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ beats: r.beats, issues: r.issues }, null, 1) },
          ...r.sheets
            .slice(0, maxSheets)
            .map((f) => ({ type: 'image' as const, data: readFileSync(f).toString('base64'), mimeType: 'image/png' })),
        ],
      };
    } finally {
      srv.close();
    }
  },
);

server.registerTool(
  'warqa_improve',
  {
    description:
      "Judge in the loop with the project's models: render each beat, ask the vision judge whether the picture shows what is said, and rewrite the beats it scores below the threshold using its notes. Returns scores before and after.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      lang: z.string().optional(),
      threshold: z.number().min(1).max(5).default(4),
      rounds: z.number().int().min(1).max(3).default(1),
    },
  },
  async ({ project, id, lang, threshold, rounds }) => {
    const p = open(project);
    return json(await P.improveLesson(p, id, { llm: P.projectLlm(p), threshold, rounds, ...(lang ? { lang } : {}) }));
  },
);

server.registerTool(
  'warqa_review',
  {
    description:
      'Translation review for a language: list strings with their state (machine, approved, edited, stale, missing) and problems (glossary, marks), or approve/edit one string. Approved wording is kept by later translations and reused across chapters.',
    inputSchema: {
      project: z.string(),
      lang: z.string(),
      lesson: z.string().optional(),
      key: z.string().optional().describe('with lesson: the string to approve or edit'),
      text: z.string().optional().describe('new wording (marks the string "edited")'),
      onlyProblems: z.boolean().default(true),
    },
  },
  async ({ project, lang, lesson, key, text, onlyProblems }) => {
    const p = open(project);
    if (lesson && key) return json({ state: P.reviewString(p, lesson, lang, key, text !== undefined ? { text } : {}) });
    const plan = P.loadPlan(p);
    const items = P.reviewQueue(p, lang, { ...(lesson ? { lessons: [lesson] } : {}), ...(plan ? { plan } : {}) });
    const counts = Object.fromEntries(
      ['machine', 'approved', 'edited', 'stale', 'missing'].map((s) => [s, items.filter((i) => i.state === s).length]),
    );
    return json({
      counts,
      items: onlyProblems ? items.filter((i) => i.flags.length || i.state === 'stale' || i.state === 'missing') : items,
    });
  },
);

server.registerTool(
  'warqa_geo_add',
  {
    description:
      'Add the regions of a country to the book for map nodes (map.regions.layer), downloaded from geoBoundaries (ISO 3166-1 alpha-3, e.g. MAR, DZA, FRA). Returns the layer id, region names and codes, licence and on-map credit.',
    inputSchema: { project: z.string(), country: z.string(), level: z.union([z.literal(1), z.literal(2)]).default(1) },
  },
  async ({ project, country, level }) => {
    const l = await P.addGeoLayer(open(project), { country, level });
    return json({
      id: l.id,
      license: l.license,
      attribution: l.attribution,
      regions: l.regions.map((r) => ({ name: r.name, iso: r.iso })),
    });
  },
);

server.registerTool(
  'warqa_export',
  {
    description: 'Export the book as a static site (and optionally a zip and SCORM package).',
    inputSchema: { project: z.string(), zip: z.boolean().default(false), scorm: z.boolean().default(false) },
  },
  async ({ project, zip, scorm }) => {
    const p = open(project);
    const r = P.exportSite(p);
    const out: Record<string, unknown> = { ...r };
    if (zip) out.zip = P.zipFolder(r.out, `${r.out}.zip`);
    if (scorm) out.scorm = P.exportScorm(p);
    return json(out);
  },
);

server.registerTool(
  'warqa_preview',
  {
    description: 'Export and serve the book locally; returns the URL.',
    inputSchema: { project: z.string(), port: z.number().int().default(0) },
  },
  async ({ project, port }) => {
    const p = open(project);
    if (previews.has(p.root)) return text(previews.get(p.root)!);
    const r = P.exportSite(p);
    const { url } = await P.serveStatic(r.out, port);
    previews.set(p.root, url);
    return text(url);
  },
);

server.registerTool('warqa_status', { description: 'Configured model providers and usable presets.' }, async () =>
  json({ providers: P.providerStatus(), presets: P.availablePresets().map((x) => x.id), tts: P.TTS_IDS }),
);

await server.connect(new StdioServerTransport());
