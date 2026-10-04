// Narrate a lesson in one language: synthesize each beat (cached by content hash), derive mark times and
// captions, write audio/<lang>/<beat>.mp3 and timings.<lang>.json.
// Portions derived from Papermorph (MIT): scripts/tts.py — per-beat clips, content-hash cache, atomic writes,
// keeping completed beats when a later one fails.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseLang, sameLetters } from '@warqa/i18n';
import { type BeatTiming, localize, spokenText, type Timings } from '@warqa/lesson';
import type { Project } from '../project/index.js';
import { markTiming } from './align.js';
import { mp3Duration, wavDuration } from './mp3.js';
import { ttsProvider, workerAlign } from './providers.js';
import type { TtsProvider } from './types.js';

export interface NarrateOptions {
  provider?: string | TtsProvider;
  voice?: string;
  rate?: string;
  /** Regenerate even when the cache matches. */
  force?: boolean;
  /** Only these beats. */
  beats?: string[];
  onProgress?: (e: { beat: string; status: 'synthesized' | 'cached' | 'failed'; error?: string }) => void;
}

export interface NarrateReport {
  lang: string;
  provider: string;
  voice: string;
  synthesized: string[];
  cached: string[];
  failed: { beat: string; error: string }[];
  /** Marks whose time had to be estimated (no matching spoken word). */
  estimated: Record<string, string[]>;
  chars: number;
}

interface CacheEntry {
  key: string;
  ext: 'mp3' | 'wav';
  timing: BeatTiming;
  estimated: string[];
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

export async function narrateLesson(
  project: Project,
  lessonId: string,
  lang: string,
  opts: NarrateOptions = {},
): Promise<NarrateReport> {
  const cfg = project.config.tts;
  const provider =
    typeof opts.provider === 'object'
      ? opts.provider
      : ttsProvider(opts.provider ?? cfg.provider, {
          ...(project.config.worker ? { worker: project.config.worker } : {}),
        });
  const voice = opts.voice ?? cfg.voices[lang] ?? cfg.voices[baseLang(lang)] ?? provider.defaultVoice(lang) ?? '';
  const rate = opts.rate ?? cfg.rate ?? '+0%';
  const skeleton = project.loadLesson(lessonId);
  const lesson = lang === skeleton.lang ? skeleton : localize(skeleton, project.loadStrings(lessonId, lang));
  const audioDir = project.audioDir(lessonId, lang);
  mkdirSync(audioDir, { recursive: true });
  const cachePath = project.path('cache', 'tts', `${lessonId}.${lang}.json`);
  const cache: Record<string, CacheEntry> = project.readJson(`cache/tts/${lessonId}.${lang}.json`, {});
  const timings: Timings = project.loadTimings(lessonId, lang) ?? {};
  const report: NarrateReport = {
    lang,
    provider: provider.id,
    voice,
    synthesized: [],
    cached: [],
    failed: [],
    estimated: {},
    chars: 0,
  };

  for (const beat of lesson.beats) {
    if (opts.beats && !opts.beats.includes(beat.id)) continue;
    let speakSrc = beat.speak ?? beat.narration;
    // Optional Arabic diacritics for better pronunciation (validated: only diacritics may be added).
    if (cfg.tashkeel && baseLang(lang) === 'ar' && project.config.worker && !beat.speak) {
      try {
        const res = await fetch(`${project.config.worker.replace(/\/$/, '')}/tashkeel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: speakSrc }),
        });
        const voc = ((await res.json()) as { text: string }).text;
        if (sameLetters(speakSrc, voc)) speakSrc = voc;
      } catch {
        /* keep the plain text */
      }
    }
    const { clean } = spokenText(speakSrc);
    const key = sha1(`${provider.id}|${voice}|${rate}|${clean}`);
    const old = cache[beat.id];
    const existing = old && existsSync(join(audioDir, `${beat.id}.${old.ext}`));
    if (!opts.force && old && old.key === key && existing) {
      // the audio is unchanged; marks may have moved, so re-derive them from the cached word times
      timings[beat.id] = old.timing;
      report.cached.push(beat.id);
      opts.onProgress?.({ beat: beat.id, status: 'cached' });
      continue;
    }
    try {
      const r = await provider.synth(clean, { voice, lang, rate });
      report.chars += clean.length;
      const dur = r.dur ?? (r.ext === 'mp3' ? mp3Duration(r.audio) : wavDuration(r.audio));
      let words = r.words;
      if (!words?.length && project.config.worker) {
        try {
          words = await workerAlign(project.config.worker, r.audio, clean, lang);
        } catch {
          /* fall back to sentence timing */
        }
      }
      const mt = markTiming(speakSrc, dur, words, r.sentences);
      // captions show the displayed narration; keep the spoken sentence times
      const sentenceTimes = mt.captions.map(([t], i) => ({ start: t, end: mt.captions[i + 1]?.[0] ?? dur }));
      const shown = markTiming(beat.narration, dur, undefined, sentenceTimes);
      // read-along: the engine's words located in the displayed text (or spread over each sentence)
      const shownWords = words?.length ? markTiming(beat.narration, dur, words).words : shown.words;
      const timing: BeatTiming = {
        dur,
        marks: mt.marks,
        captions: shown.captions.length === mt.captions.length ? shown.captions : mt.captions,
        words: shownWords,
      };
      const target = join(audioDir, `${beat.id}.${r.ext}`);
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, r.audio);
      renameSync(tmp, target);
      for (const other of ['mp3', 'wav'])
        if (other !== r.ext) rmSync(join(audioDir, `${beat.id}.${other}`), { force: true });
      timings[beat.id] = timing;
      cache[beat.id] = { key, ext: r.ext, timing, estimated: mt.estimated };
      if (mt.estimated.length) report.estimated[beat.id] = mt.estimated;
      report.synthesized.push(beat.id);
      opts.onProgress?.({ beat: beat.id, status: 'synthesized' });
      // save after every beat so a later failure keeps finished work
      project.saveTimings(lessonId, lang, timings);
      mkdirSync(join(cachePath, '..'), { recursive: true });
      project.writeJson(`cache/tts/${lessonId}.${lang}.json`, cache);
    } catch (e) {
      const error = (e as Error).message;
      report.failed.push({ beat: beat.id, error });
      opts.onProgress?.({ beat: beat.id, status: 'failed', error });
    }
  }
  // drop timings of beats that no longer exist
  for (const id of Object.keys(timings)) if (!lesson.beats.some((b) => b.id === id)) delete timings[id];
  project.saveTimings(lessonId, lang, timings);
  return report;
}
