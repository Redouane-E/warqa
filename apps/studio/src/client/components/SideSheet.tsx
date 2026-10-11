// A side sheet inspects or edits one thing (help, your data, a new book…). It slides in from the inline end:
// at 1280 px and wider it pushes the place and leaves it usable; below, it covers it with a paper veil and keeps
// the focus inside; on phones it is a bottom sheet. Closes with ×, the veil or Esc; one at a time.
import { dragSheet } from '@warqa/lesson/gestures';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
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

const phoneQuery = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
const subscribePhone = (fn: () => void) => {
  phoneQuery?.addEventListener?.('change', fn);
  return () => phoneQuery?.removeEventListener?.('change', fn);
};
/** A phone: side sheets are bottom sheets with a handle. */
const usePhone = (): boolean => useSyncExternalStore(subscribePhone, () => !!phoneQuery?.matches);
/** A bottom sheet's heights (px): half, and full (the top of the screen left visible). */
const halfOf = () => Math.round(window.innerHeight * 0.52);
const fullOf = () => window.innerHeight - 48;
/** How long a sheet takes to leave (the close motion; 70 % of arriving). */
const LEAVE_MS = 170;

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
  snap = 'full',
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
  /** On a phone: open at half height (the beat inspector: the stage stays in view) or full (the default). */
  snap?: 'half' | 'full';
}) {
  const { t } = useI18n();
  const push = useSyncExternalStore(subscribeWide, isWide);
  const phone = usePhone();
  const id = useId();
  // phones: half or full height; and it stays on screen while it leaves
  const [full, setFull] = useState(snap === 'full');
  const [shown, setShown] = useState(open);
  // (before the first paint: a reopened sheet never flashes the height it had)
  useLayoutEffect(() => {
    if (open) {
      setShown(true);
      setFull(snap === 'full');
      return;
    }
    const timer = setTimeout(() => setShown(false), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [open, snap]);
  const grip = useRef<HTMLButtonElement>(null);
  const head = useRef<HTMLElement>(null);
  // the handle and the head drag it: it stops at half height, then full; down closes
  useEffect(() => {
    if (!open || !phone) return;
    const offs = [grip.current, head.current]
      .filter((el): el is HTMLElement => !!el)
      .map((el) =>
        dragSheet(el, {
          stops: () => [0, halfOf(), fullOf()],
          height: () => ref.current?.getBoundingClientRect().height ?? 0,
          follow: (px) => {
            if (!ref.current) return;
            ref.current.style.blockSize = `${px}px`;
            ref.current.classList.add('is-dragging');
          },
          done: (px) => {
            if (!ref.current) return;
            ref.current.classList.remove('is-dragging');
            // closed by the drag: it leaves from where the finger let go
            if (px === 0) closeRef.current();
            else {
              ref.current.style.blockSize = '';
              setFull(px > halfOf() + 1);
            }
          },
        }),
      );
    return () => {
      for (const off of offs) off();
    };
  }, [open, phone]);
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // (a half sheet on a phone leaves the page usable: its keys too)
  useEscape(open, onClose, { blocks: !push && !(phone && !full) });
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
  if (!open && !shown) return null;
  // half height on a phone leaves the place above usable (no veil, the focus free), like a sheet that pushes
  const modal = !push && !(phone && !full);
  // on <body>: an opener inside the top bar (its backdrop blur makes it the box of fixed children) must not
  // shrink the sheet to the bar
  return createPortal(
    <>
      {modal && <div className={`sheet-veil${open ? '' : ' is-closing'}`} aria-hidden="true" onClick={onClose} />}
      <aside
        ref={ref}
        className={`side-sheet ${className}${open ? '' : ' is-closing'}${phone ? (full ? ' is-full' : ' is-half') : ''}`.trim()}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={id}
        // leaving: out of reach and out of the accessibility tree
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        onKeyDown={(e) => modal && trapTab(e, ref.current)}
      >
        {phone && (
          // the handle: half height → full; full → closed (a sheet opened full), or back to half
          <button
            ref={grip}
            type="button"
            className="sheet-grip"
            data-grip=""
            aria-label={full && snap === 'full' ? t('common.close') : t(full ? 'sheet.half' : 'sheet.full')}
            onClick={() => (full && snap === 'full' ? onClose() : setFull(!full))}
          >
            <span aria-hidden="true" />
          </button>
        )}
        <header className="side-sheet-head" ref={head}>
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
