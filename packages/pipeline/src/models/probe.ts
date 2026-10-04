// `warqa models probe <id>`: five small calls that show whether a model can write Warqa lessons, and at
// which tier (A: whole beats, B: beats with a smaller catalog, C: small slots with automatic cues).
import { LESSON_SCHEMA, parseLesson, schemas, validateLesson } from '@warqa/lesson';
import * as z from 'zod';
import { WRITER_SYSTEM } from '../prompts/index.js';
import { BeatDraft } from '../stages/write.js';
import { modelInfo, type Tier } from './catalog.js';
import { GenerationError, Llm } from './llm.js';

export interface ProbeResult {
  model: string;
  ok: number;
  total: number;
  repairs: number;
  tier: Tier;
  ms: number;
  usd: number;
  failures: string[];
}

export async function probeModel(model: string, llm = new Llm()): Promise<ProbeResult> {
  const t0 = Date.now();
  const failures: string[] = [];
  let ok = 0;
  let repairs = 0;
  let usd = 0;
  const tasks: { name: string; run: () => Promise<{ repairs: number; usd: number }> }[] = [
    {
      name: 'simple JSON',
      run: () =>
        llm.structured({
          stage: 'probe',
          role: 'writer',
          model,
          system: 'You answer with JSON.',
          prompt: 'Give the capital and population (approximate number) of Morocco.',
          schema: z.object({ capital: z.string(), population: z.number() }),
          name: 'probe1',
          fresh: true,
          maxRepairs: 1,
        }),
    },
    {
      name: 'Arabic narration with marks',
      run: () =>
        llm.structured({
          stage: 'probe',
          role: 'writer',
          model,
          system: 'You write narration for an animated math lesson.',
          prompt:
            'In Modern Standard Arabic, write two short sentences explaining that 7 − 3 = 4, saying the numbers in words. Put [[a]] before the word «ثلاثة» and [[b]] before the result.',
          schema: z.object({ narration: z.string() }),
          name: 'probe2',
          fresh: true,
          maxRepairs: 2,
          validate: (v) => [
            ...(/\[\[a\]\]/.test(v.narration) && /\[\[b\]\]/.test(v.narration)
              ? []
              : ['narration must contain [[a]] and [[b]]']),
            ...(/[؀-ۿ]/.test(v.narration) ? [] : ['write in Arabic']),
          ],
        }),
    },
    {
      name: 'a choice question',
      run: () =>
        llm.structured({
          stage: 'probe',
          role: 'writer',
          model,
          system: WRITER_SYSTEM,
          prompt:
            'Write a quick-check question (kind "choice", id "c-a") asking which addition equals $4 − (−9)$, three options with ids a, b, c, a "why" for each wrong option and an "explain".',
          schema: z.object({ question: z.looseObject({ kind: z.string() }) }),
          name: 'probe3',
          fresh: true,
          maxRepairs: 2,
          validate: (v) => {
            const r = schemas().Beat.safeParse({
              id: 'q',
              title: 'q',
              narration: 'Quick check.',
              questions: [v.question],
            });
            return r.success ? [] : r.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`);
          },
        }),
    },
    {
      name: 'an equation that transforms',
      run: () =>
        llm.structured({
          stage: 'probe',
          role: 'writer',
          model,
          system: WRITER_SYSTEM,
          prompt:
            'Write a node {"id":"eq","type":"equation","steps":[...]} that rewrites 9 − 4 as 9 + (−4) and then appends " = 5" (three steps, tokens at the same positions match).',
          schema: z.object({ node: z.looseObject({ id: z.string(), type: z.string() }) }),
          name: 'probe4',
          fresh: true,
          maxRepairs: 2,
          validate: (v) => {
            const r = schemas().Node.safeParse(v.node);
            return r.success ? [] : r.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`);
          },
        }),
    },
    {
      name: 'a full beat',
      run: () =>
        llm.structured({
          stage: 'probe',
          role: 'writer',
          model,
          system: WRITER_SYSTEM,
          prompt:
            'Write a beat (English) that shows 2 − 5 on a number line from −6 to 6: narration with marks, a numberline node "nl" and an equation node "eq" (2 − 5 → 2 + (−5) → = −3), cues that hop from 0 to 2, then 2 to −3, and step the equation at the words that explain it. sources: [{"page": 1}].',
          schema: BeatDraft,
          name: 'probe5',
          fresh: true,
          maxRepairs: 3,
          validate: (d) => {
            const lesson = parseLesson({
              schema: LESSON_SCHEMA,
              id: 'probe',
              title: 'probe',
              lang: 'en',
              beats: [{ id: 'ex', move: 'example', ...d }],
            });
            return validateLesson(lesson)
              .issues.filter((i) => i.level === 'error')
              .map((i) => i.message);
          },
        }),
    },
  ];
  for (const task of tasks) {
    try {
      const r = await task.run();
      ok++;
      repairs += r.repairs;
      usd += r.usd;
    } catch (e) {
      failures.push(
        `${task.name}: ${e instanceof GenerationError ? e.problems.slice(0, 2).join('; ') : (e as Error).message.slice(0, 200)}`,
      );
    }
  }
  const info = modelInfo(model);
  const tier: Tier = ok === 5 && repairs <= 2 && info.context >= 64_000 ? 'A' : ok >= 4 ? 'B' : 'C';
  return { model, ok, total: tasks.length, repairs, tier, ms: Date.now() - t0, usd, failures };
}
