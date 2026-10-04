import { ar } from './catalog/ar.js';
import { ary } from './catalog/ary.js';
import { en, type MessageKey } from './catalog/en.js';
import { fr } from './catalog/fr.js';
import { baseLang, langInfo } from './lang.js';
import { formatNumber } from './numbers.js';

export type { MessageKey };
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralMessage;
export type Catalog = Record<MessageKey, Message>;

const CATALOGS: Record<string, Catalog> = { en: en as unknown as Catalog, fr, ar, ary };

/** Register or override a catalog (community translations, book-specific wording). */
export function registerCatalog(lang: string, messages: Partial<Catalog>): void {
  CATALOGS[lang] = { ...(CATALOGS[lang] ?? CATALOGS.en!), ...messages } as Catalog;
}

export const catalogLangs = (): string[] => Object.keys(CATALOGS);

export type Params = Record<string, string | number>;

export interface TranslateOptions {
  digits?: 'latn' | 'arab';
}

/**
 * Translate a UI message. Numeric params are formatted for the language; a plural message picks its form
 * from the `n` param (Arabic has zero/one/two/few/many/other).
 */
export function t(lang: string, key: MessageKey, params: Params = {}, opts: TranslateOptions = {}): string {
  const cat = CATALOGS[lang] ?? CATALOGS[baseLang(lang)] ?? CATALOGS.en!;
  let msg: Message | undefined = cat[key] ?? CATALOGS.en![key];
  if (msg === undefined) return key;
  if (typeof msg !== 'string') {
    const n = Number(params.n ?? 0);
    const rule = new Intl.PluralRules(langInfo(lang).locale).select(n);
    msg = msg[rule] ?? msg.other;
  }
  return msg.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) return `{${name}}`;
    return typeof v === 'number' ? formatNumber(v, lang, { digits: opts.digits ?? 'latn' }) : v;
  });
}

/** A translator bound to one language. */
export const translator =
  (lang: string, opts: TranslateOptions = {}) =>
  (key: MessageKey, params?: Params) =>
    t(lang, key, params, opts);

/** Keys missing from a catalog compared with English (used by tests and the studio's translation view). */
export function missingKeys(lang: string): MessageKey[] {
  const cat = CATALOGS[lang];
  if (!cat) return Object.keys(en) as MessageKey[];
  return (Object.keys(en) as MessageKey[]).filter((k) => cat[k] === undefined);
}
