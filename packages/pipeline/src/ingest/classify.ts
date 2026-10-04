// Text heuristics shared by the text-layer extractor, the OCR path and section detection: language, list
// markers, captions, equations and chapter-like headings in Arabic, French and English.
import type { BlockKind } from './document.js';

const ARABIC_LETTER_G = /[ؠ-يٮ-ۓەۺ-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/g;
const LATIN_LETTER_G = /[A-Za-zÀ-ɏ]/g;
const FRENCH_MARKS = /[éèêëàâîïôûùüÿçœæÉÈÊËÀÂÎÏÔÛÙÜÇŒÆ]/g;
const FR_WORDS = new Set(
  'le la les des une un est et en du dans pour que qui sur au aux par avec ce cette ces sont pas plus ou nous vous il elle on son sa ses leur entre comme deux être'.split(
    ' ',
  ),
);
const EN_WORDS = new Set(
  'the of and to in is are that for with this as on by be an it from or which at was were these those its their two each between'.split(
    ' ',
  ),
);

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** Arabic and Latin letter counts (the input to direction and language guesses). */
export function scriptCounts(s: string): { arabic: number; latin: number } {
  return { arabic: count(s, ARABIC_LETTER_G), latin: count(s, LATIN_LETTER_G) };
}

/** True when Arabic letters outnumber Latin ones: the line or block reads right to left. */
export function isRtlText(s: string): boolean {
  const { arabic, latin } = scriptCounts(s);
  return arabic > latin;
}

/**
 * Language of a block: ar when Arabic letters dominate, else fr when French accents or stopwords win, else en.
 * Undefined when there are (almost) no letters, e.g. an equation.
 */
export function detectLang(s: string): string | undefined {
  const { arabic, latin } = scriptCounts(s);
  if (arabic + latin < 2) return undefined;
  if (arabic > latin) return 'ar';
  const words = s
    .toLowerCase()
    .split(/[^a-zà-ÿœæ']+/)
    .filter(Boolean);
  let fr = count(s, FRENCH_MARKS) * 0.5;
  let en = 0;
  for (const w of words) {
    if (FR_WORDS.has(w) || /^[ldjnmstcq]'/.test(w)) fr++;
    if (EN_WORDS.has(w)) en++;
  }
  return fr > en ? 'fr' : 'en';
}

/** Bullets, "1.", "2)", "a)", "(iv)", Arabic-Indic numbering "١-" and Arabic letter markers "أ-", "ب)". */
const LIST_MARKER =
  /^\s*(?:[•●○◦▪▫■□►▸‣⁃∙·*–—-]|\(?(?:\d{1,3}|[٠-٩]{1,3}|[۰-۹]{1,3})\s?[.)\-–]|\(?[a-zA-Z]\)|\((?:[ivxIVX]{1,4}|[a-zA-Z])\)|[ء-ي]\s?[-–)])(?=\s)/;

export const listMarker = (s: string): string | undefined => LIST_MARKER.exec(s)?.[0].trim();

const CAPTION =
  /^\s*(?:figure|fig\.|table|tableau|tab\.|graph(?:ique)?|sch[ée]ma|illustration|photo|document|doc\.|image|chart|diagram(?:me)?|شكل|الشكل|جدول|الجدول|صورة|الصورة|رسم|الرسم|مخطط|الوثيقة|وثيقة)\s*(?:[\d٠-٩۰-۹IVX]+|[:.\-–])/i;

export const isCaption = (s: string): boolean => CAPTION.test(s) && s.length < 400;

const MATH_CHAR_G =
  /[\d٠-٩۰-۹+\-−–×÷*/=<>≤≥≠≈±∓√∛∑∏∫∂∞πθαβγδλμσφωΔΣΠΩ^_|()[\]{}.,:;'′″°%‰∈∉⊂⊃∪∩∀∃→←↔⇒⇔∠⊥∥≡∝∼⋅·∀-⋿←-⇿]/g;
const MATH_OP = /[=<>≤≥≠≈±+−×÷√∑∫∞→⇒⇔∈∪∩≡^]/;

/**
 * Mostly math: digits, operators and symbols with at most a few single-letter variables and no real words.
 * "3 + (−3) = 0" and "0.25 = 25/100" are equations; "Exercise 3" is not.
 */
export function isMathLike(s: string): boolean {
  const t = s.replace(/\s+/g, '');
  if (t.length < 3 || t.length > 200 || !MATH_OP.test(t)) return false;
  // Words of two or more letters (Latin or Arabic) besides function names mean prose.
  const words = s.match(/[A-Za-zÀ-ɏؠ-ي]{2,}/g) ?? [];
  const prose = words.filter(
    (w) => !/^(?:sin|cos|tan|cot|log|ln|exp|lim|max|min|mod|gcd|pgcd|ppcm|det|dx|dy|dt)$/i.test(w),
  );
  if (prose.length > 1 || prose.some((w) => w.length > 3)) return false;
  return count(t, MATH_CHAR_G) / t.length >= 0.6;
}

// Chapter-like headings: "Chapter 3", "Chapitre 2", "Leçon 1", "Unit 4", "الفصل الأول", "الدرس ٣", "1. Title".
const ORDINALS =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|' +
  'premier|première|premiere|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|deuxième|deuxieme|second|seconde|troisième|troisieme|quatrième|quatrieme|cinquième|cinquieme|sixième|sixieme|septième|septieme|huitième|huitieme|neuvième|neuvieme|dixième|dixieme|' +
  '(?:ال)?(?:أول|اول|أولى|اولى|ثاني|ثانية|ثالث|ثالثة|رابع|رابعة|خامس|خامسة|سادس|سادسة|سابع|سابعة|ثامن|ثامنة|تاسع|تاسعة|عاشر|عاشرة|حادي|حادية)|' +
  'واحد|اثنان|ثلاثة|أربعة|خمسة)';
const NUM = '(?:\\d{1,3}|[٠-٩]{1,3}|[۰-۹]{1,3}|[IVXLC]{1,6}\\b|[A-Z]\\b)';
const CHAPTER_WORDS =
  'chapter|chap\\.|lesson|chapitre|leçon|lecon|séquence|sequence|séance|seance|thème|theme|الفصل|فصل|الدرس|درس|الحصة|الموضوع';
const UNIT_WORDS =
  'unit|part|module|book|unité|unite|partie|livre|bloc|الوحدة|وحدة|المحور|محور|المجال|مجال|الباب|باب|الجزء|جزء|القسم|قسم';
const chapterRe = new RegExp(`^\\s*(?:${CHAPTER_WORDS})\\s*[:.\\-–]?\\s*(?:${NUM}|${ORDINALS})(?![\\p{L}])`, 'iu');
const unitRe = new RegExp(`^\\s*(?:${UNIT_WORDS})\\s*[:.\\-–]?\\s*(?:${NUM}|${ORDINALS})(?![\\p{L}])`, 'iu');
const numberedRe = /^\s*(?:\d{1,2}|[٠-٩]{1,2})\s*[.)\-–:]\s+\S/;

/** 'chapter' for chapter/lesson headings, 'unit' for unit/part headings, 'numbered' for "3. Title", else undefined. */
export function headingKind(s: string): 'chapter' | 'unit' | 'numbered' | undefined {
  const t = s.trim();
  if (t.length > 160) return undefined;
  if (chapterRe.test(t)) return 'chapter';
  if (unitRe.test(t)) return 'unit';
  if (numberedRe.test(t) && !/^\s*\d+\.\d/.test(t)) return 'numbered';
  return undefined;
}

/** Index, glossary, answers, bibliography…: the start of back matter when it follows the last chapter. */
export const isBackMatterTitle = (s: string): boolean =>
  /^\s*(?:index|glossary|glossaire|lexique|bibliograph|references|références|annexes?|appendix|appendices|answers|solutions|corrigés?|table des matières|contents|sommaire|الفهرس|فهرس|المراجع|مراجع|الملاحق|ملحق|المصطلحات|معجم|الحلول|حلول|الأجوبة)/i.test(
    s,
  );

/** A table-of-contents line: a title, dot leaders, then a page number. */
export const isTocLine = (s: string): boolean =>
  /(?:\.\s?){3,}|…{2,}|_{3,}/.test(s) && /(?:\d{1,4}|[٠-٩]{1,4})\s*$/.test(s.trim());

/** Kind of a short text block from its content alone (no geometry). */
export function textKind(s: string): Exclude<BlockKind, 'heading' | 'figure' | 'table'> {
  if (isCaption(s)) return 'caption';
  if (listMarker(s)) return 'list';
  if (isMathLike(s)) return 'equation';
  return 'paragraph';
}
