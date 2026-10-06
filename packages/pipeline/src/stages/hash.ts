// The hash that says whether an original text changed (whitespace and Unicode forms do not count).
import { createHash } from 'node:crypto';

export const normText = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
export const srcHash = (s: string): string => createHash('sha1').update(normText(s)).digest('hex').slice(0, 12);
