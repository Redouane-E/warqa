// "Esc closes the top tool": menus, Go to and side sheets register while open; Esc closes the last one opened.
// It never leaves a place. Modal dialogs (native <dialog>) answer Esc themselves with their safe choice.
import { useEffect, useRef } from 'react';

const stack: { close: () => void }[] = [];

if (typeof document !== 'undefined')
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !stack.length) return;
    if (modalOpen()) return;
    e.preventDefault();
    stack[stack.length - 1]!.close();
  });

/** A tool (Go to, a menu, a side sheet, Lift) or a modal dialog is open: page-wide keys wait. */
export const toolOpen = (): boolean => stack.length > 0 || modalOpen();

/** The key went to a text field or a list box, where the arrows and Alt+arrows already mean something. */
export function inField(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

function modalOpen(): boolean {
  try {
    return !!document.querySelector('dialog[open]:modal');
  } catch {
    return !!document.querySelector('dialog[open]');
  }
}

/** While `open`, Esc calls `close` (unless a tool opened later is on top). */
export function useEscape(open: boolean, close: () => void): void {
  const fn = useRef(close);
  fn.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => fn.current() };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

/** Keep Tab inside an element (overlays that cover the page); returns a keydown handler. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return;
  const items = [...root.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.offsetParent !== null,
  );
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
