// Exact number input and display for answers in any of Warqa's languages.
// Portions derived from Papermorph (MIT): exact rational grading (engine.js `rat`), extended to BigInt,
// Arabic-Indic/Persian digits, the Arabic decimal separator and decimal commas.
import { baseLang, langInfo } from './lang.js';

/** An exact rational number n/d with d > 0, in lowest terms. */
export interface Rational {
  n: bigint;
  d: bigint;
}

const DIGIT_BLOCKS = [
  0x0660 /* Arabic-Indic ٠ */, 0x06f0 /* Extended (Persian/Urdu) ۰ */, 0x0966 /* Devanagari */, 0xff10 /* fullwidth */,
];
const MINUS = /[−‐‑‒–—﹣－]/g;

/** Map every decimal digit to ASCII, ٫ to ".", drop ٬ and narrow spaces, and unify minus signs to "-". */
export function normalizeDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const block = DIGIT_BLOCKS.find((b) => c >= b && c <= b + 9);
    if (block !== undefined) out += String(c - block);
    else if (c === 0x066b)
      out += '.'; // Arabic decimal separator
    else if (c === 0x066c || c === 0x2009 || c === 0x202f || c === 0x00a0)
      continue; // Arabic thousands sep, thin/nbsp
    else out += ch;
  }
  return out.replace(MINUS, '-');
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

export function rational(n: bigint, d: bigint = 1n): Rational {
  if (d === 0n) throw new RangeError('denominator is zero');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

export const rationalEquals = (a: Rational, b: Rational): boolean => a.n * b.d === b.n * a.d;
export const toNumber = (r: Rational): number => Number(r.n) / Number(r.d);
export const isLowestTerms = (n: bigint, d: bigint): boolean => gcd(n, d) === 1n;

function decimal(s: string): Rational | null {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const int = m[1] || '0';
  const frac = m[2] ?? '';
  return rational(BigInt(int + frac), 10n ** BigInt(frac.length));
}

export interface ParseOptions {
  /** Language of the reader: in French and Arabic a comma is a decimal separator. */
  lang?: string;
}

/** What a reader typed, parsed exactly, plus how it was written (for "lowest terms" checks). */
export interface ParsedNumber {
  value: Rational;
  /** Numerator/denominator as typed when the input was a fraction, e.g. "6/8" → [6, 8]. */
  typedFraction?: [bigint, bigint];
}

/**
 * Parse a typed answer exactly: integers, decimals (".5", "0,75" in fr/ar, "٠٫٧٥"), fractions ("3/4"),
 * mixed numbers ("2 1/4"), a leading sign, and one pair of surrounding parentheses ("(−3)").
 * Returns null for anything else, including a zero denominator.
 */
export function parseNumber(input: string, opts: ParseOptions = {}): ParsedNumber | null {
  let s = normalizeDigits(input).trim().replace(/\s+/g, ' ');
  if (/^\(.*\)$/.test(s)) s = s.slice(1, -1).trim();
  let sign = 1n;
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s[0] === '-') sign = -1n;
    s = s.slice(1).trim();
  }
  if (/^\(.*\)$/.test(s)) return null; // "-(3)" is an expression, not a number
  const commaDecimal = baseLang(opts.lang ?? 'en') !== 'en';
  if (s.includes(',')) {
    // "1,234" in English is a thousands separator; "0,75" (or any comma in fr/ar) is a decimal comma.
    if (commaDecimal || !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
      if ((s.match(/,/g) ?? []).length > 1 || s.includes('.')) return null;
      s = s.replace(',', '.');
    } else s = s.replace(/,/g, '');
  }
  let m = /^(\d+) (\d+)\/(\d+)$/.exec(s); // mixed number
  if (m) {
    const [, w, a, b] = m;
    if (BigInt(b!) === 0n) return null;
    const d = BigInt(b!);
    return { value: rational(sign * (BigInt(w!) * d + BigInt(a!)), d), typedFraction: [sign * BigInt(a!), d] };
  }
  m = /^(\d+(?:\.\d+)?) ?\/ ?(\d+(?:\.\d+)?)$/.exec(s); // fraction (decimal parts allowed, e.g. 1.5/2)
  if (m) {
    const a = decimal(m[1]!);
    const b = decimal(m[2]!);
    if (!a || !b || b.n === 0n) return null;
    const value = rational(sign * a.n * b.d, a.d * b.n);
    const typed: [bigint, bigint] | undefined = a.d === 1n && b.d === 1n ? [sign * a.n, b.n] : undefined;
    return typed ? { value, typedFraction: typed } : { value };
  }
  const v = decimal(s);
  return v ? { value: rational(sign * v.n, v.d) } : null;
}

/** Exact value of an answer key written by an author ("-7", "3/4", "0.75", "−2 1/4"). Throws if invalid. */
export function rationalOf(key: string | number): Rational {
  if (typeof key === 'number') {
    if (!Number.isFinite(key)) throw new RangeError(`not a finite number: ${key}`);
    const p = parseNumber(String(key));
    if (!p) throw new RangeError(`not a number: ${key}`);
    return p.value;
  }
  const p = parseNumber(key);
  if (!p) throw new RangeError(`not an exact number: ${key}`);
  return p.value;
}

export interface FormatOptions {
  /** "latn" (0-9, the default — also for Moroccan Arabic) or "arab" (٠-٩). */
  digits?: 'latn' | 'arab';
  maximumFractionDigits?: number;
  /** Use U+2212 MINUS SIGN for negatives (default true; it reads better next to math). */
  trueMinus?: boolean;
}

/** Format a number for display in a language, always with an explicit numbering system. */
export function formatNumber(v: number, lang: string, opts: FormatOptions = {}): string {
  const { digits = 'latn', maximumFractionDigits = 6, trueMinus = true } = opts;
  const nf = new Intl.NumberFormat(langInfo(lang).locale, {
    numberingSystem: digits,
    maximumFractionDigits,
    useGrouping: Math.abs(v) >= 10000,
  });
  const s = nf.format(Math.abs(v));
  if (v >= 0 || Object.is(v, 0)) return s;
  return (trueMinus ? '−' : '-') + s;
}

/** "−3" style display for plain author strings: turn ASCII hyphen-minus before a digit into U+2212. */
export const prettyMinus = (s: string): string => s.replace(/(^|[\s(=+×÷*/[{,<>≤≥])-(?=[\d.(a-zA-Z])/g, '$1−');
