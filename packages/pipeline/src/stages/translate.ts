// Stage: translate — the lesson's string table into another language, beat by beat, keeping marks, answer
// boxes and math; checked with checkStrings and repaired. Strings a person reviewed are kept, sentences the
// book already translated are reused from the translation memory, and the glossary is checked afterwards.
import { checkStrings, collectStrings, type Lesson, type Strings } from '@warqa/lesson';
import * as z from 'zod';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { langName, languageRules, TRANSLATOR_SYSTEM } from '../prompts/index.js';
import { type GlossaryIssue, glossaryIssues, reviewedKeys, TranslationMemory } from './memory.js';
import { type BookPlan, glossaryText } from './plan.js';

export interface TranslateOptions {
  llm: Llm;
  plan?: BookPlan;
  /** Re-translate keys that already have a machine translation (strings a person reviewed are always kept). */
  force?: boolean;
  onChunk?: (e: { chunk: number; total: number; keys: number }) => void;
  /** Translations that do not use the glossary's agreed terms. */
  onGlossary?: (issues: GlossaryIssue[]) => void;
  /** Called with the number of strings reused from the translation memory. */
  onMemory?: (reused: number) => void;
}

const isMathOnly = (s: string) =>
  /^[\s$\d.,+\-−×÷*/=<>≤≥()[\]{}^²³√π%°a-zA-Z|:'′]*$/.test(s.replace(/\[\[\w+\]\]/g, '')) &&
  !/[a-zA-Z]{2,}/.test(s.replace(/\$[^$]*\$/g, ''));

/** Translate a lesson into `lang`, writing strings.<lang>.json. */
export async function translateLesson(
  project: Project,
  lessonId: string,
  lang: string,
  opts: TranslateOptions,
): Promise<Strings> {
  const lesson: Lesson = project.loadLesson(lessonId);
  const entries = collectStrings(lesson);
  const saved = project.loadStrings(lessonId, lang) ?? {};
  const reviewed = reviewedKeys(project, lesson, lang);
  const existing: Strings = opts.force
    ? Object.fromEntries(Object.entries(saved).filter(([k]) => reviewed.has(k)))
    : saved;
  const tm = new TranslationMemory(project, lesson.lang, lang);
  const out: Strings = {};
  let reused = 0;
  // pure math strings are copied, already translated keys are kept, the book's memory is reused
  const todo = entries.filter((e) => {
    if (existing[e.key] !== undefined) {
      out[e.key] = existing[e.key]!;
      return false;
    }
    if (isMathOnly(e.text)) {
      out[e.key] = e.text;
      return false;
    }
    const hit = tm.get(e.text);
    if (hit && (hit.status !== 'machine' || !opts.force)) {
      out[e.key] = hit.text;
      tm.set(e.text, hit.text, hit.status, lessonId);
      reused++;
      return false;
    }
    return true;
  });
  opts.onMemory?.(reused);
  // chunk by beat (keys share a prefix up to the beat id or question id)
  const chunks: (typeof todo)[] = [];
  let cur: typeof todo = [];
  let size = 0;
  for (const e of todo) {
    if (size > 5000 && cur.length) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += e.text.length;
  }
  if (cur.length) chunks.push(cur);
  const gloss = glossaryText(opts.plan, [lesson.lang, lang]);
  for (const [ci, chunk] of chunks.entries()) {
    const input = Object.fromEntries(chunk.map((e) => [e.key, e.text]));
    // earlier translations of similar sentences in this book, so repeated phrasing stays the same
    const seen = new Set<string>();
    const memory = chunk
      .flatMap((e) => tm.similar(e.text, 3))
      .filter(([k]) => !seen.has(k) && seen.add(k))
      .slice(0, 12)
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)} → ${JSON.stringify(v.text)}${v.status === 'machine' ? '' : ' (checked by a teacher)'}`,
      );
    const schema = z.object(
      Object.fromEntries(chunk.map((e) => [e.key, z.string().min(1)])) as Record<string, z.ZodString>,
    );
    const r = await opts.llm.structured({
      stage: 'translate',
      role: 'translator',
      model: resolveRole('translator', project.config),
      system: TRANSLATOR_SYSTEM,
      prompt: `Translate from ${langName(lesson.lang)} to ${langName(lang)}. Lesson: "${lesson.title}".
${gloss ? `Glossary (${lesson.lang} = ${lang}) — always use these terms:\n${gloss}\n` : ''}${memory.length ? `Earlier translations in this book — keep the same wording for the same ideas:\n${memory.join('\n')}\n` : ''}
${languageRules(lang)}

Return a JSON object with exactly the same keys. Strings to translate (key: text):
${JSON.stringify(input, null, 1)}`,
      schema,
      name: `translate:${lessonId}:${lang}:${ci}`,
      validate: (v) => {
        const partial = { ...out, ...v } as Strings;
        const fake = Object.fromEntries(entries.map((e) => [e.key, partial[e.key] ?? e.text]));
        return checkStrings(lesson, fake, lang)
          .filter((i) => chunk.some((e) => i.message.includes(e.key)))
          .map((i) => i.message);
      },
    });
    Object.assign(out, r.value);
    for (const e of chunk) if (typeof r.value[e.key] === 'string') tm.set(e.text, r.value[e.key]!, 'machine', lessonId);
    tm.save();
    opts.onChunk?.({ chunk: ci + 1, total: chunks.length, keys: chunk.length });
    project.saveStrings(lessonId, lang, { ...existing, ...out });
  }
  const ordered: Strings = Object.fromEntries(entries.map((e) => [e.key, out[e.key] ?? existing[e.key] ?? e.text]));
  project.saveStrings(lessonId, lang, ordered);
  tm.save();
  opts.onGlossary?.(glossaryIssues(lesson, ordered, opts.plan, lang));
  return ordered;
}
