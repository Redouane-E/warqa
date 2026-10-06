// The states a person meets when work stops or waits (redesign 4h): a callout per kind of stop, each with its next
// step (paste a new key, raise the limit, use another key, try now), the countdown while a service asks Warqa to
// slow down, and the dialog that raises a book's spending limit.

import type { IconName } from '@warqa/brand';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { FAKE_PROVIDER, PROVIDERS } from '../../shared/providers';
import type { JobFailure } from '../../shared/types';
import { api } from '../api';
import { type I18n, useI18n } from '../i18n';
import { navigate } from '../router';
import { Button, Icon } from './ui';

/** A box that says what happened, with what to do next. */
export function Callout({
  tone,
  icon,
  role,
  children,
  actions,
  className = '',
}: {
  tone: 'info' | 'pen' | 'fluo' | 'inverse';
  icon?: IconName;
  role?: 'status' | 'alert';
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`callout callout-${tone} ${className}`.trim()} role={role}>
      <div className="callout-line">
        {icon && <Icon name={icon} size={20} />}
        <div className="callout-text">{children}</div>
      </div>
      {actions && <div className="callout-actions">{actions}</div>}
    </div>
  );
}

/** A service's company ("Google"), the site its keys come from, and its models' family ("Gemini"). */
export function serviceInfo(provider: string): { maker: string; site?: string; url?: string; family: string } {
  const p = PROVIDERS.find((x) => x.id === provider);
  const maker =
    provider === FAKE_PROVIDER.id
      ? FAKE_PROVIDER.name
      : (p?.maker ?? (provider ? provider[0]!.toUpperCase() + provider.slice(1) : ''));
  return {
    maker,
    ...(p?.keySite ? { site: p.keySite } : {}),
    ...(p?.keyUrl ? { url: p.keyUrl } : {}),
    family: p?.family ?? maker,
  };
}

/** "0:24", "1:05" (minutes and seconds). */
export const clock = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The time a daily quota starts again, in the viewer's time zone ("09:00"). */
const timeOf = (ms: number, i18n: I18n) =>
  new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(ms);

/** Seconds left until a moment, ticking every second. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, (until - now) / 1000);
}

/**
 * A service asked Warqa to slow down: when it tries again (a countdown and a bar that shrinks to nothing), that
 * finished work is kept, and Try now. A screen reader hears the wait once, not every second.
 */
export function RateWait({ jobId, until, provider }: { jobId: string; until: number; provider: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const left = useCountdown(until);
  const total = useRef(Math.max(1, (until - Date.now()) / 1000));
  const [asked, setAsked] = useState(false);
  const { maker } = serviceInfo(provider);
  return (
    <Callout
      tone="info"
      role="status"
      className="rate-wait"
      actions={
        <>
          <span>{t('wait.kept')}</span>
          <Button
            variant="quiet"
            busy={asked}
            onClick={() => {
              setAsked(true);
              void api.retryNow(jobId).catch(() => setAsked(false));
            }}
          >
            {t('wait.tryNow')}
          </Button>
        </>
      }
    >
      <span aria-hidden="true">
        {t('wait.slow', { maker, time: '\u0000' }).split('\u0000')[0]}
        <bdi className="mono">{clock(left)}</bdi>
        {t('wait.slow', { maker, time: '\u0000' }).split('\u0000')[1]}
      </span>
      <span className="visually-hidden">
        {left > 0 ? t('wait.live', { n: Math.round(total.current) }) : t('wait.now')}
      </span>
      <span className="rate-bar" aria-hidden="true">
        <span style={{ inlineSize: `${Math.min(100, (left / total.current) * 100)}%` }} />
      </span>
    </Callout>
  );
}

/** The short text of a wait, for the tray's pill ("Waiting · 0:24"). */
export function WaitClock({ until }: { until: number }) {
  const { t } = useI18n();
  return <>{t('wait.pill', { time: clock(useCountdown(until)) })}</>;
}

/**
 * Why a job stopped, with its next step. `chapter`: the chapter's number among those to make (for the limit's
 * sentence); `onRaise`: raise the limit and go on (the dialog is the caller's); `onContinue`: make the rest.
 */
export function FailureView({
  failure,
  error,
  chapter,
  task,
  onRaise,
}: {
  failure: JobFailure | undefined;
  error?: string;
  chapter?: number;
  /** What stopped, for jobs that are not a chapter ("Translating into French"). */
  task?: string;
  onRaise?: () => void;
}) {
  const i18n = useI18n();
  const { t, usd } = i18n;
  const [dismissed, setDismissed] = useState(false);
  if (!failure || failure.kind === 'other')
    return error ? (
      <Callout tone="pen" icon="warn" role="alert">
        <bdi>{t('fail.other', { error })}</bdi>
      </Callout>
    ) : null;
  const beat = failure.beat;
  switch (failure.kind) {
    case 'budget': {
      const limit = usd(failure.limit);
      return (
        <Callout
          tone="pen"
          icon="warn"
          role="alert"
          actions={
            onRaise && (
              <Button onClick={onRaise} className="callout-button">
                {t('limit.raise')}
              </Button>
            )
          }
        >
          {chapter && beat && beat > 1
            ? t('limit.reached', { limit, n: chapter, b: beat - 1 })
            : t('limit.reachedTask', { limit, task: task ?? t('fail.task') })}
        </Callout>
      );
    }
    case 'key':
    case 'credits': {
      const s = serviceInfo(failure.provider);
      return (
        <Callout
          tone="pen"
          icon="key"
          role="alert"
          actions={
            <>
              <Button variant="primary" onClick={() => navigate(`/ai#key-${failure.provider}`)}>
                {failure.kind === 'key' ? t('fail.pasteKey') : t('fail.otherKey')}
              </Button>
              {s.url && s.site && (
                <a className="callout-link" href={s.url} target="_blank" rel="noreferrer">
                  <span>{t('fail.openSite', { site: s.site })}</span>
                  <Icon name="open" size={16} />
                  <span className="visually-hidden"> ({t('common.newTab')})</span>
                </a>
              )}
            </>
          }
        >
          {failure.kind === 'key'
            ? failure.status
              ? t('fail.key', { maker: s.maker, status: String(failure.status) })
              : t('fail.keyNoStatus', { maker: s.maker })
            : t('fail.credits', { maker: s.maker, site: s.site ?? s.maker })}
        </Callout>
      );
    }
    case 'quota': {
      if (dismissed) return null;
      const s = serviceInfo(failure.provider);
      return (
        <Callout
          tone="fluo"
          role="status"
          actions={
            <>
              <Button className="callout-fluo-button" onClick={() => navigate('/ai#keys')}>
                {t('fail.otherKey')}
              </Button>
              <Button variant="quiet" className="callout-fluo-text" onClick={() => setDismissed(true)}>
                {t('fail.tomorrow')}
              </Button>
            </>
          }
        >
          {/* a free tier is Google's; another service's daily limit is said as such */}
          {failure.provider !== 'google'
            ? t('fail.quotaDaily', { maker: s.maker })
            : failure.resetAt
              ? t('fail.quota', { model: s.family, time: timeOf(failure.resetAt, i18n) })
              : t('fail.quotaNoTime', { model: s.family })}
        </Callout>
      );
    }
    case 'rate':
      return (
        <Callout tone="info" icon="info" role="status">
          {t('fail.rate', { maker: serviceInfo(failure.provider).maker })}
        </Callout>
      );
    case 'cut':
      return (
        <Callout tone="pen" icon="warn" role="alert">
          {beat && beat > 1
            ? t('make.cutOff', { b: beat, k: beat - 1 })
            : beat === 1
              ? t('make.cutOffFirst')
              : t('fail.cut', { task: task ?? t('fail.task') })}
        </Callout>
      );
    case 'offline':
      return (
        <Callout tone="inverse" icon="offline" role="status">
          {t('fail.offline')}
        </Callout>
      );
    case 'network':
      return (
        <Callout tone="pen" icon="warn" role="alert">
          {t('fail.network')}
        </Callout>
      );
  }
}

/* ---------- the spending limit ---------- */

export interface LimitAsk {
  limit: number;
  spent: number;
  /** About what finishing needs (the chapter's beats left, or what starting costs). */
  need?: number;
  /** The chapter's number among those to make. */
  chapter?: number;
  /** Several chapters started at once ("Making 3 chapters costs about…"). */
  chapters?: number;
  /** "reached": a job stopped at the limit; "before": starting would pass it. */
  reason: 'reached' | 'before';
}

/** A dialog that raises a book's limit: resolves to the new limit, or null (kept). */
export function useLimitDialog(): [ReactNode, (a: LimitAsk) => Promise<number | null>] {
  const [ask, setAsk] = useState<(LimitAsk & { resolve: (v: number | null) => void }) | null>(null);
  const open = useCallback((a: LimitAsk) => new Promise<number | null>((resolve) => setAsk({ ...a, resolve })), []);
  const node = ask ? (
    <LimitDialog
      {...ask}
      onDone={(v) => {
        ask.resolve(v);
        setAsk(null);
      }}
    />
  ) : null;
  return [node, open];
}

/** A typed amount ("2,50", "٢٫٥") as a number, or NaN. */
const amountOf = (s: string): number =>
  Number(
    s
      .trim()
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
      .replace(/[٫,]/, '.'),
  );

function LimitDialog({
  limit,
  spent,
  need,
  chapter,
  chapters,
  reason,
  onDone,
}: LimitAsk & { onDone: (v: number | null) => void }) {
  const { t, usd } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  // twice the limit, or what finishing needs, rounded up to 50 cents
  const suggested = Math.ceil(Math.max(limit * 2, spent + (need ?? 0)) * 2) / 2;
  const [value, setValue] = useState(suggested.toFixed(2));
  // cents, as saved: "1.004" is $1.00, not more than $1.00 spent
  const amount = Math.round(amountOf(value) * 100) / 100;
  const ok = Number.isFinite(amount) && amount > spent;
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    keep.current?.focus();
  }, []);
  const done = (v: number | null) => {
    ref.current?.close();
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    onDone(v);
  };
  const left = Math.max(0, limit - spent);
  return (
    <dialog
      ref={ref}
      className="dialog limit-dialog"
      aria-labelledby="limit-title"
      aria-describedby="limit-body"
      onCancel={(e) => {
        e.preventDefault();
        done(null);
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) done(amount);
        }}
      >
        <h2 id="limit-title">{t('limit.title')}</h2>
        <p id="limit-body" className="dialog-body">
          {reason === 'before' && chapters && chapters > 1 && need !== undefined
            ? t('limit.bodyBeforeMany', { n: chapters, cost: usd(need), left: usd(left), limit: usd(limit) })
            : reason === 'before' && chapter && need !== undefined
              ? t('limit.bodyBefore', { n: chapter, cost: usd(need), left: usd(left), limit: usd(limit) })
              : chapter && need !== undefined
                ? t('limit.body', { n: chapter, cost: usd(need) })
                : t('limit.bodySpent', { spent: usd(spent), limit: usd(limit) })}
        </p>
        <div className="field">
          <label htmlFor="limit-field">{t('limit.field')}</label>
          <div className={`money-field${ok ? '' : ' is-bad'}`} dir="ltr">
            <span className="money-unit mono" id="limit-unit">
              <span aria-hidden="true">USD</span>
              <span className="visually-hidden">{t('book.limitUnit')}</span>
            </span>
            <input
              id="limit-field"
              className="mono"
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={`limit-unit${ok ? '' : ' limit-low'}`}
              aria-invalid={!ok || undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {!ok && (
            <p id="limit-low" className="field-error">
              {t('limit.tooLow', { spent: usd(spent) })}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button ref={keep} type="button" className="btn btn-default" onClick={() => done(null)}>
            {t('limit.keep', { limit: usd(limit) })}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>
            {ok ? t('limit.raiseTo', { limit: usd(amount) }) : t('limit.raise')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
