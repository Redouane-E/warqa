// The activity tray: follows a job over SSE (its stages, per-beat progress and log) from any screen.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvent, JobInfo, JobStatus, JobType } from '../../shared/types';
import { api } from '../api';
import { withBase } from '../base';
import { type I18n, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { useToast } from './overlays';
import { Icon } from './ui';

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

export function useJobStream(jobId: string | null, onEnd?: (job: JobInfo) => void) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [info, setInfo] = useState<JobInfo | null>(null);
  const [lost, setLost] = useState(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
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
      setEvents((cur) => (cur.length && cur[cur.length - 1]!.seq >= e.seq ? cur : [...cur, e]));
      if (e.kind === 'status' && e.jobStatus) setInfo((cur) => (cur ? { ...cur, status: e.jobStatus! } : cur));
    };
    for (const k of ['status', 'progress', 'log', 'result', 'error']) es.addEventListener(k, add as EventListener);
    es.addEventListener('end', ((m: MessageEvent<string>) => {
      es.close();
      closed = true;
      const job = JSON.parse(m.data) as JobInfo;
      setInfo(job);
      endRef.current?.(job);
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
    if (e.kind !== 'progress' || !e.stage) continue;
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
    (job: JobInfo) => {
      if (!liveIds.current.delete(job.id)) return;
      const projectId = currentRef.current?.projectId;
      if (projectId) for (const fn of listeners.current.get(projectId) ?? []) fn(job);
      if (job.type === 'estimate') return;
      // done: the tray folds to its pill (a check) so the screen is free again, unless you are working in it
      const inTray = !!document.activeElement?.closest('.tray');
      if (viewRef.current === 'open' && inTray) return;
      if (viewRef.current === 'open') setView('pill');
      toast({
        text: `${jobLabel(job.type, i18n)} · ${i18n.t(`job.status.${job.status}` as MsgKey)}`,
        tone: job.status === 'error' ? 'error' : job.status === 'done' ? 'good' : 'info',
        action: { label: i18n.t('tray.open'), run: () => setView('open') },
      });
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
}: {
  tracked: Tracked;
  stream: ReturnType<typeof useJobStream>;
  view: View;
  setView: (v: View) => void;
  onSelect: (jobId: string) => void;
}) {
  const i18n = useI18n();
  const { t, ago, num, usd } = i18n;
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
  const pct = latest?.total ? Math.round((((latest.index ?? 0) + 1) * 100) / latest.total) : undefined;
  const title = info ? jobLabel(info.type, i18n) : t('job.title');
  const summary = [
    title,
    pct !== undefined && live ? `${num(pct)} %` : !live ? t(`job.status.${status}` as MsgKey) : '',
    spent ? usd(spent) : '',
  ]
    .filter(Boolean)
    .join(' · ');

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
            ) : null}
          </span>
          <span className="tray-pill-text">{summary}</span>
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
    <section className="tray" aria-labelledby="tray-title" ref={keepClear}>
      <header className="tray-head">
        <h2 id="tray-title">
          {title}
          {info && Array.isArray(info.args.chapters) && info.args.chapters.length ? (
            <span className="tray-args"> · {(info.args.chapters as string[]).join(', ')}</span>
          ) : null}
          {info && typeof info.args.lang === 'string' ? (
            <span className="tray-args"> · {info.args.lang.toUpperCase()}</span>
          ) : null}
        </h2>
        <span className={`pill pill-${status}`}>{t(`job.status.${status}` as MsgKey)}</span>
        {spent ? <span className="tray-money">{usd(spent)}</span> : null}
        <span className="tray-tools">
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
        {live && <p className="tray-note">{t('tray.keeps')}</p>}
        {status === 'queued' && <p className="tray-note">{t('job.queued')}</p>}
        {lost && live && <p className="tray-note">{t('job.reconnecting')}</p>}
        <p className="visually-hidden" aria-live="polite">
          {latest
            ? `${stageLabel(latest.stage, i18n)} ${latest.status === 'beat' ? `${(latest.index ?? 0) + 1}/${latest.total}` : ''}`
            : ''}
          {!live ? ` ${t(`job.status.${status}` as MsgKey)}` : ''}
        </p>
        {!!rows.length && (
          <ol className="job-rows">
            {rows.map((r) => (
              <RowView key={r.key} r={r} live={live} />
            ))}
          </ol>
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
