// Stage: write — each storyboard beat becomes a lesson beat (narration with marks, nodes, cues, questions).
// Every candidate is checked against the real scene left by the previous beats (compile + validators), and
// the problems go back to the model. Weak models (tier C) fill a much smaller format and code places the cues.
import { hasArabic, isArabic } from '@warqa/i18n';
import {
  type Beat,
  compileLesson,
  componentCatalog,
  componentsFor,
  LESSON_SCHEMA,
  type Lesson,
  parseLesson,
  type SceneState,
  schemas,
  validateLesson,
} from '@warqa/lesson';
import * as z from 'zod';
import { mathProblems } from '../export/math.js';
import { type SourceDocument, sectionText } from '../ingest/document.js';
import { tierFor } from '../models/catalog.js';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { EXAMPLE_BEAT, langName, languageRules, TEACHING_PRINCIPLES, WRITER_SYSTEM } from '../prompts/index.js';
import { geoNote } from './geo.js';
import { type BookPlan, glossaryText, type PlanChapter } from './plan.js';
import type { StoryBeat, Storyboard } from './storyboard.js';

const At = z.union([z.string(), z.number(), z.object({ mark: z.string(), offset: z.number() })]);
const CueDraft = z.object({
  at: At,
  do: z.string(),
  target: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
  dur: z.number().optional(),
});
const NodeDraft = z.looseObject({
  id: z.string(),
  type: z.string(),
  slot: z.string().optional(),
  enter: z.enum(['auto', 'cue']).optional(),
});
const QuestionDraft = z.looseObject({ kind: z.string(), id: z.string(), prompt: z.string() });

/** What a tier A/B writer returns (loose; checked strictly afterwards). */
export const BeatDraft = z.object({
  title: z.string(),
  narration: z.string(),
  scene: z.object({
    clear: z.boolean(),
    keep: z.array(z.string()).default([]),
    remove: z.array(z.string()).default([]),
    add: z.array(NodeDraft).default([]),
  }),
  cues: z.array(CueDraft).default([]),
  questions: z.array(QuestionDraft).optional(),
  card: z
    .object({ place: z.enum(['auto', 'band', 'side', 'top', 'screen']), label: z.enum(['check', 'practice']) })
    .optional(),
  sources: z.array(z.object({ page: z.number().int() })).default([]),
});
export type BeatDraft = z.infer<typeof BeatDraft>;

/** What a tier C writer returns: sentences and nodes; cues are placed by code. */
export const BeatLite = z.object({
  title: z.string(),
  sentences: z.array(z.string()).min(1).max(8).describe('narration sentences, in order'),
  nodes: z
    .array(NodeDraft)
    .max(4)
    .describe('what appears on screen, one node per idea, in the order the sentences mention them'),
  questions: z.array(QuestionDraft).max(3).optional(),
});
export type BeatLite = z.infer<typeof BeatLite>;

const LITE_TYPES = [
  'title',
  'text',
  'list',
  'definition',
  'callout',
  'equation',
  'numberline',
  'compare',
  'flow',
  'timeline',
  'keyfigures',
  'table',
];

const KIND_ALIASES: Record<string, string> = {
  multiple_choice: 'choice',
  'multiple-choice': 'choice',
  mcq: 'choice',
  single_choice: 'choice',
  fill_in: 'blanks',
  fill_blank: 'blanks',
  'fill-in-the-blank': 'blanks',
  fill_in_the_blank: 'blanks',
  number: 'numeric',
  short_answer: 'text',
  true_false: 'grid',
  ordering: 'order',
  sequence: 'order',
};

const cleanId = (v: unknown) => {
  if (typeof v !== 'string') return v;
  let id = v
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(id)) id = `m${id}`;
  return id.slice(0, 32);
};

function cleanAt(at: unknown): unknown {
  if (typeof at === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(at.trim())) return Number(at);
    return at.replace(/^mark:\s*/, '').replace(/^\[\[(.+)\]\]$/, '$1');
  }
  if (at && typeof at === 'object' && 'mark' in at) {
    const o = at as { mark: unknown; offset?: unknown };
    return { mark: cleanAt(o.mark), offset: Number(o.offset ?? 0) || 0 };
  }
  return at;
}

const cleanCue = (c: Record<string, unknown>) => ({
  ...c,
  at: cleanAt(c.at),
  ...(c.args && typeof c.args === 'object' && 'id' in (c.args as object)
    ? { args: { ...(c.args as object), id: cleanId((c.args as { id: unknown }).id) } }
    : {}),
});

/**
 * Forgive common model slips before validating: props nested under "props", question-kind aliases, marks
 * written as "mark:x" or "[[x]]", numeric strings for times, ids with capitals. Saves repair rounds.
 */
export function normalizeDraft<T extends Record<string, unknown>>(d: T): T {
  const out = structuredClone(d) as Record<string, unknown>;
  const scene = out.scene as { add?: Record<string, unknown>[] } | undefined;
  if (scene?.add) {
    scene.add = scene.add.map((n) => {
      const { props, ...rest } = n;
      return props && typeof props === 'object' && !Array.isArray(props) ? { ...(props as object), ...rest } : n;
    });
  }
  if (Array.isArray(out.nodes)) {
    out.nodes = (out.nodes as Record<string, unknown>[]).map((n) => {
      const { props, ...rest } = n;
      return props && typeof props === 'object' && !Array.isArray(props) ? { ...(props as object), ...rest } : n;
    });
  }
  if (Array.isArray(out.cues)) out.cues = (out.cues as Record<string, unknown>[]).map(cleanCue);
  if (Array.isArray(out.questions)) {
    out.questions = (out.questions as Record<string, unknown>[]).map((q) => {
      const kind = typeof q.kind === 'string' ? (KIND_ALIASES[q.kind.toLowerCase()] ?? q.kind.toLowerCase()) : q.kind;
      const fixed: Record<string, unknown> = { ...q, kind, id: cleanId(q.id) };
      if (kind === 'grid' && q.kind === 'true_false' && !q.cols) fixed.cols = 'tf';
      if (Array.isArray(q.resolve)) fixed.resolve = (q.resolve as Record<string, unknown>[]).map(cleanCue);
      return fixed;
    });
  }
  return out as T;
}

/** Turn a tier-C answer into a full beat: marks at sentence starts, each node shown with its sentence. */
export function liteToBeat(sb: StoryBeat, lite: BeatLite): Record<string, unknown> {
  const marks = lite.sentences.map((_, i) => `s${i + 1}`);
  const narration = lite.sentences.map((s, i) => (i === 0 ? s : `[[${marks[i]}]]${s}`)).join(' ');
  const cues: Record<string, unknown>[] = [];
  lite.nodes.forEach((n, k) => {
    if (k === 0) return; // the first node opens the beat
    const si = Math.min(k, lite.sentences.length - 1);
    if (si > 0) cues.push({ at: marks[si], do: 'show', target: n.id });
  });
  // equations advance one step per following sentence
  for (const n of lite.nodes) {
    const steps = Array.isArray((n as Record<string, unknown>).steps)
      ? ((n as Record<string, unknown>).steps as unknown[]).length
      : 0;
    const k = lite.nodes.indexOf(n);
    for (let s = 1; s < steps; s++) {
      const si = Math.min(Math.max(k, 0) + s, lite.sentences.length - 1);
      if (si > 0) cues.push({ at: { mark: marks[si]!, offset: 0.2 }, do: 'step', target: n.id });
    }
  }
  const isQ = sb.move === 'check' || sb.move === 'practice';
  return {
    title: lite.title,
    narration,
    scene: { clear: true, add: lite.nodes.map((n, k) => ({ ...n, enter: k === 0 ? 'auto' : 'cue' })) },
    cues,
    ...(lite.questions?.length
      ? {
          questions: lite.questions,
          card: {
            place: sb.move === 'practice' ? 'screen' : 'auto',
            label: isQ && sb.move === 'practice' ? 'practice' : 'check',
          },
        }
      : {}),
    sources: sb.pages.map((page) => ({ page })),
  };
}

/** Short description of what is on stage, for the writer. */
export function describeScene(st: SceneState): string {
  if (!st.order.length) return '(empty stage)';
  return st.order
    .map((id) => {
      const n = st.nodes[id]!;
      const props = JSON.stringify(n.props);
      const marks = Object.entries(n.subs)
        .filter(([, s]) => s.mark)
        .map(([k]) => k);
      const step = typeof n.ch.step === 'number' ? ` (showing step ${n.ch.step})` : '';
      return `- ${id}: ${n.type} in slot ${n.slot}${step}${n.ch.o === 0 ? ' [hidden]' : ''} props ${props.length > 260 ? `${props.slice(0, 260)}…` : props}${marks.length ? `; marks: ${marks.join(', ')}` : ''}`;
    })
    .join('\n');
}

export interface WriteOptions {
  llm: Llm;
  /** Rewrite beats even if lesson.json exists. */
  force?: boolean;
  onBeat?: (e: { id: string; index: number; total: number; repairs: number; usd: number }) => void;
}

/** Problems with a candidate beat, judged against the lesson so far. */
export function beatProblems(
  candidate: unknown,
  sb: StoryBeat,
  before: Beat[],
  lessonBase: Omit<Lesson, 'beats'>,
): string[] {
  const parsed = schemas().Beat.safeParse(candidate);
  if (!parsed.success)
    return parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(beat)'}: ${i.message}`);
  const beat = parsed.data as Beat;
  const p: string[] = [];
  const lang = lessonBase.lang;
  if (isArabic(lang) && !hasArabic(beat.narration)) p.push('narration must be in Arabic script');
  if (!isArabic(lang) && hasArabic(beat.narration)) p.push(`narration must be in ${langName(lang)}`);
  if (/\$/.test(beat.narration)) p.push('narration is read aloud: no $…$ math — say it in words');
  const types = beat.scene.add.map((n) => n.type);
  if (sb.move === 'intro' && !types.includes('title')) p.push('the intro beat needs a "title" node (title card)');
  if (sb.move === 'summary' && !types.includes('list'))
    p.push('the summary beat needs a "list" node with the takeaways');
  if ((sb.move === 'check' || sb.move === 'practice') && !beat.questions?.length)
    p.push(`a ${sb.move} beat needs "questions"`);
  if (sb.move === 'practice' && beat.card?.label !== 'practice')
    p.push('practice beats need "card": {"place": "screen", "label": "practice"}');
  if (sb.move === 'finish' && beat.questions?.length) p.push('the finish beat has no questions');
  const lesson = parseLesson({ ...lessonBase, beats: [...before, beat] });
  const v = validateLesson(lesson, { lang, layout: true });
  for (const is of v.issues) if (is.level === 'error' && (is.beat === beat.id || !is.beat)) p.push(is.message);
  for (const m of mathProblems({ ...lesson, beats: [beat] }))
    p.push(`math "${m.node}": the TeX does not typeset (${m.error}): ${m.tex}`);
  return [...new Set(p)];
}

/** Write (or resume) every beat of a chapter, then save lesson.json. */
export async function writeChapter(
  project: Project,
  doc: SourceDocument,
  plan: BookPlan,
  chapter: PlanChapter,
  story: Storyboard,
  opts: WriteOptions,
): Promise<Lesson> {
  const lang = plan.lang;
  const model = resolveRole('writer', project.config);
  const tier = tierFor(model, 'writer');
  const base: Omit<Lesson, 'beats'> = {
    schema: LESSON_SCHEMA,
    id: chapter.id,
    title: chapter.title,
    lang,
    sourceLang: doc.lang,
    minutes: chapter.minutes,
    ...(chapter.unit ? { unit: chapter.unit } : {}),
    ...(/^ch(\d+)$/.test(chapter.id) ? { number: Number(chapter.id.slice(2)) } : {}),
  };
  // resume: keep beats already written (draft file), unless forced
  const draftPath = `lessons/${chapter.id}/draft.json`;
  const done: Beat[] = opts.force ? [] : (project.readJson<{ beats: Beat[] }>(draftPath, { beats: [] }).beats ?? []);
  const packs = [...new Set([...chapter.packs, ...((project.config.packs ?? []) as typeof chapter.packs)])];
  const catalogTypes = componentsFor({ packs }).map((c) => c.type);
  const gloss = glossaryText(plan, [lang]);

  for (let i = 0; i < story.beats.length; i++) {
    const sb = story.beats[i]!;
    if (done[i]?.id === sb.id) continue;
    done.length = i;
    const prev = done.length ? parseLesson({ ...base, beats: done }) : null;
    const state: SceneState = prev
      ? compileLesson(prev, undefined, { lang, strict: false }).beats.at(-1)!.out
      : { nodes: {}, order: [] };
    const pages = sb.pages.length ? sb.pages : chapter.pages;
    const lo = Math.max(chapter.pages[0], Math.min(...pages) - 1);
    const hi = Math.min(chapter.pages[1], Math.max(...pages) + 1);
    const excerpt = sectionText(doc, lo, hi, { maxChars: tier === 'C' ? 6000 : 16000 });
    const usedIds = done.flatMap((b) => b.scene.add.map((n) => n.id));
    const usedQ = done.flatMap((b) => (b.questions ?? []).map((q) => q.id));
    const types =
      tier === 'A'
        ? catalogTypes
        : [...new Set([...sb.components.filter((t) => catalogTypes.includes(t)), 'text', 'title', 'list', 'callout'])];
    const storyLines = story.beats
      .map((b, k) => `${k === i ? '→' : ' '} ${b.id} [${b.move}] ${b.title} — ${b.idea}`)
      .join('\n');
    const context = `Chapter ${chapter.id}: ${chapter.title}. Audience: ${plan.audience}.
Conventions: ${plan.conventions.notation} ${plan.conventions.colors} ${plan.conventions.tone}
Glossary (use these terms):
${gloss || '(none)'}

Storyboard (→ = the beat to write now):
${storyLines}

THIS BEAT: id "${sb.id}", move "${sb.move}", title "${sb.title}"
Idea: ${sb.idea}
Visual: ${sb.visual}
Planned components: ${sb.components.join(', ') || '(choose)'}${sb.keep.length ? `\nKeep from the previous beat: ${sb.keep.join(', ')}` : ''}${sb.question ? `\nQuestion: ${sb.question.kinds.join('/')} about ${sb.question.about}` : ''}
About ${sb.seconds} seconds of narration.

On stage now (after the previous beat):
${describeScene(state)}
Ids already used in this lesson (never reuse): ${[...usedIds, ...usedQ].join(', ') || '(none)'}
Previous narration: ${done.at(-1)?.narration.slice(0, 400) ?? '(this is the first beat)'}

Source text (pages ${lo}–${hi}):
"""
${excerpt}
"""

${languageRules(lang)}`;

    let draft: Record<string, unknown>;
    let repairs = 0;
    let usd = 0;
    if (tier === 'C') {
      const liteTypes = types.filter((t) => LITE_TYPES.includes(t));
      const r = await opts.llm.structured({
        stage: 'write',
        role: 'writer',
        model,
        system: `You write one beat of a narrated lesson for a simple player. ${TEACHING_PRINCIPLES}`,
        prompt: `${context}

Components you may use (put props directly on the node):
${componentCatalog({ types: liteTypes, schemas: true, examples: true })}

Write 2–6 short narration sentences and the nodes that appear with them (the first node appears at once; node k appears with sentence k). For check/practice beats write the questions (kinds: choice, blanks, grid, numeric) — each with id, prompt, explain, and the fields of its kind.`,
        schema: BeatLite,
        name: `beat-lite:${chapter.id}:${sb.id}`,
        validate: (lite) =>
          beatProblems(
            { id: sb.id, move: sb.move, ...normalizeDraft(liteToBeat(sb, normalizeDraft(lite))) },
            sb,
            done,
            base,
          ),
      });
      draft = normalizeDraft(liteToBeat(sb, normalizeDraft(r.value)));
      repairs = r.repairs;
      usd = r.usd;
    } else {
      const r = await opts.llm.structured({
        stage: 'write',
        role: 'writer',
        model,
        system: WRITER_SYSTEM,
        prompt: `${context}

Components you may use:
${componentCatalog({ types, schemas: true, examples: true })}
${types.includes('map') ? geoNote(project) : ''}

Example of a good beat (English, from another lesson):
${JSON.stringify(EXAMPLE_BEAT)}

Write beat "${sb.id}" now. Make the picture carry the argument: schedule a visual change at the words that explain it.`,
        schema: BeatDraft,
        name: `beat:${chapter.id}:${sb.id}`,
        validate: (d) => beatProblems({ id: sb.id, move: sb.move, ...normalizeDraft(d) }, sb, done, base),
      });
      draft = normalizeDraft(r.value as unknown as Record<string, unknown>);
      repairs = r.repairs;
      usd = r.usd;
    }
    const beat = schemas().Beat.parse({ id: sb.id, move: sb.move, ...draft }) as Beat;
    done.push(beat);
    project.writeJson(draftPath, { beats: done });
    opts.onBeat?.({ id: sb.id, index: i, total: story.beats.length, repairs, usd });
  }

  const lesson = parseLesson({ ...base, beats: done });
  project.saveLesson(chapter.id, lesson);
  return lesson;
}

export interface RewriteOptions {
  llm: Llm;
  /** What the author wants changed ("shorter", "use a balance scale", …). */
  instruction?: string;
}

/** Regenerate one beat of an existing lesson (keeping the others), optionally following an instruction. */
export async function rewriteBeat(
  project: Project,
  doc: SourceDocument,
  plan: BookPlan,
  lessonId: string,
  beatId: string,
  opts: RewriteOptions,
): Promise<Lesson> {
  const lesson = project.loadLesson(lessonId);
  const idx = lesson.beats.findIndex((b) => b.id === beatId);
  if (idx < 0) throw new Error(`no beat "${beatId}" in ${lessonId}`);
  const chapter = plan.chapters.find((c) => c.id === lessonId);
  if (!chapter) throw new Error(`no chapter "${lessonId}" in the plan`);
  const story = project.readJson<Storyboard | undefined>(`lessons/${lessonId}/storyboard.json`, undefined);
  const old = lesson.beats[idx]!;
  const sb: StoryBeat = story?.beats.find((b) => b.id === beatId) ?? {
    id: old.id,
    move: old.move,
    title: old.title,
    idea: old.title,
    visual: '',
    components: old.scene.add.map((n) => n.type),
    keep: [],
    pages: old.sources.map((s) => s.page),
    seconds: 15,
  };
  const before = lesson.beats.slice(0, idx);
  const after = lesson.beats.slice(idx + 1);
  // ids of this beat's nodes that later beats still use: the new version must keep them
  const ownIds = new Set(old.scene.add.map((n) => n.id));
  const usedLater = new Set<string>();
  for (const b of after) {
    for (const id of [...b.scene.keep, ...b.scene.remove]) if (ownIds.has(id)) usedLater.add(id);
    for (const c of [...b.cues, ...(b.questions ?? []).flatMap((q) => q.resolve)]) {
      const id = c.target.split('#')[0]!;
      if (ownIds.has(id)) usedLater.add(id);
    }
    for (const q of b.questions ?? []) if (q.kind === 'pick' && ownIds.has(q.on)) usedLater.add(q.on);
  }
  const baseVisual = sb.visual;
  const request = (extra: string) =>
    `${baseVisual}${opts.instruction ? `\nAUTHOR'S REQUEST — follow it: ${opts.instruction}` : ''}${extra}\nCurrent version of this beat: ${JSON.stringify(old).slice(0, 4000)}${
      usedLater.size
        ? `\nLater beats use these nodes from this beat — keep them with the same ids and types: ${[...usedLater].map((id) => `${id} (${old.scene.add.find((n) => n.id === id)?.type})`).join(', ')}`
        : ''
    }`;
  const mini = (): Storyboard => ({
    chapter: lessonId,
    title: lesson.title,
    beats: [
      ...(story?.beats.slice(0, idx) ??
        before.map((b) => ({
          id: b.id,
          move: b.move,
          title: b.title,
          idea: b.title,
          visual: '',
          components: [],
          keep: [],
          pages: [],
          seconds: 10,
        }))),
      sb,
    ],
  });
  let next: Lesson | undefined;
  let problems = '';
  for (let attempt = 0; attempt < 2 && !next; attempt++) {
    sb.visual = request(problems ? `\nYOUR LAST VERSION BROKE LATER BEATS — fix this: ${problems}` : '');
    // write the single beat with the chapter writer, resuming from the beats before it
    project.writeJson(`lessons/${lessonId}/draft.json`, { beats: before });
    const partial = await writeChapter(project, doc, plan, chapter, mini(), { llm: opts.llm });
    const candidate = parseLesson({ ...lesson, beats: [...partial.beats, ...after] });
    const v = validateLesson(candidate);
    if (v.ok) next = candidate;
    else
      problems = v.issues
        .filter((i) => i.level === 'error')
        .slice(0, 5)
        .map((i) => `${i.beat}: ${i.message}`)
        .join('; ');
  }
  if (!next) {
    // report rather than save a broken lesson
    project.saveLesson(lessonId, lesson);
    throw new Error(`the new "${beatId}" breaks later beats: ${problems}`);
  }
  // translations of this beat are stale now: drop them so `translate` redoes just these strings
  const newBeat = next.beats[idx]!;
  const nodeIds = new Set([...ownIds, ...newBeat.scene.add.map((n) => n.id)]);
  const qIds = new Set([...(old.questions ?? []), ...(newBeat.questions ?? [])].map((q) => q.id));
  const stale = (k: string) =>
    k.startsWith(`beat.${beatId}.`) ||
    [...nodeIds].some((id) => k.startsWith(`node.${id}.`)) ||
    [...qIds].some((id) => k.startsWith(`q.${id}.`));
  for (const lang of project.book.langs.filter((l) => l !== lesson.lang)) {
    const st = project.loadStrings(lessonId, lang);
    if (!st) continue;
    project.saveStrings(lessonId, lang, Object.fromEntries(Object.entries(st).filter(([k]) => !stale(k))));
  }
  project.saveLesson(lessonId, next);
  return next;
}
