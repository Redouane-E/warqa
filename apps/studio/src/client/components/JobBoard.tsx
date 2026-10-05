// The activity tray: follows a job over SSE (its stages, per-beat progress and log) from any screen. Making lessons
// gets its own view: the chapter, its four stages, the beats as they are written and the money against the estimate.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvent, JobInfo, JobStatus, JobType } from '../../shared/types';
import { api } from '../api';
import { withBase } from '../base';
import { type I18n, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { navigate } from '../router';
import { type ToastOptions, useToast } from './overlays';
import { Button, Icon } from './ui';

const STAGES = [
  'read',
  'plan',
  'storyboard',
  'write',
  'translate',
  'narrate',
  'export',
  'rewrite',
  'qa',
  'improve',
  'geo',
  'panel',
];

export function stageLabel(stage: string, i18n: I18n): string {
  const [base, lang] = stage.split(':');
  const name = base && STAGES.includes(base) ? i18n.t(`stage.${base}` as MsgKey) : stage;
  return lang ? `${name} · ${lang.toUpperCase()}` : name;
}

export const jobLabel = (type: JobType, i18n: I18n) => i18n.t(`job.type.${type}` as MsgKey);

const OVER: JobStatus[] = ['done', 'error', 'cancelled'];

export function useJobStream(jobId: string | null, onEnd?: (job: JobInfo, events: JobEvent[]) => void) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  // every event so far, as they arrive: the end may come before React has shown the last ones
  const all = useRef<JobEvent[]>([]);
  const [info, setInfo] = useState<JobInfo | null>(null);
  const [lost, setLost] = useState(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    all.current = [];
    setEvents([]);
    setInfo(null);
    setLost(false);
    if (!jobId) return;
    let closed = false;
    void api
      .job(jobId)
      .then((r) => !closed && setInfo(r.job))
      .catch(() => {});
    const es = new EventSource(withBase(`/api/jobs/${jobId}/events`));
    const add = (m: MessageEvent<string>) => {
      const e = JSON.parse(m.data) as JobEvent;
      setLost(false);
      const cur = all.current;
      if (!cur.length || cur[cur.length - 1]!.seq < e.seq) all.current = [...cur, e];
      setEvents(all.current);
      if (e.kind === 'status' && e.jobStatus) setInfo((cur) => (cur ? { ...cur, status: e.jobStatus! } : cur));
    };
    for (const k of ['status', 'progress', 'log', 'result', 'error']) es.addEventListener(k, add as EventListener);
    es.addEventListener('end', ((m: MessageEvent<string>) => {
      es.close();
      closed = true;
      const job = JSON.parse(m.data) as JobInfo;
      setInfo(job);
      endRef.current?.(job, all.current);
    }) as EventListener);
    es.onerror = () => {
      if (!closed) setLost(true);
    };
    return () => {
      closed = true;
      es.close();
    };
  }, [jobId]);

  return { events, info, lost };
}

interface Row {
  key: string;
  chapter?: string;
  stage: string;
  status: string;
  detail?: string;
  index?: number;
  total?: number;
}

function rowsOf(events: JobEvent[]): Row[] {
  const rows = new Map<string, Row>();
  for (const e of events) {
    if (e.kind !== 'progress' || !e.stage || e.stage === 'chapter') continue;
    const key = `${e.chapter ?? ''}|${e.stage}`;
    const prev = rows.get(key);
    rows.set(key, {
      key,
      ...(e.chapter ? { chapter: e.chapter } : {}),
      stage: e.stage,
      status: e.status ?? 'start',
      ...(e.detail !== undefined ? { detail: e.detail } : prev?.detail !== undefined ? { detail: prev.detail } : {}),
      ...(e.index !== undefined
        ? { index: e.index, total: e.total }
        : prev?.index !== undefined
          ? { index: prev.index, total: prev.total }
          : {}),
    });
  }
  return [...rows.values()];
}

function RowView({ r, live }: { r: Row; live: boolean }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const pct = r.total ? Math.round((((r.index ?? 0) + 1) * 100) / r.total) : 0;
  const state = r.status === 'beat' ? 'running' : r.status === 'start' ? (live ? 'running' : 'stopped') : r.status;
  return (
    <li className={`job-row is-${state}`}>
      <span className="job-row-icon" aria-hidden="true">
        {state === 'done' ? (
          <Icon name="check" size={16} />
        ) : state === 'error' ? (
          <Icon name="close" size={16} />
        ) : state === 'skip' ? (
          '·'
        ) : state === 'running' ? (
          <span className="run-dot" />
        ) : (
          '–'
        )}
      </span>
      <span className="job-row-name">
        {r.chapter && <span className="job-chapter">{r.chapter}</span>}
        {stageLabel(r.stage, i18n)}
      </span>
      <span className="job-row-detail">
        {r.status === 'beat' && r.total ? (
          <>
            <span
              className="bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={r.total}
              aria-valuenow={(r.index ?? 0) + 1}
              aria-label={stageLabel(r.stage, i18n)}
            >
              <span style={{ inlineSize: `${pct}%` }} />
            </span>
            <span className="num">
              {num((r.index ?? 0) + 1)}/{num(r.total)}
            </span>
          </>
        ) : r.status === 'skip' ? (
          t('job.skip')
        ) : (
          <bdi>{r.detail}</bdi>
        )}
      </span>
    </li>
  );
}

/* ---------- making lessons: what a build job has done so far ---------- */

type StageState = 'waiting' | 'running' | 'done' | 'error';

export interface ChapterRun {
  id: string;
  /** Its number in the plan, its title, what it should cost and the book's limit (the job's chapter events). */
  n?: number;
  title?: string;
  estimate?: number;
  limit?: number;
  /** The job's spend when the chapter started, and now: what this chapter has cost so far. */
  usd0: number;
  usd: number;
  storyboard: StageState;
  /** Beats in its storyboard. */
  planned?: number;
  write: StageState;
  /** The last beat written (1-based) of how many. */
  beat?: { i: number; n: number };
  beats: { i: number; title: string }[];
  translate: { lang: string; state: StageState }[];
  narrate: { lang: string; state: StageState }[];
  done: boolean;
}

export interface BuildProgress {
  chapters: ChapterRun[];
  current?: ChapterRun;
  /** Chapters in the job (0 until the first chapter event). */
  count: number;
  spent: number;
  /** Overall, 0–100: storyboard to 10 %, the beats to 80 %, then translation and voices. */
  pct: number;
}

const stateOf = (status: string | undefined): StageState =>
  status === 'done' || status === 'skip' ? 'done' : status === 'error' ? 'error' : 'running';

export function buildProgress(events: JobEvent[]): BuildProgress {
  const map = new Map<string, ChapterRun>();
  let spent = 0;
  let count = 0;
  for (const e of events) {
    if (typeof e.usd === 'number') spent = e.usd;
    if (e.kind !== 'progress' || !e.stage || !e.chapter) continue;
    let c = map.get(e.chapter);
    if (!c) {
      c = {
        id: e.chapter,
        usd0: e.usd ?? spent,
        usd: e.usd ?? spent,
        storyboard: 'waiting',
        write: 'waiting',
        beats: [],
        translate: [],
        narrate: [],
        done: false,
      };
      map.set(e.chapter, c);
    }
    if (typeof e.usd === 'number') c.usd = e.usd;
    const [stage, lang] = e.stage.split(':');
    if (stage === 'chapter') {
      if (e.detail) c.title = e.detail;
      if (e.n) c.n = e.n;
      if (e.estimate !== undefined) c.estimate = e.estimate;
      if (e.limit !== undefined) c.limit = e.limit;
      if (e.total) count = e.total;
      if (e.status === 'done') c.done = true;
    } else if (stage === 'storyboard') {
      c.storyboard = stateOf(e.status);
      const planned = /\d+/.exec(e.detail ?? '')?.[0];
      if (e.status === 'done' && planned) c.planned = Number(planned);
    } else if (stage === 'write') {
      c.write = e.status === 'beat' ? 'running' : stateOf(e.status);
      if (e.status === 'beat' && typeof e.index === 'number' && e.total) {
        c.beat = { i: e.index + 1, n: e.total };
        c.planned ??= e.total;
        if (!c.beats.some((b) => b.i === e.index! + 1)) c.beats.push({ i: e.index + 1, title: e.title ?? '' });
      }
    } else if ((stage === 'translate' || stage === 'narrate') && lang) {
      const list = c[stage];
      const row = list.find((x) => x.lang === lang);
      if (row) row.state = stateOf(e.status);
      else list.push({ lang, state: stateOf(e.status) });
    }
  }
  const chapters = [...map.values()];
  for (const c of chapters) c.beats.sort((a, b) => a.i - b.i);
  const part = (c: ChapterRun) =>
    c.done
      ? 1
      : c.narrate.length
        ? 0.95
        : c.translate.length
          ? 0.86
          : c.write === 'done'
            ? 0.8
            : c.beat
              ? 0.1 + (0.7 * c.beat.i) / c.beat.n
              : c.storyboard === 'done'
                ? 0.1
                : c.storyboard === 'running'
                  ? 0.03
                  : 0;
  const of = Math.max(count, chapters.length, 1);
  const pct = Math.min(100, Math.round((chapters.reduce((a, c) => a + part(c), 0) * 100) / of));
  return { chapters, current: chapters[chapters.length - 1], count, spent, pct };
}

/** The beat being written now (the one after the last written), and how many there are. */
export function writingBeat(c: ChapterRun): { i: number; n: number } | undefined {
  const n = c.beat?.n ?? c.planned;
  return n ? { i: Math.min((c.beat?.i ?? 0) + 1, n), n } : undefined;
}

const shown = (s: StageState, live: boolean): StageState | 'stopped' => (s === 'running' && !live ? 'stopped' : s);

/** Making lessons in the tray: the chapter's four stages, the beats as they are written, the money so far. */
function BuildView({ prog, live, narrate }: { prog: BuildProgress; live: boolean; narrate: boolean }) {
  const { t, num, usd } = useI18n();
  const c = prog.current;
  if (!c) return null;
  const now = live && c.write === 'running' ? writingBeat(c) : undefined;
  const codes = (l: { lang: string }[]) => l.map((x) => x.lang.toUpperCase()).join(' · ');
  const many = (l: { state: StageState }[], fallback: StageState): StageState =>
    !l.length
      ? fallback
      : l.some((x) => x.state === 'running')
        ? 'running'
        : l.some((x) => x.state === 'error')
          ? 'error'
          : 'done';
  // a stage the chapter didn't need (one language, no voices asked) reads "—" once the chapter is made
  const after = c.done ? 'done' : 'waiting';
  const waiting = t('tray.waiting');
  const stages: { key: string; state: StageState; name: string; sub: string; bar?: { i: number; n: number } }[] = [
    {
      key: 'storyboard',
      state: c.storyboard,
      name: t('stage.storyboard'),
      sub:
        c.storyboard === 'done' && c.planned
          ? t('tray.planned', { beats: t('common.beats', { n: c.planned }) })
          : c.storyboard === 'waiting'
            ? waiting
            : '',
    },
    {
      key: 'write',
      state: c.write,
      name: t('stage.write'),
      sub: now
        ? t('tray.beatOf', { i: now.i, n: now.n })
        : c.write === 'done' && c.planned
          ? t('common.beats', { n: c.planned })
          : c.write === 'waiting'
            ? waiting
            : c.beat
              ? t('tray.beatOf', { i: c.beat.i, n: c.beat.n })
              : '',
      ...(c.write === 'running' && c.beat ? { bar: c.beat } : {}),
    },
    {
      key: 'translate',
      state: many(c.translate, after),
      name: t('stage.translate'),
      sub: c.translate.length ? codes(c.translate) : c.done ? '—' : waiting,
    },
    ...(narrate
      ? [
          {
            key: 'narrate',
            state: many(c.narrate, after),
            name: t('stage.narrate'),
            sub: c.narrate.length ? codes(c.narrate) : c.done ? '—' : waiting,
          },
        ]
      : []),
  ];
  // the beats to come: the one being written, the next, then the rest as one tile ("09–14")
  const next = now ? now.i + 1 : 0;
  const here = Math.max(0, c.usd - c.usd0);
  return (
    <div className="build-view">
      <ol className="build-stages" aria-label={t('tray.stages')}>
        {stages.map((st) => {
          const state = shown(st.state, live);
          return (
            <li
              key={st.key}
              className={`build-stage is-${state}`}
              aria-current={state === 'running' ? 'step' : undefined}
            >
              <span className="build-stage-head">
                <span className="build-stage-mark" aria-hidden="true">
                  {state === 'done' ? (
                    <Icon name="check" size={14} />
                  ) : state === 'running' ? (
                    <i />
                  ) : state === 'stopped' ? (
                    <Icon name="stop" size={12} />
                  ) : state === 'error' ? (
                    <Icon name="close" size={14} />
                  ) : null}
                </span>
                <span className="build-stage-name">{st.name}</span>
              </span>
              {st.bar && (
                <span
                  className="bar"
                  role="progressbar"
                  aria-label={st.name}
                  aria-valuemin={0}
                  aria-valuemax={st.bar.n}
                  aria-valuenow={st.bar.i}
                >
                  <span style={{ inlineSize: `${Math.round((st.bar.i * 100) / st.bar.n)}%` }} />
                </span>
              )}
              {st.sub && <span className="build-stage-sub">{st.sub}</span>}
            </li>
          );
        })}
      </ol>
      {(c.beats.length > 0 || now) && (
        <section className="build-beats" aria-labelledby="tray-beats">
          <h3 id="tray-beats" className="build-beats-title">
            {t('tray.beats')}
          </h3>
          <ol className="beat-tiles build-tiles">
            {c.beats.map((b) => (
              <li key={b.i}>
                <span className="beat-thumb" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="beat-cap">
                  <span className="mono">{num(b.i)}</span> <bdi>{b.title}</bdi>
                </span>
              </li>
            ))}
            {now && now.i > (c.beat?.i ?? 0) && (
              <li className="is-now">
                <span className="beat-thumb" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="beat-cap">
                  <span className="mono">{num(now.i)}</span> {t('tray.writing')}
                </span>
              </li>
            )}
            {now && next <= now.n && (
              <li className="is-todo" aria-hidden="true">
                <span className="beat-thumb" />
                <span className="beat-cap mono">{num(next)}</span>
              </li>
            )}
            {now && next < now.n && (
              <li className="is-todo" aria-hidden="true">
                <span className="beat-thumb" />
                <span className="beat-cap mono">
                  {next + 1 === now.n ? num(now.n) : `${num(next + 1)}–${num(now.n)}`}
                </span>
              </li>
            )}
          </ol>
        </section>
      )}
      <div className="build-money">
        {c.estimate ? (
          <span
            className="bar build-meter"
            role="img"
            aria-label={t('tray.meter', { spent: usd(here), estimate: usd(c.estimate) })}
          >
            <span style={{ inlineSize: `${Math.min(100, Math.round((here * 100) / c.estimate))}%` }} />
          </span>
        ) : null}
        <p>
          <strong className="mono">{usd(here)}</strong> {t('tray.soFar')}
          {c.estimate !== undefined && <> · {t('tray.aboutChapter', { cost: usd(c.estimate) })}</>}
          {c.limit !== undefined && <> · {t('tray.limit', { limit: usd(c.limit) })}</>}
        </p>
        {live && <p className="hint">{t('tray.stopKeeps')}</p>}
      </div>
    </div>
  );
}

/** The toast when a build the tray followed ends: the chapter made ("Open" goes to the editor), or where it stopped. */
function buildToast(
  job: JobInfo,
  events: JobEvent[],
  projectId: string,
  i18n: I18n,
  openTray: () => void,
): ToastOptions | null {
  const { t, usd } = i18n;
  const at = (path: string) => () => navigate(`/project/${encodeURIComponent(projectId)}${path}`);
  const made = (job.result as { chapters?: { chapter: string; n?: number; beats?: number; usd: number }[] } | undefined)
    ?.chapters;
  if (job.status === 'done' && made?.length) {
    const cost = usd(made.reduce((a, c) => a + c.usd, 0));
    const one = made.length === 1 ? made[0]! : undefined;
    return one
      ? {
          text: t('tray.toastMade', { n: one.n ?? 0, beats: t('common.beats', { n: one.beats ?? 0 }), cost }),
          tone: 'good',
          action: { label: t('tray.open'), run: at(`/lesson/${encodeURIComponent(one.chapter)}`) },
        }
      : {
          text: `${t('tray.madeMany', { n: made.length })} · ${cost}`,
          tone: 'good',
          action: { label: t('tray.open'), run: at('?step=make') },
        };
  }
  const c = job.status === 'cancelled' ? buildProgress(events).current : undefined;
  if (c?.beat && !c.done && c.write !== 'done')
    return {
      text: t('tray.toastStopped', { b: c.beat.i }),
      tone: 'info',
      action: { label: t('tray.open'), run: openTray },
    };
  return null;
}

type View = 'hidden' | 'open' | 'pill';

interface Tracked {
  projectId: string;
  jobId: string;
}

interface Jobs {
  /** Follow a job: the tray opens (once per job) and stays with you from screen to screen. */
  track(projectId: string, job: JobInfo): void;
  /** Called when a job of this book ends (the book's screen reloads). */
  onEnd(projectId: string, fn: (job: JobInfo) => void): () => void;
  /** Open the tray (the spend chip, Go to). */
  show(): void;
  current: Tracked | null;
}

const JobsContext = createContext<Jobs>({
  track: () => {},
  onEnd: () => () => {},
  show: () => {},
  current: null,
});
export const useJobs = () => useContext(JobsContext);

/**
 * The tray: work that runs sinks to the bottom of the window and follows you. Hidden → open (once per job, at
 * most 45 % of the height) → a pill in the bottom corner when hidden ("Making lessons · 43 %") → done (a toast
 * with Open). Hide never stops the work; only Stop does.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const i18n = useI18n();
  const toast = useToast();
  const [current, setCurrent] = useState<Tracked | null>(null);
  const [view, setView] = useState<View>('hidden');
  const listeners = useRef(new Map<string, Set<(job: JobInfo) => void>>());
  const viewRef = useRef(view);
  viewRef.current = view;
  const currentRef = useRef(current);
  currentRef.current = current;
  // jobs followed while they ran: only their end is news (an earlier job opened from the list ends at once)
  const liveIds = useRef(new Set<string>());

  const end = useCallback(
    (job: JobInfo, events: JobEvent[]) => {
      if (!liveIds.current.delete(job.id)) return;
      const projectId = currentRef.current?.projectId;
      if (projectId) for (const fn of listeners.current.get(projectId) ?? []) fn(job);
      if (job.type === 'estimate') return;
      // done: the tray folds to its pill (a check) so the screen is free again, unless you are working in it
      const inTray = !!document.activeElement?.closest('.tray');
      if (viewRef.current === 'open' && inTray) return;
      if (viewRef.current === 'open') setView('pill');
      const made =
        job.type === 'build' && projectId ? buildToast(job, events, projectId, i18n, () => setView('open')) : null;
      toast(
        made ?? {
          text: `${jobLabel(job.type, i18n)} · ${i18n.t(`job.status.${job.status}` as MsgKey)}`,
          tone: job.status === 'error' ? 'error' : job.status === 'done' ? 'good' : 'info',
          action: { label: i18n.t('tray.open'), run: () => setView('open') },
        },
      );
    },
    [toast, i18n],
  );
  const stream = useJobStream(current?.jobId ?? null, end);

  const value = useMemo<Jobs>(
    () => ({
      track: (projectId, job) => {
        if (job.status === 'running' || job.status === 'queued') liveIds.current.add(job.id);
        setCurrent((cur) => {
          if (cur?.jobId !== job.id) setView(job.type === 'estimate' ? 'pill' : 'open');
          return { projectId, jobId: job.id };
        });
      },
      onEnd: (projectId, fn) => {
        const set = listeners.current.get(projectId) ?? new Set();
        set.add(fn);
        listeners.current.set(projectId, set);
        return () => set.delete(fn);
      },
      show: () => setView('open'),
      current,
    }),
    [current],
  );

  return (
    <JobsContext.Provider value={value}>
      {children}
      {current && view !== 'hidden' && (
        <Tray
          tracked={current}
          stream={stream}
          view={view}
          setView={setView}
          onSelect={(jobId) => setCurrent({ projectId: current.projectId, jobId })}
          onStart={(job) => value.track(current.projectId, job)}
        />
      )}
    </JobsContext.Provider>
  );
}

function Tray({
  tracked,
  stream,
  view,
  setView,
  onSelect,
  onStart,
}: {
  tracked: Tracked;
  stream: ReturnType<typeof useJobStream>;
  view: View;
  setView: (v: View) => void;
  onSelect: (jobId: string) => void;
  /** A job started from the tray (Make the rest). */
  onStart: (job: JobInfo) => void;
}) {
  const i18n = useI18n();
  const { t, ago, num, usd } = i18n;
  const toast = useToast();
  const { events, info, lost } = stream;
  const jobId = tracked.jobId;
  const logRef = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => rowsOf(events), [events]);
  const lines = useMemo(() => events.filter((e) => e.kind === 'log' || e.kind === 'error').slice(-200), [events]);
  const result = events.find((e) => e.kind === 'result')?.result as { url?: string } | undefined;
  const spent = [...events].reverse().find((e) => typeof e.usd === 'number')?.usd;
  const status = info?.status ?? 'queued';
  const live = status === 'running' || status === 'queued';
  const [stopping, setStopping] = useState(false);
  const [earlier, setEarlier] = useState<JobInfo[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another job is shown
  useEffect(() => setStopping(false), [jobId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh the list when the job changes or ends
  useEffect(() => {
    if (view !== 'open') return;
    api
      .jobs(tracked.projectId)
      .then((r) => setEarlier(r.jobs.filter((j) => j.id !== jobId).slice(0, 6)))
      .catch(() => setEarlier([]));
  }, [view, jobId, tracked.projectId, status]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the log when a line arrives
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  // the page keeps room under its last line for the tray, so the tray never hides a button for good
  const keepClear = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--tray-space', `${el.offsetHeight + 16}px`);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => {
      ro.disconnect();
      root.style.removeProperty('--tray-space');
    };
  }, []);

  const latest = rows[rows.length - 1];
  const prog = useMemo(() => (info?.type === 'build' ? buildProgress(events) : null), [info?.type, events]);
  const cur = prog?.current;
  const pct =
    prog && cur ? prog.pct : latest?.total ? Math.round((((latest.index ?? 0) + 1) * 100) / latest.total) : undefined;
  // making lessons says which chapter: "Making chapter 6 · Integers in daily life", "Chapter 6 is made"
  const madeTitle =
    prog && cur && prog.count > 1 ? t('tray.madeMany', { n: prog.count }) : t('tray.made', { n: cur?.n ?? 0 });
  // "Stopped after beat 4" only when the writing itself was cut short
  const stoppedAt = status === 'cancelled' && cur?.beat && !cur.done && cur.write !== 'done' ? cur.beat.i : undefined;
  const title: ReactNode =
    prog && cur ? (
      status === 'done' ? (
        madeTitle
      ) : stoppedAt ? (
        t('tray.stoppedAt', { b: stoppedAt })
      ) : status === 'cancelled' ? (
        t('tray.stoppedCh', { n: cur.n ?? 0 })
      ) : status === 'error' ? (
        t('tray.failedCh', { n: cur.n ?? 0 })
      ) : (
        <>
          {t('tray.makingN', { n: cur.n ?? 0 })}
          {cur.title && (
            <>
              {' · '}
              <bdi>{cur.title}</bdi>
            </>
          )}
        </>
      )
    ) : info ? (
      jobLabel(info.type, i18n)
    ) : (
      t('job.title')
    );
  const summary =
    prog && cur
      ? [
          live
            ? t('tray.pillMaking', { n: cur.n ?? 0 })
            : status === 'done'
              ? madeTitle
              : status === 'cancelled'
                ? t('tray.pillStopped', { n: cur.n ?? 0 })
                : `${jobLabel('build', i18n)} · ${t(`job.status.${status}` as MsgKey)}`,
          live ? `${num(prog.pct)} %` : '',
          prog.spent ? usd(prog.spent) : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : [
          info ? jobLabel(info.type, i18n) : t('job.title'),
          pct !== undefined && live ? `${num(pct)} %` : !live ? t(`job.status.${status}` as MsgKey) : '',
          spent ? usd(spent) : '',
        ]
          .filter(Boolean)
          .join(' · ');
  // a build stopped partway goes on from its last written beat (no force: the beats written are kept); a Stop
  // taken once every chapter was made leaves nothing to go on with
  const asked = info && Array.isArray(info.args.chapters) ? (info.args.chapters as string[]) : undefined;
  const restLeft = asked
    ? asked.some((id) => !prog?.chapters.find((c) => c.id === id)?.done)
    : !prog?.chapters.length || prog.chapters.some((c) => !c.done);
  const makeRest = async () => {
    if (!info) return;
    const left = asked?.filter((id) => !prog?.chapters.find((c) => c.id === id)?.done);
    const { force: _force, chapters: _chapters, ...args } = info.args;
    try {
      const r = await api.startJob(tracked.projectId, 'build', { ...args, ...(left ? { chapters: left } : {}) });
      onStart(r.job);
    } catch (e) {
      toast({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  };

  if (view === 'pill')
    return (
      <div className={`tray-pill is-${status}`} ref={keepClear}>
        {/* its name is what it shows ("Making lessons · 43 %"); the tooltip says what a click does */}
        <button type="button" className="tray-pill-open" onClick={() => setView('open')} title={t('tray.show')}>
          <span className="tray-dot" aria-hidden="true">
            {status === 'done' ? (
              <Icon name="check" size={14} />
            ) : status === 'error' ? (
              <Icon name="close" size={14} />
            ) : status === 'cancelled' ? (
              <Icon name="stop" size={10} />
            ) : null}
          </span>
          <span className="tray-pill-text">{summary}</span>
          {/* on a phone the pill is a peek bar along the bottom, with the progress under its line */}
          {live && pct !== undefined && (
            <span className="tray-pill-bar" aria-hidden="true">
              <span style={{ inlineSize: `${pct}%` }} />
            </span>
          )}
        </button>
        {!live && (
          <button
            type="button"
            className="tray-pill-close"
            aria-label={t('common.close')}
            onClick={() => setView('hidden')}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    );

  return (
    <section className={`tray${prog ? ' tray-build' : ''}`} aria-labelledby="tray-title" ref={keepClear}>
      <header className="tray-head">
        {/* phones: the open tray is a bottom sheet; its handle folds it to the peek bar */}
        <button
          type="button"
          className="tray-grab"
          aria-label={t('tray.fold')}
          aria-expanded="true"
          onClick={() => setView('pill')}
        >
          <span />
        </button>
        <h2 id="tray-title">
          {title}
          {prog && cur ? (
            live && prog.count > 1 ? (
              <span className="tray-args">
                {' · '}
                {t('tray.ofCount', { i: prog.chapters.indexOf(cur) + 1, n: prog.count })}
              </span>
            ) : null
          ) : info && Array.isArray(info.args.chapters) && info.args.chapters.length ? (
            <span className="tray-args"> · {(info.args.chapters as string[]).join(', ')}</span>
          ) : null}
          {info && typeof info.args.lang === 'string' ? (
            <span className="tray-args"> · {info.args.lang.toUpperCase()}</span>
          ) : null}
        </h2>
        <span className={`pill pill-${status}`}>{t(`job.status.${status}` as MsgKey)}</span>
        {spent ? <span className="tray-money">{usd(spent)}</span> : null}
        <span className="tray-tools">
          {prog && status === 'cancelled' && restLeft && (
            <Button variant="primary" icon="play" onClick={() => void makeRest()}>
              {t('make.rest')}
            </Button>
          )}
          {live && (
            <button
              type="button"
              className="btn btn-default tray-stop"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void api.cancelJob(jobId);
              }}
            >
              <Icon name="stop" size={16} /> <span>{stopping ? t('job.stopping') : t('job.stop')}</span>
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => setView('pill')}>
            <Icon name="down" size={16} /> <span>{t('tray.hide')}</span>
          </button>
          {!live && (
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setView('hidden')}>
              <Icon name="close" />
            </button>
          )}
        </span>
      </header>
      <div className="tray-body">
        {live && !prog && <p className="tray-note">{t('tray.keeps')}</p>}
        {status === 'queued' && <p className="tray-note">{t('job.queued')}</p>}
        {lost && live && <p className="tray-note">{t('job.reconnecting')}</p>}
        <p className="visually-hidden" aria-live="polite">
          {latest
            ? `${stageLabel(latest.stage, i18n)} ${latest.status === 'beat' ? `${(latest.index ?? 0) + 1}/${latest.total}` : ''}`
            : ''}
          {!live ? ` ${t(`job.status.${status}` as MsgKey)}` : ''}
        </p>
        {prog && cur ? (
          <BuildView prog={prog} live={live} narrate={info?.args.narrate !== false} />
        ) : (
          !!rows.length && (
            <ol className="job-rows">
              {rows.map((r) => (
                <RowView key={r.key} r={r} live={live} />
              ))}
            </ol>
          )
        )}
        {info?.error && (
          <p className="tray-error" role="alert">
            <bdi>{info.error}</bdi>
          </p>
        )}
        {status === 'done' && result?.url && (
          <a className="btn btn-primary tray-link" href={result.url} target="_blank" rel="noreferrer">
            <Icon name="open" size={16} /> <span>{t('export.open')}</span>
          </a>
        )}
        {!!lines.length && (
          <details className="tray-log" open={live}>
            <summary>{t('job.log')}</summary>
            <ol ref={logRef}>
              {lines.map((e) => (
                <li key={e.seq} className={`log-${e.kind === 'error' ? 'error' : (e.level ?? 'info')}`}>
                  <bdi>{e.message ?? e.error}</bdi>
                </li>
              ))}
            </ol>
          </details>
        )}
        {!!earlier.length && (
          <details className="tray-earlier">
            <summary>{t('job.earlier')}</summary>
            <ul>
              {earlier.map((j) => (
                <li key={j.id}>
                  <button type="button" onClick={() => onSelect(j.id)}>
                    <span>{jobLabel(j.type, i18n)}</span>
                    <span className={`pill pill-${j.status}`}>{t(`job.status.${j.status}` as MsgKey)}</span>
                    <span className="muted">{ago(j.created)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

export const isOver = (s: JobStatus | undefined) => !!s && OVER.includes(s);
