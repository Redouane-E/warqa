// The narration's marks in the editor (redesign 4d3): the narration with each mark drawn as a chip on the word it
// waits for, the marks on the beat's timeline under the stage, the threads from a mark to the stage parts its cues
// move, the judge's red-pen note, and the beat writing itself again.
import { dirOf } from '@warqa/i18n';
import {
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { WarqaPlayer } from '../../player';
import { type Beat, type BeatTime, type Cue, markOfCue, targetText } from './shared';

// a mark (named as the lesson format names them) and the word it waits for, which ends at a space or at the next
// mark ("[[a]][[b]]Word")
const NAME = '[A-Za-z][\\w-]{0,31}';
const MARK = new RegExp(`\\[\\[(${NAME})\\]\\]((?:(?!\\[\\[)\\S)*)`, 'g');
const NAME_RE = new RegExp(`^${NAME}$`);

/** A run of the narration: text, or a mark with its word (`start`/`end`: where the mark and its word are). */
type Seg = { text: string } | { mark: string; label: string; word: string; start: number; end: number };

/** The narration in runs: text, and marks with the word they wait for ("[[keep]]Keep"), with their place. */
export function segmentsOf(narration: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  for (const m of narration.matchAll(MARK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: narration.slice(last, at) });
    out.push({ mark: m[1]!, label: `[[${m[1]}]]`, word: m[2] ?? '', start: at, end: at + m[0].length });
    last = at + m[0].length;
  }
  if (last < narration.length) out.push({ text: narration.slice(last) });
  return out;
}

/* ---------- the narration, its marks drawn on the words ---------- */

/**
 * A plain text box (typing, pasting, an Arabic keyboard, a screen reader all behave as usual) over a copy of its
 * text where each mark and the word it waits for are drawn as a chip. The caret in a mark chooses that mark.
 */
export function NarrationEditor({
  value,
  lang,
  onChange,
  selMark,
  onSelectMark,
  labelledBy,
  describedBy,
}: {
  value: string;
  lang: string;
  onChange: (s: string) => void;
  selMark: string | null;
  onSelectMark: (m: string | null) => void;
  labelledBy: string;
  describedBy: string;
}) {
  const { t } = useI18n();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  // closing the form without adding: the focus goes back to "Add a mark"
  const close = () => {
    setAdding(false);
    setNameError('');
    requestAnimationFrame(() => addBtn.current?.focus());
  };
  const segs = useMemo(() => segmentsOf(value), [value]);
  const dir = dirOf(lang);
  // the box grows with its text (no scrollbar: the chips under it stay in line with the letters)
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when the text changes
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${el.scrollHeight + 2}px`;
  }, [value]);
  const caret = () => {
    const el = ta.current;
    if (!el) return;
    const at = el.selectionStart;
    const hit = segs.find((s) => 'mark' in s && at >= s.start && at <= s.end);
    const m = hit && 'mark' in hit ? hit.mark : null;
    if (m && m !== selMark) onSelectMark(m);
  };
  const used = new Set(segs.flatMap((s) => ('mark' in s ? [s.mark] : [])));
  const suggest = () => {
    let k = used.size + 1;
    while (used.has(`m${k}`)) k++;
    return `m${k}`;
  };
  // the new mark goes before the word the caret is in (or the next one)
  const addMark = () => {
    const fail = (msg: string) => {
      setNameError(msg);
      // back in the field, which now reads out the problem (described by it)
      nameInput.current?.focus();
    };
    if (!NAME_RE.test(name)) return fail(t('editor.markRule'));
    if (used.has(name)) return fail(t('editor.markTaken'));
    const el = ta.current;
    const at = el?.selectionStart ?? value.length;
    let start = at;
    while (start > 0 && !/\s/.test(value[start - 1]!)) start--;
    const next = `${value.slice(0, start)}[[${name}]]${value.slice(start)}`;
    onChange(next);
    onSelectMark(name);
    setAdding(false);
    setNameError('');
    requestAnimationFrame(() => {
      ta.current?.focus();
      const pos = start + name.length + 4;
      ta.current?.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className="narr">
      <div className="narr-wrap" lang={lang} dir={dir}>
        <div className="narr-back" aria-hidden="true">
          {segs.map((s, k) =>
            'mark' in s ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: runs of one text
              <span key={k} className={`narr-chip${s.mark === selMark ? ' is-sel' : ''}`}>
                <span className="narr-label">{s.label}</span>
                <span className="narr-word">{s.word}</span>
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: runs of one text
              <span key={k}>{s.text}</span>
            ),
          )}
          {/* a last empty line keeps its height */}
          {value.endsWith('\n') ? ' ' : ''}
        </div>
        <textarea
          ref={ta}
          className="narr-input"
          rows={3}
          value={value}
          spellCheck
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onSelect={caret}
          onKeyUp={caret}
          onClick={caret}
        />
      </div>
      <div className="narr-tools">
        <p className="hint" id={describedBy}>
          {t('editor.markHint')}
        </p>
        {adding ? (
          <div className="narr-add">
            <label htmlFor={nameId}>{t('editor.markName')}</label>
            <input
              ref={nameInput}
              id={nameId}
              className="code"
              dir="ltr"
              spellCheck={false}
              value={name}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? `${nameId}-error` : undefined}
              onChange={(e) => setName(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addMark();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                }
              }}
              // biome-ignore lint/a11y/noAutofocus: the field opened by "Add a mark" takes the name at once
              autoFocus
            />
            <Button variant="primary" onClick={addMark}>
              {t('editor.addMarkDo')}
            </Button>
            <Button variant="quiet" onClick={close}>
              {t('common.cancel')}
            </Button>
            {nameError && (
              <span className="sf-error" id={`${nameId}-error`}>
                {nameError}
              </span>
            )}
          </div>
        ) : (
          <Button
            ref={addBtn}
            variant="quiet"
            icon="cue-thread"
            onClick={() => {
              setName(suggest());
              setNameError('');
              setAdding(true);
            }}
          >
            {t('editor.addMark')}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- the marks on the beat's timeline ---------- */

export function MarkTimeline({
  time,
  marks,
  withCues,
  selMark,
  onSelect,
  playerRef,
  beat,
  lang,
}: {
  /** The language shown: the timeline runs in its direction. */
  lang: string;
  time?: BeatTime;
  /** The narration's marks, in their order. */
  marks: string[];
  /** Marks that some cue waits on (the others are drawn quieter). */
  withCues: Set<string>;
  selMark: string | null;
  onSelect: (m: string, at: number) => void;
  playerRef: MutableRefObject<WarqaPlayer | null>;
  /** The beat shown (the playhead only follows the player on it). */
  beat: number;
}) {
  const { t, num } = useI18n();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const h = setInterval(() => {
      const p = playerRef.current;
      setNow(p && p.i === beat ? p.time : null);
    }, 100);
    return () => clearInterval(h);
  }, [playerRef, beat]);
  const dur = time?.dur ?? 0;
  if (!dur) return null;
  const pos = (s: number) => `${Math.min(100, Math.max(0, (s / dur) * 100))}%`;
  const ticks: number[] = [];
  const step = dur > 40 ? 10 : dur > 16 ? 5 : dur > 6 ? 2 : 1;
  for (let s = 0; s <= dur + 0.01; s += step) ticks.push(s);
  // marks close together take two rows, so their chips do not cover each other
  let prev = -1;
  let row = 0;
  const placed = marks.flatMap((m) => {
    const at = time?.marks[m];
    if (at === undefined) return [];
    row = prev >= 0 && (at - prev) / dur < 0.09 ? 1 - row : 0;
    prev = at;
    return [{ m, at, row }];
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of marks, not a form group
    <div className="mark-timeline" role="group" aria-label={t('editor.timeline')} dir={dirOf(lang)}>
      <div className="tl-axis" aria-hidden="true" />
      {ticks.map((s) => (
        <span key={s} className="tl-sec mono" style={{ insetInlineStart: pos(s) }} aria-hidden="true">
          {t('editor.sec', { n: num(s) })}
        </span>
      ))}
      {now !== null && <span className="tl-play" style={{ insetInlineStart: pos(now) }} aria-hidden="true" />}
      {placed.map(({ m, at, row: r }) => (
        <button
          key={m}
          type="button"
          dir="ltr"
          data-mark={m}
          className={`tl-mark${m === selMark ? ' is-sel' : ''}${withCues.has(m) ? '' : ' is-idle'}${r ? ' is-up' : ''}`}
          style={{ insetInlineStart: pos(at) }}
          aria-pressed={m === selMark}
          title={t('editor.markAt', { mark: m, t: num(Math.round(at * 10) / 10) })}
          onClick={() => onSelect(m, at)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

/* ---------- threads from the marks to what they move ---------- */

interface Thread {
  key: string;
  d: string;
  sel: boolean;
}
interface Target {
  key: string;
  /** On the right half of the stage: its name hangs from its right edge. */
  end: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/**
 * Curves from each mark on the timeline to the stage parts its cues move (the chosen mark's solid ink, the others
 * dashed), and a box with its name around each part the chosen mark moves. Redrawn as the stage settles.
 */
export function Threads({
  zoneRef,
  playerRef,
  beat,
  index,
  selMark,
  actionName,
}: {
  zoneRef: RefObject<HTMLDivElement | null>;
  playerRef: MutableRefObject<WarqaPlayer | null>;
  beat: Beat;
  index: number;
  selMark: string | null;
  actionName: (a: string) => string;
}) {
  const [lines, setLines] = useState<{
    threads: Thread[];
    targets: Target[];
    w: number;
    h: number;
    /** The stage's own ink and paper (its theme, Sheet or Board, not the studio's). */
    ink?: string;
    paper?: string;
    /** The stage frame in the zone: the chosen thread's halo (the stage's paper colour) stays on it. */
    clip?: { x: number; y: number; w: number; h: number };
  }>({ threads: [], targets: [], w: 0, h: 0 });
  const cues = beat.cues;
  const actionRef = useRef(actionName);
  actionRef.current = actionName;
  const host = useRef<HTMLDivElement>(null);
  const clipId = `th-clip-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  useEffect(() => {
    let last = '';
    const set = (next: typeof lines) => {
      // redrawn often, re-rendered only when something moved
      const key = JSON.stringify(next);
      if (key !== last) setLines(next);
      last = key;
    };
    const draw = () => {
      const zone = zoneRef.current;
      const p = playerRef.current;
      if (!zone || !p || p.i !== index) return set({ threads: [], targets: [], w: 0, h: 0 });
      const z = zone.getBoundingClientRect();
      const threads: Thread[] = [];
      const targets: Target[] = [];
      (cues ?? []).forEach((c: Cue, k) => {
        const m = markOfCue(c);
        if (!m) return;
        const chip = zone.querySelector<HTMLElement>(`.tl-mark[data-mark="${CSS.escape(m)}"]`);
        const r = p.targetRect(c.target);
        if (!chip || !r) return;
        const cr = chip.getBoundingClientRect();
        const x1 = cr.left + cr.width / 2 - z.left;
        const y1 = cr.top - z.top;
        const x2 = r.left + r.width / 2 - z.left;
        const y2 = r.top + r.height / 2 - z.top;
        const mid = (y1 + y2) / 2;
        const sel = m === selMark;
        threads.push({ key: `${k}`, d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`, sel });
        if (sel)
          targets.push({
            key: `${k}`,
            end: x2 > z.width / 2,
            x: r.left - z.left - 4,
            y: r.top - z.top - 4,
            w: r.width + 8,
            h: r.height + 8,
            label: `${targetText(c.target)} · ${actionRef.current(c.do)}`,
          });
      });
      // the chosen mark's threads over the others
      threads.sort((a, b) => Number(a.sel) - Number(b.sel));
      const root = zone.querySelector<HTMLElement>('.wq-player');
      const cs = root ? getComputedStyle(root) : null;
      const ink = cs?.getPropertyValue('--wq-ink').trim();
      const paper = cs?.getPropertyValue('--board').trim();
      const f = zone.querySelector('.stage-frame')?.getBoundingClientRect();
      set({
        threads,
        targets,
        w: z.width,
        h: z.height,
        ...(ink ? { ink } : {}),
        ...(paper ? { paper } : {}),
        ...(f ? { clip: { x: f.left - z.left, y: f.top - z.top, w: f.width, h: f.height } } : {}),
      });
    };
    draw();
    const h = setInterval(draw, 300);
    window.addEventListener('resize', draw);
    return () => {
      clearInterval(h);
      window.removeEventListener('resize', draw);
    };
  }, [zoneRef, playerRef, cues, index, selMark]);
  // names that would leave the stage come back onto it; names that cover one another stack upwards
  // biome-ignore lint/correctness/useExhaustiveDependencies: after each drawing of the boxes
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const z = el.getBoundingClientRect();
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const label of el.querySelectorAll<HTMLElement>('.th-label')) {
      label.style.translate = '';
      const r = label.getBoundingClientRect();
      const dx = r.left < z.left ? z.left - r.left : r.right > z.right ? z.right - r.right : 0;
      let dy = 0;
      const hits = () =>
        placed.some((o) => o.l < r.right + dx && o.r > r.left + dx && o.t < r.bottom + dy && o.b > r.top + dy);
      for (let n = 0; n < 6 && hits(); n++) dy -= r.height + 2;
      if (dx || dy) label.style.translate = `${dx}px ${dy}px`;
      placed.push({ l: r.left + dx, r: r.right + dx, t: r.top + dy, b: r.bottom + dy });
    }
  }, [lines]);
  return (
    <div
      ref={host}
      className={`threads${selMark ? ' has-sel' : ''}`}
      aria-hidden="true"
      style={
        {
          ...(lines.ink ? { '--th-ink': lines.ink } : {}),
          ...(lines.paper ? { '--th-paper': lines.paper } : {}),
        } as CSSProperties
      }
    >
      <svg aria-hidden="true" width={lines.w} height={lines.h} viewBox={`0 0 ${lines.w || 1} ${lines.h || 1}`}>
        {lines.clip && (
          <clipPath id={clipId}>
            <rect x={lines.clip.x} y={lines.clip.y} width={lines.clip.w} height={lines.clip.h} />
          </clipPath>
        )}
        {lines.threads.map((th) => (
          <g key={th.key} className={th.sel ? 'is-sel' : ''}>
            {th.sel && <path className="th-halo" d={th.d} clipPath={lines.clip ? `url(#${clipId})` : undefined} />}
            <path className="th-line" d={th.d} />
          </g>
        ))}
      </svg>
      {lines.targets.map((tg) => (
        <div
          key={tg.key}
          className={`th-target${tg.end ? ' is-end' : ''}`}
          style={{ left: tg.x, top: tg.y, width: tg.w, height: tg.h }}
        >
          <span className="th-label" dir="ltr">
            {tg.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- the judge's note, in red pen ---------- */

export function JudgeNote({
  score,
  problem,
  fix,
  compact,
  onUse,
}: {
  score: number;
  problem?: string;
  fix?: string;
  /** Just the score (a mark is chosen: its threads and boxes are what matter); the note shows on hover or focus. */
  compact?: boolean;
  onUse: (instruction: string) => void;
}) {
  const { t, num } = useI18n();
  const note = [problem, fix].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={`judge-note${compact ? ' is-compact' : ''}`}
      title={t('editor.judgeUse')}
      onClick={() => onUse(note || t('editor.judgeScore', { n: score }))}
    >
      <span className="visually-hidden">{t('editor.judgeScore', { n: score })}</span>
      <span className="judge-score" aria-hidden="true">
        {num(score)}/{num(5)}
      </span>
      {note && (
        <span className="judge-text" dir="auto">
          {note}
        </span>
      )}
      <span className="visually-hidden">{t('editor.judgeUse')}</span>
    </button>
  );
}

/* ---------- a beat being written again ---------- */

export function Writing({ n }: { n: number }) {
  const { t } = useI18n();
  return (
    <div className="stage-writing" role="status">
      <span className="writing-lines" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="writing-text">
        <span className="run-dot" aria-hidden="true" /> {t('editor.writingBeat', { n })}
      </span>
    </div>
  );
}

/* ---------- listen to the beat's narration ---------- */

export function Listen({ src }: { src: string | undefined }) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: another beat stops this one
  useEffect(() => {
    audio.current?.pause();
    audio.current = null;
    setOn(false);
  }, [src]);
  if (!src) return null;
  return (
    <Button
      icon={on ? 'pause' : 'voice'}
      onClick={() => {
        if (on) {
          audio.current?.pause();
          setOn(false);
          return;
        }
        audio.current ??= new Audio(src);
        audio.current.onended = () => setOn(false);
        audio.current.currentTime = 0;
        void audio.current.play().then(
          () => setOn(true),
          () => setOn(false),
        );
      }}
    >
      {on ? t('editor.stopListen') : t('editor.listen')}
    </Button>
  );
}
