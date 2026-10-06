// The Check step's data (redesign 4f): a chapter's saved check, the judge's verdict and the lesson, merged beat by
// beat; and, for the rail and the book's summary, how many beats of each chapter need attention.
// "Needs attention" = the judge scored it under 4, or an automatic check found something.
import { existsSync, readdirSync } from 'node:fs';
import { type Lesson, localize } from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import type { CheckBeat, CheckDetail, CheckIssue, ProjectDetail } from '../shared/types.js';

/** A short name for a part on the stage: its own text when short ("−40"), with its component and id. */
function nodeName(lesson: Lesson, id: string): { id: string; type: string; text?: string } {
  for (const b of lesson.beats)
    for (const n of b.scene.add)
      if (n.id === id) {
        const o = n as unknown as Record<string, unknown>;
        const text = ['text', 'label', 'title', 'term'].map((k) => o[k]).find((v) => typeof v === 'string') as
          | string
          | undefined;
        return { id, type: n.type, ...(text && text.length <= 24 ? { text } : {}) };
      }
  return { id, type: '' };
}

export const ATTENTION_UNDER = 4;

/** A chapter's check in one language, beat by beat. `link` makes a picture's URL. */
export function checkDetail(
  p: P.Project,
  lid: string,
  lang: string,
  opts: { chapter?: number; link: (file: string, at: number) => string },
): CheckDetail {
  const base = p.loadLesson(lid);
  const lesson = lang === base.lang ? base : localize(base, p.loadStrings(lid, lang));
  const saved = P.loadCheck(p, lid, lang);
  const verdict = P.loadVerdict(p, lid, lang);
  const hashes = P.beatHashes(p, lid, lang);
  const beats: CheckBeat[] = lesson.beats.map((b, i) => {
    const s = saved?.beats.find((x) => x.id === b.id);
    const v = verdict.find((x) => x.id === b.id);
    const issues: CheckIssue[] = (saved?.issues ?? [])
      .filter((x) => x.id === b.id)
      .map((x) => ({
        kind: x.kind,
        message: x.message,
        ...(x.nodes ? { nodes: x.nodes.map((n) => nodeName(lesson, n)) } : {}),
        ...(x.box ? { box: x.box } : {}),
        ...(x.from !== undefined ? { from: x.from } : {}),
        ...(x.to !== undefined ? { to: x.to } : {}),
        ...(x.fit !== undefined ? { fit: x.fit } : {}),
      }));
    const ask = !!b.questions?.length;
    return {
      id: b.id,
      n: i + 1,
      title: b.title,
      move: b.move,
      ask,
      narration: b.narration,
      ...(v ? { score: v.score } : {}),
      ...(v?.problem ? { problem: v.problem } : {}),
      ...(v?.fix ? { fix: v.fix } : {}),
      issues,
      ...(s?.thumb && saved ? { thumb: opts.link(s.thumb, saved.at) } : {}),
      // the full picture when it is here (a backup keeps only the small one)
      ...(saved && (s?.shot && existsSync(p.path('qa', lid, lang, s.shot)) ? s.shot : s?.thumb)
        ? { shot: opts.link((s?.shot && existsSync(p.path('qa', lid, lang, s.shot)) ? s.shot : s?.thumb)!, saved.at) }
        : {}),
      ...(s ? { dur: s.dur } : {}),
      ...(s?.hash && s.hash !== hashes[b.id] ? { changed: true } : {}),
      attention: (v !== undefined && v.score < ATTENTION_UNDER) || issues.length > 0,
    };
  });
  const langs = [base.lang, ...p.book.langs.filter((l) => l !== base.lang && p.loadStrings(lid, l))].map((l) => {
    const c = P.loadCheck(p, lid, l);
    return { lang: l, ...(c ? { checked: c.at } : {}) };
  });
  let model: string | undefined;
  try {
    model = P.resolveRole('judge', p.config);
  } catch {
    model = undefined;
  }
  const scored = lesson.beats.filter((b) => !b.questions?.length && b.move !== 'finish').length;
  const lessonUsd = model ? P.estimateJudge(p, scored) : undefined;
  const beatUsd = model ? P.estimateJudge(p, 1) : undefined;
  return {
    lesson: lid,
    lang,
    ...(opts.chapter ? { chapter: opts.chapter } : {}),
    title: lesson.title,
    langs,
    beats,
    ...(saved ? { checked: saved.at } : {}),
    ...(saved && (beats.some((b) => b.changed) || saved.beats.length !== lesson.beats.length) ? { stale: true } : {}),
    // Improve can start from the judge's verdict (it scored the lesson as it is)
    ...(verdict.length && P.checkFresh(p, lid, lang) ? { fresh: true } : {}),
    ...(model
      ? {
          judge: {
            model,
            ...(lessonUsd !== undefined ? { lessonUsd } : {}),
            ...(beatUsd !== undefined ? { beatUsd } : {}),
          },
        }
      : {}),
  };
}

/**
 * For the book (the rail, the summary): each chapter's beats that need attention, counted once across its
 * languages, from the saved checks and the judge's verdicts. Cheap: no lesson is parsed (a check older than the
 * lesson says so by its date).
 */
export function checkSummary(p: P.Project): NonNullable<ProjectDetail['checks']> {
  const out: NonNullable<ProjectDetail['checks']> = {};
  const qa = p.path('qa');
  if (!existsSync(qa)) return out;
  for (const lid of readdirSync(qa)) {
    if (!p.hasLesson(lid)) continue;
    let files: string[];
    try {
      files = readdirSync(p.path('qa', lid));
    } catch {
      continue;
    }
    const langs = new Set(files.flatMap((f) => /^(.+)-(check|judge)\.json$/.exec(f)?.[1] ?? []));
    for (const lang of langs) {
      const c = P.loadCheck(p, lid, lang);
      const v = P.loadVerdict(p, lid, lang);
      const flagged = [
        ...new Set([
          ...(c?.issues ?? []).map((x) => x.id).filter(Boolean),
          ...v.filter((x) => x.score < ATTENTION_UNDER).map((x) => x.id),
        ]),
      ];
      (out[lid] ??= []).push({
        lang,
        at: c?.at ?? 0,
        beats: c?.beats.length ?? v.length,
        attention: flagged.length,
        flagged,
        ...(c && c.at < P.lessonChangedAt(p, lid, lang) ? { stale: true } : {}),
      });
    }
  }
  return out;
}
