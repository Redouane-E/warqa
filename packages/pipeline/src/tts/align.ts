// From engine word times to mark times and captions. Words are matched in order after normalization
// (digits, Arabic diacritics and letter variants), so engines that drop or add diacritics still match.
// An unmatched mark is estimated between its neighbours instead of failing (Papermorph's tts.py stopped).
import { normalizeForMatch, splitSentences, splitWords } from '@warqa/i18n';
import { marksFromSentences, spokenText, type WordTiming, wordsAt } from '@warqa/lesson';
import type { WordTime } from './types.js';

export interface MarkTiming {
  marks: Record<string, number>;
  captions: [number, string][];
  /** Every word of the text with its start time, for read-along. */
  words: WordTiming[];
  /** Marks that had to be estimated. */
  estimated: string[];
}

/** Locate each spoken word in the clean text; returns [char offset, time] pairs in order. */
export function locateWords(clean: string, words: WordTime[]): [number, number][] {
  const textWords = splitWords(clean).map((w) => ({ ...w, norm: normalizeForMatch(w.text) }));
  const out: [number, number][] = [];
  let cursor = 0;
  for (const w of words) {
    const norm = normalizeForMatch(w.text);
    if (!norm) continue;
    // look ahead a few words for a match (engines may merge or split words)
    for (let k = cursor; k < Math.min(textWords.length, cursor + 6); k++) {
      const tw = textWords[k]!;
      if (tw.norm === norm || tw.norm.startsWith(norm) || norm.startsWith(tw.norm)) {
        out.push([tw.start, w.t]);
        cursor = k + 1;
        break;
      }
    }
  }
  return out;
}

/** Time at a character offset: the located word at or after it, else interpolated. */
function timeAt(pos: number, located: [number, number][], dur: number, textLen: number): { t: number; exact: boolean } {
  const after = located.find(([p]) => p >= pos);
  if (after && after[0] - pos <= 2) return { t: after[1], exact: true };
  const before = [...located].reverse().find(([p]) => p < pos);
  // a mark inside a word (Arabic attached prefixes such as و، ف، ب، ل) counts as that word's start
  if (before && pos - before[0] <= 2) return { t: before[1], exact: true };
  const a = before ?? [0, 0];
  const b = after ?? [textLen, dur];
  const q = (pos - a[0]) / Math.max(1, b[0] - a[0]);
  return { t: a[1] + q * (b[1] - a[1]), exact: false };
}

/** Mark times and captions from word times (or sentence times, or nothing: proportional to the text). */
export function markTiming(
  narration: string,
  dur: number,
  words?: WordTime[],
  sentences?: { start: number; end: number }[],
): MarkTiming {
  const { clean, marks } = spokenText(narration);
  if (!words?.length && sentences?.length) {
    const r = marksFromSentences(narration, sentences);
    return { ...r, estimated: Object.keys(marks) };
  }
  const located = words?.length ? locateWords(clean, words) : [];
  const out: Record<string, number> = {};
  const estimated: string[] = [];
  for (const [name, pos] of Object.entries(marks)) {
    const { t, exact } = timeAt(pos, located, dur, clean.length);
    out[name] = +t.toFixed(3);
    if (!exact) estimated.push(name);
  }
  const captions = splitSentences(clean).map(
    (s) => [+timeAt(s.start, located, dur, clean.length).t.toFixed(3), s.text] as [number, string],
  );
  const wordTimes = wordsAt(clean, (pos) => timeAt(pos, located, dur, clean.length).t);
  return { marks: out, captions, words: wordTimes, estimated };
}
