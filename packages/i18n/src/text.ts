// Sentences, words and bidi helpers shared by narration timing, captions and the player.

export interface Sentence {
  /** Character offsets into the original string. */
  start: number;
  end: number;
  text: string;
}

/**
 * Split narration into sentences on . ? ! ؟ ؛ … (and "۔"), followed by whitespace or the end.
 * Decimals ("3.5"), abbreviations without a following space and ellipses inside words are not split.
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /([.?!؟؛…۔]+)(["'»”)\]]*)(\s+|$)/g;
  let start = 0;
  for (const m of text.matchAll(re)) {
    const end = m.index! + m[1]!.length + m[2]!.length;
    push(start, end);
    start = m.index! + m[0].length;
  }
  push(start, text.length);
  return out;

  function push(a: number, b: number) {
    const raw = text.slice(a, b);
    const lead = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if (s) out.push({ start: a + lead, end: a + lead + s.length, text: s });
  }
}

export interface Word {
  start: number;
  end: number;
  text: string;
}

/** Words (runs of letters, digits and joiners) with offsets; punctuation and spaces are skipped. */
export function splitWords(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/(?:[\p{L}\p{M}\p{N}'’-]|\u200c|\u200d)+/gu)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
  }
  return out;
}

const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g;

/** Remove bidi control characters (before sending text to TTS or comparing strings). */
export const stripBidiControls = (s: string): string => s.replace(BIDI_CONTROLS, '');

/** Wrap a run in Unicode isolates so numbers, math or Latin terms keep their order inside RTL text. */
export const isolate = (s: string, dir: 'ltr' | 'rtl' | 'auto' = 'auto'): string =>
  (dir === 'ltr' ? '\u2066' : dir === 'rtl' ? '\u2067' : '\u2068') + s + '\u2069';
