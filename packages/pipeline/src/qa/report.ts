// A saved check of one chapter in one language (the studio's Check step): the end picture of every beat with a small
// copy for a contact sheet, what the automatic checks found, and (when asked) the judge's scores from those same
// pictures, kept beside the lesson so they outlive the job:
//   qa/<lesson>/<lang>/bNN_end.png, bNN_end.jpg    the end of each beat, full size and 480 × 270
//   qa/<lesson>/<lang>-check.json                 when, what each beat was then, what was found
//   qa/<lesson>/<lang>-judge.json                 the judge's verdict (as `judgeLesson` writes it)
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { localize } from '@warqa/lesson';
import type { Llm } from '../models/llm.js';
import type { Project } from '../project/index.js';
import { srcHash } from '../stages/hash.js';
import { checkLesson, type QaIssue } from './check.js';
import { judgeLesson } from './judge.js';

export interface SavedCheck {
  schema: 'warqa.check/1';
  /** When it ran (ms since 1970). */
  at: number;
  lang: string;
  beats: {
    id: string;
    index: number;
    dur: number;
    /** What the beat was (its JSON in this language) when checked: a different hash means it changed since. */
    hash: string;
    shot?: string;
    thumb?: string;
  }[];
  issues: QaIssue[];
  /** The judge looked at these pictures too. */
  judged: boolean;
}

const checkPath = (lessonId: string, lang: string) => `qa/${lessonId}/${lang}-check.json`;

export const loadCheck = (project: Project, lessonId: string, lang: string): SavedCheck | undefined =>
  project.readJson<SavedCheck | undefined>(checkPath(lessonId, lang), undefined);

/** What each beat of a lesson is now in a language, hashed (to tell a check that is out of date). */
export function beatHashes(project: Project, lessonId: string, lang: string): Record<string, string> {
  const base = project.loadLesson(lessonId);
  const lesson = lang === base.lang ? base : localize(base, project.loadStrings(lessonId, lang));
  return Object.fromEntries(lesson.beats.map((b) => [b.id, srcHash(JSON.stringify(b))]));
}

export interface CheckChapterOptions {
  /** The lesson's page in an exported site, served. */
  url: string;
  /** Also have the judge score each picture (it spends). */
  judge?: { llm: Llm };
  theme?: 'sheet' | 'board';
  onBeat?: (i: number, n: number) => void;
  /** Just before the judge is asked (it spends): a job checks here whether it was stopped. */
  beforeJudge?: () => void;
  /** The check to run (default: Playwright), for tests. */
  check?: typeof checkLesson;
  /** The judge to run (default: the vision model), for tests. */
  judgeFn?: typeof judgeLesson;
}

/** Check one chapter in one language, keep its pictures and findings, and (when asked) the judge's scores. */
export async function checkChapter(
  project: Project,
  lessonId: string,
  lang: string,
  opts: CheckChapterOptions,
): Promise<SavedCheck> {
  const dir = project.path('qa', lessonId, lang);
  // drawn into a folder of its own, which takes the place of the earlier pictures only when the check succeeds (a
  // failed check leaves the earlier one whole, a beat removed since leaves no picture behind)
  const tmp = `${dir}.new`;
  rmSync(tmp, { recursive: true, force: true });
  let r: Awaited<ReturnType<typeof checkLesson>>;
  try {
    r = await (opts.check ?? checkLesson)({
      url: opts.url,
      lang,
      shots: tmp,
      moments: ['end'],
      thumbs: true,
      ...(opts.theme ? { theme: opts.theme } : {}),
      ...(opts.onBeat ? { onBeat: opts.onBeat } : {}),
    });
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  const hashes = beatHashes(project, lessonId, lang);
  const saved: SavedCheck = {
    schema: 'warqa.check/1',
    at: Date.now(),
    lang,
    beats: r.beatInfo.map((b) => ({
      id: b.id,
      index: b.index,
      dur: +b.dur.toFixed(2),
      hash: hashes[b.id] ?? '',
      ...(r.ends[b.index] ? { shot: basename(r.ends[b.index]!) } : {}),
      ...(r.thumbs[b.index] ? { thumb: basename(r.thumbs[b.index]!) } : {}),
    })),
    issues: r.issues,
    judged: false,
  };
  try {
    if (opts.judge) {
      // a job stopped while the beats were drawn stops here, before anything is spent
      opts.beforeJudge?.();
      await (opts.judgeFn ?? judgeLesson)(project, lessonId, { llm: opts.judge.llm, lang, shots: r.ends });
      saved.judged = true;
    }
  } finally {
    // the new pictures take the earlier ones' place (also when the judge stopped or failed: the check is good)
    rmSync(dir, { recursive: true, force: true });
    if (existsSync(tmp)) renameSync(tmp, dir);
    project.writeJson(checkPath(lessonId, lang), saved);
  }
  return saved;
}

/**
 * The saved check still shows the lesson as it is (every beat's hash the same): the judge's verdict made from it
 * can be trusted, so Improve starts from it.
 */
export function checkFresh(project: Project, lessonId: string, lang: string): boolean {
  const c = loadCheck(project, lessonId, lang);
  if (!c) return false;
  const now = beatHashes(project, lessonId, lang);
  return c.beats.length === Object.keys(now).length && c.beats.every((b) => !!b.hash && b.hash === now[b.id]);
}

/** When a lesson (or its strings in a language) changed last, to tell a check that is out of date. */
export function lessonChangedAt(project: Project, lessonId: string, lang: string): number {
  const files = [
    join(project.lessonDir(lessonId), 'lesson.json'),
    join(project.lessonDir(lessonId), `strings.${lang}.json`),
  ];
  return Math.max(0, ...files.filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs));
}
