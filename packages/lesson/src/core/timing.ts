// Beat timings: synthetic timings for lessons without audio, and mark estimates for speech engines that
// only report sentence boundaries.
import { langInfo, splitSentences, splitWords, stripBidiControls } from '@warqa/i18n';
import type { At } from '../schema/common.js';
import type { BeatTiming, Lesson, Timings } from '../schema/lesson.js';
import { parseMarks, plainText } from './text.js';

const SENTENCE_PAUSE = 0.35;
const LEAD = 0.15;
const TAIL = 0.3;

/** Spoken/captioned text of a narration: marks removed, inline math markers removed, bidi controls stripped. */
export function spokenText(narration: string): { clean: string; marks: Record<string, number> } {
  const { clean, marks } = parseMarks(narration);
  // "$" signs only delimit math; removing them shifts offsets, so map positions through the removal.
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    map[i] = out.length;
    const c = clean[i]!;
    if (c === '$' && clean[i - 1] !== '\\') continue;
    if (c === '\\' && clean[i + 1] === '$') continue;
    out += c;
  }
  map[clean.length] = out.length;
  const moved: Record<string, number> = {};
  for (const [k, v] of Object.entries(marks)) moved[k] = map[v] ?? out.length;
  return { clean: stripBidiControls(out), marks: moved };
}

export type WordTiming = [number, number, number];

/** Start time of every word of a clean text, from a character position → seconds function. */
export function wordsAt(clean: string, timeAt: (pos: number) => number): WordTiming[] {
  return splitWords(clean).map((w) => [+timeAt(w.start).toFixed(3), w.start, w.end] as WordTiming);
}

/** Index of the word being spoken at time t (-1 before the first word, or after the last word ends). */
export function wordAt(words: WordTiming[] | undefined, t: number, dur: number): number {
  if (!words?.length || t < words[0]![0] - 0.02 || t > dur + 0.3) return -1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (words[mid]![0] <= t + 0.02) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Timing for one narration at a reading speed (characters per second), with a pause after each sentence.
 * Used when a lesson has no audio for a language, and as the starting estimate before synthesis.
 */
export function syntheticTiming(narration: string, lang: string, cps = langInfo(lang).cps): BeatTiming {
  const { clean, marks } = spokenText(narration);
  const sentences = splitSentences(clean);
  const starts: number[] = [];
  let t = LEAD;
  let prevEnd = 0;
  const timeAt = (pos: number) => {
    // position → seconds, counting pauses for the sentences before it
    let tt = LEAD;
    let pe = 0;
    for (const s of sentences) {
      if (pos < s.start) return tt + Math.max(0, pos - pe) / cps;
      tt += (s.start - pe) / cps;
      if (pos <= s.end) return tt + (pos - s.start) / cps;
      tt += (s.end - s.start) / cps + SENTENCE_PAUSE;
      pe = s.end;
    }
    return tt + Math.max(0, pos - pe) / cps;
  };
  for (const s of sentences) {
    t += (s.start - prevEnd) / cps;
    starts.push(+t.toFixed(3));
    t += (s.end - s.start) / cps + SENTENCE_PAUSE;
    prevEnd = s.end;
  }
  const dur = sentences.length ? t - SENTENCE_PAUSE + TAIL : LEAD + clean.length / cps + TAIL;
  const markTimes: Record<string, number> = {};
  for (const [k, pos] of Object.entries(marks)) markTimes[k] = +timeAt(pos).toFixed(3);
  return {
    dur: +Math.max(dur, 0.8).toFixed(3),
    marks: markTimes,
    captions: sentences.map((s, i) => [starts[i]!, s.text] as [number, string]),
    words: wordsAt(clean, timeAt),
    synthetic: true,
  };
}

/**
 * Mark times from sentence start times (exact, from per-sentence synthesis or a sentence-boundary engine):
 * inside a sentence, time is proportional to the character offset.
 */
export function marksFromSentences(
  narration: string,
  sentenceTimes: { start: number; end: number }[],
): { marks: Record<string, number>; captions: [number, string][]; words: WordTiming[] } {
  const { clean, marks } = spokenText(narration);
  const sentences = splitSentences(clean);
  const timeAt = (pos: number, k = 1): number => {
    let i = sentences.findIndex((s) => pos < s.end);
    if (i < 0) i = sentences.length - 1;
    const s = sentences[i];
    const tm = sentenceTimes[i];
    if (!s || !tm) return 0;
    const q = Math.min(1, Math.max(0, (pos - s.start) / Math.max(1, s.end - s.start)));
    return tm.start + q * (tm.end - tm.start) * k;
  };
  const out: Record<string, number> = {};
  for (const [k, pos] of Object.entries(marks)) out[k] = +timeAt(pos).toFixed(3);
  return {
    marks: out,
    captions: sentences.map((s, i) => [sentenceTimes[i]?.start ?? 0, s.text] as [number, string]),
    // words are spoken over ~90 % of a sentence clip that ends with a short pause
    words: wordsAt(clean, (pos) => timeAt(pos, 0.92)),
  };
}

/** Synthetic timings for every beat of a (localized) lesson. */
export function syntheticTimings(lesson: Lesson, lang: string): Timings {
  const out: Timings = {};
  for (const b of lesson.beats) out[b.id] = syntheticTiming(b.narration, lang);
  return out;
}

/** Fill in missing beats (or beats whose marks changed) with synthetic timings. */
export function completeTimings(lesson: Lesson, lang: string, timings: Timings | undefined): Timings {
  const out: Timings = { ...(timings ?? {}) };
  for (const b of lesson.beats) {
    const have = out[b.id];
    const names = Object.keys(parseMarks(b.narration).marks);
    if (!have || names.some((n) => !(n in have.marks))) out[b.id] = syntheticTiming(b.narration, lang);
  }
  return out;
}

/** Seconds into a beat for a cue's `at`. Unknown marks resolve to null. */
export function resolveAt(at: At, timing: BeatTiming): number | null {
  if (typeof at === 'number') return at;
  const name = typeof at === 'string' ? at : at.mark;
  const offset = typeof at === 'string' ? 0 : (at.offset ?? 0);
  let base: number | undefined;
  if (name === 'start') base = 0;
  else if (name === 'end') base = timing.dur;
  else base = timing.marks[name];
  if (base === undefined) return null;
  return Math.max(0, base + offset);
}

/** Plain caption/transcript text for a narration. */
export const narrationText = (narration: string): string => plainText(parseMarks(narration).clean);
