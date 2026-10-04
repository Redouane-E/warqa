// The interface language (ar, fr, en): a tiny store, a hook, and locale-aware formatting.
import { CONTENT_LANGS, dirOf, EXTRA_LANG_INFO, LANG_INFO, langInfo } from '@warqa/i18n';
import { createContext, useContext } from 'react';
import { CATALOGS, type Msg, type MsgKey } from './messages';

export type UiLang = 'ar' | 'fr' | 'en';
export const UI_LANGS: UiLang[] = ['ar', 'fr', 'en'];
/** Languages a book is offered in first (the interface languages and Moroccan Darija). */
export const BOOK_LANGS: string[] = [...CONTENT_LANGS];
const STORE = 'warqa-studio:lang';

function initial(): UiLang {
  try {
    const v = localStorage.getItem(STORE);
    if (v && (UI_LANGS as string[]).includes(v)) return v as UiLang;
  } catch {
    /* storage unavailable */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const b = l.toLowerCase().split('-')[0];
    if (b && (UI_LANGS as string[]).includes(b)) return b as UiLang;
  }
  return 'en';
}

let current: UiLang = initial();
const listeners = new Set<() => void>();

export const getLang = () => current;
export function setLang(l: UiLang) {
  current = l;
  try {
    localStorage.setItem(STORE, l);
  } catch {
    /* storage unavailable */
  }
  applyDocument();
  for (const fn of listeners) fn();
}
export function subscribeLang(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function applyDocument() {
  document.documentElement.lang = current;
  document.documentElement.dir = dirOf(current);
}

export type Params = Record<string, string | number>;

export interface I18n {
  lang: UiLang;
  dir: 'rtl' | 'ltr';
  locale: string;
  t: (key: MsgKey, params?: Params) => string;
  num: (n: number, opts?: Intl.NumberFormatOptions) => string;
  usd: (n: number) => string;
  ago: (ms: number) => string;
  langName: (code: string) => string;
  bytes: (n: number) => string;
}

export function makeI18n(lang: UiLang): I18n {
  const locale = LANG_INFO[lang].locale;
  const cat = CATALOGS[lang]!;
  const plural = new Intl.PluralRules(locale);
  const nf = new Intl.NumberFormat(locale);
  const num = (n: number, opts?: Intl.NumberFormatOptions) =>
    (opts ? new Intl.NumberFormat(locale, opts) : nf).format(n);
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([locale], { type: 'language' });
  } catch {
    names = undefined;
  }
  const t = (key: MsgKey, params: Params = {}): string => {
    let m: Msg = cat[key] ?? CATALOGS.en![key] ?? key;
    if (typeof m !== 'string') {
      const n = Number(params.n ?? 0);
      const rule = n === 0 && m.zero ? 'zero' : plural.select(n);
      m = (m as Record<string, string>)[rule] ?? m.other;
    }
    return m.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = params[k];
      if (v === undefined) return `{${k}}`;
      return typeof v === 'number' ? num(v) : v;
    });
  };
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return {
    lang,
    dir: dirOf(lang),
    locale,
    t,
    num,
    usd: (n) =>
      num(n, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: n > 0 && n < 0.1 ? 3 : 2,
      }),
    ago: (ms) => {
      const s = (ms - Date.now()) / 1000;
      const a = Math.abs(s);
      if (a < 60) return rtf.format(Math.round(s), 'second');
      if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
      if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
      if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(ms);
    },
    langName: (code) => {
      // content languages that are not interface languages (Darija): our own name, with the native one
      if (EXTRA_LANG_INFO[code]) {
        const native = langInfo(code).name;
        const local = t(`lang.${code}` as MsgKey);
        return local === native || local === `lang.${code}` ? native : `${local} (${native})`;
      }
      try {
        const n = names?.of(code);
        if (n && n.toLowerCase() !== code.toLowerCase()) return n;
      } catch {
        /* invalid code */
      }
      return code;
    },
    bytes: (n) =>
      n > 1e6 ? `${num(n / 1e6, { maximumFractionDigits: 1 })} MB` : `${num(Math.max(1, Math.round(n / 1e3)))} kB`,
  };
}

export const I18nContext = createContext<I18n>(makeI18n('en'));
export const useI18n = () => useContext(I18nContext);
