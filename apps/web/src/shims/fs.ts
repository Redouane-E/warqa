// node:fs for the browser build: the worker's virtual file system (worker/vfs.ts).
import { vfs } from '../worker/vfs';

type Fn<K extends keyof typeof vfs> = (typeof vfs)[K];
const bind = <K extends keyof typeof vfs>(k: K) => (vfs[k] as (...a: unknown[]) => unknown).bind(vfs) as Fn<K>;

export const existsSync = bind('existsSync');
export const statSync = bind('statSync');
export const lstatSync = bind('statSync');
// Node's typings say string | Buffer; callers pass an encoding when they want a string.
export const readFileSync = bind('readFileSync') as {
  (p: string, opts: 'utf8' | 'utf-8' | { encoding: 'utf8' | 'utf-8' }): string;
  (p: string, opts?: unknown): import('buffer').Buffer;
};
export const writeFileSync = bind('writeFileSync');
export const appendFileSync = bind('appendFileSync');
export const mkdirSync = bind('mkdirSync');
export const readdirSync = bind('readdirSync') as (p: string, opts?: unknown) => never;
export const renameSync = bind('renameSync');
export const rmSync = bind('rmSync');
export const rmdirSync = bind('rmdirSync');
export const unlinkSync = bind('unlinkSync');
export const copyFileSync = bind('copyFileSync');
export const cpSync = bind('cpSync');
export const mkdtempSync = bind('mkdtempSync');
export const chmodSync = bind('chmodSync');
export const utimesSync = bind('utimesSync');
export const accessSync = bind('accessSync');
export const realpathSync = Object.assign(bind('realpathSync'), { native: bind('realpathSync') });
export const createReadStream = bind('createReadStream');

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 };

const later =
  <A extends unknown[], R>(f: (...a: A) => R) =>
  async (...a: A): Promise<R> =>
    f(...a);

export const promises = {
  readFile: later(readFileSync as (p: string, o?: unknown) => unknown),
  writeFile: later(writeFileSync),
  appendFile: later(appendFileSync),
  mkdir: later(mkdirSync),
  readdir: later(readdirSync as (p: string, o?: unknown) => unknown),
  rename: later(renameSync),
  rm: later(rmSync),
  unlink: later(unlinkSync),
  stat: later(statSync),
  lstat: later(statSync),
  access: later(accessSync),
  copyFile: later(copyFileSync),
  cp: later(cpSync),
  mkdtemp: later(mkdtempSync),
  realpath: later(bind('realpathSync')),
};

export default {
  existsSync,
  statSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  copyFileSync,
  cpSync,
  mkdtempSync,
  chmodSync,
  utimesSync,
  accessSync,
  realpathSync,
  createReadStream,
  constants,
  promises,
};
