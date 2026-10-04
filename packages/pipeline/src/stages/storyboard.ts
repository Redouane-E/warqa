// Stage: storyboard — one chapter as a list of beats with teaching moves, the visual change of each and
// where the questions go.
import { componentsFor, MOVES } from '@warqa/lesson';
import * as z from 'zod';
import { type SourceDocument, sectionText } from '../ingest/document.js';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { langName, languageRules, STORYBOARD_SYSTEM } from '../prompts/index.js';
import { type BookPlan, glossaryText, type PlanChapter } from './plan.js';

export const StoryBeat = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/)
    .describe('short lower-case id, e.g. "intro", "rule", "ex1", "q1", "wrap", "final1", "finish"'),
  move: z.enum(MOVES),
  title: z.string(),
  idea: z.string().describe('what this beat teaches, in one or two sentences'),
  visual: z
    .string()
    .describe('what the picture shows and how it changes while the narration explains (the visual argument)'),
  components: z.array(z.string()).describe('component types used, from the catalog'),
  keep: z
    .array(z.string())
    .default([])
    .describe('components from the previous beat to keep on stage (by description), if any'),
  question: z
    .object({ kinds: z.array(z.string()), about: z.string() })
    .optional()
    .describe('for check/practice beats'),
  pages: z.array(z.number().int()).describe('source pages used'),
  seconds: z.number().min(2).max(90).describe('approximate narration length'),
});
export type StoryBeat = z.infer<typeof StoryBeat>;

export const Storyboard = z.object({
  chapter: z.string(),
  title: z.string(),
  beats: z.array(StoryBeat).min(4).max(30),
});
export type Storyboard = z.infer<typeof Storyboard>;

export interface StoryboardOptions {
  llm: Llm;
  maxChars?: number;
}

export function storyboardProblems(sb: Pick<Storyboard, 'beats'>, allowed: string[]): string[] {
  const p: string[] = [];
  const ids = sb.beats.map((b) => b.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) p.push(`beat ids must be unique (repeated: ${[...new Set(dup)].join(', ')})`);
  if (sb.beats[0]?.move !== 'intro') p.push('the first beat must be the intro (move "intro") with a title card');
  if (sb.beats.at(-1)?.move !== 'finish') p.push('the last beat must have move "finish"');
  if (!sb.beats.some((b) => b.move === 'summary')) p.push('add a "summary" beat (the wrap) before the practice');
  if (!sb.beats.some((b) => b.move === 'practice')) p.push('add 1–3 "practice" beats before the finish');
  if (!sb.beats.some((b) => b.move === 'check')) p.push('add quick checks (move "check") between lesson beats');
  let run = 0;
  for (const b of sb.beats) {
    if (['define', 'example', 'transform', 'contrast', 'predict', 'hook', 'story'].includes(b.move)) run++;
    else run = 0;
    if (run > 4) {
      p.push(`more than 4 lesson beats in a row before "${b.id}": put a quick check between them`);
      break;
    }
  }
  for (const b of sb.beats) {
    const unknown = b.components.filter((c) => !allowed.includes(c));
    if (unknown.length)
      p.push(`beat ${b.id}: unknown components ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
  }
  return p;
}

export async function storyboardChapter(
  project: Project,
  doc: SourceDocument,
  plan: BookPlan,
  chapter: PlanChapter,
  opts: StoryboardOptions,
): Promise<Storyboard> {
  const lang = plan.lang;
  const comps = componentsFor({
    packs: [...new Set([...chapter.packs, ...((project.config.packs ?? []) as typeof chapter.packs)])],
  });
  const allowed = comps.map((c) => c.type);
  const text = sectionText(doc, chapter.pages[0], chapter.pages[1], { maxChars: opts.maxChars ?? 60_000 });
  const prompt = `Book: ${plan.title}. Audience: ${plan.audience}.
Chapter ${chapter.id}: ${chapter.title}${chapter.unit ? ` (unit: ${chapter.unit})` : ''}, about ${chapter.minutes} minutes.
Objectives:
${chapter.objectives.map((o) => `- ${o}`).join('\n')}
Suggested visual models: ${chapter.visuals.join('; ') || '(choose)'}
Conventions: ${plan.conventions.notation} ${plan.conventions.colors} ${plan.conventions.tone}
Glossary:
${glossaryText(plan, [lang]) || '(none)'}

Available components (type — what it is for):
${comps.map((c) => `- ${c.type} — ${c.doc.split('. ')[0]}.`).join('\n')}

Source text of the chapter (pages ${chapter.pages[0]}–${chapter.pages[1]}):
"""
${text}
"""

Storyboard the chapter as 8–18 beats. For each beat give the move, a title (in ${langName(lang)}), the idea, the visual change that carries the argument, the components, what stays on stage from the previous beat, the question focus for check/practice beats, the source pages and the approximate narration length. Re-create examples rather than copying long passages. Keep the chapter's scope.
${languageRules(lang)}`;
  const r = await opts.llm.structured({
    stage: 'storyboard',
    role: 'storyboard',
    model: resolveRole('storyboard', project.config),
    system: STORYBOARD_SYSTEM,
    prompt,
    schema: Storyboard.omit({ chapter: true }),
    name: `storyboard:${chapter.id}`,
    validate: (sb) => storyboardProblems(sb, allowed),
  });
  const sb: Storyboard = { chapter: chapter.id, ...r.value };
  project.writeJson(`lessons/${chapter.id}/storyboard.json`, sb);
  return sb;
}
