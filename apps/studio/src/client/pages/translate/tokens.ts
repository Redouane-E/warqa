// The parts of a translated text that must stay as they are (narration marks [[keep]], answer boxes [[a]] in an
// answer template, inline formulas $…$), the checks on them while a person types (the server runs the full checks on
// save), where a lost mark goes back, and what changed in an original since it was translated. No React here, so it
// can be tested.

export type Tok =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'mark' | 'box'; name: string; text: string; start: number; end: number }
  | { kind: 'math'; tex: string; text: string; start: number; end: number };

// a mark or box (named as the lesson format names them), or inline math (an escaped \$ is not math)
const TOKEN = /\[\[([A-Za-z][\w-]{0,31})\]\]|(?<!\\)\$((?:\\\$|[^$\n])+?)(?<!\\)\$/g;

/** The text in runs: plain text, and the locked tokens (marks, or boxes in an answer template, and formulas). */
export function tokensOf(text: string, kind: string): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at), start: last, end: at });
    const end = at + m[0].length;
    if (m[1] !== undefined)
      out.push({ kind: kind === 'math-template' ? 'box' : 'mark', name: m[1], text: m[0], start: at, end });
    else out.push({ kind: 'math', tex: m[2] ?? '', text: m[0], start: at, end });
    last = end;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last), start: last, end: text.length });
  return out;
}

const names = (text: string, kind: string, of: 'mark' | 'box') =>
  tokensOf(text, kind).flatMap((t) => (t.kind === of ? [t.name] : []));

/** What one list has that the other lacks (as many times as it has it more). */
function minus(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((x) => {
    const i = left.indexOf(x);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

export interface LiveProblem {
  code: 'marks' | 'boxes' | 'dollars';
  lost: string[];
  extra: string[];
}

/** The problems a person can see while typing: lost or extra marks and answer boxes, an unbalanced $. */
export function liveProblems(source: string, text: string, kind: string): LiveProblem[] {
  if (!text.trim()) return [];
  const out: LiveProblem[] = [];
  const of = kind === 'math-template' ? 'box' : kind === 'narration' ? 'mark' : null;
  if (of) {
    const want = names(source, kind, of);
    const got = names(text, kind, of);
    const lost = minus(want, got);
    const extra = minus(got, want);
    if (lost.length || extra.length) out.push({ code: of === 'box' ? 'boxes' : 'marks', lost, extra });
  }
  if ((text.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2) out.push({ code: 'dollars', lost: [], extra: [] });
  return out;
}

/** Word starts outside tokens, with how many plain-text characters come before each. */
function wordStarts(text: string, kind: string): { at: number; plain: number }[] {
  const out: { at: number; plain: number }[] = [];
  let plain = 0;
  for (const t of tokensOf(text, kind)) {
    if (t.kind !== 'text') {
      // a token is a word of its own for the count (marks sit before the word they wait for)
      continue;
    }
    for (let i = 0; i < t.text.length; i++) {
      const prev = i ? t.text[i - 1]! : text[t.start - 1];
      const prevIsTokenEnd = !i && t.start > 0 && (text[t.start - 1] === ']' || text[t.start - 1] === '$');
      if (/\S/.test(t.text[i]!) && (prev === undefined || /\s/.test(prev)) && !prevIsTokenEnd)
        out.push({ at: t.start + i, plain });
      plain++;
    }
  }
  return out;
}

const plainLength = (text: string, kind: string) =>
  tokensOf(text, kind).reduce((a, t) => a + (t.kind === 'text' ? t.text.length : 0), 0);

/**
 * Where a mark the translation lost goes back: at the same share of the sentence as in the original (nothing aligns
 * words across languages), between the marks around it, at a word start; or at the caret when the person put it
 * somewhere. Returns the new text, the word it now waits for, and where the caret goes.
 */
export function putBack(
  source: string,
  text: string,
  name: string,
  kind: string,
  caret?: number,
): { text: string; word: string; caret: number } {
  const label = `[[${name}]]`;
  const insert = (at: number) => {
    const next = `${text.slice(0, at)}${label}${text.slice(at)}`;
    const word = /^[^\s[$]*/.exec(text.slice(at))?.[0] ?? '';
    return { text: next, word, caret: at + label.length };
  };
  if (caret !== undefined && caret >= 0 && caret <= text.length) return insert(caret);
  const srcToks = tokensOf(source, kind);
  const order = srcToks.flatMap((t) => (t.kind === 'mark' || t.kind === 'box' ? [t.name] : []));
  const at = srcToks.find((t) => (t.kind === 'mark' || t.kind === 'box') && t.name === name);
  if (!at) return insert(text.length);
  // its share of the original's plain text
  const before = srcToks.filter((t) => t.end <= at.start && t.kind === 'text').reduce((a, t) => a + t.text.length, 0);
  const share = before / Math.max(1, plainLength(source, kind));
  const target = share * plainLength(text, kind);
  // between the marks that come before and after it in the original, as far as the translation has them
  const trToks = tokensOf(text, kind);
  const pos = (n: string) => trToks.find((t) => (t.kind === 'mark' || t.kind === 'box') && t.name === n);
  const i = order.indexOf(name);
  const prev = order
    .slice(0, i)
    .reverse()
    .map(pos)
    .find((t) => t);
  const next = order
    .slice(i + 1)
    .map(pos)
    .find((t) => t);
  const lo = prev ? prev.end : 0;
  const hi = next ? next.start : text.length;
  const starts = wordStarts(text, kind).filter((w) => w.at >= lo && w.at <= hi);
  if (!starts.length) return insert(prev ? prev.end : next ? next.start : text.length);
  const best = starts.reduce((a, w) => (Math.abs(w.plain - target) < Math.abs(a.plain - target) ? w : a));
  return insert(best.at);
}

/** Character ranges [start, end) of words. */
export type Ranges = [number, number][];

const wordsOf = (s: string) => [...s.matchAll(/\S+/g)].map((m) => ({ w: m[0], at: m.index ?? 0 }));
const bare = (w: string) => w.replace(/^\[\[[\w-]+\]\]/, '').replace(/[.,;:!?؟،«»"'()]/g, '');

/**
 * What changed in an original since it was translated: the first run of words that differs, said as "−5 became −7"
 * when both sides are short, and the ranges of the new words in the current original (to underline).
 */
export function changeOf(before: string, after: string): { from: string; to: string; ranges: Ranges } | null {
  const a = wordsOf(before);
  const b = wordsOf(after);
  // longest common subsequence of the words
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i]![j] = a[i]!.w === b[j]!.w ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const gone: number[] = [];
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i]!.w === b[j]!.w) {
      i++;
      j++;
    } else if (j < n && (i >= m || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) added.push(j++);
    else gone.push(i++);
  }
  if (!gone.length && !added.length) return null;
  const ranges: Ranges = added.map((k) => [b[k]!.at, b[k]!.at + b[k]!.w.length]);
  // the first contiguous change, said in words
  const firstGone = gone.length ? gone[0]! : -1;
  const firstAdded = added.length ? added[0]! : -1;
  const run = (idx: number[], start: number) => {
    const out = [start];
    for (const k of idx) if (k === out.at(-1)! + 1) out.push(k);
    return out;
  };
  const from =
    firstGone < 0
      ? ''
      : run(gone, firstGone)
          .map((k) => bare(a[k]!.w))
          .join(' ');
  const to =
    firstAdded < 0
      ? ''
      : run(added, firstAdded)
          .map((k) => bare(b[k]!.w))
          .join(' ');
  return { from, to, ranges };
}

/**
 * The words of a translation that still say what the original said before (the same numbers, or the same untranslated
 * words): underlined there too. Nothing when nothing matches.
 */
export function staleRanges(text: string, removed: string): Ranges {
  const gone = new Set(
    removed
      .split(/\s+/)
      .map(bare)
      .filter((w) => w && (/\d/.test(w) || w.length > 3)),
  );
  if (!gone.size) return [];
  return wordsOf(text)
    .filter(({ w }) => gone.has(bare(w)))
    .map(({ w, at }) => [at, at + w.length] as [number, number]);
}

/** Ranges where a glossary term is used in a text (its start, any ending: "opposé", "opposés"). */
export function termRanges(text: string, term: string): Ranges {
  if (!term.trim()) return [];
  const out: Ranges = [];
  const low = text.toLocaleLowerCase();
  const t = term.toLocaleLowerCase();
  for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + 1)) {
    let end = i + t.length;
    while (end < text.length && /\p{L}/u.test(text[end]!)) end++;
    out.push([i, end]);
  }
  return out;
}
