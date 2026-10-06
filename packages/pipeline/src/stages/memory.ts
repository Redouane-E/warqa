// Translation memory, review status and glossary checks, shared by every chapter of a book.
//   tm/<src>-<tgt>.json             source text → translation (machine, edited or approved), book-wide
//   lessons/<id>/review.<lang>.json key → {status, src}: strings a person approved or edited
// A string a person approved is never overwritten by the model; the same sentence in a later chapter reuses it.
import { normalizeForMatch } from '@warqa/i18n';
import { checkStrings, collectStrings, type Lesson, type Strings } from '@warqa/lesson';
import type { Project } from '../project/index.js';
import { normText, srcHash } from './hash.js';
import type { BookPlan } from './plan.js';
import { changedSource, loadSources, markTranslated } from './sources.js';

export type TmStatus = 'machine' | 'edited' | 'approved';

export interface TmEntry {
  text: string;
  status: TmStatus;
  lessons: string[];
  at: string;
}

const norm = normText;

export { srcHash };

const words = (s: string) =>
  new Set(
    normalizeForMatch(s.replace(/\[\[\w+\]\]|\$[^$]*\$/g, ' '))
      .split(' ')
      .filter((w) => w.length > 2),
  );

export class TranslationMemory {
  readonly file: string;
  private entries: Record<string, TmEntry>;
  private dirty = false;

  constructor(
    readonly project: Project,
    readonly src: string,
    readonly tgt: string,
  ) {
    this.file = `tm/${src}-${tgt}.json`;
    this.entries = project.readJson<{ entries?: Record<string, TmEntry> }>(this.file, {}).entries ?? {};
  }

  get size(): number {
    return Object.keys(this.entries).length;
  }

  get(source: string): TmEntry | undefined {
    return this.entries[norm(source)];
  }

  /** Record a translation. A machine translation never replaces one a person edited or approved. */
  set(source: string, text: string, status: TmStatus, lesson?: string): void {
    const k = norm(source);
    const old = this.entries[k];
    if (old && old.status !== 'machine' && status === 'machine') {
      if (lesson && !old.lessons.includes(lesson)) old.lessons.push(lesson);
      this.dirty = true;
      return;
    }
    const lessons = [...new Set([...(old?.lessons ?? []), ...(lesson ? [lesson] : [])])];
    this.entries[k] = { text, status, lessons, at: new Date().toISOString() };
    this.dirty = true;
  }

  /** A person's check withdrawn (Undo): their entry for this sentence, when it still holds this text, is the model's again. */
  demote(source: string, text: string): void {
    const e = this.entries[norm(source)];
    if (e && e.status !== 'machine' && e.text === text) {
      e.status = 'machine';
      this.dirty = true;
    }
  }

  /** Earlier translations that share words with `source` (people's versions first), for consistent wording. */
  similar(source: string, n = 8): [string, TmEntry][] {
    const w = words(source);
    if (!w.size) return [];
    const scored: [number, string, TmEntry][] = [];
    for (const [k, e] of Object.entries(this.entries)) {
      const kw = words(k);
      let common = 0;
      for (const x of w) if (kw.has(x)) common++;
      const score = common / (w.size + kw.size - common || 1);
      if (score >= 0.3 && k !== norm(source)) scored.push([score + (e.status === 'machine' ? 0 : 0.2), k, e]);
    }
    return scored
      .sort((a, b) => b[0] - a[0])
      .slice(0, n)
      .map(([, k, e]) => [k, e]);
  }

  all(): [string, TmEntry][] {
    return Object.entries(this.entries);
  }

  save(): void {
    if (!this.dirty) return;
    this.project.writeJson(this.file, { src: this.src, tgt: this.tgt, entries: this.entries });
    this.dirty = false;
  }
}

export interface ReviewMark {
  status: 'approved' | 'edited';
  /** Hash of the source text when it was reviewed: a changed source makes the review stale. */
  src: string;
  at: string;
  /** Where the check came from: the studio, a spreadsheet, the command line. */
  by?: 'studio' | 'sheet' | 'cli';
}
export type ReviewFile = Record<string, ReviewMark>;

export const loadReview = (project: Project, lessonId: string, lang: string): ReviewFile =>
  project.readJson<ReviewFile>(`lessons/${lessonId}/review.${lang}.json`, {});
export const saveReview = (project: Project, lessonId: string, lang: string, r: ReviewFile): void =>
  project.writeJson(`lessons/${lessonId}/review.${lang}.json`, r);

/** Keys a person reviewed whose source has not changed since. */
export function reviewedKeys(project: Project, lesson: Lesson, lang: string): Set<string> {
  const review = loadReview(project, lesson.id, lang);
  const out = new Set<string>();
  for (const e of collectStrings(lesson)) if (review[e.key]?.src === srcHash(e.text)) out.add(e.key);
  return out;
}

// --- glossary -------------------------------------------------------------------------------------------

const ARABIC = /[؀-ۿ]/;
/** Does `text` use `term`? Arabic: anywhere (clitics attach to words). Latin: at a word start, any ending. */
function uses(text: string, term: string): boolean {
  const t = normalizeForMatch(term);
  if (!t) return false;
  const s = normalizeForMatch(text);
  if (ARABIC.test(t)) {
    // compare word by word without the article so "العدد" matches "عدد"
    const strip = (x: string) => x.replace(/(^| )(و|ف)?(ب|ل|ك)?(ال|لل)/g, '$1');
    return s.includes(t) || strip(s).includes(strip(t));
  }
  const at = s.indexOf(t);
  if (at < 0) return false;
  for (let i = at; i >= 0; i = s.indexOf(t, i + 1)) if (i === 0 || !/\p{L}/u.test(s[i - 1]!)) return true;
  return false;
}

export interface GlossaryIssue {
  key: string;
  term: string;
  expected: string;
}

/** Strings whose source uses a glossary term but whose translation does not use the agreed term. */
export function glossaryIssues(
  lesson: Lesson,
  strings: Strings,
  plan: BookPlan | undefined,
  lang: string,
): GlossaryIssue[] {
  const terms = (plan?.glossary ?? [])
    .map((g) => [g.terms[lesson.lang], g.terms[lang]] as const)
    .filter((x): x is readonly [string, string] => !!x[0] && !!x[1]);
  if (!terms.length) return [];
  const out: GlossaryIssue[] = [];
  for (const e of collectStrings(lesson)) {
    const tr = strings[e.key];
    if (typeof tr !== 'string') continue;
    for (const [src, tgt] of terms)
      if (uses(e.text, src) && !uses(tr, tgt)) out.push({ key: e.key, term: src, expected: tgt });
  }
  return out;
}

// --- review queue -----------------------------------------------------------------------------------------

export type ReviewState = 'machine' | 'approved' | 'edited' | 'stale' | 'missing';

/** What part of a lesson a string is ("narration", "question"…), for people. */
export type StringField =
  | 'lesson-title'
  | 'unit'
  | 'title'
  | 'narration'
  | 'part'
  | 'question'
  | 'choice'
  | 'answer'
  | 'cue';

export interface ReviewProblem {
  code: 'missing' | 'marks' | 'speak-marks' | 'boxes' | 'dollars' | 'glossary';
  /** Marks or answer boxes the translation lost, and those it has that the original doesn't. */
  lost?: string[];
  extra?: string[];
  /** Glossary: the original's term and the agreed translation. */
  term?: string;
  expected?: string;
  /** Approving waits until it is fixed (marks, answer boxes, $). */
  blocking: boolean;
}

export interface ReviewItem {
  lesson: string;
  key: string;
  where: string;
  kind: string;
  source: string;
  text: string;
  state: ReviewState;
  /** Glossary misses and string-table problems (marks, answer boxes), in English (the spreadsheet, the CLI). */
  flags: string[];
  /** The beat it belongs to (1-based), with its title in the original language. */
  beat?: { n: number; id: string; title: string };
  field: StringField;
  /** For a part on the stage: its component and the property ("number line", "label"). */
  part?: { type: string; path: string };
  problems: ReviewProblem[];
  /** Every glossary term the original uses, and whether the translation uses the agreed one. */
  glossary: { term: string; expected: string; used: boolean }[];
  /** "Original changed": the original as it was when this was translated or checked. */
  before?: string;
  /** Checked by a person: when, and where from. */
  reviewed?: { at: string; by?: ReviewMark['by'] };
}

/** Where each string of a lesson sits: its beat and what part of it. */
export function stringPlaces(
  lesson: Lesson,
): Map<string, { beat?: ReviewItem['beat']; field: StringField; part?: ReviewItem['part'] }> {
  const out = new Map<string, { beat?: ReviewItem['beat']; field: StringField; part?: ReviewItem['part'] }>();
  const nodeBeat = new Map<string, { n: number; id: string; title: string; type: string }>();
  const qBeat = new Map<string, { n: number; id: string; title: string }>();
  lesson.beats.forEach((b, i) => {
    for (const n of b.scene.add) nodeBeat.set(n.id, { n: i + 1, id: b.id, title: b.title, type: n.type });
    for (const q of b.questions ?? []) qBeat.set(q.id, { n: i + 1, id: b.id, title: b.title });
  });
  const beatOf = (id: string) => {
    const i = lesson.beats.findIndex((b) => b.id === id);
    return i < 0 ? undefined : { n: i + 1, id, title: lesson.beats[i]!.title };
  };
  for (const e of collectStrings(lesson)) {
    const k = e.key.split('.');
    if (k[0] === 'lesson') out.set(e.key, { field: k[1] === 'unit' ? 'unit' : 'lesson-title' });
    else if (k[0] === 'beat') {
      const beat = beatOf(k[1]!);
      const field: StringField = k[2] === 'narration' ? 'narration' : k[2] === 'title' ? 'title' : 'cue';
      out.set(e.key, { ...(beat ? { beat } : {}), field });
    } else if (k[0] === 'node') {
      const nb = nodeBeat.get(k[1]!);
      out.set(e.key, {
        ...(nb ? { beat: { n: nb.n, id: nb.id, title: nb.title } } : {}),
        field: 'part',
        ...(nb ? { part: { type: nb.type, path: k.slice(2).join('.') } } : {}),
      });
    } else if (k[0] === 'q') {
      const beat = qBeat.get(k[1]!);
      const f = k[2];
      const field: StringField =
        f === 'resolve'
          ? 'cue'
          : f === 'options' || f === 'items' || f === 'rows' || f === 'cols' || f === 'wrong'
            ? 'choice'
            : f === 'accept' || f === 'answers'
              ? 'answer'
              : 'question';
      out.set(e.key, { ...(beat ? { beat } : {}), field });
    } else out.set(e.key, { field: 'question' });
  }
  return out;
}

/** The marks or answer boxes one list has that the other lacks. */
const minus = (a: string[] = [], b: string[] = []) => a.filter((x) => !b.includes(x));

/** Every translatable string of a language with its review state and problems, chapter by chapter. */
export function reviewQueue(
  project: Project,
  lang: string,
  opts: { lessons?: string[]; plan?: BookPlan; loaded?: Map<string, Lesson> } = {},
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const id of opts.lessons ?? project.lessonIds()) {
    const lesson = opts.loaded?.get(id) ?? project.loadLesson(id);
    if (lesson.lang === lang) continue;
    const strings = project.loadStrings(id, lang) ?? {};
    const review = loadReview(project, id, lang);
    const sources = loadSources(project, id, lang);
    const places = stringPlaces(lesson);
    const flags = new Map<string, string[]>();
    const problems = new Map<string, ReviewProblem[]>();
    const add = (k: string, m: string, p: ReviewProblem) => {
      flags.set(k, [...(flags.get(k) ?? []), m]);
      problems.set(k, [...(problems.get(k) ?? []), p]);
    };
    for (const g of glossaryIssues(lesson, strings, opts.plan, lang))
      add(g.key, `glossary: “${g.term}” → “${g.expected}”`, {
        code: 'glossary',
        term: g.term,
        expected: g.expected,
        blocking: false,
      });
    const entries = collectStrings(lesson);
    const full = Object.fromEntries(entries.map((e) => [e.key, strings[e.key] ?? e.text]));
    for (const i of checkStrings(lesson, full, lang)) {
      const k = i.key ?? entries.find((e) => i.message.includes(e.key))?.key;
      if (!k || !i.code) continue;
      add(k, i.message, {
        code: i.code,
        ...(i.want ? { lost: minus(i.want, i.got) } : {}),
        ...(i.got ? { extra: minus(i.got, i.want) } : {}),
        blocking: i.level === 'error',
      });
    }
    const terms = (opts.plan?.glossary ?? [])
      .map((g) => [g.terms[lesson.lang], g.terms[lang]] as const)
      .filter((x): x is readonly [string, string] => !!x[0] && !!x[1]);
    for (const e of entries) {
      const text = strings[e.key];
      const r = review[e.key];
      // a person's check is stale when the original changed since; a model's translation too (from its record)
      const changed = changedSource(sources, e.key, e.text);
      const state: ReviewState =
        typeof text !== 'string'
          ? 'missing'
          : r
            ? r.src === srcHash(e.text)
              ? r.status
              : 'stale'
            : changed
              ? 'stale'
              : 'machine';
      const place = places.get(e.key) ?? { field: 'question' as const };
      out.push({
        lesson: id,
        key: e.key,
        where: e.where,
        kind: e.kind,
        source: e.text,
        text: typeof text === 'string' ? text : '',
        state,
        flags: flags.get(e.key) ?? [],
        ...place,
        problems: problems.get(e.key) ?? [],
        glossary: terms
          .filter(([src]) => uses(e.text, src))
          .map(([term, expected]) => ({ term, expected, used: typeof text === 'string' && uses(text, expected) })),
        ...(state === 'stale' && changed ? { before: changed.t } : {}),
        ...(r && state !== 'stale' ? { reviewed: { at: r.at, ...(r.by ? { by: r.by } : {}) } } : {}),
      });
    }
  }
  return out;
}

/**
 * A person approves a string (optionally with their own wording). The string table, the review file and the
 * book's translation memory are updated, so later chapters reuse this wording.
 */
export function reviewString(
  project: Project,
  lessonId: string,
  lang: string,
  key: string,
  opts: {
    text?: string;
    approve?: boolean;
    /** "Keep mine" for a changed original: checked again as it is, an edited wording staying edited. */
    keep?: boolean;
    by?: ReviewMark['by'];
  },
): ReviewItem['state'] {
  const lesson = project.loadLesson(lessonId);
  const entry = collectStrings(lesson).find((e) => e.key === key);
  if (!entry) throw new Error(`no string "${key}" in ${lessonId}`);
  const strings = { ...(project.loadStrings(lessonId, lang) ?? {}) };
  const review = loadReview(project, lessonId, lang);
  const old = strings[key];
  const text = opts.text ?? (typeof old === 'string' ? old : undefined);
  if (text === undefined) throw new Error(`"${key}" has no ${lang} translation yet`);
  const problems = checkStrings(lesson, { ...strings, [key]: text }, lang).filter((i) => i.message.includes(key));
  if (problems.some((i) => i.level === 'error')) throw new Error(problems.map((i) => i.message).join('; '));
  if (opts.text !== undefined) strings[key] = opts.text;
  const status: ReviewMark['status'] =
    opts.text !== undefined && opts.text !== old
      ? 'edited'
      : opts.keep && review[key]
        ? review[key].status
        : 'approved';
  if (opts.approve === false) delete review[key];
  else
    review[key] = {
      status,
      src: srcHash(entry.text),
      at: new Date().toISOString(),
      ...(opts.by ? { by: opts.by } : {}),
    };
  project.saveStrings(lessonId, lang, strings);
  saveReview(project, lessonId, lang, review);
  // checked against the original as it is now
  if (opts.approve !== false) markTranslated(project, lesson, lang, [key]);
  const tm = new TranslationMemory(project, lesson.lang, lang);
  if (opts.approve === false) tm.demote(entry.text, text);
  else tm.set(entry.text, text, status, lessonId);
  tm.save();
  return opts.approve === false ? 'machine' : status;
}

/** Rebuild the translation memory from the string tables (e.g. for books made before it existed). */
export function rebuildMemory(project: Project, src: string, tgt: string): TranslationMemory {
  const tm = new TranslationMemory(project, src, tgt);
  for (const id of project.lessonIds()) {
    const lesson = project.loadLesson(id);
    if (lesson.lang !== src) continue;
    const strings = project.loadStrings(id, tgt);
    if (!strings) continue;
    const review = loadReview(project, id, tgt);
    for (const e of collectStrings(lesson)) {
      const t = strings[e.key];
      if (typeof t !== 'string') continue;
      const r = review[e.key];
      tm.set(e.text, t, r && r.src === srcHash(e.text) ? r.status : 'machine', id);
    }
  }
  tm.save();
  return tm;
}

// --- spreadsheet round trip (for teachers who review in Excel, LibreOffice or Google Sheets) ---------------

const CSV_COLUMNS = ['lesson', 'key', 'where', 'state', 'problems', 'source', 'translation', 'ok'] as const;
const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The review queue as CSV (UTF-8 with BOM so spreadsheet apps show Arabic correctly). */
export function reviewCsv(items: ReviewItem[]): string {
  const rows = items.map((i) =>
    [
      i.lesson,
      i.key,
      i.where,
      i.state,
      i.flags.join(' | '),
      i.source,
      i.text,
      i.state === 'approved' || i.state === 'edited' ? 'yes' : '',
    ]
      .map(cell)
      .join(','),
  );
  return `﻿${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}

/** Parse CSV (quoted fields, embedded commas and newlines, comma or semicolon separated). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        f += '"';
        i++;
      } else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(f);
      f = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += ch;
  }
  if (f || row.length) rows.push([...row, f]);
  return rows.filter((r) => r.some((x) => x.trim()));
}

const YES = /^\s*(y|yes|x|ok|oui|o|نعم|✓|✔|1|true)\s*$/i;

/** Apply a reviewed spreadsheet: changed translations become "edited", rows marked ok become "approved". */
export interface ImportChange {
  lesson: string;
  key: string;
  kind: 'edited' | 'approved';
  before: string;
  after: string;
}

export function importReviewCsv(
  project: Project,
  lang: string,
  csv: string,
  opts: { dry?: boolean } = {},
): { edited: number; approved: number; errors: { key: string; error: string }[]; changes: ImportChange[] } {
  const [head, ...rows] = parseCsv(csv);
  const changes: ImportChange[] = [];
  if (!head) return { edited: 0, approved: 0, errors: [], changes };
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const [li, ki, ti, oi] = [col('lesson'), col('key'), col('translation'), col('ok')];
  if (li < 0 || ki < 0 || ti < 0) throw new Error('the sheet needs the columns lesson, key and translation');
  let edited = 0;
  let approved = 0;
  const errors: { key: string; error: string }[] = [];
  const current = new Map<string, Strings>();
  for (const r of rows) {
    const lesson = r[li]?.trim();
    const key = r[ki]?.trim();
    if (!lesson || !key) continue;
    if (!current.has(lesson)) current.set(lesson, project.loadStrings(lesson, lang) ?? {});
    const before = current.get(lesson)![key];
    const text = r[ti] ?? '';
    const ok = oi >= 0 && YES.test(r[oi] ?? '');
    const was = typeof before === 'string' ? before : (before?.text ?? '');
    try {
      if (text.trim() && text !== was) {
        if (opts.dry) dryCheck(project, lesson, lang, key, text);
        else reviewString(project, lesson, lang, key, { text, by: 'sheet' });
        changes.push({ lesson, key, kind: 'edited', before: was, after: text });
        edited++;
      } else if (ok) {
        const review = loadReview(project, lesson, lang)[key];
        if (!review) {
          if (opts.dry) dryCheck(project, lesson, lang, key, was);
          else reviewString(project, lesson, lang, key, { by: 'sheet' });
          changes.push({ lesson, key, kind: 'approved', before: was, after: was });
          approved++;
        }
      }
    } catch (e) {
      errors.push({ key: `${lesson}/${key}`, error: (e as Error).message });
    }
  }
  return { edited, approved, errors, changes };
}

/** What `reviewString` would refuse, without writing anything (the import's preview). */
function dryCheck(project: Project, lessonId: string, lang: string, key: string, text: string): void {
  const lesson = project.loadLesson(lessonId);
  if (!collectStrings(lesson).some((e) => e.key === key)) throw new Error(`no string "${key}" in ${lessonId}`);
  if (!text) throw new Error(`"${key}" has no ${lang} translation yet`);
  const strings = project.loadStrings(lessonId, lang) ?? {};
  const problems = checkStrings(lesson, { ...strings, [key]: text }, lang).filter(
    (i) => i.key === key && i.level === 'error',
  );
  if (problems.length) throw new Error(problems.map((i) => i.message).join('; '));
}
