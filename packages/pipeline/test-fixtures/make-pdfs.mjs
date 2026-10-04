#!/usr/bin/env node
// Generate the small, deterministic PDFs used by src/ingest/ingest.test.ts.
//   node test-fixtures/make-pdfs.mjs
// Chromium's PDF backend embeds subset fonts with ToUnicode maps, so the Arabic text layer is real text
// (the same as most textbooks exported from Word/InDesign), and `outline: true` turns h1–h6 into bookmarks.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const fonts = join(here, '../../lesson/dist/bundle/fonts');
// Inlined as data: URLs: pages loaded with setContent() may not fetch file:// fonts, and system fonts would make
// the fixtures depend on the machine that generated them.
const fontUrl = (f) => `data:font/woff2;base64,${readFileSync(join(fonts, f)).toString('base64')}`;

const css = `
@font-face { font-family: 'Readex'; font-weight: 400; src: url('${fontUrl('readex-pro-arabic-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Readex'; font-weight: 700; src: url('${fontUrl('readex-pro-arabic-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Naskh'; font-weight: 400; src: url('${fontUrl('noto-naskh-arabic-arabic-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Stix'; font-weight: 400; src: url('${fontUrl('stix-two-text-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Stix'; font-weight: 700; src: url('${fontUrl('stix-two-text-latin-600-normal.woff2')}') format('woff2'); }
@page { size: A5; margin: 18mm 16mm; }
body { font-family: 'Stix', 'Readex', serif; font-size: 11pt; line-height: 1.5; margin: 0; }
[dir=rtl] body { font-family: 'Readex', 'Stix', serif; }
/* Noto Naskh shapes with glyph variants that have no cmap entry, so Chromium's ToUnicode map loses letters:
   a realistic broken Arabic text layer that must go to OCR. */
.naskh { font-family: 'Naskh', serif; }
h1 { font-size: 20pt; margin: 0 0 10pt; }
h2 { font-size: 14pt; margin: 14pt 0 6pt; }
p { margin: 0 0 8pt; }
.page { break-before: page; }
.cover { font-size: 26pt; text-align: center; margin-top: 60pt; }
.sub { font-size: 12pt; text-align: center; }
.eq { text-align: center; margin: 10pt 0; direction: ltr; }
.list { margin: 0 0 8pt; padding: 0; list-style: none; }
.caption { font-size: 9pt; font-style: italic; text-align: center; }
.fig { display: block; width: 240pt; height: 40pt; margin: 8pt auto 4pt; }
`;

// A raster figure (a number line drawn on a canvas, printed as an image), so figure detection has something to find.
const numberLine = `<canvas class="fig" width="600" height="100"></canvas>
<script>
for (const c of document.querySelectorAll('canvas.fig')) {
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 100);
  g.strokeStyle = '#123'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(20, 50); g.lineTo(580, 50); g.stroke();
  for (let i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(40 + i * 52, 38); g.lineTo(40 + i * 52, 62); g.stroke(); }
  g.fillStyle = '#c33'; g.beginPath(); g.arc(300, 50, 9, 0, 7); g.fill();
}
</script>`;

const html = (lang, dir, body, title = '') =>
  `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;

const en = html(
  'en',
  'ltr',
  `
<div class="cover">Numbers and Operations</div>
<div class="sub">A short sample textbook for grade 7</div>

<section class="page">
<h1>Chapter 1: Integers</h1>
<p>Integers are the whole numbers together with their opposites. They let us describe temperatures below zero, debts and depths under the sea level.</p>
<h2>1.1 Opposite numbers</h2>
<p>Every integer has an opposite at the same distance from zero on the number line.</p>
<ul class="list">
<li>• The opposite of 3 is −3.</li>
<li>• The opposite of −7 is 7.</li>
<li>• Zero is its own opposite.</li>
</ul>
<div class="eq">3 + (−3) = 0</div>
<p>The sum of a number and its opposite is always zero.</p>
</section>

<section class="page">
<h2>1.2 The number line</h2>
<p>We draw the integers on a line, with the negative numbers to the left of zero and the positive numbers to the right.</p>
${numberLine}
<div class="caption">Figure 1: The number line from −5 to 5.</div>
<p>A number is greater than every number to its left.</p>
</section>

<section class="page">
<h1>Chapter 2: Fractions</h1>
<p>A fraction names a part of a whole. The denominator tells how many equal parts the whole is cut into, and the numerator tells how many of them we take.</p>
<ul class="list">
<li>1. Find a common denominator.</li>
<li>2. Add the numerators.</li>
<li>3. Simplify the result.</li>
</ul>
<div class="eq">1/2 + 1/4 = 3/4</div>
</section>

<section class="page">
<h2>2.1 Equivalent fractions</h2>
<p>Two fractions are equivalent when they name the same part of the whole, like one half and two quarters.</p>
</section>

<section class="page">
<h1>Chapter 3: Decimals</h1>
<p>Decimals are another way to write fractions whose denominator is a power of ten.</p>
<div class="eq">0.25 = 25/100 = 1/4</div>
<p>To compare two decimals, compare their digits from left to right.</p>
</section>
`,
  'Numbers and Operations',
);

const ar = html(
  'ar',
  'rtl',
  `
<div class="cover">الأعداد والعمليات</div>
<div class="sub">كتاب مدرسي قصير للسنة الأولى من التعليم الإعدادي</div>

<section class="page">
<h1>الفصل الأول: الأعداد الصحيحة</h1>
<p>الأعداد الصحيحة هي الأعداد الطبيعية مع مقابلاتها. نستعملها للتعبير عن درجات الحرارة تحت الصفر وعن الديون.</p>
<h2>المقابل</h2>
<p>لكل عدد صحيح مقابل يوجد على نفس المسافة من الصفر في المستقيم العددي.</p>
<ul class="list">
<li>أ- مقابل العدد 3 هو العدد −3.</li>
<li>ب- مقابل العدد −7 هو العدد 7.</li>
<li>ج- الصفر هو مقابل نفسه.</li>
</ul>
<div class="eq">3 + (−3) = 0</div>
<p>مجموع عدد ومقابله يساوي دائما الصفر.</p>
</section>

<section class="page">
<h2>المستقيم العددي</h2>
<p>نمثل الأعداد الصحيحة على مستقيم، الأعداد السالبة على يسار الصفر والأعداد الموجبة على يمينه.</p>
${numberLine}
<div class="caption">شكل 1: المستقيم العددي من −5 إلى 5.</div>
</section>

<section class="page">
<h1>الفصل الثاني: الكسور</h1>
<p>الكسر يدل على جزء من الكل. المقام يبين عدد الأجزاء المتساوية، والبسط يبين عدد الأجزاء التي نأخذها.</p>
<div class="eq">1/2 + 1/4 = 3/4</div>
</section>

<section class="page">
<h1>الفصل الثالث: الأعداد العشرية</h1>
<p>الأعداد العشرية طريقة أخرى لكتابة الكسور التي مقامها قوة للعدد عشرة.</p>
<p>لمقارنة عددين عشريين نقارن أرقامهما من اليسار إلى اليمين.</p>
</section>
`,
);

/* ---------- Arabic → presentation forms (what some old PDF producers store in the text layer) ---------- */

// [isolated, final, initial, medial] code points; right-joining letters have only the first two.
const FORMS = {};
const dual = 'ئبتثجحخسشصضطظعغفقكلمنهي';
const right = 'آأؤإاةدذرزوى';
let cp = 0xfe80;
for (const ch of 'ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي') {
  if (ch === 'ء') FORMS[ch] = [cp++];
  else if (right.includes(ch)) FORMS[ch] = [cp++, cp++];
  else FORMS[ch] = [cp++, cp++, cp++, cp++];
}
const LAM_ALEF = { آ: 0xfef5, أ: 0xfef7, إ: 0xfef9, ا: 0xfefb };
const joinsLeft = (ch) => ch !== undefined && dual.includes(ch); // can connect to the following letter
const isLetter = (ch) => ch !== undefined && ch in FORMS;

function toPresentationForms(text) {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!isLetter(ch)) {
      out += ch;
      continue;
    }
    const prev = chars[i - 1];
    const joinPrev = isLetter(prev) && joinsLeft(prev);
    if (ch === 'ل' && chars[i + 1] in LAM_ALEF) {
      out += String.fromCodePoint(LAM_ALEF[chars[i + 1]] + (joinPrev ? 1 : 0));
      i++;
      continue;
    }
    const next = chars[i + 1];
    const joinNext = joinsLeft(ch) && isLetter(next);
    const f = FORMS[ch];
    const form = joinPrev ? (joinNext ? 3 : 1) : joinNext ? 2 : 0;
    out += String.fromCodePoint(f[Math.min(form, f.length - 1)] ?? f[0]);
  }
  return out;
}

const garbled = html(
  'ar',
  'rtl',
  `
<h1>${toPresentationForms('الدرس الأول: الجمع')}</h1>
<p>${toPresentationForms('الجمع هو العملية التي نحسب بها مجموع عددين أو أكثر. في هذا الدرس نتعلم كيف نجمع الأعداد الصحيحة.')}</p>
<p>${toPresentationForms('لا يتغير المجموع إذا غيرنا ترتيب الأعداد. هذه هي خاصية التبادل.')}</p>
`,
);

/* ---------- a "scanned" page: an image of text, no text layer ---------- */

const scanSource = html(
  'en',
  'ltr',
  `<div id="scan" style="width:420px;padding:24px;background:#fff;font:20px Stix,serif;line-height:1.5">
<b style="font-size:26px">Chapter 1: Scanned page</b><br>This page is only an image of text.<br>It has no text layer at all.</div>`,
);

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const write = async (name, content, extra = {}) => {
      await page.setContent(content, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        format: 'A5',
        outline: true,
        tagged: true,
        printBackground: true,
        preferCSSPageSize: true,
        ...extra,
      });
      const file = join(here, name);
      writeFileSync(file, pdf);
      console.log(`${name}: ${(statSync(file).size / 1024).toFixed(1)} KB`);
    };
    // Printed page numbers in the footer: page furniture the ingester must not mistake for content.
    await write('textbook-en.pdf', en, {
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:center;font-size:9pt">- <span class="pageNumber"></span> -</div>',
    });
    await write('textbook-ar.pdf', ar);
    await write('garbled-ar.pdf', garbled);

    await page.setContent(scanSource, { waitUntil: 'load' });
    const png = await page.locator('#scan').screenshot({ type: 'png' });
    const img = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    await write(
      'scanned.pdf',
      html(
        'en',
        'ltr',
        `<h1>Scanned sample</h1><p>The next page is a scan with no text layer.</p>
<section class="page"><img src="${img}" style="width:100%"></section>
<section class="page naskh" dir="rtl" lang="ar"><p>الأعداد الصحيحة هي الأعداد الطبيعية مع مقابلاتها. نستعملها للتعبير عن درجات الحرارة تحت الصفر وعن الديون في الحياة اليومية.</p>
<p>لكل عدد صحيح مقابل يوجد على نفس المسافة من الصفر في المستقيم العددي.</p></section>`,
      ),
    );
  } finally {
    await browser.close();
  }
}

await main();
