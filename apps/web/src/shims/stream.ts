// node:stream for the browser build: only Readable.toWeb over the virtual file system's read streams.
import type { WebReadStream } from '../worker/vfs';

export const Readable = {
  toWeb(s: WebReadStream): ReadableStream<Uint8Array> {
    if (!s || !(s as WebReadStream).__web) throw new Error('only virtual file streams can be read in the browser');
    return s.__web;
  },
  fromWeb(): never {
    throw new Error('Readable.fromWeb is not available in the browser');
  },
};

export default { Readable };
