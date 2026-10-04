// One language-neutral lesson skeleton + string tables per language.
// collectStrings() lists every localizable string with a stable key; localize() applies a table.
import { componentDef } from '../components/registry.js';
import type { Beat, Lesson, Strings } from '../schema/lesson.js';
import type { Question } from '../schema/question.js';

export interface StringEntry {
  key: string;
  text: string;
  /** Where it lives, for editors: e.g. "beat rule › narration". */
  where: string;
  /** Narration strings must keep the same [[marks]] in every language. */
  kind: 'narration' | 'text' | 'math-template';
}

/** Expand a pattern like "items.*.text" against an object: concrete paths whose value is a string. */
export function expandPath(obj: unknown, pattern: string): string[] {
  const segs = pattern.split('.');
  const out: string[] = [];
  const walk = (v: unknown, i: number, path: string[]) => {
    if (i === segs.length) {
      if (typeof v === 'string') out.push(path.join('.'));
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const seg = segs[i]!;
    if (seg === '*') {
      for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], i + 1, [...path, k]);
    } else walk((v as Record<string, unknown>)[seg], i + 1, [...path, seg]);
  };
  walk(obj, 0, []);
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), obj);
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const segs = path.split('.');
  let v = obj as Record<string, unknown>;
  for (const s of segs.slice(0, -1)) {
    if (!v || typeof v !== 'object') return;
    v = v[s] as Record<string, unknown>;
  }
  if (v && typeof v === 'object') v[segs[segs.length - 1]!] = value;
}

function questionEntries(
  q: Question,
  push: (key: string, text: string | undefined, where: string, kind?: StringEntry['kind']) => void,
) {
  const k = `q.${q.id}`;
  push(`${k}.prompt`, q.prompt, `question ${q.id} › prompt`);
  push(`${k}.hint`, q.hint, `question ${q.id} › hint`);
  push(`${k}.explain`, q.explain, `question ${q.id} › explain`);
  switch (q.kind) {
    case 'choice':
      for (const o of q.options) {
        push(`${k}.options.${o.id}.text`, o.text, `question ${q.id} › option ${o.id}`);
        push(`${k}.options.${o.id}.why`, o.why, `question ${q.id} › option ${o.id} feedback`);
      }
      break;
    case 'blanks':
      q.rows.forEach((r, i) => {
        push(`${k}.rows.${i}.template`, r.template, `question ${q.id} › row ${i + 1}`, 'math-template');
        push(`${k}.rows.${i}.explain`, r.explain, `question ${q.id} › row ${i + 1} explanation`);
        push(`${k}.rows.${i}.hint`, r.hint, `question ${q.id} › row ${i + 1} hint`);
        for (const [box, a] of Object.entries(r.answers)) {
          if (typeof a === 'object' && a && 'text' in a)
            a.text.forEach((t, j) =>
              push(`${k}.rows.${i}.answers.${box}.text.${j}`, t, `question ${q.id} › accepted word`),
            );
        }
      });
      break;
    case 'numeric':
      push(`${k}.unit`, q.unit, `question ${q.id} › unit`);
      break;
    case 'grid':
      if (q.cols !== 'tf')
        for (const c of q.cols) push(`${k}.cols.${c.id}`, c.text, `question ${q.id} › column ${c.id}`);
      for (const r of q.rows) {
        push(`${k}.rows.${r.id}.text`, r.text, `question ${q.id} › row ${r.id}`);
        push(`${k}.rows.${r.id}.why`, r.why, `question ${q.id} › row ${r.id} feedback`);
      }
      break;
    case 'order':
      for (const it of q.items) push(`${k}.items.${it.id}`, it.text, `question ${q.id} › item ${it.id}`);
      break;
    case 'pick':
      for (const [s, txt] of Object.entries(q.wrong ?? {}))
        push(`${k}.wrong.${s}`, txt, `question ${q.id} › wrong pick ${s}`);
      break;
    case 'text':
      q.accept.forEach((a, i) => push(`${k}.accept.${i}`, a, `question ${q.id} › accepted answer`));
      break;
  }
}

/** Every localizable string of a lesson, with stable keys shared by all languages. */
export function collectStrings(lesson: Lesson): StringEntry[] {
  indexLesson(lesson);
  const out: StringEntry[] = [];
  const push = (key: string, text: string | undefined, where: string, kind: StringEntry['kind'] = 'text') => {
    if (typeof text === 'string' && text.length) out.push({ key, text, where, kind });
  };
  push('lesson.title', lesson.title, 'lesson › title');
  push('lesson.unit', lesson.unit, 'lesson › unit');
  for (const b of lesson.beats) {
    push(`beat.${b.id}.title`, b.title, `beat ${b.id} › title`);
    push(`beat.${b.id}.narration`, b.narration, `beat ${b.id} › narration`, 'narration');
    for (const n of b.scene.add) {
      const def = componentDef(n.type);
      for (const pattern of def?.text ?? []) {
        for (const p of expandPath(n, pattern))
          push(`node.${n.id}.${p}`, getPath(n, p) as string, `beat ${b.id} › ${n.type} ${n.id} › ${p}`);
      }
    }
    b.cues.forEach((c, i) => cueEntries(b, c, i, `beat.${b.id}.cue.${i}`, push));
    for (const q of b.questions ?? []) {
      questionEntries(q, push);
      q.resolve.forEach((c, i) => cueEntries(b, c, i, `q.${q.id}.resolve.${i}`, push));
    }
  }
  return out;
}

function cueEntries(
  b: Beat,
  c: Beat['cues'][number],
  _i: number,
  key: string,
  push: (key: string, text: string | undefined, where: string) => void,
) {
  if (!c.args) return;
  const nodeId = c.target.split('#')[0]!;
  const type = findNodeType(b, nodeId);
  const action = type ? componentDef(type)?.actions?.[c.do] : undefined;
  for (const a of action?.text ?? []) {
    const v = c.args[a];
    if (typeof v === 'string') push(`${key}.args.${a}`, v, `beat ${b.id} › ${c.do} ${c.target} › ${a}`);
  }
}

// Node types by id across the lesson (ids are unique per lesson).
const typeIndex = new WeakMap<Beat, Map<string, string>>();
let lessonIndex = new Map<string, string>();
function findNodeType(b: Beat, id: string): string | undefined {
  return typeIndex.get(b)?.get(id) ?? lessonIndex.get(id);
}
function indexLesson(lesson: Lesson) {
  lessonIndex = new Map();
  for (const b of lesson.beats) {
    const m = new Map<string, string>();
    for (const n of b.scene.add) {
      m.set(n.id, n.type);
      lessonIndex.set(n.id, n.type);
    }
    typeIndex.set(b, m);
  }
}

/** The author-language string table of a lesson (what strings.<lang>.json looks like). */
export function stringTable(lesson: Lesson): Record<string, string> {
  return Object.fromEntries(collectStrings(lesson).map((e) => [e.key, e.text]));
}

/**
 * Apply a language's string table to a lesson. Missing keys keep the author-language text; `speak`
 * overrides become `beat.speak`.
 */
export function localize(lesson: Lesson, strings: Strings | undefined): Lesson {
  indexLesson(lesson);
  const out = structuredClone(lesson);
  if (!strings) return out;
  indexLesson(out);
  const val = (key: string): { text: string; speak?: string } | undefined => {
    const v = strings[key];
    if (v === undefined) return undefined;
    return typeof v === 'string' ? { text: v } : v;
  };
  const apply = (key: string, set: (text: string) => void) => {
    const v = val(key);
    if (v) set(v.text);
  };
  apply('lesson.title', (t) => (out.title = t));
  if (out.unit) apply('lesson.unit', (t) => (out.unit = t));
  for (const b of out.beats) {
    apply(`beat.${b.id}.title`, (t) => (b.title = t));
    const narr = val(`beat.${b.id}.narration`);
    if (narr) {
      b.narration = narr.text;
      if (narr.speak) b.speak = narr.speak;
      else delete b.speak;
    }
    for (const n of b.scene.add) {
      const def = componentDef(n.type);
      for (const pattern of def?.text ?? []) {
        for (const p of expandPath(n, pattern)) apply(`node.${n.id}.${p}`, (t) => setPath(n, p, t));
      }
    }
    const applyCue = (c: Beat['cues'][number], key: string) => {
      if (!c.args) return;
      const type = findNodeType(b, c.target.split('#')[0]!);
      for (const a of (type ? componentDef(type)?.actions?.[c.do]?.text : undefined) ?? []) {
        apply(`${key}.args.${a}`, (t) => (c.args![a] = t));
      }
    };
    b.cues.forEach((c, i) => applyCue(c, `beat.${b.id}.cue.${i}`));
    for (const q of b.questions ?? []) {
      const k = `q.${q.id}`;
      apply(`${k}.prompt`, (t) => (q.prompt = t));
      if (q.hint) apply(`${k}.hint`, (t) => (q.hint = t));
      if (q.explain) apply(`${k}.explain`, (t) => (q.explain = t));
      q.resolve.forEach((c, i) => applyCue(c, `${k}.resolve.${i}`));
      switch (q.kind) {
        case 'choice':
          for (const o of q.options) {
            apply(`${k}.options.${o.id}.text`, (t) => (o.text = t));
            if (o.why) apply(`${k}.options.${o.id}.why`, (t) => (o.why = t));
          }
          break;
        case 'blanks':
          q.rows.forEach((r, i) => {
            apply(`${k}.rows.${i}.template`, (t) => (r.template = t));
            if (r.explain) apply(`${k}.rows.${i}.explain`, (t) => (r.explain = t));
            if (r.hint) apply(`${k}.rows.${i}.hint`, (t) => (r.hint = t));
            for (const [box, a] of Object.entries(r.answers)) {
              if (typeof a === 'object' && a && 'text' in a) {
                a.text = a.text.map((orig, j) => val(`${k}.rows.${i}.answers.${box}.text.${j}`)?.text ?? orig);
              }
            }
          });
          break;
        case 'numeric':
          if (q.unit) apply(`${k}.unit`, (t) => (q.unit = t));
          break;
        case 'grid':
          if (q.cols !== 'tf') for (const c of q.cols) apply(`${k}.cols.${c.id}`, (t) => (c.text = t));
          for (const r of q.rows) {
            apply(`${k}.rows.${r.id}.text`, (t) => (r.text = t));
            if (r.why) apply(`${k}.rows.${r.id}.why`, (t) => (r.why = t));
          }
          break;
        case 'order':
          for (const it of q.items) apply(`${k}.items.${it.id}`, (t) => (it.text = t));
          break;
        case 'pick':
          for (const s of Object.keys(q.wrong ?? {})) apply(`${k}.wrong.${s}`, (t) => (q.wrong![s] = t));
          break;
        case 'text':
          q.accept = q.accept.map((a, i) => val(`${k}.accept.${i}`)?.text ?? a);
          break;
      }
    }
  }
  return out;
}
