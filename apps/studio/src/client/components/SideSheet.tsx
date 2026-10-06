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
/** Wide enough for a side sheet to push the place (1280 px and wider) instead of covering it. */
export const useWide = (): boolean => useSyncExternalStore(subscribeWide, isWide);

// sheets pushing the place now (the page keeps their room until the last one closes)
let pushing = 0;
// one sheet at a time: a sheet that opens asks the open one to close
const OPENED = 'warqa:sheet-opened';

export function SideSheet({
  open,
  onClose,
  title,
  children,
  className = '',
  takeFocus = true,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
  /** Move the focus to its title when it opens (not when it opens by itself, as the editor's inspector). */
  takeFocus?: boolean;
  /** Where the focus goes when it closes (else back to what had it when it opened). */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const { t } = useI18n();
  const push = useSyncExternalStore(subscribeWide, isWide);
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEscape(open, onClose, { blocks: !push });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const backRef = useRef(returnFocus);
  backRef.current = returnFocus;
  // biome-ignore lint/correctness/useExhaustiveDependencies: takeFocus is read when it opens
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    if (takeFocus) ref.current?.querySelector<HTMLElement>('h2')?.focus();
    window.dispatchEvent(new CustomEvent(OPENED, { detail: id }));
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) closeRef.current();
    };
    window.addEventListener(OPENED, other);
    if (push) pushing++;
    document.documentElement.classList.toggle('has-sheet', pushing > 0);
    return () => {
      window.removeEventListener(OPENED, other);
      if (push) pushing--;
      document.documentElement.classList.toggle('has-sheet', pushing > 0);
      // back to what opened it (or where its page wants the focus)
      const back = backRef.current?.() ?? opener.current;
      if (back?.isConnected && ref.current?.contains(document.activeElement)) back.focus();
      else if (back?.isConnected && (!document.activeElement || document.activeElement === document.body)) back.focus();
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
