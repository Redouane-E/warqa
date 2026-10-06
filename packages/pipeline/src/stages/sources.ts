// What each translation and each recording was made from, kept beside the lesson (versioned with the book, unlike
// cache/):
//   lessons/<id>/sources.<lang>.json   key → {h: hash of the original text, t: that text} when it was translated
//   lessons/<id>/narrated.<lang>.json  {beats: {beatId: hash of the engine, voice, rate and spoken text}}
// A translation whose original changed since is "Original changed" (whoever translated it); a beat whose spoken text
// or voice changed since its recording needs narrating again. Books made before these files existed get a baseline
// the first time a lesson is saved again (from the lesson as it was), so that edit is already seen.
import { baseLang } from '@warqa/i18n';
import { collectStrings, type Lesson, localize, type Strings, spokenText } from '@warqa/lesson';
import type { Project } from '../project/index.js';
import { ttsProvider } from '../tts/providers.js';
import { srcHash } from './hash.js';

export interface SourceSnap {
  /** Hash of the original text (as `srcHash`). */
  h: string;
  /** The original text itself, to show what changed ("−5 became −7"). */
  t: string;
}
export type SourceFile = Record<string, SourceSnap>;

const sourcesPath = (lessonId: string, lang: string) => `lessons/${lessonId}/sources.${lang}.json`;
const narratedPath = (lessonId: string, lang: string) => `lessons/${lessonId}/narrated.${lang}.json`;

export const snapOf = (text: string): SourceSnap => ({ h: srcHash(text), t: text });

export function loadSources(project: Project, lessonId: string, lang: string): SourceFile | undefined {
  return project.readJson<SourceFile | undefined>(sourcesPath(lessonId, lang), undefined);
}

export function saveSources(project: Project, lessonId: string, lang: string, s: SourceFile): void {
  project.writeJson(sourcesPath(lessonId, lang), s);
}

/**
 * Record that these keys were translated (or checked) from the lesson's current text. The first record of a book
 * made before records were kept also notes every other translated key as made from the text as it is now (as far as
 * anyone knows), so a later edit of any sentence shows.
 */
export function markTranslated(project: Project, lesson: Lesson, lang: string, keys: Iterable<string>): void {
  const entries = collectStrings(lesson);
  const text = new Map(entries.map((e) => [e.key, e.text]));
  const had = loadSources(project, lesson.id, lang);
  const file: SourceFile = { ...(had ?? {}) };
  if (!had) {
    const strings = project.loadStrings(lesson.id, lang) ?? {};
    for (const e of entries) if (strings[e.key] !== undefined) file[e.key] = snapOf(e.text);
  }
  let changed = !had;
  for (const k of keys) {
    const t = text.get(k);
    if (t === undefined) continue;
    const snap = snapOf(t);
    if (file[k]?.h !== snap.h) {
      file[k] = snap;
      changed = true;
    }
  }
  if (changed) saveSources(project, lesson.id, lang, file);
}

/**
 * Translations saved as typed (an API client, an agent, a script): saved, and the changed ones recorded as made from
 * the original as it is now, so the next translation run keeps them.
 */
export function saveTypedStrings(project: Project, lessonId: string, lang: string, strings: Strings): void {
  const before = project.loadStrings(lessonId, lang) ?? {};
  project.saveStrings(lessonId, lang, strings);
  const text = (v: Strings[string] | undefined) => (v === undefined ? undefined : typeof v === 'string' ? v : v.text);
  const changed = Object.keys(strings).filter((k) => text(strings[k]) !== text(before[k]));
  if (changed.length) markTranslated(project, project.loadLesson(lessonId), lang, changed);
}

/**
 * The original as it was when this key was translated, when it changed since (else undefined). A key with no record
 * (books made before records were kept, or translations typed by hand) counts as current.
 */
export function changedSource(file: SourceFile | undefined, key: string, current: string): SourceSnap | undefined {
  const s = file?.[key];
  return s && s.h !== srcHash(current) ? s : undefined;
}

export interface NarratedFile {
  beats: Record<string, string>;
}

export interface VoiceChoice {
  provider: string;
  voice: string;
  rate: string;
}

/** The voice a language is narrated with: the book's choice, else the engine's default (as narrate resolves it). */
export function voiceFor(project: Project, lang: string): VoiceChoice {
  const cfg = project.config.tts;
  let provider = cfg.provider;
  let def = '';
  try {
    const p = ttsProvider(cfg.provider, project.config.worker ? { worker: project.config.worker } : {});
    provider = p.id;
    def = p.defaultVoice(lang) ?? '';
  } catch {
    /* an engine this build does not know: its id stands */
  }
  return { provider, voice: cfg.voices[lang] ?? cfg.voices[baseLang(lang)] ?? def, rate: cfg.rate ?? '+0%' };
}

/** What a beat's recording was made from: the engine, voice and rate, and what it says (marks left out). */
export const narrationKey = (v: VoiceChoice, beat: { narration: string; speak?: string | undefined }): string =>
  srcHash(`${v.provider}|${v.voice}|${v.rate}|${spokenText(beat.speak ?? beat.narration).clean}`);

export function loadNarrated(project: Project, lessonId: string, lang: string): NarratedFile | undefined {
  return project.readJson<NarratedFile | undefined>(narratedPath(lessonId, lang), undefined);
}

export function saveNarrated(project: Project, lessonId: string, lang: string, f: NarratedFile): void {
  project.writeJson(narratedPath(lessonId, lang), f);
}

/** Beats whose recording no longer matches what they say (or the voice chosen now). */
export function changedBeats(
  project: Project,
  lessonId: string,
  lang: string,
  voice = voiceFor(project, lang),
  /** The lesson, when the caller has it already (saves parsing it again). */
  loaded?: Lesson,
): string[] {
  const rec = loadNarrated(project, lessonId, lang);
  const clips = project.audioFiles(lessonId, lang);
  if (!rec || !Object.keys(clips).length) return [];
  const skeleton = loaded ?? project.loadLesson(lessonId);
  const lesson = lang === skeleton.lang ? skeleton : localize(skeleton, project.loadStrings(lessonId, lang));
  return lesson.beats
    .filter((b) => clips[b.id] && rec.beats[b.id] !== undefined && rec.beats[b.id] !== narrationKey(voice, b))
    .map((b) => b.id);
}

/**
 * Before a lesson is overwritten: for each translation and recording with no record yet, write one from the lesson
 * as it is now (what they were made from, as far as anyone knows), so the coming edit shows as a change.
 */
export function baselineSources(project: Project, lessonId: string, old: Lesson): void {
  for (const lang of project.book.langs) {
    if (lang !== old.lang) {
      // every translated key with no record yet, one by one (a record file may hold only the keys checked so far)
      const strings = project.loadStrings(lessonId, lang);
      const had = loadSources(project, lessonId, lang);
      if (strings) {
        const file: SourceFile = { ...(had ?? {}) };
        let added = false;
        for (const e of collectStrings(old))
          if (strings[e.key] !== undefined && !file[e.key]) {
            file[e.key] = snapOf(e.text);
            added = true;
          }
        if (added || !had) saveSources(project, lessonId, lang, file);
      }
    }
    const clips = project.audioFiles(lessonId, lang);
    if (Object.keys(clips).length && !loadNarrated(project, lessonId, lang)) {
      const lesson = lang === old.lang ? old : localize(old, project.loadStrings(lessonId, lang));
      const v = voiceFor(project, lang);
      saveNarrated(project, lessonId, lang, {
        beats: Object.fromEntries(lesson.beats.filter((b) => clips[b.id]).map((b) => [b.id, narrationKey(v, b)])),
      });
    }
  }
}

/**
 * Keys renamed or removed in the editor (a part, a question or a beat renamed, a cue removed): the translations, the
 * people's checks and the records of what was translated follow, batch by batch. A moved key never overwrites one
 * that stays.
 */
export function moveStringKeys(
  project: Project,
  lessonId: string,
  batches: { from: string; to: string | null }[][],
): number {
  const lessonLang = (project.loadLessonRaw(lessonId) as { lang?: string }).lang;
  let moved = 0;
  const move = <T>(table: Record<string, T>, count: boolean): Record<string, T> => {
    let st = table;
    for (const batch of batches) {
      const kept: Record<string, T> = {};
      const went: Record<string, T> = {};
      for (const [k, v] of Object.entries(st)) {
        const mv = batch.find((m) => k.startsWith(m.from));
        if (!mv) kept[k] = v;
        else {
          if (count) moved++;
          if (mv.to !== null) went[mv.to + k.slice(mv.from.length)] = v;
        }
      }
      st = { ...went, ...kept };
    }
    return st;
  };
  for (const lang of project.book.langs.filter((l) => l !== lessonLang)) {
    const st = project.loadStrings(lessonId, lang);
    if (st) project.saveStrings(lessonId, lang, move(st, true));
    const review = project.readJson<Record<string, unknown> | undefined>(
      `lessons/${lessonId}/review.${lang}.json`,
      undefined,
    );
    if (review) project.writeJson(`lessons/${lessonId}/review.${lang}.json`, move(review, false));
    const src = loadSources(project, lessonId, lang);
    if (src) saveSources(project, lessonId, lang, move(src, false));
  }
  return moved;
}
