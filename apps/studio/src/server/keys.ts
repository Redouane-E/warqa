// Provider keys live on this computer only: ~/.warqa/keys.json (or $WARQA_HOME/keys.json), mode 0600.
// They are applied to process.env so every pipeline call sees them, and are never written into a project
// or an export.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS } from '@warqa/pipeline';
import type { KeyInfo } from '../shared/types.js';

export const warqaHome = (): string => process.env.WARQA_HOME ?? join(homedir(), '.warqa');
export const keysFile = (): string => join(warqaHome(), 'keys.json');

/** Keys used by speech engines (the model providers' keys come from PROVIDERS). */
const TTS_KEYS: Record<string, string[]> = {
  AZURE_SPEECH_KEY: ['azure'],
  AZURE_SPEECH_REGION: ['azure'],
  ELEVENLABS_API_KEY: ['elevenlabs'],
  ELEVENLABS_VOICE_ID: ['elevenlabs'],
  GOOGLE_TTS_API_KEY: ['google'],
};

/** Every variable the studio offers a field for, with who uses it. */
export function knownKeys(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of PROVIDERS) for (const e of p.env) (out[e] ??= []).push(p.id);
  for (const [k, v] of Object.entries(TTS_KEYS)) (out[k] ??= []).push(...v.map((x) => `speech:${x}`));
  // OpenAI and Gemini keys also power their speech engines
  out.OPENAI_API_KEY?.push('speech:openai');
  out.GEMINI_API_KEY?.push('speech:gemini');
  return out;
}

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Values of the environment before the studio applied any stored key (so removing a key restores them). */
const original = new Map<string, string | undefined>();

export function loadKeys(): Record<string, string> {
  const f = keysFile();
  if (!existsSync(f)) return {};
  try {
    const data = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(data).filter(
        (e): e is [string, string] => NAME.test(e[0]) && typeof e[1] === 'string' && e[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function setEnv(name: string, value: string | undefined) {
  if (!original.has(name)) original.set(name, process.env[name]);
  if (value === undefined) {
    const o = original.get(name);
    if (o === undefined) delete process.env[name];
    else process.env[name] = o;
  } else process.env[name] = value;
}

/** Apply stored keys to process.env (stored keys win over the shell's). */
export function applyKeys(): void {
  for (const [k, v] of Object.entries(loadKeys())) setEnv(k, v);
}

/** Merge a patch ({NAME: value | null}) into the key file and the environment. */
export function saveKeys(patch: Record<string, unknown>): void {
  const keys = loadKeys();
  for (const [k, v] of Object.entries(patch)) {
    if (!NAME.test(k)) throw new Error(`"${k}" is not a valid variable name (UPPER_CASE letters, digits and _)`);
    if (v === null || v === '') {
      delete keys[k];
      setEnv(k, undefined);
    } else if (typeof v === 'string') {
      const value = v.trim();
      if (value.length > 4096 || /[\r\n]/.test(value)) throw new Error(`the value of ${k} is not a key`);
      keys[k] = value;
      setEnv(k, value);
    } else throw new Error(`the value of ${k} must be a string or null`);
  }
  const dir = warqaHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = keysFile();
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
  chmodSync(f, 0o600);
}

const mask = (v: string) => `••••${v.length > 8 ? v.slice(-4) : ''}`;

/** Masked view of the keys: only the last 4 characters are ever sent to the browser. */
export function maskedKeys(): KeyInfo[] {
  const stored = loadKeys();
  const known = knownKeys();
  const names = [...new Set([...Object.keys(known), ...Object.keys(stored)])];
  return names.map((name) => {
    const s = stored[name];
    const env = process.env[name];
    const value = s ?? env;
    return {
      name,
      set: !!value,
      ...(value ? { masked: mask(value), source: s ? ('studio' as const) : ('env' as const) } : {}),
      usedBy: known[name] ?? [],
    };
  });
}
