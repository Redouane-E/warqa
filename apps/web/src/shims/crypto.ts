// node:crypto for the browser build: synchronous hashes (the pipeline keys its caches with sha1) and random ids.

import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';

const ALGOS = { sha1, sha256, sha512, md5 } as const;

export function createHash(algorithm: string) {
  const fn = ALGOS[algorithm.toLowerCase().replace('-', '') as keyof typeof ALGOS];
  if (!fn) throw new Error(`hash "${algorithm}" is not available in the browser`);
  const h = fn.create();
  const api = {
    update(data: string | Uint8Array, encoding?: 'utf8' | 'base64' | 'hex') {
      h.update(
        typeof data === 'string'
          ? encoding && encoding !== 'utf8'
            ? new Uint8Array(Buffer.from(data, encoding))
            : utf8ToBytes(data)
          : data,
      );
      return api;
    },
    digest(encoding?: 'hex' | 'base64' | 'base64url'): string & Buffer {
      const out = h.digest();
      if (encoding === 'hex') return bytesToHex(out) as string & Buffer;
      if (encoding) return Buffer.from(out).toString(encoding) as string & Buffer;
      return Buffer.from(out) as string & Buffer;
    },
  };
  return api;
}

export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const randomBytes = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
export const webcrypto = globalThis.crypto;

export default { createHash, randomUUID, randomBytes, webcrypto };
