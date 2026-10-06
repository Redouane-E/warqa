// What a new book starts with (AI and voices, "New books"): the model set, models changed by hand, the voices and
// the local helper. Kept in ${warqaHome()}/defaults.json (the web app: /home/.warqa in the browser's storage); never
// holds a key. A book copies them when it is made, then keeps its own in warqa.json (the CLI reads only that).
// The same validation applies these fields to a book's settings.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as P from '@warqa/pipeline';
import { z } from 'zod';
import { warqaHome } from './keys.js';

export const defaultsFile = (): string => join(warqaHome(), 'defaults.json');

const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
/** An engine's voice name: Azure puts it into SSML as it is, so nothing that could leave the attribute. */
export const VOICE_ID = /^[\w.:-]{1,80}$/;
const MODEL_ID = /^[a-z][a-z0-9-]*:.+$/;

/** The AI fields of a book's settings or of the defaults (a patch: null clears, absent keeps). */
export const AiPatch = z.object({
  preset: z.string().max(40).nullable().optional(),
  models: z.record(z.string(), z.string().max(200)).optional(),
  tts: z
    .object({
      provider: z.enum(P.TTS_IDS).optional(),
      voices: z.record(z.string(), z.string().max(120)).optional(),
      rate: z
        .string()
        .regex(/^[+-]?\d{1,2}%$/)
        .nullable()
        .optional(),
      tashkeel: z.boolean().optional(),
    })
    .optional(),
  worker: z.string().max(300).nullable().optional(),
});
export type AiPatch = z.infer<typeof AiPatch>;

/** What `AiPatch` applies to: a book's pipeline settings, or the defaults. */
export interface AiSettings {
  preset?: string | undefined;
  models: Record<string, string>;
  tts: { provider?: string; voices: Record<string, string>; rate?: string | undefined; tashkeel: boolean };
  worker?: string | undefined;
}

export class BadSetting extends Error {}

/** Apply a patch; throws `BadSetting` with a sentence for a person when a value is wrong. */
export function applyAiPatch(target: AiSettings, s: AiPatch): void {
  if (s.preset !== undefined) {
    if (s.preset && !P.PRESETS.some((x) => x.id === s.preset)) throw new BadSetting(`unknown preset "${s.preset}"`);
    target.preset = s.preset || undefined;
  }
  if (s.models) {
    const models: Record<string, string> = {};
    for (const [role, m] of Object.entries(s.models)) {
      if (!(P.ROLES as string[]).includes(role)) throw new BadSetting(`unknown role "${role}"`);
      const v = m.trim();
      if (!v) continue;
      if (!MODEL_ID.test(v)) throw new BadSetting(`model ids look like "provider:model", got "${v}"`);
      models[role] = v;
    }
    target.models = models;
  }
  if (s.tts) {
    if (s.tts.provider) target.tts.provider = s.tts.provider;
    if (s.tts.voices) {
      const voices: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.tts.voices)) {
        const id = v.trim();
        if (!LANG.test(k) || !id) continue;
        if (!VOICE_ID.test(id)) throw new BadSetting(`"${id}" is not a voice name`);
        voices[k] = id;
      }
      target.tts.voices = voices;
    }
    if (s.tts.rate !== undefined) target.tts.rate = s.tts.rate || undefined;
    if (s.tts.tashkeel !== undefined) target.tts.tashkeel = s.tts.tashkeel;
  }
  if (s.worker !== undefined) {
    const w = (s.worker ?? '').trim();
    if (w && !/^https?:\/\/[^\s]+$/.test(w))
      throw new BadSetting('the worker address must start with http:// or https://');
    target.worker = w || undefined;
  }
}

const Stored = z.object({
  preset: z.string().max(40).optional(),
  models: z.record(z.string(), z.string().max(200)).default({}),
  tts: z
    .object({
      provider: z.enum(P.TTS_IDS).optional(),
      voices: z.record(z.string(), z.string().max(120)).default({}),
      rate: z.string().optional(),
      tashkeel: z.boolean().default(false),
    })
    .prefault({}),
  worker: z.string().max(300).optional(),
});
export type AiDefaults = z.infer<typeof Stored>;

/** The defaults for new books (empty when none were chosen, or the file cannot be read). */
export function loadDefaults(): AiDefaults {
  const f = defaultsFile();
  try {
    if (existsSync(f)) return Stored.parse(JSON.parse(readFileSync(f, 'utf8')));
  } catch {
    /* a broken file counts as none */
  }
  return Stored.parse({});
}

/** Apply a patch to the defaults and save them. */
export function saveDefaults(patch: AiPatch): AiDefaults {
  const d = loadDefaults();
  applyAiPatch(d, patch);
  const clean = Stored.parse(JSON.parse(JSON.stringify(d)));
  mkdirSync(warqaHome(), { recursive: true });
  const f = defaultsFile();
  const tmp = `${f}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`);
  renameSync(tmp, f);
  return clean;
}
