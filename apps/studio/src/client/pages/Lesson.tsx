// The lesson editor (redesign 4d): the beats hang on the margin, the stage is the lesson's own player drawing the
// beat being edited (Preview lifts it to the whole window), the narration sits under it, and the selected beat's
// details open in the side sheet (pushing the place on wide screens).
import { dirOf } from '@warqa/i18n';
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, LessonDetail, ProjectDetail, StagePart } from '../../shared/types';
import { api, errorText } from '../api';
import { useJobs } from '../components/JobBoard';
import { Menu } from '../components/Menu';
import { useConfirm, useToast, useUnsavedGuard } from '../components/overlays';
import { SideSheet, useWide } from '../components/SideSheet';
import { inField, toolOpen } from '../components/tools';
import { Button, Icon, IssueList, Loading, Notice } from '../components/ui';
import { useI18n } from '../i18n';
import { usePublishBook } from '../place';
import type { WarqaPlayer } from '../player';
import { Link, navigate, useLocation } from '../router';
import { BeatList } from './editor/BeatList';
import { useActionName } from './editor/Cues';
import { useCatalog } from './editor/catalog';
import { Inspector } from './editor/Inspector';
import { JudgeNote, Listen, MarkTimeline, NarrationEditor, Threads, Writing } from './editor/Marks';
import { Stage, type StageHandle } from './editor/Stage';
import {
  type Beat,
  type BeatTime,
  copyBeat,
  freshId,
  type KeyMove,
  type LessonObj,
  marksOf,
  renameNode,
  type Timings,
  wordsOf,
} from './editor/shared';

/** `?beat=3` is the third beat (index 2); anything else is the first. */
const beatOf = (v: string | null) => Math.max(0, (Number.parseInt(v ?? '', 10) || 1) - 1);

/* ---------- the beat's row above the stage: play it, and where it is ---------- */

function BeatHead({
  index,
  title,
  lang,
  time,
  playerRef,
}: {
  index: number;
  title: string;
  lang: string;
  time?: BeatTime;
  playerRef: MutableRefObject<WarqaPlayer | null>;
}) {
  const { t, num } = useI18n();
  const [now, setNow] = useState({ t: 0, playing: false });
  // the clock follows the player (only this row redraws while it plays)
  useEffect(() => {
    const h = setInterval(() => {
      const p = playerRef.current;
      if (p) setNow((cur) => (cur.t === p.time && cur.playing === p.playing ? cur : { t: p.time, playing: p.playing }));
    }, 100);
    return () => clearInterval(h);
  }, [playerRef]);
  const sec = (s: number) => num(Math.round(s * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dur = time?.dur ?? 0;
  const at = Math.min(now.t, dur || now.t);
  // the last mark passed ("at the mark keep")
  const mark = Object.entries(time?.marks ?? {})
    .filter(([, s]) => s <= at + 0.01)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const toggle = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) p.pause();
    // paused partway through this beat: go on; resting (as the editor shows it) or at its end: from the start
    else if (p.i === index && !p.resting && p.time < dur - 0.05) p.play();
    else p.seek(index, true);
  };
  return (
    <div className="beat-head">
      <button
        type="button"
        className="play-round"
        aria-label={now.playing ? t('editor.pauseBeat') : t('editor.playBeat')}
        onClick={toggle}
      >
        <Icon name={now.playing ? 'pause' : 'play'} />
      </button>
      <div className="beat-head-text">
        <strong>
          {t('editor.beatHead', { n: index + 1 })}
          {' · '}
          <bdi lang={lang} dir={dirOf(lang)}>
            {title}
          </bdi>
        </strong>
        {dur > 0 && (
          <span className="mono muted small">
            {t('editor.clock', { t: sec(at), dur: sec(dur) })}
            {/* the mark's name is an id, written left to right even in Arabic */}
            {mark && ` · ${t('editor.atMark', { mark: `\u2066${mark}\u2069` })}`}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- the narration, under the stage ---------- */

function NarrationBox({
  beat,
  lang,
  time,
  audio,
  selMark,
  onSelectMark,
  onChange,
}: {
  beat: Beat;
  lang: string;
  time?: BeatTime;
  /** Its recorded narration, when there is one (Listen). */
  audio?: string;
  selMark: string | null;
  onSelectMark: (m: string | null) => void;
  onChange: (s: string) => void;
}) {
  const { t, num } = useI18n();
  const marks = marksOf(beat.narration);
  const meta = [
    time?.dur ? t('editor.sec', { n: num(Math.round(time.dur * 10) / 10) }) : '',
    t('editor.wordsN', { n: wordsOf(beat.narration) }),
    t('editor.marksN', { n: marks.length }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="narration-box" aria-labelledby="narration-title">
      <div className="narration-head">
        <h2 id="narration-title" className="narration-title">
          {t('editor.narration')}
        </h2>
        <span className="mono muted small">{meta}</span>
        <Listen src={audio} />
      </div>
      <NarrationEditor
        value={beat.narration}
        lang={lang}
        onChange={onChange}
        selMark={selMark}
        onSelectMark={onSelectMark}
        labelledBy="narration-title"
        describedBy="narration-hint"
      />
    </section>
  );
}

/* ---------- the editor ---------- */

export function LessonPage({ id, lid }: { id: string; lid: string }) {
  const i18n = useI18n();
  const { t, lang: ui, langName, num } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const jobs = useJobs();
  const { query } = useLocation();
  const wide = useWide();
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [lesson, setLesson] = useState<LessonObj | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  // what is on the stage during each beat (the server's last check of the lesson, saved or not)
  const [parts, setParts] = useState<Record<string, StagePart[]>>({});
  const catalog = useCatalog(id);
  // ?beat=3 shows the third beat (Go to links here); the address follows the beat shown
  const beatParam = query.get('beat');
  const [sel, setSelState] = useState(() => beatOf(beatParam));
  useEffect(() => {
    if (beatParam) setSelState(beatOf(beatParam));
  }, [beatParam]);
  const setSel = useCallback(
    (k: number) => {
      setSelState(k);
      const q = new URLSearchParams(location.search);
      q.set('beat', String(k + 1));
      navigate(`/project/${encodeURIComponent(id)}/lesson/${encodeURIComponent(lid)}?${q}`, {
        replace: true,
        keepScroll: true,
      });
    },
    [id, lid],
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [previewLang, setPreviewLang] = useState<string>('');
  const [timings, setTimings] = useState<Timings>({});
  const [audio, setAudio] = useState<Record<string, Record<string, string>>>({});
  // the mark chosen in the narration, on the timeline or by a cue: its threads and cues stand out
  const [selMark, setSelMark] = useState<string | null>(null);
  // "Show what each mark moves" (remembered)
  const [threads, setThreads] = useState(() => {
    try {
      return localStorage.getItem('warqa-studio:threads') !== '0';
    } catch {
      return true;
    }
  });
  // a beat's new version waiting: the stage shows the saved one, or the new one for this beat ("After")
  const [afterBeat, setAfterBeat] = useState<string | null>(null);
  // what should change, per beat (the judge's note can fill it)
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const zoneRef = useRef<HTMLDivElement>(null);
  const actionName = useActionName();
  // the inspector: open by itself where it pushes the place (wide screens); Enter on a beat opens it anywhere
  const [inspecting, setInspecting] = useState<boolean | null>(null);
  const [focusSheet, setFocusSheet] = useState(false);
  const sheetOpen = inspecting ?? wide;
  const stage = useRef<StageHandle>(null);
  const playerRef = useRef<WarqaPlayer | null>(null);
  const detailsBtn = useRef<HTMLButtonElement>(null);
  // beats being rewritten (their jobs run in the tray) and the last error per beat
  const [rewriting, setRewriting] = useState<Record<string, string>>({});
  const [regenErrors, setRegenErrors] = useState<Record<string, string>>({});
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // what the translations' keys need since the last save: cue removals (in order, by the saved beat ids) and ids
  // renamed from their saved value to their current one ("node:eq1" → "eq2"); sent once the lesson is saved
  const keyMoves = useRef<{ cues: KeyMove[][]; renames: Map<string, string> }>({ cues: [], renames: new Map() });
  const savedIdOf = (kind: string, id: string) =>
    [...keyMoves.current.renames.entries()]
      .find(([k, v]) => k.startsWith(`${kind}:`) && v === id)?.[0]
      .slice(kind.length + 1) ?? id;
  const renameKeys = (kind: 'node' | 'q' | 'beat', from: string, to: string) => {
    const m = keyMoves.current.renames;
    const hit = [...m.entries()].find(([k, v]) => k.startsWith(`${kind}:`) && v === from);
    m.set(hit ? hit[0] : `${kind}:${from}`, to);
  };
  const moveKeys = (moves: KeyMove[]) => {
    // written with the beat ids the server knows (a beat renamed since keeps its saved id there until the save)
    const batch = moves.map((mv) => {
      const fix = (k: string) => k.replace(/^beat\.([^.]+)\./, (_, b: string) => `beat.${savedIdOf('beat', b)}.`);
      return { from: fix(mv.from), to: mv.to === null ? null : fix(mv.to) };
    });
    keyMoves.current.cues.push(batch);
    return () => {
      keyMoves.current.cues = keyMoves.current.cues.filter((b) => b !== batch);
    };
  };
  const sendKeyMoves = useCallback(async () => {
    const { cues, renames } = keyMoves.current;
    const prefix = { node: 'node', q: 'q', beat: 'beat' } as Record<string, string>;
    const named = [...renames.entries()]
      .map(([k, to]) => {
        const [kind, from] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        return { from: `${prefix[kind]}.${from}.`, to: `${prefix[kind]}.${to}.` };
      })
      .filter((mv) => mv.from !== mv.to);
    const batches = [...cues, ...(named.length ? [named] : [])].filter((b) => b.length);
    keyMoves.current = { cues: [], renames: new Map() };
    if (batches.length) await api.moveStrings(id, lid, batches);
  }, [id, lid]);
  // the Translations tab moved to Translate & narrate (redesign 4e): its address goes there, this chapter chosen
  const oldTab = query.get('tab') === 'translations';
  useEffect(() => {
    if (oldTab)
      navigate(`/project/${encodeURIComponent(id)}?step=voice&chapter=${encodeURIComponent(lid)}`, { replace: true });
  }, [oldTab, id, lid]);
  usePublishBook(
    id,
    'make',
    lesson
      ? {
          id: lid,
          title: String(lesson.title ?? lid),
          beats: (lesson.beats as { id: string; title?: string }[]).map((b) => ({ id: b.id, title: b.title ?? b.id })),
        }
      : undefined,
  );
  const uiRef = useRef({ t, ui });
  uiRef.current = { t, ui };

  // the book's models: offline, writing a beat again waits only when its writer is a cloud model
  const [bookInfo, setBookInfo] = useState<ProjectDetail | null>(null);
  useEffect(() => {
    let live = true;
    api
      .project(id)
      .then((p) => live && setBookInfo(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);

  const load = useCallback(async () => {
    const { t, ui } = uiRef.current;
    try {
      const d = await api.lesson(id, lid);
      setDetail(d);
      setLesson(structuredClone(d.lesson) as unknown as LessonObj);
      setIssues(d.issues);
      setParts(d.parts ?? {});
      // edits are gone (a reload, a restore): so are the key moves they needed
      keyMoves.current = { cues: [], renames: new Map() };
      setDirty(false);
      setPreviewLang(
        (cur) =>
          cur || (d.langs.includes(ui) ? ui : d.langs.includes(d.lesson.lang) ? d.lesson.lang : (d.langs[0] ?? '')),
      );
    } catch (e) {
      setError(errorText(e, t));
    }
  }, [id, lid]);
  useEffect(() => {
    void load();
  }, [load]);

  // live validation of unsaved edits (nothing is written)
  useEffect(() => {
    if (!dirty || !lesson) return;
    const h = setTimeout(() => {
      api
        .saveLesson(id, lid, lesson, { dry: true })
        .then((r) => {
          setIssues(r.issues);
          if (r.parts) setParts(r.parts);
        })
        .catch(() => {});
    }, 700);
    return () => clearTimeout(h);
  }, [lesson, dirty, id, lid]);

  // leaving names what is lost: the beat changed (or how many), and at most two kinds of change in it
  useUnsavedGuard(dirty, () => {
    const saved = detail?.lesson.beats ?? [];
    if (!lesson) return null;
    const json = (x: unknown) => JSON.stringify(x ?? null);
    const changed = lesson.beats
      .map((b, i) => ({ b, i, old: saved.find((x) => x.id === b.id) }))
      .filter(({ b, old }) => json(b) !== json(old));
    const removed = saved.filter((x) => !lesson.beats.some((b) => b.id === x.id)).length;
    if (!changed.length && !removed) return null;
    const one = changed[0];
    if (changed.length + removed > 1 || !one) return { title: t('leave.beats', { n: changed.length + removed }) };
    const { b, old } = one;
    const what: string[] = [];
    const o = (old ?? {}) as Record<string, unknown>;
    if (old && json(b.narration) !== json(o.narration)) what.push(t('leave.what.narration'));
    const cues = (b.cues ?? []) as { at?: unknown }[];
    const oldCues = (o.cues ?? []) as { at?: unknown }[];
    const cue = cues.find((c, k) => json(c) !== json(oldCues[k]));
    // the mark a cue waits for: "keep", or { mark: "keep", offset } (not the start, the end or a time)
    const mark = (at: unknown): string | null =>
      typeof at === 'string'
        ? at === 'start' || at === 'end'
          ? null
          : at
        : at && typeof at === 'object' && typeof (at as { mark?: unknown }).mark === 'string'
          ? (at as { mark: string }).mark
          : null;
    const cueMark = cue ? mark(cue.at) : null;
    if (old && cue) what.push(cueMark ? t('leave.what.cue', { mark: cueMark }) : t('leave.what.cues'));
    if (old && json(b.scene) !== json(o.scene)) what.push(t('leave.what.stage'));
    if (old && json(b.questions) !== json(o.questions)) what.push(t('leave.what.question'));
    if (old && json(b.title) !== json(o.title)) what.push(t('leave.what.title'));
    const list = new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(what.slice(0, 2));
    return {
      title: t('leave.beat', { n: one.i + 1 }),
      // (a capital where the sentence starts with the list: English)
      ...(list
        ? {
            body: t('leave.lost', {
              changes: i18n.lang === 'en' ? list.charAt(0).toUpperCase() + list.slice(1) : list,
            }),
          }
        : {}),
    };
  });

  // put back the lesson as it was saved before (the toast's Undo); edits made since are lost, so that asks first
  const restore = useCallback(
    async (prev: unknown) => {
      const t = uiRef.current.t;
      if (
        dirtyRef.current &&
        !(await confirm({
          title: t('editor.undoSaveTitle'),
          confirm: t('editor.undoSave'),
          cancel: t('leave.stay'),
          danger: true,
        }))
      )
        return;
      try {
        const r = await api.saveLesson(id, lid, prev, { force: true });
        if (!r.saved) {
          setSaveError(r.error ?? t('err.generic'));
          return;
        }
        await load();
        setReloadKey((k) => k + 1);
        setSavedAt(Date.now());
      } catch (e) {
        setSaveError(errorText(e, t));
      }
    },
    [id, lid, load, confirm],
  );

  // a rewrite ends (in the tray): the new beat comes in; unsaved edits to other beats stay
  useEffect(
    () =>
      jobs.onEnd(id, (job) => {
        if (job.type !== 'rewrite' || job.args.lesson !== lid) return;
        const bid = String(job.args.beat ?? '');
        setRewriting((cur) => {
          const { [bid]: _done, ...rest } = cur;
          return rest;
        });
        if (job.status === 'error') setRegenErrors((cur) => ({ ...cur, [bid]: job.error ?? '' }));
        if (job.status !== 'done') return;
        // a new version to compare: the lesson is as it was; the book says the version is waiting
        if ((job.result as { candidate?: boolean } | undefined)?.candidate) {
          void api.lesson(id, lid).then((d) => {
            setDetail(d);
            const k = (d.lesson.beats as Beat[]).findIndex((b) => b.id === bid);
            toast({
              text: t('editor.rewritten', { n: k + 1 }),
              tone: 'good',
              action: {
                label: t('editor.compare'),
                run: () => {
                  if (k >= 0) setSel(k);
                  setAfterBeat(bid);
                  setFocusSheet(true);
                  setInspecting(true);
                },
              },
            });
          });
          return;
        }
        void (async () => {
          if (!dirtyRef.current) await load();
          else {
            const d = await api.lesson(id, lid);
            const fresh = (d.lesson.beats as Beat[]).find((b) => b.id === bid);
            setDetail(d);
            if (fresh)
              setLesson((cur) =>
                cur ? { ...cur, beats: cur.beats.map((b) => (b.id === bid ? structuredClone(fresh) : b)) } : cur,
              );
          }
          setReloadKey((k) => k + 1);
        })();
      }),
    [jobs, id, lid, load, toast, t, setSel],
  );

  // another beat: no mark chosen yet
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the beat shown changes
  useEffect(() => {
    setSelMark(null);
  }, [sel]);

  // ?compare=1 (Compare from the Check step): the beat's new version on the stage, its details open
  const compareAsked = query.get('compare') === '1';
  const compared = useRef(false);
  useEffect(() => {
    if (!compareAsked || compared.current || !detail || !lesson) return;
    const bid = lesson.beats[sel]?.id;
    if (!bid || !detail.candidates?.[bid]) return;
    compared.current = true;
    setAfterBeat(bid);
    setInspecting(true);
  }, [compareAsked, detail, lesson, sel]);

  const save = useCallback(
    async (force = false) => {
      if (!lesson) return;
      const before = detail?.lesson;
      setSaving(true);
      setSaveError('');
      try {
        const r = await api.saveLesson(id, lid, lesson, { force });
        setIssues(r.issues);
        if (r.saved) {
          await sendKeyMoves().catch(() => {});
          setDirty(false);
          setBlocked(0);
          setSavedAt(Date.now());
          setReloadKey((k) => k + 1);
          const fresh = await api.lesson(id, lid);
          setDetail(fresh);
          setParts(fresh.parts ?? {});
          toast({
            text: t('editor.lessonSaved'),
            tone: 'good',
            ...(before ? { action: { label: t('common.undo'), run: () => void restore(before) } } : {}),
          });
        } else {
          const n = r.issues.filter((i) => i.level === 'error' && !i.lang).length;
          setBlocked(n || 1);
          if (!n && r.error) setSaveError(r.error);
        }
      } catch (e) {
        setSaveError(errorText(e, t));
      }
      setSaving(false);
    },
    [id, lid, lesson, t, detail, toast, restore, sendKeyMoves],
  );

  const beatsLen = lesson?.beats.length ?? 0;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // the physical key: an Arabic keyboard types "س" there
      // (not AltGr, which Windows reports as Ctrl + Alt: it types ś or ș)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (dirty) void save();
        return;
      }
      // J / K: the next or previous beat (not while typing; the player's own keys stay inside it)
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        inField(e) ||
        toolOpen() ||
        (e.target as Element).closest?.('.wq-player')
      )
        return;
      if (e.code === 'KeyJ' && sel < beatsLen - 1) setSel(sel + 1);
      else if (e.code === 'KeyK' && sel > 0) setSel(sel - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dirty, save, sel, beatsLen, setSel]);

  const byBeat = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) if (i.beat) m.set(i.beat, [...(m.get(i.beat) ?? []), i]);
    return m;
  }, [issues]);

  if (error)
    return (
      <div className="page">
        <Notice tone="error">{error.startsWith('no lesson') ? t('editor.notFound') : error}</Notice>
        <Link to={`/project/${encodeURIComponent(id)}`}>{t('editor.back')}</Link>
      </div>
    );
  if (!detail || !lesson)
    return (
      <div className="page">
        <Loading />
      </div>
    );

  const beats = lesson.beats;
  const i = Math.min(sel, beats.length - 1);
  const beat = beats[i]!;
  const lessonLang = lesson.lang;
  const shown = previewLang || lessonLang;
  const timeOf = (b: Beat, lang = shown): BeatTime | undefined => timings[lang]?.[b.id] ?? timings[lessonLang]?.[b.id];
  const seconds = beats.reduce((a, b) => a + (timeOf(b)?.dur ?? 0), 0);
  const minutes = seconds ? Math.max(1, Math.round(seconds / 60)) : undefined;
  const update = (fn: (l: LessonObj) => void) => {
    setLesson((cur) => {
      const next = structuredClone(cur!) as LessonObj;
      fn(next);
      return next;
    });
    setDirty(true);
    setBlocked(0);
  };
  const updateBeat = (fn: (b: Beat) => void) => update((l) => fn(l.beats[i]!));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= beats.length) return;
    update((l) => {
      const [b] = l.beats.splice(from, 1);
      l.beats.splice(to, 0, b!);
    });
    setSel(to);
  };
  // the focus goes to the sheet's title (when it is open) once the beat it shows changed
  const focusSheetTitle = () =>
    requestAnimationFrame(() =>
      (document.querySelector<HTMLElement>('.beat-sheet h2') ?? detailsBtn.current)?.focus({ preventScroll: true }),
    );
  const addBeat = (copy?: Beat) => {
    const fresh: Beat = copy
      ? copyBeat(copy, lesson)
      : {
          id: freshId(
            'beat',
            beats.map((b) => b.id),
          ),
          title: t('editor.newBeat'),
          move: 'example',
          narration: '',
          scene: { clear: false, add: [] },
          cues: [],
        };
    update((l) => void l.beats.splice(i + 1, 0, fresh));
    setSel(i + 1);
    if (copy) focusSheetTitle();
  };
  const deleteBeat = () => {
    const gone = structuredClone(beat);
    const at = i;
    update((l) => void l.beats.splice(at, 1));
    setSel(Math.max(0, at - 1));
    focusSheetTitle();
    toast({
      text: t('editor.beatDeleted', { n: at + 1 }),
      action: {
        label: t('common.undo'),
        run: () => {
          update((l) => void l.beats.splice(at, 0, gone));
          setSel(at);
        },
      },
    });
  };
  const general = issues.filter((x) => !x.beat);
  const unitTitle =
    detail.unit && (typeof detail.unit.title === 'string' ? detail.unit.title : detail.unit.title[lessonLang]);
  const kicker = [
    detail.chapter ? t('editor.kicker.chapter', { n: detail.chapter }) : '',
    detail.unit ? t('editor.kicker.unit', { n: detail.unit.index }) : '',
    minutes ? t('editor.kicker.minutes', { n: minutes }) : '',
  ].filter(Boolean);
  const waiting = detail.bookLangs.filter((l) => !detail.langs.includes(l));
  // Enter on a beat (or Details): the sheet opens, or takes the focus when it is open already
  const openSheet = () => {
    if (sheetOpen) return focusSheetTitle();
    setFocusSheet(true);
    setInspecting(true);
  };
  const startRegen = async (instruction: string) => {
    setRegenErrors((cur) => ({ ...cur, [beat.id]: '' }));
    try {
      // the new version waits beside the lesson: Compare, then keep one
      const r = await api.startJob(id, 'rewrite', { lesson: lid, beat: beat.id, instruction, candidate: true });
      setRewriting((cur) => ({ ...cur, [beat.id]: r.jobId }));
      // the work runs in the tray, which follows you; the beat comes back when it ends
      jobs.track(id, r.job);
    } catch (e) {
      setRegenErrors((cur) => ({ ...cur, [beat.id]: errorText(e, t) }));
    }
  };

  const cand = detail.candidates?.[beat.id];
  const view = cand && afterBeat === beat.id ? 'after' : 'before';
  const setView = (v: 'before' | 'after') => setAfterBeat(v === 'after' ? beat.id : null);
  // the judge's note where it found something wrong (red pen); a beat it liked carries none
  const verdict = detail.judge?.[beat.id];
  const judged = verdict && (verdict.problem || verdict.fix || verdict.score < 4) ? verdict : undefined;
  const beatMarks = marksOf(beat.narration);
  const withCues = new Set(
    (beat.cues ?? []).flatMap((c) => (typeof c.at === 'object' ? [c.at.mark] : [c.at as string])),
  );
  const listOf = (items: string[]) => {
    try {
      return new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };
  const keepNew = async () => {
    const n = i + 1;
    const bid = beat.id;
    setRegenErrors((cur) => ({ ...cur, [bid]: '' }));
    try {
      const r = await api.acceptBeat(id, lid, bid);
      await load();
      setReloadKey((k) => k + 1);
      setAfterBeat(null);
      toast({
        text: r.langs.length
          ? `${t('editor.replaced', { n })} ${t('editor.retranslate', { langs: listOf(r.langs.map((l) => langName(l))) })}`
          : t('editor.replaced', { n }),
        tone: 'good',
        action: {
          label: t('common.undo'),
          run: () =>
            void (async () => {
              // the edits made since would go with the reload: ask first, as Undo of a save does
              if (
                dirtyRef.current &&
                !(await confirm({
                  title: t('editor.undoKeepTitle'),
                  confirm: t('editor.undoKeep'),
                  cancel: t('leave.stay'),
                  danger: true,
                }))
              )
                return;
              try {
                await api.restoreBeat(id, lid, bid);
                await load();
                setReloadKey((k) => k + 1);
                toast({ text: t('editor.restored') });
              } catch (e) {
                toast({ text: errorText(e, t), tone: 'error' });
              }
            })(),
        },
      });
    } catch (e) {
      setRegenErrors((cur) => ({ ...cur, [bid]: errorText(e, t) }));
    }
  };
  const keepOld = async () => {
    const bid = beat.id;
    try {
      await api.dropCandidate(id, lid, bid);
      setDetail(await api.lesson(id, lid));
      setAfterBeat(null);
    } catch (e) {
      setRegenErrors((cur) => ({ ...cur, [bid]: errorText(e, t) }));
    }
  };

  return (
    <div className="page page-lesson">
      <header className="lesson-head">
        <div className="lesson-title">
          {kicker.length > 0 && (
            <p className="lesson-kicker" title={unitTitle || undefined}>
              {kicker.join(' · ')}
            </p>
          )}
          <h1 className="display" lang={lessonLang}>
            <bdi>{lesson.title}</bdi>
          </h1>
        </div>
        <div className="lesson-tools">
          <div className="preview-in">
            <span className="muted small" aria-hidden="true">
              {t('editor.previewIn')}
            </span>
            <Menu
              label={t('editor.previewInLang', { lang: langName(shown) })}
              className="preview-lang"
              button={
                <>
                  <span lang={shown}>{langName(shown)}</span>
                  <Icon name="next" size={16} className="menu-chevron" />
                </>
              }
              items={[
                ...detail.langs.map((l) => ({
                  key: l,
                  label: <span lang={l}>{langName(l)}</span>,
                  checked: l === shown,
                  onSelect: () => setPreviewLang(l),
                })),
                ...waiting.map((l) => ({
                  key: l,
                  label: (
                    <span className="menu-waiting">
                      <span lang={l}>{langName(l)}</span>
                      <span className="small muted">{t('editor.notTranslated')}</span>
                    </span>
                  ),
                  checked: false,
                  disabled: true,
                })),
              ]}
            />
          </div>
          {/* the toast announces a save; this line only shows the state */}
          <div className="save-state">
            {saving ? (
              <>
                <span className="spinner" aria-hidden="true" /> {t('common.saving')}
              </>
            ) : dirty ? (
              <span className="dirty">{t('common.unsaved')}</span>
            ) : (
              <>
                <Icon name="check" size={18} className="good" />{' '}
                {savedAt
                  ? t('editor.savedAt', {
                      time: new Intl.DateTimeFormat(i18n.locale, { timeStyle: 'short' }).format(savedAt),
                    })
                  : t('common.saved')}
              </>
            )}
          </div>
          {blocked > 0 && (
            <Button variant="danger" onClick={() => void save(true)}>
              {t('editor.saveAnyway')}
            </Button>
          )}
          {/* it stays in place when there is nothing to save (aria-disabled keeps the focus on it) */}
          <Button
            variant={dirty ? 'primary' : 'default'}
            busy={saving}
            aria-disabled={!dirty || undefined}
            className={dirty ? '' : 'is-idle'}
            onClick={() => dirty && void save()}
            aria-keyshortcuts="Control+S Meta+S"
          >
            {t('editor.save')}
          </Button>
          <Button icon="fullscreen" className="lift-btn" title={t('editor.lift')} onClick={() => stage.current?.lift()}>
            {t('editor.preview')}
          </Button>
        </div>
      </header>
      {blocked > 0 && <Notice tone="warn">{t('editor.blocked', { n: blocked })}</Notice>}
      {saveError && (
        <Notice
          tone="error"
          action={
            <Button onClick={() => void save()} disabled={saving}>
              {t('common.retry')}
            </Button>
          }
        >
          {/* (a reason that is its own sentence loses its full stop inside this one) */}
          {t('editor.saveFailed', { error: saveError.replace(/[.。]$/, '') })}
        </Notice>
      )}

      <div className="editor-work">
        <BeatList
          beats={beats}
          sel={i}
          lang={lessonLang}
          issues={byBeat}
          {...(minutes ? { minutes } : {})}
          onSelect={setSel}
          onOpen={openSheet}
          onMove={move}
          onAdd={() => addBeat()}
        />
        <div className="editor-main">
          <div className="beat-bar">
            <BeatHead
              index={i}
              title={beat.title}
              lang={lessonLang}
              {...(timeOf(beat) ? { time: timeOf(beat) } : {})}
              playerRef={playerRef}
            />
            <span className="beat-bar-end">
              <label className="check">
                <input
                  type="checkbox"
                  checked={threads}
                  onChange={(e) => {
                    setThreads(e.target.checked);
                    try {
                      localStorage.setItem('warqa-studio:threads', e.target.checked ? '1' : '0');
                    } catch {
                      /* storage unavailable */
                    }
                  }}
                />
                <span>{t('editor.showThreads')}</span>
              </label>
              <Button
                ref={detailsBtn}
                variant="quiet"
                icon="edit"
                aria-expanded={sheetOpen}
                onClick={() => (sheetOpen ? setInspecting(false) : openSheet())}
              >
                {t('editor.details', { n: i + 1 })}
              </Button>
            </span>
          </div>
          <Stage
            ref={stage}
            id={id}
            lid={lid}
            bookId={detail.bookId}
            lang={shown}
            beat={i}
            reloadKey={reloadKey}
            stale={dirty}
            label={t('editor.stageLabel', { n: i + 1 })}
            strip={detail.chapter ? t('editor.kicker.chapter', { n: detail.chapter }) : String(lesson.title)}
            langName={langName(shown)}
            playerRef={playerRef}
            onBeat={(k) => {
              if (k !== i) setSel(k);
            }}
            onData={(d) => {
              setTimings(d.timings);
              setAudio(d.audio);
            }}
            candidate={view === 'after' && cand ? beat.id : undefined}
            zoneRef={zoneRef}
            below={
              view === 'after' && cand ? null : (
                <MarkTimeline
                  {...(timeOf(beat) ? { time: timeOf(beat) } : {})}
                  marks={beatMarks}
                  withCues={withCues}
                  selMark={selMark}
                  onSelect={(m, at) => {
                    setSelMark(m);
                    // the stage just after that mark's cues have played
                    playerRef.current?.showAt(i, at + 0.7);
                  }}
                  playerRef={playerRef}
                  beat={i}
                  lang={shown}
                />
              )
            }
            overlay={
              threads && !(view === 'after' && cand) ? (
                <Threads
                  zoneRef={zoneRef}
                  playerRef={playerRef}
                  beat={beat}
                  index={i}
                  selMark={selMark}
                  actionName={actionName}
                />
              ) : null
            }
          >
            {judged && !(view === 'after' && cand) && (
              <JudgeNote
                {...judged}
                compact={!!selMark && threads}
                onUse={(note) => {
                  setInstructions((cur) => ({ ...cur, [beat.id]: note }));
                  setFocusSheet(true);
                  setInspecting(true);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('.beat-sheet .regen textarea')?.focus(),
                  );
                }}
              />
            )}
            {rewriting[beat.id] && <Writing n={i + 1} />}
          </Stage>
          <NarrationBox
            beat={beat}
            lang={lessonLang}
            {...(timeOf(beat, lessonLang) ? { time: timeOf(beat, lessonLang) } : {})}
            {...(audio[lessonLang]?.[beat.id] ? { audio: audio[lessonLang]![beat.id]! } : {})}
            selMark={selMark}
            onSelectMark={setSelMark}
            onChange={(s) => updateBeat((b) => void (b.narration = s))}
          />
          {!!general.length && (
            <section className="lesson-issues" aria-labelledby="lesson-issues">
              <h2 id="lesson-issues" className="small-title">
                {t('editor.lessonIssues')}
              </h2>
              <IssueList issues={general} />
            </section>
          )}
        </div>
        <SideSheet
          open={sheetOpen}
          // on a phone the stage stays in view above it; the handle takes it to full height
          snap="half"
          onClose={() => {
            setFocusSheet(false);
            setInspecting(false);
          }}
          title={
            <>
              <span className="insp-count mono">{t('editor.beatOf', { i: num(i + 1), n: num(beats.length) })}</span>
              <bdi lang={lessonLang} dir="auto" className="insp-name">
                {beat.title}
              </bdi>
            </>
          }
          className="beat-sheet"
          takeFocus={focusSheet}
          returnFocus={() => detailsBtn.current}
        >
          <Inspector
            // by its place: editing the beat's id (Edit as JSON) keeps the inspector as it is
            key={i}
            beat={beat}
            index={i}
            lessonLang={lessonLang}
            langs={detail.bookLangs.filter((l) => l !== lessonLang)}
            moves={detail.moves}
            issues={byBeat.get(beat.id) ?? []}
            catalog={catalog}
            parts={parts[beat.id] ?? []}
            allIds={beats.flatMap((b) => b.scene?.add?.map((n) => n.id) ?? [])}
            allQuestionIds={beats.flatMap((b) => ((b.questions ?? []) as { id?: string }[]).map((q) => q.id ?? ''))}
            update={updateBeat}
            replace={(b) => {
              if (b.id !== beat.id) renameKeys('beat', beat.id, b.id);
              update((l) => void (l.beats[i] = b));
            }}
            renameNode={(from, to) => {
              renameKeys('node', from, to);
              update((l) => renameNode(l, i, from, to));
            }}
            moveKeys={moveKeys}
            renameKeys={renameKeys}
            onGoTo={setSel}
            regen={{
              busy: !!rewriting[beat.id],
              error: regenErrors[beat.id] ?? '',
              disabled: dirty,
              ...(detail.rewriteUsd !== undefined
                ? { cost: t('learn.est.cost', { cost: i18n.usd(detail.rewriteUsd) }) }
                : {}),
              instruction: instructions[beat.id] ?? '',
              setInstruction: (v) => setInstructions((cur) => ({ ...cur, [beat.id]: v })),
              start: startRegen,
              book: bookInfo,
            }}
            {...(cand
              ? {
                  compare: {
                    narration: String((cand.beat as { narration?: string } | undefined)?.narration ?? ''),
                    ...(cand.instruction ? { instruction: cand.instruction } : {}),
                    view,
                    setView,
                    keepNew: () => void keepNew(),
                    keepOld: () => void keepOld(),
                    ...(cand.changed ? { changed: true } : {}),
                    ...(regenErrors[beat.id] ? { error: regenErrors[beat.id] } : {}),
                    again: () => void startRegen(cand.instruction ?? instructions[beat.id] ?? ''),
                    disabled: dirty || !!rewriting[beat.id],
                    book: bookInfo,
                  },
                }
              : {})}
            selMark={selMark}
            onSelectMark={setSelMark}
            onDuplicate={() => addBeat(beat)}
            onDelete={deleteBeat}
            canDelete={beats.length > 1}
          />
        </SideSheet>
      </div>
    </div>
  );
}
