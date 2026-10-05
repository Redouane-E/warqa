// Small building blocks shared by the screens.
import { ICON_STROKE, ICONS, type IconDef, type IconName, MARK, MIRRORED } from '@warqa/brand';
import { type ButtonHTMLAttributes, type ReactNode, useId } from 'react';
import type { Issue } from '../../shared/types';
import { useI18n } from '../i18n';

/** An icon from the brand set (a 24 grid, 1.75 stroke). Back and next swap in right-to-left pages. */
export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const def: IconDef = ICONS[name];
  return (
    <svg
      className={`icon${MIRRORED.has(name) ? ' icon-mirror' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={def.d} />
      {def.fill && <path d={def.fill} fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** Warqa's mark: a sheet with its top-left corner folded (ورقة means "a sheet of paper"). It never mirrors. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="brand-mark wq-mark"
      width={Math.round((size * MARK.width) / MARK.height)}
      height={size}
      viewBox={MARK.viewBox}
      aria-hidden="true"
      focusable="false"
    >
      <path className="wq-mark-sheet" d={MARK.sheet} />
      <path className="wq-mark-fold" d={MARK.fold} />
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName; busy?: boolean }) {
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
