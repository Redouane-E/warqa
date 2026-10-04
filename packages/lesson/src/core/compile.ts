// Compile a lesson into seekable beats: the scene state is folded beat by beat as plain data, and each beat
// becomes a list of channel segments that can be evaluated at any time (random access, no replay).
// Portions derived from Papermorph (MIT): tween/evalTo semantics, the beat end rule and the opening lead-in rule.
import { dirOf } from '@warqa/i18n';
import { componentDef } from '../components/registry.js';
import { type Cue, GENERIC_ACTIONS } from '../schema/common.js';
import type { Beat, BeatTiming, Lesson, LessonNode, Timings } from '../schema/lesson.js';
import { completeTimings, resolveAt } from './timing.js';
import {
  type ActionCtx,
  type Ch,
  type ChValue,
  type EaseName,
  key,
  type NodeState,
  type SceneState,
  type Segment,
} from './types.js';

export interface Issue {
  level: 'error' | 'warn';
  beat?: string;
  message: string;
}

export interface CompiledBeat {
  index: number;
  id: string;
  beat: Beat;
  timing: BeatTiming;
  /** Scene at the beat start: everything present during the beat, including nodes fading out and marks made later. */
  start: SceneState;
  /** Segments by channel key, each list sorted by start time. */
  segs: Map<string, Segment[]>;
  /** Seconds at which a lesson beat is over (questions wait for the reader). */
  end: number;
  /** Scene after the beat, with all questions resolved. */
  out: SceneState;
  /** Nodes that fade out at the start and are gone afterwards. */
  leaving: string[];
  /** Resolve segments per question id, relative to the moment the question is resolved. */
  resolve: Record<string, Segment[]>;
  ask: boolean;
  askAt: number;
  issues: Issue[];
}

export interface CompiledLesson {
  lesson: Lesson;
  lang: string;
  timings: Timings;
  beats: CompiledBeat[];
  issues: Issue[];
}

export interface CompileOptions {
  lang?: string;
  /** Validate component action arguments with their schemas (on by default). */
  strict?: boolean;
}

const FADE = 0.45;
const AUTO_START = 0.2;
const AUTO_STEP = 0.15;
const REVEAL_GAP = 0.35;

const clone = <T>(v: T): T => structuredClone(v);

export function emptyScene(): SceneState {
  return { nodes: {}, order: [] };
}

/** Build the state of a newly added node from its definition. */
export function newNodeState(n: LessonNode): NodeState {
  const def = componentDef(n.type);
  const { id, type, slot, enter: _enter, ...props } = n;
  const ch: Ch = { o: 0, s: 1, hl: 0, hlc: 'task', ...(def?.init?.(props) ?? {}) };
  const subs: NodeState['subs'] = {};
  for (const s of def?.subs(props) ?? [])
    subs[s] = { ch: { o: 1, s: 1, hl: 0, hlc: 'task', ...(def?.initSub?.(props, s) ?? {}) } };
  return { id, type, slot: slot ?? def?.defaultSlot ?? 'main', props, ch, subs };
}

function lerp(a: number, b: number, q: number) {
  return a + (b - a) * q;
}

export const EASES: Record<EaseName, (q: number) => number> = {
  lin: (q) => q,
  io: (q) => (q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2),
  out: (q) => 1 - (1 - q) ** 3,
  in: (q) => q * q * q,
  back: (q) => {
    const c = 1.70158;
    return 1 + (c + 1) * (q - 1) ** 3 + c * (q - 1) ** 2;
  },
};

/** Value of one segment at time t (t at or after its start). */
export function segValue(s: Segment, t: number): ChValue {
  if (typeof s.to === 'string' || typeof s.from === 'string') return t >= s.t0 ? s.to : s.from;
  if (s.dur <= 0 || t >= s.t0 + s.dur) return s.to;
  const q = Math.max(0, (t - s.t0) / s.dur);
  const v = lerp(s.from as number, s.to as number, EASES[s.ease](q));
  return s.amp ? v + s.amp * Math.sin(Math.PI * q) : v;
}

/** Value of a channel at time t given its sorted segments and its start value. */
export function valueAt(list: Segment[] | undefined, start: ChValue | undefined, t: number): ChValue | undefined {
  if (!list?.length) return start;
  if (t < list[0]!.t0) return list[0]!.from;
  let cur = list[0]!;
  for (const s of list) {
    if (s.t0 <= t) cur = s;
    else break;
  }
  return segValue(cur, t);
}

const startValue = (st: SceneState, node: string, sub: string, ch: string): ChValue | undefined => {
  const n = st.nodes[node];
  if (!n) return undefined;
  return sub ? n.subs[sub]?.ch[ch] : n.ch[ch];
};

function insertSeg(segs: Map<string, Segment[]>, s: Segment) {
  const k = key(s.node, s.sub, s.ch);
  const list = segs.get(k) ?? [];
  // A new tween cuts short one still running on the same channel.
  for (const p of list) if (p.t0 <= s.t0 && p.t0 + p.dur > s.t0) p.dur = s.t0 - p.t0;
  let i = list.length;
  while (i > 0 && list[i - 1]!.t0 > s.t0) i--;
  list.splice(i, 0, s);
  segs.set(k, list);
}

interface Event {
  t: number;
  order: number;
  cue: Cue;
  auto?: boolean;
}

function parseTarget(target: string): [string, string] {
  const i = target.indexOf('#');
  return i < 0 ? [target, ''] : [target.slice(0, i), target.slice(i + 1)];
}

/** Compile every beat, folding the scene state from the first beat to the last. */
export function compileLesson(
  lesson: Lesson,
  timingsIn: Timings | undefined,
  opts: CompileOptions = {},
): CompiledLesson {
  const lang = opts.lang ?? lesson.lang;
  const timings = completeTimings(lesson, lang, timingsIn);
  const beats: CompiledBeat[] = [];
  let state = emptyScene();
  lesson.beats.forEach((beat, index) => {
    const cb = compileBeat(beat, index, state, timings[beat.id]!, { ...opts, lang });
    beats.push(cb);
    state = cb.out;
  });
  return { lesson, lang, timings, beats, issues: beats.flatMap((b) => b.issues) };
}

/** Compile one beat from the scene state before it. Pure: the input state is not modified. */
export function compileBeat(
  beat: Beat,
  index: number,
  stateIn: SceneState,
  timing: BeatTiming,
  opts: CompileOptions & { lang: string },
): CompiledBeat {
  const issues: Issue[] = [];
  const err = (message: string, level: Issue['level'] = 'error') => issues.push({ level, beat: beat.id, message });
  const start = clone(stateIn);
  const segs = new Map<string, Segment[]>();
  const dir = dirOf(opts.lang);
  const markCount: Record<string, number> = {};

  // 1. What leaves: everything not kept when clearing, plus explicit removals; marks of kept nodes when clearing.
  const leaving = new Set<string>(beat.scene.remove.filter((id) => id in start.nodes));
  const leavingMarks: [string, string][] = [];
  if (beat.scene.clear) {
    for (const id of start.order) {
      if (!beat.scene.keep.includes(id)) leaving.add(id);
      else for (const [s, sub] of Object.entries(start.nodes[id]!.subs)) if (sub.mark) leavingMarks.push([id, s]);
    }
  }
  for (const id of beat.scene.remove) if (!(id in start.nodes)) err(`scene.remove: no node "${id}" on stage`, 'warn');
  for (const id of beat.scene.keep) if (!(id in start.nodes)) err(`scene.keep: no node "${id}" on stage`, 'warn');
  const tween = (
    node: string,
    sub: string,
    ch: string,
    to: ChValue,
    t0: number,
    dur: number,
    ease: EaseName = 'io',
    amp?: number,
  ) => {
    const k = key(node, sub, ch);
    const from = valueAt(segs.get(k), startValue(start, node, sub, ch), t0) ?? (typeof to === 'number' ? 0 : to);
    const s: Segment = { node, sub, ch, t0, dur: typeof to === 'string' ? 0 : dur, from, to, ease };
    if (amp) s.amp = amp;
    insertSeg(segs, s);
  };
  for (const id of leaving) tween(id, '', 'o', 0, 0, FADE);
  for (const [id, s] of leavingMarks) tween(id, s, 'o', 0, 0, FADE);

  // 2. New nodes.
  const added: string[] = [];
  for (const n of beat.scene.add) {
    if (n.id in start.nodes && !leaving.has(n.id)) {
      err(`node id "${n.id}" is already on stage; use a new id`);
      continue;
    }
    if (n.id in start.nodes) {
      err(`node id "${n.id}" is reused while the old node fades out; use a new id`);
      continue;
    }
    if (!componentDef(n.type)) {
      err(`unknown component type "${n.type}"`);
      continue;
    }
    start.nodes[n.id] = newNodeState(n);
    start.order.push(n.id);
    added.push(n.id);
  }

  // 3. Events: cues at their times, plus automatic entrances for nodes and parts nobody cued.
  const events: Event[] = [];
  let order = 0;
  const shownBy = new Map<string, number>(); // "node" or "node#sub" → time of an explicit show/draw
  const cueTimes: { cue: Cue; t: number }[] = [];
  for (const cue of beat.cues) {
    const t = resolveAt(cue.at, timing);
    if (t === null) {
      err(`cue "${cue.do} ${cue.target}": unknown mark "${typeof cue.at === 'object' ? cue.at.mark : cue.at}"`);
      continue;
    }
    cueTimes.push({ cue, t });
    if (cue.do === 'show' || cue.do === 'draw') {
      const prev = shownBy.get(cue.target);
      if (prev === undefined || t < prev) shownBy.set(cue.target, t);
    }
  }
  let autoK = 0;
  for (const id of added) {
    const node = start.nodes[id]!;
    const n = beat.scene.add.find((x) => x.id === id)!;
    let visibleAt = shownBy.get(id);
    if (visibleAt === undefined && n.enter === 'auto') {
      visibleAt = AUTO_START + autoK++ * AUTO_STEP;
      events.push({ t: visibleAt, order: order++, cue: { at: visibleAt, do: 'show', target: id }, auto: true });
    }
    const def = componentDef(node.type)!;
    const reveal = (def.reveal?.(node.props) ?? []).filter((s) => !shownBy.has(`${id}#${s}`));
    if (visibleAt !== undefined) {
      reveal.forEach((s, k) => {
        const t = visibleAt! + 0.3 + k * REVEAL_GAP;
        events.push({ t, order: order++, cue: { at: t, do: 'show', target: `${id}#${s}` }, auto: true });
      });
    }
  }
  for (const { cue, t } of cueTimes) events.push({ t, order: order++, cue });
  events.sort((a, b) => a.t - b.t || a.order - b.order);

  for (const ev of events) runCue(ev.cue, ev.t, segs);

  // 4. Lead-in: if the beat opens a new picture and nothing appears for 0.8 s, bring the opening group forward.
  if (beat.lead && (beat.scene.clear || index === 0) && added.length) {
    const reveals = [...segs.values()].flat().filter((s) => added.includes(s.node) && isReveal(s));
    const first = Math.min(...reveals.map((s) => s.t0));
    if (Number.isFinite(first) && first > 0.8) {
      const shift = 0.4 - first;
      for (const list of segs.values()) {
        for (const s of list) if (added.includes(s.node) && s.t0 >= first && s.t0 <= first + 1.2) s.t0 += shift;
        list.sort((a, b) => a.t0 - b.t0);
      }
    }
  }

  // 5. End of the beat, the out state, and question resolution.
  let last = 0;
  for (const list of segs.values()) for (const s of list) last = Math.max(last, s.t0 + s.dur);
  const end = Math.max(timing.dur, last) + 0.6;
  const out = finalState(start, segs);

  const resolve: Record<string, Segment[]> = {};
  for (const q of beat.questions ?? []) {
    const rs = new Map<string, Segment[]>();
    for (const cue of q.resolve) {
      const t = resolveAt(cue.at, { ...timing, dur: 0, marks: {} }) ?? 0;
      runCueInto(cue, t, rs, out);
    }
    resolve[q.id] = [...rs.values()].flat();
    const after = finalState(out, rs);
    out.nodes = after.nodes;
    out.order = after.order;
  }
  for (const id of leaving) {
    delete out.nodes[id];
    out.order = out.order.filter((x) => x !== id);
  }
  for (const [id, s] of leavingMarks) delete out.nodes[id]?.subs[s];

  const ask = !!beat.questions?.length || beat.move === 'finish';
  return {
    index,
    id: beat.id,
    beat,
    timing,
    start,
    segs,
    end,
    out,
    leaving: [...leaving],
    resolve,
    ask,
    askAt: 0.5,
    issues,
  };

  // ---- cue execution ----
  function runCue(cue: Cue, t: number, into: Map<string, Segment[]>) {
    runCueInto(cue, t, into, start);
  }

  function runCueInto(cue: Cue, t: number, into: Map<string, Segment[]>, base: SceneState) {
    const [nodeId, sub] = parseTarget(cue.target);
    const node = base.nodes[nodeId] ?? start.nodes[nodeId];
    if (!node) return err(`cue "${cue.do}": no node "${nodeId}" on stage`);
    const def = componentDef(node.type)!;
    const at = (n: string, s: string, ch: string, tt: number) =>
      valueAt(into.get(key(n, s, ch)), startValue(base, n, s, ch) ?? startValue(start, n, s, ch), tt);
    const tw = (s: string, ch: string, to: ChValue, t0: number, dur: number, ease: EaseName = 'io', amp?: number) => {
      const k = key(nodeId, s, ch);
      const from = at(nodeId, s, ch, t0) ?? (typeof to === 'number' ? (ch === 'o' ? 0 : 0) : to);
      const seg: Segment = { node: nodeId, sub: s, ch, t0, dur: typeof to === 'string' ? 0 : dur, from, to, ease };
      if (amp) seg.amp = amp;
      insertSeg(into, seg);
      void k;
    };
    // a cue on something that fades out at the start of this beat would never be seen
    const isFade = cue.do === 'hide' || cue.do === 'dim';
    if (!isFade && base === start && leaving.has(nodeId)) {
      return err(
        `cue "${cue.do} ${cue.target}": node "${nodeId}" is cleared at the start of this beat (scene.clear/remove); keep it (scene.keep) or add a new node`,
      );
    }
    if (!isFade && base === start && sub && leavingMarks.some(([n, s]) => n === nodeId && s === sub)) {
      return err(
        `cue "${cue.do} ${cue.target}": mark "${sub}" belongs to the previous beat and is cleared at the start of this one; draw a new mark instead`,
      );
    }
    if (sub && !(sub in node.subs)) {
      return err(
        `cue "${cue.do} ${cue.target}": ${node.type} "${nodeId}" has no part "${sub}" (parts: ${Object.keys(node.subs).slice(0, 12).join(', ') || 'none'})`,
      );
    }
    if ((GENERIC_ACTIONS as readonly string[]).includes(cue.do)) {
      const args = cue.args ?? {};
      switch (cue.do) {
        case 'show': {
          tw(sub, 'o', 1, t, cue.dur ?? 0.5);
          const d = at(nodeId, sub, 'd', t);
          if (typeof d === 'number' && d < 1) tw(sub, 'd', 1, t, Math.max(cue.dur ?? 0.9, 0.5));
          return;
        }
        case 'hide':
          return tw(sub, 'o', 0, t, cue.dur ?? 0.5);
        case 'dim':
          return tw(sub, 'o', 0.3, t, cue.dur ?? 0.4);
        case 'undim':
          return tw(sub, 'o', 1, t, cue.dur ?? 0.4);
        case 'highlight':
          tw(sub, 'hlc', String(args.color ?? 'task'), t, 0);
          return tw(sub, 'hl', 1, t, cue.dur ?? 0.3);
        case 'unhighlight':
          return tw(sub, 'hl', 0, t, cue.dur ?? 0.3);
        case 'pulse': {
          const s0 = Number(at(nodeId, sub, 's', t) ?? 1);
          return tw(sub, 's', s0, t, cue.dur ?? 0.6, 'lin', Number(args.amount ?? 0.15));
        }
        case 'draw':
          tw(sub, 'o', 1, t, 0.2);
          return tw(sub, 'd', 1, t, cue.dur ?? 0.9);
        case 'color':
          return tw(sub, 'c', String(args.color ?? 'task'), t, 0);
      }
      return;
    }
    const action = def.actions?.[cue.do];
    if (!action) {
      const names = [...GENERIC_ACTIONS, ...Object.keys(def.actions ?? {})].join(', ');
      return err(`cue "${cue.do} ${cue.target}": ${node.type} has no action "${cue.do}" (actions: ${names})`);
    }
    let args = (cue.args ?? {}) as Record<string, unknown>;
    if (opts.strict !== false) {
      const parsed = action.args.safeParse(args);
      if (!parsed.success)
        return err(
          `cue "${cue.do} ${cue.target}": bad args — ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`,
        );
      args = parsed.data as Record<string, unknown>;
    }
    const ctx: ActionCtx = {
      node,
      sub,
      t0: t,
      dur: cue.dur ?? action.dur ?? 0.6,
      lang: opts.lang,
      dir,
      tween: (s, ch, to, t0 = t, dur = ctx.dur, ease = 'io', amp) => tw(s, ch, to, t0, dur, ease, amp),
      get: (s, ch) => at(nodeId, s, ch, t),
      addMark: (id, data, ch) => {
        if (id in node.subs) {
          err(`mark id "${id}" already exists on "${nodeId}"`);
          return id;
        }
        node.subs[id] = { ch: { o: 1, s: 1, hl: 0, hlc: 'task', ...ch }, data, mark: true };
        // marks exist in the beat's start scene (invisible until animated) and in every scene after it
        if (base !== start && start.nodes[nodeId] && !(id in start.nodes[nodeId]!.subs))
          start.nodes[nodeId]!.subs[id] = clone(node.subs[id]!);
        return id;
      },
      markId: (prefix) => {
        let k = markCount[`${nodeId}:${prefix}`] ?? 0;
        let id: string;
        do id = `${prefix}${++k}`;
        while (id in node.subs);
        markCount[`${nodeId}:${prefix}`] = k;
        return id;
      },
      error: (m) => err(m),
    };
    action.apply(ctx, args);
  }
}

function isReveal(s: Segment): boolean {
  if (s.ch === 'o' || s.ch === 'd') return typeof s.to === 'number' && typeof s.from === 'number' && s.to > s.from;
  return s.ch === 'step';
}

/** The scene after all segments have finished. */
export function finalState(start: SceneState, segs: Map<string, Segment[]>): SceneState {
  const out = clone(start);
  for (const list of segs.values()) {
    const last = list.reduce((a, b) => (b.t0 + b.dur >= a.t0 + a.dur ? b : a));
    const n = out.nodes[last.node];
    if (!n) continue;
    const target = last.sub ? n.subs[last.sub]?.ch : n.ch;
    if (target) target[last.ch] = last.to;
  }
  return out;
}

/** Read channel values of a compiled beat at time t (plus extra segments, e.g. question resolutions). */
export function sampler(cb: CompiledBeat, t: number, extra?: Map<string, Segment[]>) {
  return (node: string, sub: string, ch: string): ChValue | undefined => {
    const k = key(node, sub, ch);
    const base = valueAt(cb.segs.get(k), startValue(cb.start, node, sub, ch), t);
    const more = extra?.get(k);
    if (!more?.length || t < more[0]!.t0) return base;
    return valueAt(more, base, t);
  };
}

/** Values of every channel of a beat at time t, as a scene (used by tests and screenshots). */
export function sceneAt(cb: CompiledBeat, t: number): SceneState {
  const get = sampler(cb, t);
  const out = clone(cb.start);
  for (const n of Object.values(out.nodes)) {
    for (const ch of Object.keys(n.ch)) n.ch[ch] = get(n.id, '', ch)!;
    for (const [s, sub] of Object.entries(n.subs)) for (const ch of Object.keys(sub.ch)) sub.ch[ch] = get(n.id, s, ch)!;
  }
  return out;
}
