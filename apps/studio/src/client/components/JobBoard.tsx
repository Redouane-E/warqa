// The activity board: follows a job over SSE and shows its stages, per-beat progress and log.
// Styled as a small chalkboard — the one place the studio borrows the player's look.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvent, JobInfo, JobStatus, JobType } from '../../shared/types';
import { api } from '../api';
import { withBase } from '../base';
import { type I18n, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
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
          <Icon name="x" size={16} />
        ) : state === 'skip' ? (
          '·'
        ) : state === 'running' ? (
          <span className="chalk-dot" />
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

export function JobBoard({
  jobId,
  jobs,
  onSelect,
  onEnd,
}: {
  jobId: string | null;
  jobs: JobInfo[];
  onSelect: (id: string) => void;
  onEnd: (job: JobInfo) => void;
}) {
  const i18n = useI18n();
  const { t, ago } = i18n;
  const { events, info, lost } = useJobStream(jobId, onEnd);
  const logRef = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => rowsOf(events), [events]);
  const lines = useMemo(() => events.filter((e) => e.kind === 'log' || e.kind === 'error').slice(-200), [events]);
  const result = events.find((e) => e.kind === 'result')?.result as { url?: string } | undefined;
  const status = info?.status ?? (jobId ? 'queued' : null);
  const live = status === 'running' || status === 'queued';
  const [stopping, setStopping] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another job is shown
  useEffect(() => setStopping(false), [jobId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the log when a line arrives
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const earlier = jobs.filter((j) => j.id !== jobId).slice(0, 6);
  const latest = rows[rows.length - 1];

  return (
    <section className="board" aria-labelledby="board-title">
      <header className="board-head">
        <h2 id="board-title">{t('job.title')}</h2>
        {status && <span className={`pill pill-${status}`}>{t(`job.status.${status}` as MsgKey)}</span>}
      </header>
      {!jobId && <p className="board-idle">{t('job.idle')}</p>}
      {jobId && info && (
        <div className="board-job">
          <p className="board-type">
            {jobLabel(info.type, i18n)}
            {Array.isArray(info.args.chapters) && info.args.chapters.length ? (
              <span className="board-args"> · {(info.args.chapters as string[]).join(', ')}</span>
            ) : null}
            {typeof info.args.lang === 'string' ? (
              <span className="board-args"> · {info.args.lang.toUpperCase()}</span>
            ) : null}
          </p>
          {live && (
            <button
              type="button"
              className="board-stop"
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                void api.cancelJob(jobId);
              }}
            >
              <Icon name="stop" size={14} /> {stopping ? t('job.stopping') : t('job.stop')}
            </button>
          )}
        </div>
      )}
      {status === 'queued' && <p className="board-note">{t('job.queued')}</p>}
      {lost && live && <p className="board-note">{t('job.reconnecting')}</p>}
      <p className="visually-hidden" aria-live="polite">
        {latest
          ? `${stageLabel(latest.stage, i18n)} ${latest.status === 'beat' ? `${(latest.index ?? 0) + 1}/${latest.total}` : ''}`
          : ''}
        {status && !live ? ` ${t(`job.status.${status}` as MsgKey)}` : ''}
      </p>
      {!!rows.length && (
        <ol className="job-rows">
          {rows.map((r) => (
            <RowView key={r.key} r={r} live={live} />
          ))}
        </ol>
      )}
      {info?.error && (
        <p className="board-error" role="alert">
          <bdi>{info.error}</bdi>
        </p>
      )}
      {status === 'done' && result?.url && (
        <a className="board-link" href={result.url} target="_blank" rel="noreferrer">
          <Icon name="external" size={16} /> {t('export.open')}
        </a>
      )}
      {!!lines.length && (
        <details className="board-log" open={live}>
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
        <details className="board-earlier">
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
    </section>
  );
}

export const isOver = (s: JobStatus | undefined) => !!s && OVER.includes(s);
