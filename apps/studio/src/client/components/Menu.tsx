// A menu for choosing (interface language, a status list): anchored 8 px under its button, toward free space;
// arrow keys move, Enter chooses, Esc or a click outside closes it.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useEscape } from './tools';

export interface MenuItem {
  key: string;
  label: ReactNode;
  /** A radio choice (aria-checked), or a plain action when undefined. */
  checked?: boolean;
  lang?: string;
  onSelect?: () => void;
  /** A link instead of an action. */
  href?: string;
}

export function Menu({
  label,
  button,
  items,
  className = '',
  align = 'end',
  header,
}: {
  /** The button's accessible name. */
  label: string;
  /** What the button shows. */
  button: ReactNode;
  items: MenuItem[];
  className?: string;
  align?: 'start' | 'end';
  /** Text above the items (a status menu's explanation). */
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  };
  useEscape(open, () => close());
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    // keep the whole menu in the window (a wide menu under a button near the edge of a phone)
    const box = root.current?.querySelector<HTMLElement>('.menu');
    if (box) {
      const r = box.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
      if (dx) box.style.translate = `${dx}px 0`;
    }
    const first =
      root.current?.querySelector<HTMLElement>('[role="menu"] [aria-checked="true"]') ??
      root.current?.querySelector<HTMLElement>('[role="menu"] [role^="menuitem"]');
    first?.focus();
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const list = [...(root.current?.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]') ?? [])];
    const k = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(k + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className={`menu-wrap ${className}`.trim()} ref={root}>
      <button
        ref={btn}
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-items`}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {button}
      </button>
      {open && (
        <div className={`menu menu-${align}`} id={id}>
          {/* the text above is not a menu item: the menu points to it, so it is read when the menu opens */}
          {header && (
            <div className="menu-header" id={`${id}-header`}>
              {header}
            </div>
          )}
          <div
            className="menu-items"
            id={`${id}-items`}
            role="menu"
            aria-label={label}
            aria-describedby={header ? `${id}-header` : undefined}
            onKeyDown={onKey}
          >
            {items.map((it) =>
              it.href ? (
                <a
                  key={it.key}
                  role="menuitem"
                  className="menu-item"
                  href={it.href}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={-1}
                  onClick={() => close(false)}
                >
                  {it.label}
                </a>
              ) : it.checked === undefined ? (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  lang={it.lang}
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    it.onSelect?.();
                  }}
                >
                  {it.label}
                </button>
              ) : (
                <button
                  key={it.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={it.checked}
                  className="menu-item"
                  lang={it.lang}
                  tabIndex={-1}
                  onClick={() => {
                    close();
                    it.onSelect?.();
                  }}
                >
                  {it.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
