// Narration marks, inline math and answer-box templates.
// Portions derived from Papermorph (MIT): the [[mark]] convention and mark/caption extraction (scripts/tts.py).

const MARK = /\[\[([A-Za-z][\w-]{0,31})\]\]/g;

export interface MarkedText {
  /** Text without [[marks]] (what is spoken and captioned). */
  clean: string;
  /** Mark name → character offset in `clean` of the word it precedes. */
  marks: Record<string, number>;
  /** Mark names in order. */
  order: string[];
  duplicates: string[];
}

/** Split "Keep the [[keep]]seven." into clean text and mark positions. */
export function parseMarks(raw: string): MarkedText {
  const marks: Record<string, number> = {};
  const order: string[] = [];
  const duplicates: string[] = [];
  let clean = '';
  let last = 0;
  for (const m of raw.matchAll(MARK)) {
    clean += raw.slice(last, m.index);
    const name = m[1]!;
    if (name in marks) duplicates.push(name);
    else order.push(name);
    // a mark points at the next word: skip spaces after it
    let pos = clean.length;
    const rest = raw.slice(m.index! + m[0].length);
    const lead = rest.length - rest.trimStart().length;
    pos += lead;
    marks[name] = pos;
    last = m.index! + m[0].length;
  }
  clean += raw.slice(last);
  return { clean, marks, order, duplicates };
}

/** Mark names in a narration string, in order. */
export const markNames = (raw: string): string[] => parseMarks(raw).order;

export interface Run {
  math: boolean;
  text: string;
}

/**
 * Split text with inline math ("Find $4 − (−9)$.") into runs. "\$" is a literal dollar sign.
 * Math runs are displayed left-to-right, isolated, in the math font — in Arabic text too.
 */
export function inlineRuns(s: string): Run[] {
  const out: Run[] = [];
  let buf = '';
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && s[i + 1] === '$') {
      buf += '$';
      i++;
    } else if (c === '$') {
      if (buf) out.push({ math, text: buf });
      buf = '';
      math = !math;
    } else buf += c;
  }
  if (buf) out.push({ math, text: buf });
  return out;
}

/** Plain text of a string with inline math (for captions, transcripts and screen readers). */
export const plainText = (s: string): string =>
  inlineRuns(s)
    .map((r) => r.text)
    .join('');

export type TemplatePart = { box: string } | { math: boolean; text: string };

const MATHY = /^[\s\d.,+\-−–×÷*/=<>≤≥≠≈±()[\]{}^²³√π%°|:'′]*$/;

/** True for a run that is math rather than words: digits, operators and single-letter variables only. */
export function isMathRun(s: string): boolean {
  if (!s.trim()) return true;
  const stripped = s.replace(/(^|[^\p{L}])\p{Script=Latin}(?=$|[^\p{L}])/gu, '$1'); // single Latin letters = variables
  return MATHY.test(stripped);
}

/**
 * Parse an answer-box template ("25 − (−8) = [[a]] meters") into parts. Explicit $…$ runs are math;
 * other text runs are math when they contain only digits, operators and single-letter variables.
 */
export function parseTemplate(tpl: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  for (const run of inlineRuns(tpl)) {
    let last = 0;
    for (const m of run.text.matchAll(MARK)) {
      const before = run.text.slice(last, m.index);
      if (before) parts.push({ math: run.math || isMathRun(before), text: before });
      parts.push({ box: m[1]! });
      last = m.index! + m[0].length;
    }
    const tail = run.text.slice(last);
    if (tail) parts.push({ math: run.math || isMathRun(tail), text: tail });
  }
  return parts;
}

/**
 * Group template parts into display groups: consecutive math text and boxes form one left-to-right group
 * (so "= [[a]]" keeps the box after the equals sign inside Arabic text); words form text groups.
 */
export function templateGroups(parts: TemplatePart[]): { math: boolean; parts: TemplatePart[] }[] {
  const groups: { math: boolean; parts: TemplatePart[] }[] = [];
  for (const p of parts) {
    const isMath = 'box' in p || p.math;
    // whitespace-only text joins whatever group it sits in
    const ws = !('box' in p) && !p.text.trim();
    const g = groups[groups.length - 1];
    if (g && (g.math === isMath || ws)) g.parts.push(p);
    else groups.push({ math: isMath, parts: [p] });
  }
  return groups;
}

/** Box names in a template. */
export const templateBoxes = (tpl: string): string[] => parseTemplate(tpl).flatMap((p) => ('box' in p ? [p.box] : []));
