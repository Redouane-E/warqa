// A side sheet inspects or edits one thing (help, your data, a new book…). It slides in from the inline end:
// at 1280 px and wider it pushes the place and leaves it usable; below, it covers it with a paper veil and keeps
// the focus inside; on phones it is a bottom sheet. Closes with ×, the veil or Esc; one at a time.
import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { trapTab, useEscape } from './tools';
import { Icon } from './ui';

const wide = typeof matchMedia === 'function' ? matchMedia('(min-width: 1280px)') : null;
const subscribeWide = (fn: () => void) => {
  wide?.addEventListener?.('change', fn);
  return () => wide?.removeEventListener?.('change', fn);
};
const isWide = () => !!wide?.matches;

export function SideSheet({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const push = useSyncExternalStore(subscribeWide, isWide);
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    document.documentElement.classList.toggle('has-sheet', push);
    return () => {
      document.documentElement.classList.remove('has-sheet');
      // back to what opened it
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open, push]);
  if (!open) return null;
  // on <body>: an opener inside the top bar (its backdrop blur makes it the box of fixed children) must not
  // shrink the sheet to the bar
  return createPortal(
    <>
      {!push && <div className="sheet-veil" aria-hidden="true" onClick={onClose} />}
      <aside
        ref={ref}
        className={`side-sheet ${className}`.trim()}
        role="dialog"
        aria-modal={!push}
        aria-labelledby={id}
        onKeyDown={(e) => !push && trapTab(e, ref.current)}
      >
        <header className="side-sheet-head">
          <h2 id={id} tabIndex={-1}>
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="side-sheet-body">{children}</div>
      </aside>
    </>,
    document.body,
  );
}
