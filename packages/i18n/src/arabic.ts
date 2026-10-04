// Arabic text helpers: detection, presentation-form repair, diacritics, matching and text-layer quality checks.
import { normalizeDigits } from './numbers.js';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\ufeff]/;
const ARABIC_G = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-\ufeff]/g;
const PRESENTATION = /[ﭐ-﷿ﹰ-\ufeff]/;
const PRESENTATION_G = /[ﭐ-﷿ﹰ-\ufeff]+/g;
/** Harakat, superscript alef, Quranic marks and tatweel. */
const TASHKEEL_G = /[ً-ٰٟۖ-ۭـ]/g;

export const hasArabic = (s: string): boolean => ARABIC.test(s);
export const isPresentationForm = (ch: string): boolean => PRESENTATION.test(ch);

/**
 * Turn Arabic presentation forms (contextual glyph code points some PDFs store) back into ordinary letters.
 * NFKC is applied only to those ranges, so ², ½, ﬁ and other compatibility characters stay as they are.
 */
export const normalizePresentationForms = (s: string): string =>
  s.replace(PRESENTATION_G, (run) => run.normalize('NFKC'));

/** Remove diacritics (tashkeel) and tatweel. */
export const stripTashkeel = (s: string): string => s.replace(TASHKEEL_G, '');

/** True when `vocalized` is `plain` with only diacritics added (used to validate automatic tashkeel). */
export const sameLetters = (plain: string, vocalized: string): boolean =>
  stripTashkeel(plain).normalize('NFC') === stripTashkeel(vocalized).normalize('NFC');

/**
 * Normalize text for answer matching in any language: digits to ASCII, Arabic letter variants folded
 * (أ إ آ ٱ → ا, ى → ي, ة → ه), diacritics and tatweel removed, Latin case and accents folded, spaces collapsed.
 */
export function normalizeForMatch(s: string): string {
  return normalizeDigits(normalizePresentationForms(s))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents (after NFKD)
    .normalize('NFC')
    .replace(TASHKEEL_G, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[\s\u200c\u200d]+/g, ' ')
    .replace(/[.,;:!?؟،؛"'«»“”()[\]]/g, '')
    .trim();
}

// Frequent Modern Standard Arabic words, used to tell logical-order text from visually reversed text.
const COMMON = new Set(
  (
    'من في على إلى أن عن مع هذا هذه التي الذي الذين كان كانت ما لا لم لن هو هي ذلك تلك بين كل بعد قبل حتى أو ثم قد ' +
    'عند إذا إذ هناك أي غير كما أيضا عدد العدد الأعداد يكون تكون يمكن نحن هم أنت الى او اذا ان ولا وهو وهي وفي ومن ' +
    'لقد إن انه أنه بها به له لها فيه فيها منه منها عليه عليها حيث عندما لكن بل مثل حول خلال ضد دون لدى سنة يوم ' +
    'الله قال قالت كتاب الكتاب العالم الدرس الفصل مثال المثال التمرين الجواب السؤال حل الحل جدا جميع بعض أكثر أقل'
  ).split(/\s+/),
);

export interface ArabicTextQuality {
  /** Share of non-space characters that are Arabic letters. */
  arabicRatio: number;
  /** Share of Arabic letters stored as presentation forms (normalizable). */
  presentationRatio: number;
  /** Private-use characters, U+FFFD and "(cid:N)" strings: signs of a missing ToUnicode map. */
  broken: number;
  /** Share of Arabic "words" that are a single letter (broken shaping/spacing). */
  oneLetterWordRatio: number;
  /** Common-word hits reading words forward vs reversed (reversed ≫ forward means visual order). */
  forwardHits: number;
  reversedHits: number;
  /** Words ending in "لا" (a reversed "ال") vs starting with "ال". */
  reversedArticle: number;
  forwardArticle: number;
  verdict: 'ok' | 'normalize' | 'reversed' | 'ocr' | 'not-arabic';
}

/** Score an extracted PDF text layer and say whether it can be used, normalized, un-reversed or needs OCR. */
export function arabicTextQuality(raw: string): ArabicTextQuality {
  const chars = raw.replace(/\s+/g, '');
  const arabic = raw.match(ARABIC_G)?.length ?? 0;
  const presentation = raw.match(/[ﭐ-﷿ﹰ-\ufeff]/g)?.length ?? 0;
  const broken = (raw.match(/[-�]/g)?.length ?? 0) + (raw.match(/\(cid:\d+\)/g)?.length ?? 0);
  const text = stripTashkeel(normalizePresentationForms(raw));
  const words = text.split(/[^؀-ۿ]+/).filter(Boolean);
  const reverse = (w: string) => [...w].reverse().join('');
  let forwardHits = 0;
  let reversedHits = 0;
  let one = 0;
  let forwardArticle = 0;
  let reversedArticle = 0;
  for (const w of words) {
    if (w.length === 1) one++;
    if (COMMON.has(w)) forwardHits++;
    if (COMMON.has(reverse(w))) reversedHits++;
    if (w.length > 3 && w.startsWith('ال')) forwardArticle++;
    if (w.length > 3 && w.endsWith('لا')) reversedArticle++;
  }
  const arabicRatio = chars.length ? arabic / chars.length : 0;
  const presentationRatio = arabic ? presentation / arabic : 0;
  const oneLetterWordRatio = words.length ? one / words.length : 0;
  let verdict: ArabicTextQuality['verdict'] = 'ok';
  if (broken > Math.max(3, chars.length * 0.01)) verdict = 'ocr';
  else if (arabicRatio < 0.2) verdict = arabic === 0 && chars.length > 0 ? 'not-arabic' : 'ok';
  else if (words.length >= 8 && oneLetterWordRatio > 0.3) verdict = 'ocr';
  else if (words.length >= 8 && reversedHits + reversedArticle > 2 * (forwardHits + forwardArticle) + 2)
    verdict = 'reversed';
  else if (presentationRatio > 0.05) verdict = 'normalize';
  return {
    arabicRatio,
    presentationRatio,
    broken,
    oneLetterWordRatio,
    forwardHits,
    reversedHits,
    reversedArticle,
    forwardArticle,
    verdict,
  };
}

/** Repair a line of visually ordered (reversed) Arabic: reverse each Arabic word's letters and the word order of Arabic runs. */
export function unreverseArabicLine(line: string): string {
  const fixed = normalizePresentationForms(line);
  const tokens = fixed.split(/(\s+)/);
  const out = tokens.map((t) => (ARABIC.test(t) && !/\d/.test(t) ? [...t].reverse().join('') : t));
  return out.reverse().join('');
}
