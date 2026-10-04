// Messages between the page and the Web Worker that runs the studio server. An HTTP request goes over as one
// message; its response comes back as a head, body chunks (transferred, not copied) and an end, so streams
// (Server-Sent Events of running jobs) work like over a socket.

export interface InitOptions {
  /** The app's base path ("/" or e.g. "/warqa/"). */
  base: string;
  /** Test-only scripted model (no network), enabled by ?warqa-fake=1 or VITE_WARQA_FAKE=1. */
  fake: boolean;
}

export interface WorkerInfo {
  /** Books and keys survive a reload (IndexedDB works). */
  persistent: boolean;
  fake: boolean;
  version: string;
}

export type ToWorker =
  | { t: 'init'; opts: InitOptions }
  | {
      t: 'req';
      id: number;
      method: string;
      url: string;
      headers: [string, string][];
      body?: ArrayBuffer;
    }
  | { t: 'abort'; id: number }
  /** Ask the tab that has the books open to let this one have them. */
  | { t: 'takeover' };

export type FromWorker =
  | { t: 'ready'; info: WorkerInfo }
  /** Another tab has the books open. */
  | { t: 'busy' }
  /** This tab gave the books to another tab. */
  | { t: 'released' }
  | { t: 'fatal'; message: string }
  | { t: 'head'; id: number; status: number; statusText: string; headers: [string, string][] }
  | { t: 'chunk'; id: number; data: Uint8Array }
  | { t: 'end'; id: number }
  | { t: 'fail'; id: number; message: string }
  /** Saving to the browser's storage failed (full, or blocked). */
  | { t: 'storage'; message: string }
  /** How many jobs are running (closing the tab would stop them). */
  | { t: 'jobs'; running: number };

/** Paths (after the base) that the worker answers; everything else is a static file of the app. */
export const SERVER_PATH = /^\/(api|books)(\/|$)/;
