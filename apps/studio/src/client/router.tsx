// A small history router: the studio has five screens, no need for a routing library.
// Routes are written without the base path ("/project/x"); the address bar shows it ("/warqa/project/x").
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react';
import { stripBase, withBase } from './base';

const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const href = withBase(to);
  if (href === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  notify();
  window.scrollTo({ top: 0 });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const u = new URL(href, location.origin);
  return { path: stripBase(u.pathname), query: u.searchParams };
}

/** Match "/project/:id/lesson/:lid" against a path. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = s[i]!;
    if (a.startsWith(':')) out[a.slice(1)] = decodeURIComponent(b);
    else if (a !== b) return null;
  }
  return out;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={withBase(to)} onClick={click} {...rest} />;
}
