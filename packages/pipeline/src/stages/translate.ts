// Stage: translate — the lesson's string table into another language, beat by beat, keeping marks, answer
// boxes and math; checked with checkStrings and repaired. Strings a person reviewed are kept, sentences the
// book already translated are reused from the translation memory, and the glossary is checked afterwards.
// A model translation whose original changed since it was made is translated again; a person's is kept (the
// review queue shows it as "Original changed" for them to decide).
import { checkStrings, collectStrings, type Lesson, type Strings } from '@warqa/lesson';
import * as z from 'zod';
import type { Llm } from '../models/llm.js';
import { resolveRole } from '../models/presets.js';
import type { Project } from '../project/index.js';
import { langName, languageRules, TRANSLATOR_SYSTEM } from '../prompts/index.js';
import {
  type GlossaryIssue,
  glossaryIssues,
  loadReview,
  reviewedKeys,
  saveReview,
  TranslationMemory,
} from './memory.js';
import { type BookPlan, glossaryText } from './plan.js';
import { changedSource, loadSources, markTranslated } from './sources.js';

export interface TranslateOptions {
  llm: Llm;
  plan?: BookPlan;
  /** Re-translate keys that already have a machine translation (strings a person reviewed are always kept). */
  force?: boolean;
  /** Translate these keys again, even a person's wording (asked for row by row: "Translate again"). */
  keys?: string[];
  /** After each chunk is saved (Stop between chunks keeps it). */
  onChunk?: (e: { chunk: number; total: number; keys: number }) => void;
  /** Translations that do not use the glossary's agreed terms. */
  onGlossary?: (issues: GlossaryIssue[]) => void;
  /** Called with the number of strings reused from the translation memory. */
  onMemory?: (reused: number) => void;
}

/** A string of numbers and symbols only: copied, never translated. */
export const isMathOnly = (s: string) =>
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
  const sources = loadSources(project, lessonId, lang);
  const redo = new Set(opts.keys ?? []);
  const existing: Strings = opts.force
    ? Object.fromEntries(Object.entries(saved).filter(([k]) => reviewed.has(k)))
    : { ...saved };
  // a person's wording stays theirs even when its original changed: they decide ("Keep mine" or "Translate again")
  const review = loadReview(project, lessonId, lang);
  for (const e of entries) {
    // rows asked for again ("Translate again": those only), else the model's translations whose original changed
    const stale = !review[e.key] && changedSource(sources, e.key, e.text);
    if (redo.size ? redo.has(e.key) : stale) delete existing[e.key];
  }
  const tm = new TranslationMemory(project, lesson.lang, lang);
  const out: Strings = {};
  // keys written now (translated, copied or reused) and kept ones with no record of their source yet
  const fresh = new Set<string>();
  let reused = 0;
  // pure math strings are copied, already translated keys are kept, the book's memory is reused
  const todo = entries.filter((e) => {
    // rows asked for again: the others stay as they are (a missing one stays missing)
    if (redo.size && !redo.has(e.key)) {
      if (existing[e.key] !== undefined) out[e.key] = existing[e.key]!;
      return false;
    }
    if (existing[e.key] !== undefined) {
      out[e.key] = existing[e.key]!;
      if (!sources?.[e.key]) fresh.add(e.key);
      return false;
    }
    fresh.add(e.key);
    if (isMathOnly(e.text)) {
      out[e.key] = e.text;
      return false;
    }
    const hit = tm.get(e.text);
    // a row asked for again goes to the model, even when the memory knows the sentence
    if (hit && !redo.has(e.key) && (hit.status !== 'machine' || !opts.force)) {
      out[e.key] = hit.text;
      tm.set(e.text, hit.text, hit.status, lessonId);
      reused++;
      return false;
    }
    return true;
  });
  opts.onMemory?.(reused);
  // a person's wording sent to the model (asked for again, or "Make again" with force) is theirs no more
  const sent = new Set(todo.map((e) => e.key));
  if (Object.keys(review).some((k) => sent.has(k)))
    saveReview(project, lessonId, lang, Object.fromEntries(Object.entries(review).filter(([k]) => !sent.has(k))));
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
    // saved before it is reported: a Stop after this chunk keeps it
    project.saveStrings(lessonId, lang, { ...existing, ...out });
    markTranslated(
      project,
      lesson,
      lang,
      chunk.map((e) => e.key).filter((k) => out[k] !== undefined),
    );
    opts.onChunk?.({ chunk: ci + 1, total: chunks.length, keys: chunk.length });
  }
  // only the rows asked for: nothing else is filled in (a missing row is not written with the original's text)
  const ordered: Strings = redo.size
    ? Object.fromEntries(
        entries.flatMap((e) => {
          const v = out[e.key] ?? saved[e.key];
          return v === undefined ? [] : [[e.key, v]];
        }),
      )
    : Object.fromEntries(entries.map((e) => [e.key, out[e.key] ?? existing[e.key] ?? e.text]));
  project.saveStrings(lessonId, lang, ordered);
  markTranslated(project, lesson, lang, fresh);
  tm.save();
  opts.onGlossary?.(glossaryIssues(lesson, ordered, opts.plan, lang));
  return ordered;
}
