// The two things that may interrupt: a dialog (only for spending beyond the estimate, replacing a teacher's work,
// or deleting) and a toast (results, with Undo). One provider at the top of the app owns both.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useLeaveGuard } from '../router';
import { Icon } from './ui';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The action's name: it says what happens ("Make it again", "Delete the book"). */
  confirm: string;
  /** The safe choice, focused by default and chosen by Esc (default: Cancel). */
  cancel?: string;
  /** Red, for loss (deleting, replacing a teacher's work). */
  danger?: boolean;
}

export interface ToastOptions {
  text: ReactNode;
  tone?: 'good' | 'info' | 'error';
  /** A button in the toast ("Undo", "Open"). */
  action?: { label: string; run: () => void };
  /** Milliseconds before it goes (default 5 s; it waits while hovered or focused). */
  ms?: number;
}

interface Overlays {
  confirm(o: ConfirmOptions): Promise<boolean>;
  toast(o: ToastOptions): void;
}

const OverlayContext = createContext<Overlays>({
  confirm: async () => false,
  toast: () => {},
});

export const useConfirm = () => useContext(OverlayContext).confirm;
export const useToast = () => useContext(OverlayContext).toast;

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
  /** Where the focus was: it goes back there when the dialog closes. */
  opener: HTMLElement | null;
}

function ConfirmDialog({ pending, onDone }: { pending: Pending; onDone: (ok: boolean) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // the safe choice has the focus: Enter never spends or deletes by accident
    safe.current?.focus();
  }, []);
  // close it properly, then give the focus back to what opened it (a sheet's focus trap stays whole)
  const done = (ok: boolean) => {
    ref.current?.close();
    if (pending.opener?.isConnected) pending.opener.focus({ preventScroll: true });
    onDone(ok);
  };
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        done(false);
      }}
    >
      <h2 id="dialog-title">{pending.title}</h2>
      {pending.body && <div className="dialog-body">{pending.body}</div>}
      <div className="dialog-actions">
        <button ref={safe} type="button" className="btn btn-default" onClick={() => done(false)}>
          {pending.cancel ?? t('common.cancel')}
        </button>
        <button
          type="button"
          className={`btn ${pending.danger ? 'btn-danger-solid' : 'btn-primary'}`}
          onClick={() => done(true)}
        >
          {pending.confirm}
        </button>
      </div>
    </dialog>
  );
}

function ToastView({ toast, onGone }: { toast: ToastOptions & { id: number }; onGone: () => void }) {
  const { t } = useI18n();
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold) return;
    // a toast with an action (Undo, Open) stays longer: time to reach it from the keyboard
    const timer = setTimeout(onGone, toast.ms ?? (toast.action ? 12000 : 5000));
    return () => clearTimeout(timer);
  }, [hold, toast, onGone]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering or focusing only pauses the timer
    <div
      className={`toast toast-${toast.tone ?? 'good'}`}
      role={toast.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <Icon name={toast.tone === 'error' ? 'error' : toast.tone === 'info' ? 'info' : 'check'} />
      <span className="toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            onGone();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label={t('common.close')} onClick={onGone}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const seq = useRef(0);
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setPending({
          ...o,
          resolve,
          opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        }),
      ),
    [],
  );
  // one toast at a time: a new one replaces the last
  const show = useCallback((o: ToastOptions) => setToast({ ...o, id: ++seq.current }), []);
  const value = useMemo(() => ({ confirm, toast: show }), [confirm, show]);
  const gone = useCallback(() => setToast(null), []);
  return (
    <OverlayContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          key={pending.title}
          pending={pending}
          onDone={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
      {/* always on the page, so screen readers announce what appears in it */}
      <div className="toast-host" role="status" aria-live="polite">
        {toast && <ToastView key={toast.id} toast={toast} onGone={gone} />}
      </div>
    </OverlayContext.Provider>
  );
}

/** Unsaved changes: leaving the screen through the studio asks first (loss interrupts), and so does closing the tab. */
export function useUnsavedGuard(dirty: boolean): void {
  const { t } = useI18n();
  const confirm = useConfirm();
  useLeaveGuard(dirty, () =>
    confirm({ title: t('leave.title'), confirm: t('leave.discard'), cancel: t('leave.stay'), danger: true }),
  );
}

/** A result to announce ("Saved"): shown by the toast host while this is rendered. */
export function Toast({ children, tone = 'good' }: { children: ReactNode; tone?: ToastOptions['tone'] }) {
  const toast = useToast();
  const text = typeof children === 'string' ? children : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: announce once per message
  useEffect(() => {
    toast({ text: children, tone });
  }, [text, toast]);
  return null;
}
