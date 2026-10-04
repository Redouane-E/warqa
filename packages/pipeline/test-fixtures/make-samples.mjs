#!/usr/bin/env node
// Sample PDFs for trying Warqa from the studio or the web app (examples/pdfs/), written for the project and
// shared under CC BY 4.0: an Arabic maths chapter, a French science chapter and an Arabic picture book.
//   node packages/pipeline/test-fixtures/make-samples.mjs
// Real text layers (embedded fonts with ToUnicode maps) and bookmarks, like PDFs exported from Word.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const out = join(root, 'examples/pdfs');
const fonts = join(root, 'packages/lesson/dist/bundle/fonts');
const font = (f) => `data:font/woff2;base64,${readFileSync(join(fonts, f)).toString('base64')}`;
const svg = (f) => `data:image/svg+xml;base64,${readFileSync(join(root, 'examples/fox.warqa/assets', f)).toString('base64')}`;

const css = `
@font-face { font-family: 'Readex'; font-weight: 400; src: url('${font('readex-pro-arabic-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Readex'; font-weight: 700; src: url('${font('readex-pro-arabic-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'ReadexL'; font-weight: 400; src: url('${font('readex-pro-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'ReadexL'; font-weight: 700; src: url('${font('readex-pro-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Stix'; font-weight: 400; src: url('${font('stix-two-text-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Stix'; font-weight: 700; src: url('${font('stix-two-text-latin-600-normal.woff2')}') format('woff2'); }
@page { size: A4; margin: 20mm 18mm; }
body { font-family: 'Stix', serif; font-size: 12pt; line-height: 1.6; margin: 0; color: #1b1b1b; }
[dir=rtl] body, body[dir=rtl] { font-family: 'Readex', 'ReadexL', 'Stix', serif; }
h1 { font-size: 22pt; margin: 0 0 12pt; color: #0b5c58; }
h2 { font-size: 15pt; margin: 16pt 0 6pt; color: #0b5c58; }
h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
p { margin: 0 0 8pt; }
.page { break-before: page; }
.cover { text-align: center; margin-top: 140pt; }
.cover h1, .cover .title { font-size: 30pt; font-weight: 700; color: #0b5c58; margin-bottom: 12pt; }
.cover .sub { font-size: 14pt; color: #444; }
.box { border: 1.5pt solid #0b5c58; border-radius: 8pt; padding: 8pt 12pt; margin: 10pt 0; background: #f2f8f7; }
.box b:first-child { color: #0b5c58; }
.eq { direction: ltr; unicode-bidi: isolate; font-family: 'Stix', serif; }
.center { text-align: center; }
table { border-collapse: collapse; margin: 8pt auto; }
td, th { border: 1pt solid #888; padding: 4pt 10pt; text-align: center; }
ol, ul { margin: 0 0 8pt; }
.ex li { margin-bottom: 6pt; }
figure { margin: 10pt 0; text-align: center; }
figcaption { font-size: 10pt; color: #555; }
.story { text-align: center; }
.story img { width: 100%; max-height: 150mm; object-fit: contain; border-radius: 10pt; }
.story p { font-size: 20pt; line-height: 1.8; margin-top: 14pt; }
`;

// a number line from a to b (left to right, also in Arabic books), with optional marked points
const line = (a, b, marks = {}) => {
  const w = 460;
  const x = (v) => 20 + ((v - a) / (b - a)) * (w - 40);
  let s = `<svg width="${w}" height="70" viewBox="0 0 ${w} 70" xmlns="http://www.w3.org/2000/svg" style="direction:ltr"><line x1="10" y1="35" x2="${w - 10}" y2="35" stroke="#222" stroke-width="2"/><path d="M${w - 10} 35 l-8 -5 v10z" fill="#222"/>`;
  for (let v = a; v <= b; v++) s += `<line x1="${x(v)}" y1="29" x2="${x(v)}" y2="41" stroke="#222" stroke-width="${v === 0 ? 3 : 1.5}"/><text x="${x(v)}" y="60" font-size="13" text-anchor="middle" font-family="Stix">${v < 0 ? `−${-v}` : v}</text>`;
  for (const [v, label] of Object.entries(marks)) s += `<circle cx="${x(Number(v))}" cy="35" r="6" fill="#d9534f"/><text x="${x(Number(v))}" y="20" font-size="13" text-anchor="middle" font-family="Readex">${label}</text>`;
  return `${s}</svg>`;
};

const mathsAr = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body dir="rtl">
<div class="cover"><div class="title">الرياضيات</div><p class="sub">السنة الأولى من التعليم الثانوي الإعدادي</p><p class="sub">الوحدة 2: الأعداد العشرية النسبية</p><p class="sub" style="margin-top:40pt">نموذج تجريبي لمشروع «ورقة» — رخصة CC BY 4.0</p></div>

<div class="page"><h1>الفصل الأول: الأعداد العشرية النسبية</h1>
<h2>1. تعريف</h2>
<p>في الحياة اليومية نصادف أعدادًا «تحت الصفر»: درجة حرارة الهواء في إفران شتاءً قد تكون <span class="eq">−4</span> درجات، ومستوى سطح البحر الميت أقل من مستوى سطح البحر بنحو <span class="eq">430</span> مترًا.</p>
<div class="box"><b>تعريف:</b> العدد العشري النسبي عدد يتكون من إشارة (<span class="eq">+</span> أو <span class="eq">−</span>) ومن عدد عشري يسمى <b>مسافته إلى الصفر</b>. الأعداد التي إشارتها <span class="eq">+</span> أعداد <b>موجبة</b>، والتي إشارتها <span class="eq">−</span> أعداد <b>سالبة</b>. العدد <span class="eq">0</span> موجب وسالب في آن واحد.</div>
<p>أمثلة: <span class="eq">+3</span> و <span class="eq">2,5</span> عددان موجبان (نكتب <span class="eq">2,5</span> بدل <span class="eq">+2,5</span>)، و <span class="eq">−7</span> و <span class="eq">−0,8</span> عددان سالبان.</p>
<h2>2. المستقيم المدرج</h2>
<p>المستقيم المدرج مستقيم نختار عليه نقطة أصلًا <span class="eq">O</span> تمثل العدد <span class="eq">0</span>، ووحدة طول، واتجاهًا موجبًا من اليسار إلى اليمين. كل نقطة من المستقيم تمثل عددًا نسبيًا يسمى <b>أفصول</b> هذه النقطة.</p>
<figure>${line(-5, 5, { '-3': 'A', 2: 'B' })}<figcaption>الشكل 1: أفصول النقطة A هو <span class="eq">−3</span>، وأفصول النقطة B هو <span class="eq">2</span>.</figcaption></figure>
<p>المسافة إلى الصفر هي المسافة بين أصل المستقيم المدرج والنقطة التي تمثل العدد: المسافة إلى الصفر للعدد <span class="eq">−3</span> هي <span class="eq">3</span>.</p>
<h2>3. مقابل عدد</h2>
<div class="box"><b>تعريف:</b> عددان متقابلان هما عددان لهما نفس المسافة إلى الصفر وإشارتان مختلفتان. مقابل العدد <span class="eq">5</span> هو <span class="eq">−5</span>، ومقابل العدد <span class="eq">−2,4</span> هو <span class="eq">2,4</span>. مقابل <span class="eq">0</span> هو <span class="eq">0</span>.</div>
<p>على المستقيم المدرج، النقطتان اللتان تمثلان عددين متقابلين متماثلتان بالنسبة للأصل <span class="eq">O</span>.</p>
<figure>${line(-5, 5, { '-4': 'C', 4: 'D' })}<figcaption>الشكل 2: العددان <span class="eq">−4</span> و <span class="eq">4</span> متقابلان.</figcaption></figure></div>

<div class="page"><h2>4. مقارنة الأعداد النسبية</h2>
<p>على المستقيم المدرج، كلما اتجهنا نحو اليمين كبرت الأعداد.</p>
<div class="box"><b>قواعد:</b>
<ul><li>كل عدد موجب أكبر من كل عدد سالب: <span class="eq">2 &gt; −9</span>.</li>
<li>من بين عددين موجبين، الأكبر هو الذي مسافته إلى الصفر أكبر: <span class="eq">7,2 &gt; 3,5</span>.</li>
<li>من بين عددين سالبين، الأكبر هو الذي مسافته إلى الصفر أصغر: <span class="eq">−3 &gt; −8</span>.</li></ul></div>
<p>مثال: لنرتب ترتيبًا تزايديًا الأعداد التالية: <span class="eq">4 ; −1,5 ; 0 ; −6 ; 2,7</span>. نجد: <span class="eq">−6 &lt; −1,5 &lt; 0 &lt; 2,7 &lt; 4</span>.</p>
<h3>خطأ شائع</h3>
<p>يظن بعض التلاميذ أن <span class="eq">−8</span> أكبر من <span class="eq">−3</span> لأن <span class="eq">8</span> أكبر من <span class="eq">3</span>. لكن <span class="eq">−8</span> يوجد على يسار <span class="eq">−3</span> في المستقيم المدرج، إذن <span class="eq">−8 &lt; −3</span>: درجة حرارة <span class="eq">−8</span> أبرد من <span class="eq">−3</span>.</p>

</div><div class="page"><h1>الفصل الثاني: جمع وطرح الأعداد النسبية</h1>
<h2>1. جمع عددين نسبيين</h2>
<div class="box"><b>قاعدة 1:</b> لجمع عددين لهما نفس الإشارة، نحتفظ بالإشارة المشتركة ونجمع المسافتين إلى الصفر:
<p class="center eq">(−3) + (−5) = −8 &nbsp;&nbsp;&nbsp; 4 + 6 = 10</p></div>
<div class="box"><b>قاعدة 2:</b> لجمع عددين مختلفي الإشارة، نأخذ إشارة العدد الذي مسافته إلى الصفر أكبر، ونطرح المسافة الصغرى من المسافة الكبرى:
<p class="center eq">(−7) + 3 = −4 &nbsp;&nbsp;&nbsp; 9 + (−2) = 7</p></div>
<p>تفسير على المستقيم المدرج: لحساب <span class="eq">(−2) + 5</span> ننطلق من <span class="eq">−2</span> ونتقدم <span class="eq">5</span> وحدات نحو اليمين، فنصل إلى <span class="eq">3</span>.</p>
<figure>${line(-5, 5, { '-2': 'انطلاق', 3: 'وصول' })}<figcaption>الشكل 3: <span class="eq">(−2) + 5 = 3</span>.</figcaption></figure>
<p>مجموع عددين متقابلين يساوي صفرًا: <span class="eq">(−6) + 6 = 0</span>.</p></div>

<div class="page"><h2>2. طرح عددين نسبيين</h2>
<div class="box"><b>قاعدة:</b> لطرح عدد نسبي، نضيف مقابله: <span class="eq">a − b = a + (−b)</span>.
<p class="center eq">7 − 3 = 7 + (−3) = 4 &nbsp;&nbsp;&nbsp; 4 − (−9) = 4 + 9 = 13 &nbsp;&nbsp;&nbsp; (−2) − 6 = (−2) + (−6) = −8</p></div>
<p>مثال من الحياة: كانت درجة الحرارة في الصباح <span class="eq">−3</span> درجات، وفي الزوال <span class="eq">5</span> درجات. ارتفعت درجة الحرارة بـ <span class="eq">5 − (−3) = 5 + 3 = 8</span> درجات.</p>
<h2>3. المسافة بين نقطتين</h2>
<p>المسافة بين نقطتين أفصولاهما <span class="eq">a</span> و <span class="eq">b</span> هي الفرق بين الأكبر والأصغر. مثلًا المسافة بين <span class="eq">A(−3)</span> و <span class="eq">B(2)</span> هي <span class="eq">2 − (−3) = 5</span>.</p>
<h2>4. مجاميع جبرية</h2>
<p>لحساب مجموع جبري مثل <span class="eq">5 − 8 + 3 − (−4)</span>، نحول كل طرح إلى جمع ثم نجمع الأعداد الموجبة وحدها والأعداد السالبة وحدها:</p>
<p class="center eq">5 + (−8) + 3 + 4 = (5 + 3 + 4) + (−8) = 12 + (−8) = 4</p>

<h2 style="margin-top:20pt">5. تمارين</h2>
<ol class="ex">
<li>مثّل على مستقيم مدرج النقط <span class="eq">E(−2,5)</span> و <span class="eq">F(1,5)</span> و <span class="eq">G(−4)</span>، ثم أعط مقابل كل عدد.</li>
<li>قارن: <span class="eq">−6</span> و <span class="eq">−2</span> ؛ <span class="eq">3,1</span> و <span class="eq">−8</span> ؛ <span class="eq">−0,5</span> و <span class="eq">−0,49</span>.</li>
<li>احسب: <span class="eq">(−9) + (−4)</span> ؛ <span class="eq">(−12) + 7</span> ؛ <span class="eq">6 − 11</span> ؛ <span class="eq">(−3) − (−10)</span>.</li>
<li>في مدينة إفران، سُجلت درجة حرارة <span class="eq">−6</span> في الليل و <span class="eq">9</span> في النهار. ما هو الفرق بين الدرجتين؟</li>
<li>احسب المجموع الجبري: <span class="eq">−7 + 4 − 2 − (−8) + 1</span>.</li>
</ol>
<table><tr><th>العدد</th><td class="eq">−7</td><td class="eq">3,5</td><td class="eq">0</td><td class="eq">−1,2</td></tr><tr><th>مقابله</th><td></td><td></td><td></td><td></td></tr><tr><th>مسافته إلى الصفر</th><td></td><td></td><td></td><td></td></tr></table>
<p class="center">أكمل الجدول.</p></div>
</body></html>`;

const scienceFr = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css} body { font-family: 'ReadexL', 'Stix', sans-serif; }</style></head><body>
<div class="cover"><div class="title">Sciences de la vie et de la Terre</div><p class="sub">1re année du collège</p><p class="sub">Chapitre 3 : Le cycle de l'eau</p><p class="sub" style="margin-top:40pt">Exemple pour le projet « Warqa » — licence CC BY 4.0</p></div>

<div class="page"><h1>Chapitre 3 : Le cycle de l'eau</h1>
<h2>1. L'eau sur la Terre</h2>
<p>Vue de l'espace, la Terre est une planète bleue : l'eau recouvre environ 71 % de sa surface. Pourtant, presque toute cette eau est salée.</p>
<table><tr><th>Réservoir</th><th>Part de l'eau de la Terre</th></tr><tr><td>Océans et mers (eau salée)</td><td>environ 97 %</td></tr><tr><td>Glaciers et calottes polaires</td><td>environ 2 %</td></tr><tr><td>Eaux souterraines</td><td>moins de 1 %</td></tr><tr><td>Lacs, rivières, atmosphère, êtres vivants</td><td>moins de 0,1 %</td></tr></table>
<div class="box"><b>À retenir :</b> l'eau douce facilement utilisable par l'être humain (rivières, lacs, nappes peu profondes) représente une très petite partie de l'eau de la Terre. C'est une ressource précieuse.</div>
<h2>2. Les trois états de l'eau</h2>
<p>L'eau existe à l'état <b>solide</b> (glace, neige), <b>liquide</b> (pluie, mer, rivières) et <b>gazeux</b> (vapeur d'eau, invisible). Elle passe d'un état à l'autre selon la température :</p>
<ul><li><b>fusion</b> : solide → liquide (la neige de l'Atlas fond au printemps) ;</li>
<li><b>solidification</b> : liquide → solide ;</li>
<li><b>évaporation</b> : liquide → gaz (une flaque sèche au soleil) ;</li>
<li><b>condensation</b> : gaz → liquide (la buée sur une vitre froide, les gouttelettes des nuages).</li></ul>
<p>Sous la pression normale, l'eau pure gèle à 0 °C et bout à 100 °C.</p></div>

<div class="page"><h2>3. Les étapes du cycle</h2>
<p>L'eau circule sans cesse entre l'océan, l'atmosphère et les continents. Ce trajet fermé s'appelle le <b>cycle de l'eau</b>. Le moteur du cycle est l'énergie du Soleil.</p>
<ol><li><b>Évaporation</b> : chauffée par le Soleil, l'eau des océans, des lacs et du sol s'évapore. Les plantes rejettent aussi de la vapeur d'eau par leurs feuilles : c'est la <b>transpiration</b>.</li>
<li><b>Condensation</b> : en montant, la vapeur d'eau se refroidit et se condense en fines gouttelettes qui forment les <b>nuages</b>.</li>
<li><b>Précipitations</b> : les gouttelettes grossissent et tombent sous forme de pluie, de neige ou de grêle.</li>
<li><b>Ruissellement</b> : une partie de l'eau coule à la surface du sol et rejoint les rivières, puis la mer.</li>
<li><b>Infiltration</b> : une autre partie s'enfonce dans le sol et alimente les <b>nappes souterraines</b>, que l'on exploite par des puits.</li></ol>
<figure><svg width="440" height="200" viewBox="0 0 440 200" xmlns="http://www.w3.org/2000/svg" font-family="ReadexL" font-size="12">
<rect width="440" height="200" fill="#eaf4fb"/><circle cx="400" cy="35" r="22" fill="#f6c343"/>
<path d="M0 150 Q110 140 200 150 L200 200 L0 200Z" fill="#3a8fb7"/><path d="M200 150 L260 110 L330 70 L440 120 L440 200 L200 200Z" fill="#9c7a4f"/>
<ellipse cx="250" cy="45" rx="55" ry="18" fill="#fff"/><ellipse cx="290" cy="38" rx="35" ry="15" fill="#fff"/>
<path d="M70 135 C 80 100 140 70 200 55" fill="none" stroke="#d9534f" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#a)"/>
<g stroke="#3a8fb7" stroke-width="2"><line x1="240" y1="70" x2="232" y2="92"/><line x1="260" y1="70" x2="252" y2="92"/><line x1="280" y1="70" x2="272" y2="92"/></g>
<path d="M330 120 C 300 140 260 150 210 152" fill="none" stroke="#2b6cb0" stroke-width="2" marker-end="url(#a)"/>
<defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#333"/></marker></defs>
<text x="40" y="120">évaporation</text><text x="300" y="30">condensation</text><text x="190" y="105">précipitations</text><text x="300" y="160">ruissellement</text></svg>
<figcaption>Figure 1 : le cycle de l'eau.</figcaption></figure>
<h2>4. L'eau au Maroc</h2>
<p>Au Maroc, les pluies sont irrégulières : abondantes certaines années, rares pendant les années de sécheresse. Les montagnes de l'Atlas et du Rif reçoivent plus de pluie et de neige ; les régions du Sud en reçoivent très peu.</p>
<p>Pour garder l'eau des années pluvieuses, le pays a construit de nombreux <b>barrages</b>. On développe aussi le <b>dessalement</b> de l'eau de mer et la réutilisation des eaux usées traitées pour l'irrigation.</p>
<div class="box"><b>Gestes utiles :</b> fermer le robinet pendant qu'on se brosse les dents, arroser le soir, réparer les fuites, préférer l'irrigation au goutte-à-goutte.</div>
<h2 style="margin-top:16pt">5. Exercices</h2>
<ol class="ex"><li>Nomme les changements d'état : la glace qui fond ; la buée sur un miroir ; le linge qui sèche.</li>
<li>Remets dans l'ordre : précipitations — évaporation — ruissellement — condensation.</li>
<li>Pourquoi dit-on que l'eau douce est une ressource rare, alors que la Terre est couverte d'eau ?</li>
<li>Explique le rôle du Soleil dans le cycle de l'eau.</li></ol></div>
</body></html>`;

const story = [
  ['page1.svg', 'في قرية بيضاء قرب البحر، كان يعيش ثعلب صغير اسمه زيتون. وكان زيتون يحب الكتب أكثر من أي شيء آخر.'],
  ['page2.svg', 'كل صباح، كان يجلس تحت شجرة الأركان الكبيرة ويقرأ. وكانت أغصانها تحميه من شمس الصيف الحارة.'],
  ['page3.svg', 'وذات يوم، هبّت ريح قوية، فطارت صفحة من كتابه! ركض زيتون وراءها، ومرّ بالسوق، حتى وصل إلى الشاطئ.'],
  ['page4.svg', 'هناك، وجد عنزة صغيرة اسمها نور، تقرأ صفحته بفرح. قال زيتون: «تعالَيْ نقرأ معًا!» ومنذ ذلك اليوم، صارت لزيتون صديقة تحب الكتب مثله تمامًا.'],
];
const storyAr = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body dir="rtl">
<div class="cover"><h1>زيتون والصفحة الطائرة</h1><p class="sub">قصة مصوّرة للأطفال</p><img src="${svg('page1.svg')}" style="width:70%;margin-top:20pt;border-radius:10pt"><p class="sub" style="margin-top:20pt">قصة ورسوم لمشروع «ورقة» — رخصة CC BY 4.0</p></div>
${story.map(([img, text]) => `<div class="page story"><img src="${svg(img)}"><p>${text}</p></div>`).join('\n')}
<div class="page story"><p><b>النهاية</b></p><p>أين كان زيتون يقرأ كل صباح؟</p></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, html] of [
  ['maths-college-ar.pdf', mathsAr],
  ['science-water-cycle-fr.pdf', scienceFr],
  ['story-zitoun-ar.pdf', storyAr],
]) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const file = join(out, name);
  await page.pdf({ path: file, format: 'A4', printBackground: true, outline: true, tagged: true });
  console.log(`${name}: ${Math.round(statSync(file).size / 1024)} KB`);
}
await browser.close();
