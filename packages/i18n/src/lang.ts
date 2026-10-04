/** Languages Warqa ships UI catalogs for. Lesson content may use any BCP-47 tag; these three are first-class. */
export const LANGS = ['ar', 'fr', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export interface LangInfo {
  /** Native name, for language pickers. */
  name: string;
  dir: 'rtl' | 'ltr';
  /** Locale used for Intl formatting. Moroccan Arabic defaults keep Western digits. */
  locale: string;
  /** Speaking rate used for synthetic timings when a lesson has no audio (characters per second). */
  cps: number;
}

export const LANG_INFO: Record<Lang, LangInfo> = {
  ar: { name: 'العربية', dir: 'rtl', locale: 'ar-MA', cps: 13 },
  fr: { name: 'Français', dir: 'ltr', locale: 'fr-FR', cps: 15 },
  en: { name: 'English', dir: 'ltr', locale: 'en-US', cps: 15 },
};

/**
 * More languages with full lesson support (writing rules, voices, player UI) that are not studio UI languages.
 * ary: Moroccan Arabic (Darija), written in Arabic script.
 */
export const CONTENT_LANGS = ['ar', 'fr', 'en', 'ary'] as const;

export const EXTRA_LANG_INFO: Record<string, LangInfo> = {
  ary: { name: 'الدارجة المغربية', dir: 'rtl', locale: 'ar-MA', cps: 14 },
};

/** Arabic varieties: they share Arabic text processing, voices fall back to Moroccan Arabic voices. */
export const ARABIC_VARIETIES = new Set(['ar', 'ary', 'arq', 'aeb', 'arz', 'apc', 'acm', 'afb']);
export const isArabic = (tag: string): boolean => ARABIC_VARIETIES.has(baseLang(tag));

const RTL = new Set(['fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi', 'ckb', 'dv', ...ARABIC_VARIETIES]);

/** Base language subtag: "ar-MA" → "ar". */
export const baseLang = (tag: string): string => tag.toLowerCase().split(/[-_]/)[0] ?? tag;

export const isLang = (tag: string): tag is Lang => (LANGS as readonly string[]).includes(tag);

/** Writing direction of any language tag. */
export const dirOf = (tag: string): 'rtl' | 'ltr' => (RTL.has(baseLang(tag)) ? 'rtl' : 'ltr');

/** Info for any tag, falling back to English metrics with the right direction. */
export function langInfo(tag: string): LangInfo {
  const b = baseLang(tag);
  if (isLang(b)) return LANG_INFO[b];
  if (EXTRA_LANG_INFO[b]) return EXTRA_LANG_INFO[b];
  return { name: tag, dir: dirOf(tag), locale: tag, cps: 15 };
}
