import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arabicTextQuality,
  CONTENT_LANGS,
  dirOf,
  formatNumber,
  isArabic,
  isolate,
  LANGS,
  langInfo,
  missingKeys,
  normalizeDigits,
  normalizeForMatch,
  normalizePresentationForms,
  parseNumber,
  rational,
  rationalEquals,
  rationalOf,
  sameLetters,
  splitSentences,
  splitWords,
  stripBidiControls,
  stripTashkeel,
  t,
  unreverseArabicLine,
} from './index.js';

const val = (s: string, lang?: string) => {
  const p = parseNumber(s, lang ? { lang } : {});
  return p ? `${p.value.n}/${p.value.d}` : null;
};

describe('numbers', () => {
  it('normalizes Arabic-Indic, Persian digits, ٫ and minus signs', () => {
    expect(normalizeDigits('٣٫٥')).toBe('3.5');
    expect(normalizeDigits('۱۲۳')).toBe('123');
    expect(normalizeDigits('−٧')).toBe('-7');
    expect(normalizeDigits('١٬٢٣٤')).toBe('1234');
  });

  it('parses integers, decimals, fractions, mixed numbers and parentheses exactly', () => {
    expect(val('-7')).toBe('-7/1');
    expect(val('−7')).toBe('-7/1');
    expect(val('(−3)')).toBe('-3/1');
    expect(val('+5')).toBe('5/1');
    expect(val('.5')).toBe('1/2');
    expect(val('0.75')).toBe('3/4');
    expect(val('6/8')).toBe('3/4');
    expect(val('2 1/4')).toBe('9/4');
    expect(val('-2 1/4')).toBe('-9/4');
    expect(val('٣/٤')).toBe('3/4');
    expect(val('٠٫٧٥')).toBe('3/4');
  });

  it('treats the comma as a decimal separator in French and Arabic, as thousands in English', () => {
    expect(val('0,75', 'fr')).toBe('3/4');
    expect(val('0,75', 'ar')).toBe('3/4');
    expect(val('1,234', 'en')).toBe('1234/1');
    expect(val('1,234', 'fr')).toBe('617/500');
    expect(val('0,5', 'en')).toBe('1/2');
  });

  it('rejects zero denominators and garbage', () => {
    expect(val('3/0')).toBeNull();
    expect(val('abc')).toBeNull();
    expect(val('')).toBeNull();
    expect(val('1.2.3')).toBeNull();
    expect(val('-(3)')).toBeNull();
  });

  it('keeps the typed fraction for lowest-terms checks', () => {
    expect(parseNumber('6/8')?.typedFraction).toEqual([6n, 8n]);
    expect(parseNumber('3/4')?.typedFraction).toEqual([3n, 4n]);
  });

  it('round-trips integers and simple decimals typed with any digit set (property)', () => {
    const arabicDigits = (s: string) => s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 999 }), (i, f) => {
        const s = `${i}.${String(f).padStart(3, '0')}`;
        const a = parseNumber(s)!.value;
        const b = parseNumber(arabicDigits(s).replace('.', '٫'))!.value;
        return rationalEquals(a, b) && rationalEquals(a, rationalOf(s));
      }),
    );
  });

  it('formats with Western digits for ar-MA unless Arabic-Indic digits are asked for', () => {
    expect(formatNumber(-3, 'ar')).toBe('−3');
    expect(formatNumber(1234.5, 'fr')).toMatch(/^1\s?234,5$/);
    expect(formatNumber(12, 'ar', { digits: 'arab' })).toBe('١٢');
    expect(rationalEquals(rational(6n, 8n), rational(3n, 4n))).toBe(true);
  });
});

describe('arabic', () => {
  it('repairs presentation forms but leaves other compatibility characters alone', () => {
    // "سلام" in isolated/initial/medial/final presentation forms, followed by x² and ½.
    const pf = 'ﺳﻼﻡ x² ½';
    expect(normalizePresentationForms(pf)).toBe('سلام x² ½');
  });

  it('strips tashkeel and checks that diacritization kept the letters', () => {
    expect(stripTashkeel('العَدَدُ')).toBe('العدد');
    expect(sameLetters('العدد', 'العَدَدُ')).toBe(true);
    expect(sameLetters('العدد', 'العَدَدِيّ')).toBe(false);
  });

  it('normalizes answers for matching', () => {
    expect(normalizeForMatch('  الأعداد   الصحيحة ')).toBe(normalizeForMatch('الاعداد الصحيحه'));
    expect(normalizeForMatch('Égalité')).toBe('egalite');
    expect(normalizeForMatch('٣ أمتار')).toBe('3 امتار');
  });

  it('flags broken, reversed and fine text layers', () => {
    const good = 'في هذا الدرس نتعلم كيف نطرح عددا من عدد آخر على المستقيم العددي، ثم نتحقق من الجواب مع الأمثلة.';
    expect(arabicTextQuality(good).verdict).toBe('ok');
    const reversed = good
      .split(' ')
      .map((w) => [...w].reverse().join(''))
      .reverse()
      .join(' ');
    expect(arabicTextQuality(reversed).verdict).toBe('reversed');
    expect(unreverseArabicLine(reversed).replace(/\s+/g, ' ')).toContain('في هذا الدرس');
    expect(arabicTextQuality('(cid:12)(cid:44)(cid:91)(cid:3)(cid:8)  في').verdict).toBe('ocr');
    expect(arabicTextQuality('The quick brown fox').verdict).toBe('not-arabic');
  });
});

describe('text', () => {
  it('splits sentences on Arabic punctuation and keeps decimals together', () => {
    const s = splitSentences('ما هو الجواب؟ إنه 3.5 تقريبا. حسنا… لنتابع؛ ثم ننتهي!');
    expect(s.map((x) => x.text)).toEqual(['ما هو الجواب؟', 'إنه 3.5 تقريبا.', 'حسنا…', 'لنتابع؛', 'ثم ننتهي!']);
    const en = 'Seven minus three is four. Is it? Yes!';
    expect(splitSentences(en).map((x) => en.slice(x.start, x.end))).toEqual([
      'Seven minus three is four.',
      'Is it?',
      'Yes!',
    ]);
  });

  it('finds words with offsets', () => {
    expect(splitWords('Keep the seven, l’opposé.').map((w) => w.text)).toEqual(['Keep', 'the', 'seven', 'l’opposé']);
  });

  it('wraps and strips bidi isolates', () => {
    const iso = isolate('x + 2 = 6', 'ltr');
    expect(iso.startsWith('\u2066')).toBe(true);
    expect(stripBidiControls(`حل ${iso}`)).toBe('حل x + 2 = 6');
    expect(dirOf('ar-MA')).toBe('rtl');
    expect(dirOf('fr')).toBe('ltr');
  });
});

describe('catalogs', () => {
  it('every catalog defines every key', () => {
    for (const lang of [...LANGS, ...CONTENT_LANGS]) expect(missingKeys(lang)).toEqual([]);
  });

  it('interpolates and pluralizes, including Arabic dual and plural forms', () => {
    expect(t('en', 'book.chapters', { n: 1 })).toBe('1 chapter');
    expect(t('en', 'book.chapters', { n: 5 })).toBe('5 chapters');
    expect(t('ar', 'book.chapters', { n: 2 })).toBe('فصلان');
    expect(t('ar', 'book.chapters', { n: 5 })).toBe('5 فصول');
    expect(t('ar', 'book.chapters', { n: 11 })).toBe('11 فصلًا');
    expect(t('fr', 'finish.score', { right: 3, total: 4 })).toBe('3 sur 4 justes du premier coup');
    expect(t('xx', 'quiz.check')).toBe('Check');
  });
});

describe('Darija (Moroccan Arabic)', () => {
  it('is a right-to-left Arabic variety with its own player UI', () => {
    expect(dirOf('ary')).toBe('rtl');
    expect(isArabic('ary')).toBe(true);
    expect(isArabic('fr')).toBe(false);
    expect(langInfo('ary').locale).toBe('ar-MA');
    expect(t('ary', 'finish.again')).toBe('عاود شوف');
    expect(t('ary', 'book.chapters', { n: 2 })).toBe('جوج فصول');
    expect(parseNumber('0,5', { lang: 'ary' })?.value.d).toBe(2n);
  });
});
