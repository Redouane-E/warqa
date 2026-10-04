// Small building blocks shared by the screens.
import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react';
import type { Issue } from '../../shared/types';
import { useI18n } from '../i18n';

const PATHS: Record<string, string> = {
  check: 'M4 10.5l4 4 8-9',
  plus: 'M10 4v12M4 10h12',
  x: 'M5 5l10 10M15 5L5 15',
  up: 'M10 15V5M5.5 9.5L10 5l4.5 4.5',
  down: 'M10 5v10M5.5 10.5L10 15l4.5-4.5',
  external: 'M11 4h5v5M16 4l-7 7M14 12v4H4V6h4',
  download: 'M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16h12',
  stop: 'M6 6h8v8H6z',
  play: 'M6 4l10 6-10 6z',
  warn: 'M10 3l8 14H2zM10 8v4M10 14.5v.5',
  error: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM7 7l6 6M13 7l-6 6',
  info: 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10 9v5M10 6.2v.3',
  sun: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  moon: 'M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z',
  auto: 'M10 3a7 7 0 1 0 0 14zM10 3a7 7 0 0 1 0 14',
  gear: 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6',
  back: 'M12.5 4.5L7 10l5.5 5.5',
  key: 'M7 9a3 3 0 1 1 0 .01M9.6 10.5L17 10.5M14 10.5v3M16.5 10.5v2',
  refresh: 'M15.5 7.5A6 6 0 1 0 16 12M15.5 3.5v4h-4',
  file: 'M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15',
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name] ?? ''}
        fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The wordmark: a sheet with a folded corner (ورقة means "a sheet of paper"). */
export function Sheet({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false" className="sheet-mark">
      <path d="M5 3.5h11l5 5v14H5z" className="sheet-body" />
      <path d="M16 3.5v5h5" className="sheet-fold" />
      <path d="M8.5 13h9M8.5 16.5h9M8.5 20h5.5" className="sheet-lines" />
    </svg>
  );
}

type Variant = 'primary' | 'default' | 'quiet' | 'danger';

export function Button({
  variant = 'default',
  icon,
  busy,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string; busy?: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${className ?? ''}`}
      aria-busy={busy || undefined}
      {...rest}
      disabled={rest.disabled || busy}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (id: string, describedBy?: string) => ReactNode;
  id?: string;
  className?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  const described = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={fid}>{label}</label>
      {children(fid, described)}
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'error' | 'good';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'error' : tone === 'warn' ? 'warn' : tone === 'good' ? 'check' : 'info'} />
      <div className="notice-body">{children}</div>
      {action}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {t('common.loading')}
    </p>
  );
}

export function LangTag({ code, active }: { code: string; active?: boolean }) {
  const { langName } = useI18n();
  return (
    <abbr className={`lang-tag ${active ? 'is-active' : ''}`} title={langName(code)} lang={code}>
      {code.toUpperCase()}
    </abbr>
  );
}

export function IssueList({ issues, empty }: { issues: Issue[]; empty?: ReactNode }) {
  const { langName } = useI18n();
  if (!issues.length) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a static list rebuilt as a whole
        <li key={k} className={`issue issue-${i.level}`}>
          <Icon name={i.level === 'error' ? 'error' : 'warn'} size={16} />
          <span>
            {i.lang && (
              <abbr className="lang-tag" title={langName(i.lang)}>
                {i.lang.toUpperCase()}
              </abbr>
            )}{' '}
            <bdi>{i.message.replace(/^\[[\w-]+\] /, '')}</bdi>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="toast" role="status">
      <Icon name="check" /> {children}
    </div>
  );
}
