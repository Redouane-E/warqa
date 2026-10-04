// Optional vision judge: show a vision model the rendered end frame of each beat with its narration and
// ask whether the picture shows what is said. `improveLesson` feeds its notes back into beat rewrites.
import { readFileSync } from 'node:fs';
import { localize, narrationText } from '@warqa/lesson';
import * as z from 'zod';
import { serveStatic } from '../export/serve.js';
import { exportSite } from '../export/site.js';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { checkLesson } from './check.js';

export const JudgeVerdict = z.object({
  beats: z.array(
    z.object({
      id: z.string(),
      score: z
        .number()
        .min(1)
        .max(5)
        .describe('5 = the picture clearly shows what the narration says; 1 = unrelated or broken'),
      problem: z
        .string()
        .optional()
        .describe('what is wrong, if anything (overlap, unreadable, picture does not match the words, wrong math)'),
      fix: z.string().optional().describe('a concrete instruction to fix it'),
    }),
  ),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export interface JudgeOptions {
  llm: Llm;
  lang?: string;
  /** Beats per model call (each with one screenshot). */
  batch?: number;
}

/** Judge every lesson beat (questions excluded) from its rendered end frame. */
export async function judgeLesson(
  project: Project,
  lessonId: string,
  opts: JudgeOptions,
): Promise<JudgeVerdict['beats']> {
  const base = project.loadLesson(lessonId);
  const lang = opts.lang ?? base.lang;
  const lesson = lang === base.lang ? base : localize(base, project.loadStrings(lessonId, lang));
  const site = exportSite(project, { lessons: [lessonId], out: project.path('cache', 'judge-site'), pwa: false });
  const { server, url } = await serveStatic(site.out, 0);
  let shots: string[] = [];
  try {
    const r = await checkLesson({
      url: `${url}${lessonId}/index.html`,
      lang,
      shots: project.path('qa', lessonId, `${lang}-judge`),
      moments: ['end'],
    });
    shots = r.shots;
  } finally {
    server.close();
  }
  const model = resolveRole('judge', project.config);
  const items = lesson.beats
    .map((b, i) => ({ b, shot: shots[i] }))
    .filter(({ b, shot }) => shot && !b.questions?.length && b.move !== 'finish');
  const out: JudgeVerdict['beats'] = [];
  const size = opts.batch ?? 4;
  for (let k = 0; k < items.length; k += size) {
    const chunk = items.slice(k, k + size);
    const r = await opts.llm.structured({
      stage: 'judge',
      role: 'judge',
      model,
      system:
        'You review frames of an animated, narrated lesson. For each beat you get the narration and the picture at the end of the beat. Judge whether the picture shows and supports what is said, whether text is readable and nothing overlaps, and whether the math is right. Be brief and concrete.',
      prompt: `Lesson: ${lesson.title} (${lang}). The images follow in this order:\n${chunk.map(({ b }, j) => `${j + 1}. beat "${b.id}" (${b.move}): ${narrationText(b.narration)}`).join('\n')}`,
      images: chunk.map(({ shot }) => ({ data: new Uint8Array(readFileSync(shot!)), mediaType: 'image/png' })),
      schema: JudgeVerdict,
      name: `judge:${lessonId}:${lang}:${k}`,
      validate: (v) => {
        const want = chunk.map(({ b }) => b.id);
        const missing = want.filter((id) => !v.beats.some((x) => x.id === id));
        return missing.length ? [`give a verdict for every beat: missing ${missing.join(', ')}`] : [];
      },
    });
    out.push(...r.value.beats);
  }
  project.writeJson(`qa/${lessonId}/${lang}-judge.json`, out);
  return out;
}

export interface ImproveOptions {
  llm: Llm;
  lang?: string;
  /** Beats scoring below this are rewritten (1–5, default 4). */
  threshold?: number;
  /** Judge → rewrite rounds (default 1). */
  rounds?: number;
  onBeat?: (e: { id: string; score: number; status: 'rewritten' | 'failed' | 'ok'; detail?: string }) => void;
  /** The judge to use (default: render with Playwright and ask the vision model). */
  judge?: typeof judgeLesson;
}

export interface ImproveReport {
  before: JudgeVerdict['beats'];
  after: JudgeVerdict['beats'];
  rewritten: string[];
  failed: { id: string; error: string }[];
}

/**
 * Judge in the loop: render, ask the vision judge, rewrite every beat it scores below the threshold using its
 * notes as the instruction, then judge again. Translations of rewritten beats are dropped so they are redone.
 */
export async function improveLesson(project: Project, lessonId: string, opts: ImproveOptions): Promise<ImproveReport> {
  const { rewriteBeat } = await import('../stages/write.js');
  const { loadPlan } = await import('../stages/plan.js');
  const { loadDocument } = await import('../stages/build.js');
  const doc = loadDocument(project);
  const plan = loadPlan(project);
  if (!doc || !plan) throw new Error('improve needs source/document.json and plan.json');
  const threshold = opts.threshold ?? 4;
  const judgeOpts = { llm: opts.llm, ...(opts.lang ? { lang: opts.lang } : {}) };
  const judge = opts.judge ?? judgeLesson;
  const before = await judge(project, lessonId, judgeOpts);
  let current = before;
  const rewritten: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (let round = 0; round < (opts.rounds ?? 1); round++) {
    const weak = current.filter((v) => v.score < threshold && (v.problem || v.fix));
    if (!weak.length) break;
    for (const v of weak) {
      try {
        await rewriteBeat(project, doc, plan, lessonId, v.id, {
          llm: opts.llm,
          instruction: `A reviewer looked at the rendered beat and scored it ${v.score}/5. Problem: ${v.problem ?? '(not stated)'}. Fix: ${v.fix ?? 'make the picture show what the narration says'}.`,
        });
        rewritten.push(v.id);
        opts.onBeat?.({ id: v.id, score: v.score, status: 'rewritten' });
      } catch (e) {
        failed.push({ id: v.id, error: (e as Error).message });
        opts.onBeat?.({ id: v.id, score: v.score, status: 'failed', detail: (e as Error).message });
      }
    }
    current = await judge(project, lessonId, judgeOpts);
  }
  return { before, after: current, rewritten, failed };
}
