// The lesson editor's shapes and small helpers: a beat as the editor holds it (the raw lesson JSON), its marks
// and the cues that wait on them.

export type Cue = {
  at: string | number | { mark: string; offset?: number };
  do: string;
  target: string;
  args?: Record<string, unknown>;
  dur?: number;
};

export type SceneNode = Record<string, unknown> & { id: string; type: string; slot?: string; enter?: string };

export type Beat = Record<string, unknown> & {
  id: string;
  title: string;
  move?: string;
  narration: string;
  scene?: { clear?: boolean; keep?: string[]; remove?: string[]; add?: SceneNode[] } & Record<string, unknown>;
  cues?: Cue[];
  questions?: unknown[];
};

export type LessonObj = { id: string; title: string; lang: string; beats: Beat[]; [k: string]: unknown };

/** Timings of a beat in one language (the player's, synthetic where there is no audio). */
export interface BeatTime {
  dur: number;
  marks: Record<string, number>;
}
/** Per language, per beat id. */
export type Timings = Record<string, Record<string, BeatTime>>;

const MARK = /\[\[(\w+)\]\]/g;
export const marksOf = (s: string): string[] => [...s.matchAll(MARK)].map((m) => m[1]!);
/** The narration's words, marks left out ("30 words"). */
export const wordsOf = (s: string): number => s.replace(MARK, ' ').trim().split(/\s+/).filter(Boolean).length;

export const atText = (at: Cue['at']): string =>
  typeof at === 'object'
    ? `${at.mark}${at.offset ? ` ${at.offset > 0 ? '+' : ''}${at.offset}s` : ''}`
    : typeof at === 'number'
      ? `${at}s`
      : at;
/** The mark a cue waits on (a mark name, or {mark, offset}); none for start, end or seconds. */
export const markOfCue = (c: Cue): string | null =>
  typeof c.at === 'string' && c.at !== 'start' && c.at !== 'end' ? c.at : typeof c.at === 'object' ? c.at.mark : null;

/** A beat with questions is drawn as a diamond on the margin. */
export const questionsOf = (b: Beat): number => (Array.isArray(b.questions) ? b.questions.length : 0);

/** A new id of the form base-2, base-3… that no beat (or node) uses yet. */
export function freshId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let k = 2; ; k++) if (!used.has(`${base}-${k}`)) return `${base}-${k}`;
}

/**
 * A copy of a beat that can sit in the same lesson: new ids for the beat, the parts it adds to the stage and its
 * questions (ids are unique across a lesson), with its cues and questions pointed at the new parts.
 */
export function copyBeat(b: Beat, lesson: LessonObj): Beat {
  const c = structuredClone(b);
  const nodeIds = lesson.beats.flatMap((x) => x.scene?.add?.map((n) => n.id) ?? []);
  const qIds = lesson.beats.flatMap(
    (x) => (x.questions as { id?: string }[] | undefined)?.map((q) => q.id ?? '') ?? [],
  );
  c.id = freshId(
    b.id,
    lesson.beats.map((x) => x.id),
  );
  const renamed = new Map<string, string>();
  for (const n of c.scene?.add ?? []) {
    const id = freshId(n.id, nodeIds);
    renamed.set(n.id, id);
    nodeIds.push(id);
    n.id = id;
  }
  const retarget = (target: string) => {
    const [node, ...rest] = target.split('#');
    const to = renamed.get(node!);
    return to ? [to, ...rest].join('#') : target;
  };
  for (const cue of c.cues ?? []) cue.target = retarget(cue.target);
  for (const q of (c.questions ?? []) as Record<string, unknown>[]) {
    if (typeof q.id === 'string') {
      const id = freshId(q.id, qIds);
      qIds.push(id);
      q.id = id;
    }
    if (typeof q.on === 'string') q.on = renamed.get(q.on) ?? q.on;
    for (const cue of (q.resolve ?? []) as Cue[]) cue.target = retarget(cue.target);
  }
  return c;
}
