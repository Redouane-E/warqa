// Semantic checks beyond the schema: ids, marks, cue targets, answers, language parity, pacing.
// Messages are written to be fed back to a model in a repair loop, so they say what to change.
import { parseNumber } from '@warqa/i18n';
import { componentDef } from '../components/registry.js';
import type { Lesson, Strings, Timings } from '../schema/lesson.js';
import { type CompiledLesson, compileLesson, type Issue } from './compile.js';
import { together, tracks, visibility } from './layout.js';
import { collectStrings, localize } from './strings.js';
import { UNSAFE_TEX } from './tex.js';
import { parseMarks, templateBoxes } from './text.js';
import { syntheticTimings } from './timing.js';

export interface ValidateOptions {
  timings?: Timings;
  lang?: string;
  /** Pacing rules for generated lessons (a visual change per sentence, no long still stretches). */
  pacing?: boolean;
  /** Require source references on lesson beats (generated lessons). */
  requireSources?: boolean;
  /** Generation-time layout check: slot conflicts and components squeezed below their readable width are errors. */
  layout?: boolean;
}

const SLOT_W: Record<string, number> = {
  full: 1600,
  title: 1440,
  upper: 1440,
  lower: 1440,
  main: 1440,
  band: 1440,
  start: 700,
  end: 700,
};
const ROW = new Set(['title', 'upper', 'lower', 'band']);
const SLOT_H: Record<string, number> = {
  full: 900,
  title: 120,
  upper: 266,
  lower: 240,
  main: 516,
  start: 516,
  end: 516,
  band: 180,
};

/** Layout problems at the end of each beat, without a browser (slot rules and readable widths). */
function layoutCheck(c: CompiledLesson, err: (m: string, beat?: string, level?: Issue['level']) => void) {
  for (const cb of c.beats) {
    const vis = visibility(cb);
    const visible = Object.values(cb.out.nodes).filter((n) => {
      const v = vis.get(n.id);
      return v ? v[1] > v[0] : Number(n.ch.o ?? 1) > 0.01;
    });
    const by = new Map<string, typeof visible>();
    for (const n of visible) by.set(n.slot, [...(by.get(n.slot) ?? []), n]);
    const has = (s: string) => (by.get(s)?.length ?? 0) > 0;
    if (has('main') && ['upper', 'lower', 'start', 'end'].some(has)) {
      const mains = by.get('main')!;
      const others = ['upper', 'lower', 'start', 'end'].flatMap((s) =>
        (by.get(s) ?? [])
          .filter((o) => mains.some((m) => together(vis.get(m.id), vis.get(o.id))))
          .map((n) => `${n.id} (${s})`),
      );
      if (others.length)
        err(
          `slot conflict: ${mains.map((n) => n.id).join(', ')} in "main" overlaps ${others.join(', ')}; use upper + lower or start + end instead of main, or hide/remove the other nodes`,
          cb.id,
        );
    }
    if (has('full') && visible.some((n) => n.slot !== 'full' && n.slot !== 'title' && n.slot !== 'band'))
      err(
        'a node in "full" covers the whole stage; nothing else (except title/band) should be on stage with it',
        cb.id,
      );
    const side = cb.ask && (cb.beat.card?.place === 'side' || cb.beat.card?.place === 'auto' || !cb.beat.card);
    for (const [slot, nodes] of by) {
      let w = SLOT_W[slot] ?? 1440;
      if (side && slot !== 'full') w = Math.min(w, 860);
      // nodes never visible together share a place (tracks)
      const tr = tracks(
        nodes.map((n) => n.id),
        vis,
      );
      const nTracks = new Set(tr.values()).size;
      const cell = ROW.has(slot) ? (w - 28 * (nTracks - 1)) / nTracks : w;
      // heights: stacked tracks (tall slots) or each track of a row (wide slots) must fit, allowing a 20 % shrink
      const trackH = new Map<number, number>();
      for (const n of nodes) {
        const t = tr.get(n.id) ?? 0;
        trackH.set(t, Math.max(trackH.get(t) ?? 0, componentDef(n.type)?.natHeight?.(n.props) ?? 0));
      }
      const hs = [...trackH.values()];
      const need = ROW.has(slot) ? Math.max(...hs) : hs.reduce((a, b) => a + b, 0) + 28 * (nTracks - 1);
      const room = SLOT_H[slot] ?? 516;
      if (need > room * 1.25)
        err(
          `${nodes.map((n) => `"${n.id}" (${n.type})`).join(' and ')} need about ${Math.round(need)} px of height but slot "${slot}" has ${room} px; ${nodes.length > 1 ? 'split them across slots (upper + lower, start + end) or show one at a time' : 'use a taller slot (main, full) or make it smaller'}`,
          cb.id,
        );
      for (const n of nodes) {
        const need = componentDef(n.type)?.minWidth?.(n.props);
        if (need && need > cell * 1.05)
          err(
            `"${n.id}" (${n.type}) needs about ${Math.round(need)} px but slot "${slot}" gives it ${Math.round(cell)} px${nTracks > 1 ? ` (shared with ${nTracks - 1} other node${nTracks > 2 ? 's' : ''})` : ''}; put it alone in a wide slot (main, upper or lower) or make it smaller`,
            cb.id,
          );
      }
    }
  }
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  compiled: CompiledLesson;
}

export function validateLesson(lesson: Lesson, opts: ValidateOptions = {}): ValidationResult {
  const issues: Issue[] = [];
  const err = (message: string, beat?: string, level: Issue['level'] = 'error') =>
    issues.push({ level, message, ...(beat ? { beat } : {}) });
  const seen = { beat: new Set<string>(), node: new Set<string>(), q: new Set<string>() };

  for (const b of lesson.beats) {
    if (seen.beat.has(b.id)) err(`beat id "${b.id}" is used twice`, b.id);
    seen.beat.add(b.id);
    const marks = parseMarks(b.narration);
    for (const d of marks.duplicates)
      err(`narration mark [[${d}]] appears twice; mark names must be unique in a beat`, b.id);
    if (b.speak) {
      const sm = Object.keys(parseMarks(b.speak).marks).sort().join(',');
      if (sm !== Object.keys(marks.marks).sort().join(','))
        err('speak must contain exactly the same [[marks]] as narration', b.id);
    }
    const used = new Set<string>();
    for (const c of [...b.cues, ...(b.questions ?? []).flatMap((q) => q.resolve)]) {
      const name = typeof c.at === 'string' ? c.at : typeof c.at === 'object' ? c.at.mark : null;
      if (name) used.add(name);
    }
    for (const m of marks.order)
      if (!used.has(m)) err(`mark [[${m}]] is never used by a cue; remove it or add a cue at it`, b.id, 'warn');
    for (const n of b.scene.add) {
      if (n.type === 'math') {
        const bad = ((n as { steps?: string[] }).steps ?? []).find((t) => UNSAFE_TEX.test(t));
        if (bad)
          err(`math "${n.id}": links, raw styles and \\require are not allowed in TeX (${bad.slice(0, 60)})`, b.id);
      }
      if (n.type === 'widget') {
        const html = String((n as { html?: unknown }).html ?? '');
        if (/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']?(https?:|\/\/)/i.test(html))
          err(`widget "${n.id}": load nothing from the network; inline everything`, b.id);
        err(
          `widget "${n.id}" is experimental: custom code is sandboxed but not checked like built-in components`,
          b.id,
          'warn',
        );
      }
      if (seen.node.has(n.id)) err(`node id "${n.id}" is used twice in the lesson; node ids must be unique`, b.id);
      seen.node.add(n.id);
    }
    if (opts.requireSources && b.move !== 'finish' && b.move !== 'intro' && !b.sources.length)
      err('add sources: the page(s) of the source this beat teaches from', b.id, 'warn');
    for (const q of b.questions ?? []) {
      if (seen.q.has(q.id)) err(`question id "${q.id}" is used twice`, b.id);
      seen.q.add(q.id);
      const where = `question ${q.id}`;
      switch (q.kind) {
        case 'choice': {
          const ids = q.options.map((o) => o.id);
          if (new Set(ids).size !== ids.length) err(`${where}: option ids must be unique`, b.id);
          for (const c of q.correct)
            if (!ids.includes(c)) err(`${where}: correct option "${c}" is not one of ${ids.join(', ')}`, b.id);
          if (!q.multi && q.correct.length > 1) err(`${where}: several correct options need "multi": true`, b.id);
          const wrong = q.options.filter((o) => !q.correct.includes(o.id) && !o.why);
          if (wrong.length)
            err(
              `${where}: give each wrong option a "why" that names the mistake (${wrong.map((o) => o.id).join(', ')})`,
              b.id,
              'warn',
            );
          break;
        }
        case 'blanks':
          q.rows.forEach((r, i) => {
            const boxes = templateBoxes(r.template);
            const keys = Object.keys(r.answers);
            if (!boxes.length) err(`${where} row ${i + 1}: template has no [[box]]`, b.id);
            for (const k of boxes)
              if (!keys.includes(k)) err(`${where} row ${i + 1}: box [[${k}]] has no answer`, b.id);
            for (const k of keys)
              if (!boxes.includes(k))
                err(`${where} row ${i + 1}: answer "${k}" has no [[${k}]] box in the template`, b.id);
            for (const [k, a] of Object.entries(r.answers)) checkAnswer(a, `${where} row ${i + 1} box ${k}`, b.id);
          });
          break;
        case 'numeric':
          checkAnswer(q.answer, where, b.id);
          break;
        case 'grid': {
          const cols = q.cols === 'tf' ? ['t', 'f'] : q.cols.map((c) => c.id);
          for (const r of q.rows)
            for (const c of ([] as string[]).concat(r.correct))
              if (!cols.includes(c))
                err(`${where} row ${r.id}: correct column "${c}" is not one of ${cols.join(', ')}`, b.id);
          break;
        }
        case 'order': {
          const ids = q.items.map((i) => i.id);
          if (new Set(ids).size !== ids.length) err(`${where}: item ids must be unique`, b.id);
          break;
        }
        case 'pick':
        case 'text':
          break;
      }
    }
  }
  const last = lesson.beats[lesson.beats.length - 1];
  if (last && last.move !== 'finish')
    err('end the lesson with a beat whose move is "finish" (the score card)', undefined, 'warn');

  // Compile to check cue targets, actions, args and marks against the stage state of each beat.
  const lang = opts.lang ?? lesson.lang;
  const timings = opts.timings ?? syntheticTimings(lesson, lang);
  const compiled = compileLesson(lesson, timings, { lang });
  issues.push(...compiled.issues);

  // pick questions need their node on stage and valid targets
  compiled.beats.forEach((cb) => {
    for (const q of cb.beat.questions ?? []) {
      if (q.kind !== 'pick') continue;
      const node = cb.out.nodes[q.on] ?? cb.start.nodes[q.on];
      if (!node) {
        err(`question ${q.id}: "on" node "${q.on}" is not on stage in this beat`, cb.id);
        continue;
      }
      const def = componentDef(node.type);
      const pickable = def?.pickable?.(node.props);
      if (!pickable && node.type !== 'plane') err(`question ${q.id}: a ${node.type} cannot be picked on`, cb.id);
      for (const s of [...q.correct, ...(q.choices ?? [])]) {
        const okPlane = node.type === 'plane' && /^pt:-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(s);
        if (!okPlane && pickable && !pickable.includes(s))
          err(
            `question ${q.id}: "${s}" is not a pickable part of ${q.on} (e.g. ${pickable.slice(0, 5).join(', ')})`,
            cb.id,
          );
      }
    }
  });

  if (opts.pacing) pacing(compiled, err);
  if (opts.layout) layoutCheck(compiled, err);
  return { ok: !issues.some((i) => i.level === 'error'), issues, compiled };

  function checkAnswer(a: unknown, where: string, beat: string) {
    if (typeof a === 'string' && !parseNumber(a))
      err(`${where}: "${a}" is not an exact number; use {"text": [...]} for words`, beat);
    if (typeof a === 'object' && a && 'value' in a) {
      const v = (a as { value: unknown }).value;
      if (typeof v === 'string' && !parseNumber(v)) err(`${where}: value "${v}" is not a number`, beat);
    }
  }
}

/** Pacing: each narrated sentence should come with a visual change, and the picture should not sit still for long. */
function pacing(c: CompiledLesson, err: (m: string, beat?: string, level?: Issue['level']) => void) {
  for (const cb of c.beats) {
    if (cb.ask || cb.beat.move === 'intro') continue;
    // a picture-book page read along word by word changes with every word
    const readAlong = cb.start.order.some((id) => {
      const n = cb.start.nodes[id];
      return n?.type === 'storypage' && n.props.readAlong !== false && !cb.leaving.includes(id);
    });
    if (readAlong) continue;
    const changes = [...cb.segs.values()]
      .flat()
      .map((s) => s.t0)
      .sort((a, b) => a - b);
    const caps = cb.timing.captions;
    let quiet = 0;
    caps.forEach(([t], i) => {
      const next = caps[i + 1]?.[0] ?? cb.timing.dur;
      if (!changes.some((x) => x >= t - 0.3 && x < next)) quiet++;
    });
    if (caps.length >= 3 && quiet > caps.length / 2)
      err(
        `beat is mostly still: ${quiet} of ${caps.length} sentences have no visual change; add cues at marks in those sentences`,
        cb.id,
        'warn',
      );
    let prev = 0;
    for (const t of [...changes, cb.timing.dur]) {
      if (t - prev > 6) {
        err(
          `nothing changes on screen from ${prev.toFixed(1)} s to ${t.toFixed(1)} s; add a cue (highlight, show, step) in between`,
          cb.id,
          'warn',
        );
        break;
      }
      prev = Math.max(prev, t);
    }
  }
}

/** Check a translation table against the author lesson: every key present and the same narration marks. */
export function checkStrings(lesson: Lesson, strings: Strings, lang: string): Issue[] {
  const issues: Issue[] = [];
  for (const e of collectStrings(lesson)) {
    const v = strings[e.key];
    if (v === undefined) {
      issues.push({ level: 'error', message: `[${lang}] missing translation for ${e.key} (${e.where})` });
      continue;
    }
    const text = typeof v === 'string' ? v : v.text;
    if (e.kind === 'narration') {
      const want = Object.keys(parseMarks(e.text).marks).sort().join(',');
      const got = Object.keys(parseMarks(text).marks).sort().join(',');
      if (want !== got)
        issues.push({
          level: 'error',
          message: `[${lang}] ${e.key}: marks must be [${want}] like the original, found [${got}]`,
        });
      if (typeof v !== 'string' && v.speak) {
        const sp = Object.keys(parseMarks(v.speak).marks).sort().join(',');
        if (sp !== want) issues.push({ level: 'error', message: `[${lang}] ${e.key}: speak marks must be [${want}]` });
      }
    }
    if (e.kind === 'math-template') {
      const want = templateBoxes(e.text).sort().join(',');
      const got = templateBoxes(text).sort().join(',');
      if (want !== got)
        issues.push({ level: 'error', message: `[${lang}] ${e.key}: answer boxes must be [${want}], found [${got}]` });
    }
    const dollars = (s: string) => (s.replace(/\\\$/g, '').match(/\$/g) ?? []).length;
    if (dollars(text) % 2)
      issues.push({ level: 'error', message: `[${lang}] ${e.key}: unbalanced $ (inline math must be $…$)` });
  }
  const loc = localize(lesson, strings);
  void loc;
  return issues;
}
