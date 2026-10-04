// Stage: book plan — which chapters to make, for whom, with what objectives and terminology.
import { ltext } from '@warqa/lesson';
import * as z from 'zod';
import { type SourceDocument, sectionText } from '../ingest/document.js';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { langName, PLAN_SYSTEM } from '../prompts/index.js';

export const PlanChapter = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  section: z.string(),
  title: z.string().min(1),
  unit: z.string().optional(),
  pages: z.tuple([z.number().int(), z.number().int()]),
  objectives: z.array(z.string()).min(1).max(6),
  minutes: z.number().min(2).max(30),
  visuals: z.array(z.string()).max(6).default([]),
  /** Component packs suited to the chapter (stem, humanities, document, kids). */
  packs: z.array(z.enum(['core', 'stem', 'humanities', 'document', 'kids'])).default(['core']),
  include: z.boolean().default(true),
});
export type PlanChapter = z.infer<typeof PlanChapter>;

export const BookPlan = z.object({
  status: z.enum(['draft', 'approved']).default('draft'),
  title: z.string(),
  subtitle: z.string().optional(),
  audience: z.string(),
  /** Language the lessons are written in first (others are translated). */
  lang: z.string(),
  chapters: z.array(PlanChapter).min(1),
  glossary: z.array(z.object({ terms: z.record(z.string(), z.string()), note: z.string().optional() })).default([]),
  conventions: z
    .object({ notation: z.string().default(''), colors: z.string().default(''), tone: z.string().default('') })
    .prefault({}),
});
export type BookPlan = z.infer<typeof BookPlan>;

/** What the planner model writes (ids, page ranges and order are filled in from the section map). */
const PlanDraft = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  audience: z.string(),
  chapters: z
    .array(
      z.object({
        section: z.string().describe('id of the source section this chapter teaches (from the list)'),
        title: z.string(),
        unit: z.string().optional(),
        objectives: z.array(z.string()).min(1).max(5),
        minutes: z.number().min(2).max(30),
        visuals: z
          .array(z.string())
          .max(5)
          .describe(
            'visual models that explain the ideas (e.g. "number line hops", "balance scale", "timeline of reigns")',
          ),
        packs: z.array(z.enum(['core', 'stem', 'humanities', 'document', 'kids'])),
        include: z.boolean().describe('false for front matter, indexes, answer keys'),
      }),
    )
    .min(1),
  glossary: z
    .array(
      z.object({
        terms: z.record(z.string(), z.string()).describe('the same term in each book language, keyed by language code'),
        note: z.string().optional(),
      }),
    )
    .max(60),
  conventions: z.object({ notation: z.string(), colors: z.string(), tone: z.string() }),
});

export interface PlanOptions {
  llm: Llm;
  /** Override the audience (else from warqa.json). */
  audience?: string;
  maxSections?: number;
}

/** Draft a book plan from the ingested document. */
export async function planBook(project: Project, doc: SourceDocument, opts: PlanOptions): Promise<BookPlan> {
  const book = project.book;
  const lang = book.defaultLang ?? book.langs[0]!;
  const audience = opts.audience ?? book.audience ?? project.config.audience ?? 'secondary-school students';
  const sections = doc.sections.length
    ? doc.sections
    : [{ id: 'all', title: doc.source.title ?? 'Book', start: 1, end: doc.source.pages }];
  const listed = sections.slice(0, opts.maxSections ?? 120);
  const outline = listed
    .map(
      (s) =>
        `- ${s.id} | pages ${s.start}-${s.end}${s.unit ? ` | unit: ${s.unit}` : ''} | ${s.title}\n  ${sectionText(doc, s.chapterStart ?? s.start, Math.min(s.end, (s.chapterStart ?? s.start) + 1), { markers: false, maxChars: 700 }).replace(/\s+/g, ' ')}`,
    )
    .join('\n');
  const prompt = `Book: ${doc.source.title ?? ltext(book.title, lang)} (${doc.source.pages} pages, source language: ${doc.lang}).
Audience: ${audience}. Tone: ${project.config.tone ?? 'warm, clear, exact'}.
Lessons will be written in ${langName(lang)} and offered in: ${book.langs.map(langName).join(', ')}.

Source sections (id | pages | title, then the opening text):
${outline}

Plan one animated lesson per teachable section, in book order. Skip front matter, indexes, answer keys and blank sections (include: false).
Give each chapter a title in ${langName(lang)}, 2–4 concrete learning objectives (in ${langName(lang)}), an estimated length (minutes, typically 5–11), visual models that would explain its ideas through change, and the component packs it needs.
Glossary: the key terms of the book, each given in every book language (${book.langs.join(', ')}), using standard school terminology for each language.
Conventions: notation, colour meanings to keep consistent, and the narration tone.`;
  const r = await opts.llm.structured({
    stage: 'plan',
    role: 'planner',
    model: resolveRole('planner', project.config),
    system: PLAN_SYSTEM,
    prompt,
    schema: PlanDraft,
    name: 'plan',
    validate: (d) => {
      const ids = new Set(listed.map((s) => s.id));
      const bad = d.chapters.filter((c) => !ids.has(c.section)).map((c) => c.section);
      return bad.length ? [`unknown section ids: ${bad.join(', ')} (use ids from the list)`] : [];
    },
  });
  const d = r.value;
  let n = 0;
  const chapters: PlanChapter[] = d.chapters.map((c) => {
    const s = listed.find((x) => x.id === c.section)!;
    n += c.include ? 1 : 0;
    return {
      id: `ch${String(n).padStart(2, '0')}`,
      section: c.section,
      title: c.title,
      ...(c.unit ? { unit: c.unit } : {}),
      pages: [s.chapterStart ?? s.start, s.end] as [number, number],
      objectives: c.objectives,
      minutes: c.minutes,
      visuals: c.visuals,
      packs: [...new Set(['core', ...c.packs])] as PlanChapter['packs'],
      include: c.include,
    };
  });
  // excluded chapters keep a distinct id
  chapters.filter((c) => !c.include).forEach((c, i) => (c.id = `x${String(i + 1).padStart(2, '0')}`));
  const plan: BookPlan = BookPlan.parse({
    status: 'draft',
    title: d.title,
    subtitle: d.subtitle,
    audience: d.audience,
    lang,
    chapters,
    glossary: d.glossary,
    conventions: d.conventions,
  });
  project.writeJson('plan.json', plan);
  return plan;
}

export function loadPlan(project: Project): BookPlan | undefined {
  const raw = project.readJson<unknown>('plan.json', undefined);
  return raw ? BookPlan.parse(raw) : undefined;
}

/** Write the approved plan's units and titles into warqa.json. */
export function applyPlan(project: Project, plan: BookPlan): void {
  const units: { title: string; chapters: string[] }[] = [];
  for (const c of plan.chapters.filter((x) => x.include)) {
    const u = c.unit ?? plan.title;
    const last = units[units.length - 1];
    if (last && last.title === u) last.chapters.push(c.id);
    else units.push({ title: u, chapters: [c.id] });
  }
  const lang = plan.lang;
  project.book.units = units.map((u) => ({ title: { [lang]: u.title }, chapters: u.chapters }));
  if (typeof project.book.title === 'string' || !ltext(project.book.title, lang))
    project.book.title = { [lang]: plan.title };
  if (plan.subtitle && !project.book.subtitle) project.book.subtitle = { [lang]: plan.subtitle };
  project.book.audience = plan.audience;
  project.saveBook();
}

/** Glossary lines for prompts in the author language (and target language when translating). */
export function glossaryText(plan: BookPlan | undefined, langs: string[]): string {
  if (!plan?.glossary.length) return '';
  return plan.glossary
    .map(
      (g) =>
        langs
          .map((l) => g.terms[l])
          .filter(Boolean)
          .join(' = ') + (g.note ? ` (${g.note})` : ''),
    )
    .filter(Boolean)
    .join('\n');
}
