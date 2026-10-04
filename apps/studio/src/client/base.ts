// The path the app is served under: "/" for the local studio, e.g. "/warqa/" when the web app is hosted on
// GitHub Pages. Every URL the browser asks for (API, player bundle, exported books, screens) goes under it.

/** The base path, with a trailing slash. */
export const BASE: string = (import.meta.env?.BASE_URL ?? '/').replace(/\/*$/, '/');

/** "/api/status" → "<base>api/status" (unchanged when the base is "/"). */
export const withBase = (path: string): string => BASE + path.replace(/^\/+/, '');

/** "<base>project/x" → "/project/x" (the router's view of a location). */
export function stripBase(pathname: string): string {
  if (BASE === '/') return pathname;
  if (pathname === BASE.slice(0, -1)) return '/';
  return pathname.startsWith(BASE) ? `/${pathname.slice(BASE.length)}` : pathname;
}
