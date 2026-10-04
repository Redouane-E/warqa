// Pure grading for every question kind (shared by the player, the validator and tests).
// Portions derived from Papermorph (MIT): exact-value grading semantics (equal values match unless lowest
// terms are asked for; sets in any order; no zero denominators).
import {
  isLowestTerms,
  normalizeForMatch,
  parseNumber,
  prettyMinus,
  rationalEquals,
  rationalOf,
  toNumber,
} from '@warqa/i18n';
import type { Answer, BlanksRow, Question } from '../schema/question.js';

export type Verdict = 'ok' | 'wrong' | 'nan' | 'lowest' | 'empty';

/** Does a typed value match an expected answer? */
export function matchAnswer(answer: Answer, input: string, lang: string): Verdict {
  if (!input.trim()) return 'empty';
  if (typeof answer === 'object' && 'text' in answer) {
    const v = normalizeForMatch(input);
    return answer.text.some((a) => normalizeForMatch(a) === v) ? 'ok' : 'wrong';
  }
  const typed = parseNumber(input, { lang });
  if (!typed) return 'nan';
  if (typeof answer === 'object') {
    if (answer.tol !== undefined) {
      const want = typeof answer.value === 'number' ? answer.value : toNumber(rationalOf(answer.value));
      return Math.abs(toNumber(typed.value) - want) <= answer.tol + 1e-12 ? 'ok' : 'wrong';
    }
    const want = rationalOf(answer.value);
    if (!rationalEquals(typed.value, want)) return 'wrong';
    if (answer.lowest && typed.typedFraction && !isLowestTerms(...typed.typedFraction)) return 'lowest';
    return 'ok';
  }
  return rationalEquals(typed.value, rationalOf(answer)) ? 'ok' : 'wrong';
}

/** How to show an expected answer ("Show answer"). */
export function answerText(answer: Answer): string {
  if (typeof answer === 'number') return prettyMinus(String(answer));
  if (typeof answer === 'string') return prettyMinus(answer);
  if ('text' in answer) return answer.text[0]!;
  return prettyMinus(String(answer.value));
}

export interface RowResult {
  ok: boolean;
  boxes: Record<string, Verdict>;
}

/** Grade one row of answer boxes. With anyOrder, the multiset of values must match. */
export function gradeRow(row: BlanksRow, values: Record<string, string>, lang: string): RowResult {
  const names = Object.keys(row.answers);
  const boxes: Record<string, Verdict> = {};
  if (row.anyOrder) {
    const left = [...names];
    for (const n of names) {
      const v = values[n] ?? '';
      if (!v.trim()) {
        boxes[n] = 'empty';
        continue;
      }
      if (
        !parseNumber(v, { lang }) &&
        !names.some((m) => typeof row.answers[m] === 'object' && 'text' in (row.answers[m] as object))
      ) {
        boxes[n] = 'nan';
        continue;
      }
      const hit = left.findIndex((m) => matchAnswer(row.answers[m]!, v, lang) === 'ok');
      if (hit >= 0) {
        boxes[n] = 'ok';
        left.splice(hit, 1);
      } else boxes[n] = 'wrong';
    }
  } else {
    for (const n of names) boxes[n] = matchAnswer(row.answers[n]!, values[n] ?? '', lang);
  }
  return { ok: names.every((n) => boxes[n] === 'ok'), boxes };
}

export interface Grade {
  ok: boolean;
  /** Parts right / total (rows of a blanks or grid question score separately). */
  right: number;
  total: number;
  /** Feedback key or text for the reader. */
  message?: string;
  detail?: unknown;
}

export type Response =
  | { kind: 'choice'; selected: string[] }
  | { kind: 'blanks'; rows: Record<string, string>[] }
  | { kind: 'numeric'; value: string }
  | { kind: 'grid'; rows: Record<string, string[]> }
  | { kind: 'order'; ids: string[] }
  | { kind: 'pick'; sub: string }
  | { kind: 'text'; value: string };

const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Grade a full response to a question. */
export function grade(q: Question, r: Response, lang: string): Grade {
  switch (q.kind) {
    case 'choice': {
      const sel = r.kind === 'choice' ? r.selected : [];
      const ok = setEq(sel, q.correct);
      const wrong = sel.find((s) => !q.correct.includes(s));
      const why = wrong ? q.options.find((o) => o.id === wrong)?.why : undefined;
      return { ok, right: ok ? 1 : 0, total: 1, ...(why ? { message: why } : {}) };
    }
    case 'blanks': {
      const rows = r.kind === 'blanks' ? r.rows : [];
      const results = q.rows.map((row, i) => gradeRow(row, rows[i] ?? {}, lang));
      const right = results.filter((x) => x.ok).length;
      return { ok: right === q.rows.length, right, total: q.rows.length, detail: results };
    }
    case 'numeric': {
      const v = matchAnswer(q.answer, r.kind === 'numeric' ? r.value : '', lang);
      return { ok: v === 'ok', right: v === 'ok' ? 1 : 0, total: 1, detail: v };
    }
    case 'grid': {
      const rows = r.kind === 'grid' ? r.rows : {};
      const per = q.rows.map((row) => setEq(rows[row.id] ?? [], ([] as string[]).concat(row.correct)));
      const right = per.filter(Boolean).length;
      return { ok: right === q.rows.length, right, total: q.rows.length, detail: per };
    }
    case 'order': {
      const ids = r.kind === 'order' ? r.ids : [];
      const per = q.items.map((it, i) => ids[i] === it.id);
      const ok = per.every(Boolean);
      return { ok, right: ok ? 1 : 0, total: 1, detail: per };
    }
    case 'pick': {
      const sub = r.kind === 'pick' ? r.sub : '';
      const ok = q.correct.includes(sub);
      const msg = q.wrong?.[sub];
      return { ok, right: ok ? 1 : 0, total: 1, ...(msg && !ok ? { message: msg } : {}) };
    }
    case 'text': {
      const v = normalizeForMatch(r.kind === 'text' ? r.value : '');
      const ok = !!v && q.accept.some((a) => normalizeForMatch(a) === v);
      return { ok, right: ok ? 1 : 0, total: 1 };
    }
  }
}

/** Number of scored parts in a question (a multi-row question scores one per row). */
export const partsOf = (q: Question): number => (q.kind === 'blanks' || q.kind === 'grid' ? q.rows.length : 1);

/** Deterministic shuffle for "order" questions (never returns the correct order for 2+ items). */
export function shuffleIds(ids: string[], seed: string): string[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((x, i) => x === ids[i])) out.push(out.shift()!);
  return out;
}
