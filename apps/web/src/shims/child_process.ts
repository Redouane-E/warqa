// node:child_process for the browser build: a web page cannot start programs. Edge voices (Python), ffmpeg and
// the zip command need the desktop version of Warqa; this explains it instead of failing obscurely.
export class DesktopOnlyError extends Error {
  readonly code = 'EDESKTOP';
  constructor(what: string) {
    super(
      `${what} runs a program on your computer, which a web page cannot do: it needs the desktop version of Warqa (npx warqa studio).`,
    );
  }
}

const name = (cmd: unknown) => (typeof cmd === 'string' ? `"${cmd}"` : 'This feature');

export function spawn(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}
export function spawnSync(cmd: string) {
  const error = new DesktopOnlyError(name(cmd));
  return { pid: 0, status: null, signal: null, output: [], stdout: '', stderr: '', error };
}
export function exec(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}
export function execSync(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}
export function execFile(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}
export function execFileSync(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}
export function fork(cmd: string): never {
  throw new DesktopOnlyError(name(cmd));
}

export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork };
