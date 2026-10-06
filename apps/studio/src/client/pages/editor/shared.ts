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

// a mark, named as the lesson format names them
const MARK = /\[\[([A-Za-z][\w-]{0,31})\]\]/g;
export const marksOf = (s: string): string[] => [...s.matchAll(MARK)].map((m) => m[1]!);
/** The narration's words, marks left out ("30 words"). */
export const wordsOf = (s: string): number => s.replace(MARK, ' ').trim().split(/\s+/).filter(Boolean).length;

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

/**
 * Rename a part of the stage added by beat `from`: that beat and the following ones (until a beat adds another
 * part with the same id) point their cues, kept and removed lists and questions at the new id.
 */
export function renameNode(lesson: LessonObj, from: number, oldId: string, newId: string): void {
  const re = (t: string) => {
    const [n, ...rest] = t.split('#');
    return n === oldId ? [newId, ...rest].join('#') : t;
  };
  for (let j = from; j < lesson.beats.length; j++) {
    const b = lesson.beats[j]!;
    const adds = b.scene?.add ?? [];
    if (j > from && adds.some((n) => n.id === oldId)) break;
    for (const n of adds) if (j === from && n.id === oldId) n.id = newId;
    if (b.scene?.keep) b.scene.keep = b.scene.keep.map((x) => (x === oldId ? newId : x));
    if (b.scene?.remove) b.scene.remove = b.scene.remove.map((x) => (x === oldId ? newId : x));
    for (const c of b.cues ?? []) c.target = re(c.target);
    for (const q of (b.questions ?? []) as Record<string, unknown>[]) {
      if (q.on === oldId) q.on = newId;
      for (const c of (q.resolve ?? []) as Cue[]) c.target = re(c.target);
    }
  }
}

/** How long an action takes when its cue gives no duration (as the compiler does); null: at once. */
export function cueDuration(c: Cue, actionDur?: number): number | null {
  if (typeof c.dur === 'number') return c.dur;
  const generic: Record<string, number | null> = {
    show: 0.5,
    hide: 0.5,
    dim: 0.4,
    undim: 0.4,
    highlight: 0.3,
    unhighlight: 0.3,
    pulse: 0.6,
    draw: 0.9,
    color: null,
  };
  return c.do in generic ? generic[c.do]! : (actionDur ?? 0.6);
}

/** "eq" or "eq › tok:0": the node and the part a cue moves. */
export const targetText = (target: string): string => target.replace('#', ' › ');

/**
 * A change to the keys of the lesson's translations (strings.<lang>.json): keys starting with `from` now start
 * with `to`, or are dropped (null). Renaming a part, a question or a beat, or removing a cue, makes some.
 */
export interface KeyMove {
  from: string;
  to: string | null;
}

/**
 * Removing cues of a beat: their translated arguments ("beat.<id>.cue.<i>.args.label") are dropped and those of the
 * cues after them follow their new place (in order, so no key lands on one still in use).
 */
export function cueRemovalMoves(beatId: string, removed: number[], total: number): KeyMove[] {
  const gone = new Set(removed);
  const out: KeyMove[] = removed.map((k) => ({ from: `beat.${beatId}.cue.${k}.`, to: null }));
  let shift = 0;
  for (let k = 0; k < total; k++) {
    if (gone.has(k)) shift++;
    else if (shift) out.push({ from: `beat.${beatId}.cue.${k}.`, to: `beat.${beatId}.cue.${k - shift}.` });
  }
  return out;
}

/** The smallest shape a beat must keep to be edited in the form ("Edit as JSON" can break it). */
export function beatProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'object';
  const b = v as Record<string, unknown>;
  if (typeof b.id !== 'string' || !b.id) return 'id';
  if (typeof b.title !== 'string') return 'title';
  if (typeof b.narration !== 'string') return 'narration';
  if (b.cues !== undefined && !Array.isArray(b.cues)) return 'cues';
  if (b.questions !== undefined && !Array.isArray(b.questions)) return 'questions';
  if (b.scene !== undefined && (typeof b.scene !== 'object' || b.scene === null || Array.isArray(b.scene)))
    return 'scene';
  const add = (b.scene as { add?: unknown } | undefined)?.add;
  if (add !== undefined && !Array.isArray(add)) return 'scene';
  return null;
}
