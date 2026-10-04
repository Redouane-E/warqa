// node:vm for the browser build. Component packs (pipeline.components in warqa.json) are code; on the desktop
// the user installs them on purpose. In the browser a book can arrive in a shared backup, and running its code
// here would give it the keys kept in this browser: packs are refused, with an explanation.
import { DesktopOnlyError } from './child_process';

export function runInNewContext(_code: string, _sandbox?: unknown, opts?: { filename?: string } | string): never {
  const file = typeof opts === 'string' ? opts : opts?.filename;
  throw new DesktopOnlyError(
    `This book uses a component pack${file ? ` (${file})` : ''}: custom components written as code, which Warqa runs only in its desktop version so that a shared book can never run code next to your keys. The component pack`,
  );
}
export const runInContext = runInNewContext;
export const runInThisContext = runInNewContext;
export const createContext = <T>(o: T) => o;
export default { runInNewContext, runInContext, runInThisContext, createContext };
