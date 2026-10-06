// What the generated forms need to know about JSON Schemas (no React here, so it can be tested): a value to start
// from, which variant of a union a value belongs to and what sets it apart, a line standing for a folded value,
// and whether a path is translated.
import type { JsonSchema } from '../../../shared/types';

export type Path = (string | number)[];

/** The types a schema allows ("type": "string", or ["string", "number"]). */
export const typesOf = (s: JsonSchema): string[] =>
  Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : [];

/** No type, no choice, no shape: any JSON value (a cue's free arguments). */
export const isAny = (s: JsonSchema): boolean =>
  !typesOf(s).length && !('const' in s) && !Array.isArray(s.enum) && !(s.anyOf ?? s.oneOf);

/** A value to start from: the schema's default, else the smallest thing that fits it. */
export function defaultFor(s: JsonSchema | undefined): unknown {
  if (!s) return undefined;
  if ('default' in s) return structuredClone(s.default);
  if ('const' in s) return s.const;
  const variants = (s.anyOf ?? s.oneOf) as JsonSchema[] | undefined;
  if (variants?.length) return defaultFor(variants[0]);
  if (Array.isArray(s.enum)) return s.enum[0];
  switch (typesOf(s)[0]) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return false;
    case 'array': {
      const prefix = s.prefixItems as JsonSchema[] | undefined;
      if (prefix) return prefix.map(defaultFor);
      const n = typeof s.minItems === 'number' ? s.minItems : 0;
      return Array.from({ length: n }, () => defaultFor(s.items as JsonSchema));
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, JsonSchema>;
      for (const k of (s.required ?? []) as string[]) out[k] = defaultFor(props[k]);
      return out;
    }
  }
  return undefined;
}

const typeOfValue = (v: unknown) =>
  Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v;

/** Does a value fit a variant: its constant, its type and, for an object, its required and known keys? */
export function fits(s: JsonSchema, v: unknown): boolean {
  if ('const' in s) return s.const === v;
  const t = typeOfValue(v);
  const types = typesOf(s);
  if (t === 'number') return types.includes('number') || (types.includes('integer') && Number.isInteger(v));
  if (t !== 'object') return types.includes(t);
  if (!types.includes('object')) return false;
  const o = v as Record<string, unknown>;
  const props = (s.properties ?? {}) as Record<string, JsonSchema>;
  for (const [k, p] of Object.entries(props)) if ('const' in p && o[k] !== p.const) return false;
  if (!((s.required ?? []) as string[]).every((k) => k in o)) return false;
  // a closed shape: every key of the value is one of its properties
  return !!s.additionalProperties || !Object.keys(props).length || Object.keys(o).every((k) => k in props);
}

/** The variant of a union a value belongs to (the first that fits it). */
export function variantOf(variants: JsonSchema[], v: unknown): number {
  const k = variants.findIndex((s) => fits(s, v));
  return k < 0 ? 0 : k;
}

/**
 * What sets a variant apart from the others: its constant, else (an object) its first required key that no other
 * object variant requires, else its type ("string", "number"…).
 */
export function variantKey(variants: JsonSchema[], k: number): { kind: 'const' | 'key' | 'type'; value: string } {
  const s = variants[k]!;
  if ('const' in s) return { kind: 'const', value: String(s.const) };
  if (typesOf(s).includes('object')) {
    const others = new Set(variants.filter((_, j) => j !== k).flatMap((o) => (o.required ?? []) as string[]));
    const own = ((s.required ?? []) as string[]).find((r) => !others.has(r));
    if (own) return { kind: 'key', value: own };
  }
  const t = typesOf(s)[0] ?? 'other';
  return { kind: 'type', value: t === 'integer' ? 'number' : t };
}

/** A line that stands for a value folded away ("7 · + · (−3)", "Add the opposite"). */
export function preview(v: unknown, depth = 0): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v))
    return v
      .slice(0, 6)
      .map((x) => preview(x, depth + 1))
      .filter(Boolean)
      .join(depth ? ' ' : ' · ');
  const o = v as Record<string, unknown>;
  for (const k of ['t', 'text', 'title', 'label', 'term', 'prompt', 'value', 'id'])
    if (o[k] !== undefined && typeof o[k] !== 'object') return String(o[k]);
  return Object.values(o)
    .filter((x) => typeof x === 'string' || typeof x === 'number')
    .slice(0, 3)
    .join(' · ');
}

/** Does a localizable pattern ("items.*.text", "wrong.*") cover this path? "*" stands for any one step. */
export const translated = (path: Path, text: string[] | undefined): boolean =>
  !!text?.some((pattern) => {
    const parts = pattern.split('.');
    return parts.length === path.length && parts.every((p, k) => p === '*' || p === String(path[k]));
  });

/** A number being typed: "-", "1.", "" are on the way to one, not one yet. */
export const numberOf = (text: string): number | undefined => {
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text.trim())) return undefined;
  return Number(text);
};

/** Text that may be a number ("3", "-0.5") where both are allowed (an answer's value): numbers stay numbers. */
export const textOrNumber = (text: string): string | number => {
  const n = numberOf(text);
  return n !== undefined && String(n) === text.trim() ? n : text;
};
