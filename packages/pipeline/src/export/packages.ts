// Packaged exports: a zip of the site, a SCORM 1.2 package for LMSs (Moodle, …), and flashcards (TSV for
// Anki, CSV) built from the lesson questions and the glossary.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerText, type Lesson, localize, plainText } from '@warqa/lesson';
import { zipSync } from 'fflate';
import type { Project } from '../project/index.js';
import { loadPlan } from '../stages/plan.js';
import { exportSite, listFiles } from './site.js';

/** Zip a folder. */
export function zipFolder(dir: string, out: string, prefix = ''): string {
  const files: Record<string, Uint8Array> = {};
  for (const f of listFiles(dir)) files[prefix + f] = new Uint8Array(readFileSync(join(dir, f)));
  writeFileSync(out, zipSync(files, { level: 6 }));
  return out;
}

const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

// Reports completion and the first-try score of each lesson to the LMS through the SCORM 1.2 API.
const SCORM_JS = `(function(){
  function findAPI(w){for(var i=0;w&&i<10;i++){if(w.API)return w.API;if(w.parent===w)break;w=w.parent;}return null;}
  var api=findAPI(window)||(window.opener&&findAPI(window.opener));
  if(!api)return;
  try{api.LMSInitialize("");}catch(e){return;}
  var status=api.LMSGetValue("cmi.core.lesson_status");
  if(!status||status==="not attempted")api.LMSSetValue("cmi.core.lesson_status","incomplete");
  window.addEventListener("warqa:finish",function(e){
    var d=e.detail||{};
    if(d.total){api.LMSSetValue("cmi.core.score.min","0");api.LMSSetValue("cmi.core.score.max","100");api.LMSSetValue("cmi.core.score.raw",String(Math.round(100*d.right/d.total)));}
    api.LMSSetValue("cmi.core.lesson_status","completed");api.LMSCommit("");
  });
  window.addEventListener("beforeunload",function(){try{api.LMSCommit("");api.LMSFinish("");}catch(e){}});
})();`;

/** SCORM 1.2 package: one SCO per lesson, the book contents as a resource. */
export function exportScorm(project: Project, out = project.path('dist-scorm.zip')): string {
  const site = exportSite(project, { out: project.path('cache', 'scorm-site') });
  writeFileSync(join(site.out, '_warqa', 'scorm.js'), SCORM_JS);
  // inject the SCORM bridge into every lesson page
  for (const id of site.lessons) {
    const page = join(site.out, id, 'index.html');
    writeFileSync(
      page,
      readFileSync(page, 'utf8').replace('</body>', '<script src="../_warqa/scorm.js"></script>\n</body>'),
    );
  }
  const lang = project.book.defaultLang ?? project.book.langs[0]!;
  const title =
    typeof project.book.title === 'string'
      ? project.book.title
      : (project.book.title[lang] ?? Object.values(project.book.title)[0]!);
  const all = listFiles(site.out);
  const items = site.lessons
    .map((id) => {
      const l = localize(
        project.loadLesson(id),
        lang === project.loadLesson(id).lang ? undefined : project.loadStrings(id, lang),
      );
      return `      <item identifier="item-${id}" identifierref="res-${id}"><title>${xml(l.title)}</title></item>`;
    })
    .join('\n');
  const resources = site.lessons
    .map(
      (id) =>
        `    <resource identifier="res-${id}" type="webcontent" adlcp:scormtype="sco" href="${id}/index.html">\n${all
          .filter((f) => f.startsWith(`${id}/`) || f.startsWith('_warqa/') || f.startsWith('assets/'))
          .map((f) => `      <file href="${xml(f)}"/>`)
          .join('\n')}\n    </resource>`,
    )
    .join('\n');
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="warqa-${xml(project.book.id)}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>${xml(title)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>
`;
  writeFileSync(join(site.out, 'imsmanifest.xml'), manifest);
  return zipFolder(site.out, out);
}

export interface Card {
  front: string;
  back: string;
  tags: string;
}

/** Flashcards from questions (with their answers and explanations) and from the glossary. */
export function flashcards(project: Project, lang: string): Card[] {
  const cards: Card[] = [];
  for (const id of project.lessonIds()) {
    const base: Lesson = project.loadLesson(id);
    const l = localize(base, lang === base.lang ? undefined : project.loadStrings(id, lang));
    const tag = `warqa::${project.book.id}::${id}`;
    for (const b of l.beats) {
      for (const q of b.questions ?? []) {
        const explain = q.explain ? `<br><small>${plainText(q.explain)}</small>` : '';
        switch (q.kind) {
          case 'choice':
            cards.push({
              front: `${plainText(q.prompt)}<br>${q.options.map((o, i) => `${i + 1}. ${plainText(o.text)}`).join('<br>')}`,
              back:
                q.options
                  .filter((o) => q.correct.includes(o.id))
                  .map((o) => plainText(o.text))
                  .join(', ') + explain,
              tags: tag,
            });
            break;
          case 'blanks':
            for (const r of q.rows) {
              let front = plainText(r.template);
              let back = plainText(r.template);
              for (const [k, a] of Object.entries(r.answers)) {
                front = front.replace(`[[${k}]]`, '___');
                back = back.replace(`[[${k}]]`, `<b>${answerText(a)}</b>`);
              }
              cards.push({
                front: `${plainText(q.prompt)}<br>${front}`,
                back: back + (r.explain ? `<br><small>${plainText(r.explain)}</small>` : ''),
                tags: tag,
              });
            }
            break;
          case 'numeric':
            cards.push({
              front: plainText(q.prompt),
              back: `${answerText(q.answer)}${q.unit ? ` ${q.unit}` : ''}${explain}`,
              tags: tag,
            });
            break;
          case 'grid':
            for (const r of q.rows) {
              const cols =
                q.cols === 'tf'
                  ? [
                      { id: 't', text: '✓' },
                      { id: 'f', text: '✗' },
                    ]
                  : q.cols;
              cards.push({
                front: `${plainText(q.prompt)}<br>${plainText(r.text)}`,
                back:
                  ([] as string[])
                    .concat(r.correct)
                    .map((c) => plainText(cols.find((x) => x.id === c)?.text ?? c))
                    .join(', ') + (r.why ? `<br><small>${plainText(r.why)}</small>` : ''),
                tags: tag,
              });
            }
            break;
          case 'order':
            cards.push({
              front: plainText(q.prompt),
              back: q.items.map((it, i) => `${i + 1}. ${plainText(it.text)}`).join('<br>'),
              tags: tag,
            });
            break;
          case 'text':
            cards.push({ front: plainText(q.prompt), back: q.accept[0]! + explain, tags: tag });
            break;
          case 'pick':
            break;
        }
      }
    }
  }
  const plan = loadPlan(project);
  for (const g of plan?.glossary ?? []) {
    const front = g.terms[lang];
    const other = Object.entries(g.terms)
      .filter(([k]) => k !== lang)
      .map(([k, v]) => `${k}: ${v}`)
      .join('<br>');
    if (front && other)
      cards.push({
        front,
        back: other + (g.note ? `<br><small>${g.note}</small>` : ''),
        tags: `warqa::${project.book.id}::glossary`,
      });
  }
  return cards;
}

/** Tab-separated file Anki imports directly (File → Import; "Allow HTML" on). */
export function exportAnki(project: Project, lang: string, out = project.path(`flashcards.${lang}.txt`)): string {
  const clean = (s: string) => s.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const lines = [
    '#separator:tab',
    '#html:true',
    '#tags column:3',
    ...flashcards(project, lang).map((c) => `${clean(c.front)}\t${clean(c.back)}\t${c.tags}`),
  ];
  writeFileSync(out, `${lines.join('\n')}\n`);
  return out;
}

/** CSV flashcards (front, back) for other tools. */
export function exportCsv(project: Project, lang: string, out = project.path(`flashcards.${lang}.csv`)): string {
  const q = (s: string) =>
    `"${s
      .replace(/<br>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/"/g, '""')}"`;
  writeFileSync(
    out,
    `\ufefffront,back\n${flashcards(project, lang)
      .map((c) => `${q(c.front)},${q(c.back)}`)
      .join('\n')}\n`,
  );
  return out;
}
