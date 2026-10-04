// Teacher panel evaluations: people judge what models make. A kit is a folder of exported lessons with the
// rating dialog switched on; in a blind kit each model's chapter is a letter (A, B, C…) and only the organiser
// keeps the key. Teachers send back their ratings file; `scorePanel` turns them into a table for the
// leaderboard.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportSite } from '../export/site.js';
import type { Project } from '../project/index.js';

export const CRITERIA = ['accuracy', 'clarity', 'picture', 'language', 'level'] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface RatingsFile {
  schema: 'warqa.ratings/1';
  kit: string;
  rater: { name?: string; at: string };
  lessons: Record<
    string,
    {
      lang: string;
      beats: Record<string, Partial<Record<Criterion, number>> & { note?: string }>;
      overall?: { use?: 'yes' | 'changes' | 'no'; score?: number; note?: string };
    }
  >;
}

export interface PanelEntry {
  project: Project;
  lesson: string;
  /** What is being compared (e.g. the model); hidden from raters in a blind kit. */
  label: string;
}

export interface PanelKey {
  kit: string;
  created: string;
  codes: Record<string, { label: string; lesson: string; project: string }>;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Export a review kit: one exported lesson per entry under <out>/<code>/, an index page with instructions in
 * Arabic, French and English, and the key (code → label) written next to the kit, not inside it.
 */
export function exportPanelKit(
  entries: PanelEntry[],
  opts: { out: string; kit?: string; blind?: boolean; langs?: string[] },
): { out: string; keyFile: string; key: PanelKey } {
  const kit = opts.kit ?? `kit-${new Date().toISOString().slice(0, 10)}`;
  if (existsSync(opts.out)) rmSync(opts.out, { recursive: true, force: true });
  mkdirSync(opts.out, { recursive: true });
  // shuffle so the order of letters says nothing about the models
  const order = entries.map((e, i) => ({ e, r: opts.blind === false ? i : Math.random() })).sort((a, b) => a.r - b.r);
  const key: PanelKey = { kit, created: new Date().toISOString(), codes: {} };
  const links: { code: string; href: string; title: string }[] = [];
  order.forEach(({ e }, i) => {
    const code = opts.blind === false ? e.label.replace(/[^\w-]+/g, '-') : (LETTERS[i] ?? `Z${i}`);
    exportSite(e.project, {
      out: join(opts.out, code),
      lessons: [e.lesson],
      ...(opts.langs ? { langs: opts.langs } : {}),
      pwa: false,
      panel: { kit, codes: { [e.lesson]: code } },
    });
    key.codes[code] = { label: e.label, lesson: e.lesson, project: e.project.root };
    links.push({ code, href: `${code}/${e.lesson}/index.html`, title: code });
  });
  writeFileSync(join(opts.out, 'index.html'), kitPage(kit, links));
  const keyFile = `${opts.out.replace(/[\\/]+$/, '')}-key.json`;
  writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  return { out: opts.out, keyFile, key };
}

function kitPage(kit: string, links: { code: string; href: string }[]): string {
  const list = links.map((l) => `<li><a href="${l.href}">${l.code}</a></li>`).join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Warqa — ${kit}</title>
<style>body{font:18px/1.6 system-ui,sans-serif;background:#121b18;color:#ece8dc;max-width:760px;margin:0 auto;padding:24px}
a{color:#f0b45a}section{margin:0 0 28px}ol{font-size:22px}li{margin:6px 0}[dir=ltr]{text-align:left}</style></head>
<body>
<section><h1>تقييم دروس ورقة</h1>
<p>افتح كل درس من القائمة وشاهده كما يشاهده التلاميذ. في كل خطوة اضغط على ★ (أو المفتاح R) وأعطِ نقطة من 1 إلى 5 لكل معيار. في النهاية اضغط «تنزيل تقييماتي» وأرسل الملف إلى منظم التقييم.</p></section>
<section dir="ltr" lang="fr"><h2>Évaluer des leçons Warqa</h2>
<p>Ouvrez chaque leçon de la liste et regardez-la comme un élève. À chaque étape, appuyez sur ★ (ou la touche R) et notez chaque critère de 1 à 5. À la fin, cliquez sur « Télécharger mes évaluations » et envoyez le fichier à l’organisateur.</p></section>
<section dir="ltr" lang="en"><h2>Rate Warqa lessons</h2>
<p>Open each lesson in the list and watch it as a pupil would. On each step press ★ (or the R key) and score each criterion from 1 to 5. At the end click “Download my ratings” and send the file to the organiser.</p></section>
<ol dir="ltr">${list}</ol>
<p dir="ltr" style="color:#9aaba3;font-size:14px">Kit ${kit}. Your ratings stay in this browser until you download them.</p>
</body></html>
`;
}

export interface PanelRow {
  label: string;
  code: string;
  raters: number;
  steps: number;
  means: Partial<Record<Criterion | 'overall', number>>;
  use: { yes: number; changes: number; no: number };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Combine ratings files with the kit's key: one row per label (model), means per criterion. */
export function scorePanel(files: RatingsFile[], key: PanelKey): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const [code, info] of Object.entries(key.codes)) {
    const per: Record<string, number[]> = {};
    const use = { yes: 0, changes: 0, no: 0 };
    let raters = 0;
    let steps = 0;
    for (const f of files) {
      if (f.kit !== key.kit) continue;
      const l = f.lessons[code];
      if (!l) continue;
      raters++;
      for (const b of Object.values(l.beats)) {
        steps++;
        // each rater's step scores are averaged per criterion over the steps they rated
        for (const c of CRITERIA) if (typeof b[c] === 'number') (per[c] ??= []).push(b[c]!);
      }
      if (l.overall?.score) (per.overall ??= []).push(l.overall.score);
      if (l.overall?.use) use[l.overall.use]++;
    }
    const means: PanelRow['means'] = {};
    for (const [c, xs] of Object.entries(per)) {
      const m = mean(xs);
      if (m !== undefined) means[c as Criterion] = +m.toFixed(2);
    }
    rows.push({ label: info.label, code, raters, steps, means, use });
  }
  return rows.sort((a, b) => (b.means.overall ?? 0) - (a.means.overall ?? 0));
}

/** Markdown table of a panel's results (for LEADERBOARD.md). */
export function panelMarkdown(rows: PanelRow[], kit: string): string {
  const f = (v: number | undefined) => (v === undefined ? '–' : v.toFixed(2));
  return [
    `## Teacher panel (${kit})`,
    '',
    'Mean scores from 1 to 5 given by teachers who watched each lesson without knowing which model made it. "Would use" counts answers to "Would you use it in class?" (as it is / with changes / no).',
    '',
    '| model | raters | steps rated | correct | clear | picture | language | level | overall | would use |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.label} | ${r.raters} | ${r.steps} | ${f(r.means.accuracy)} | ${f(r.means.clarity)} | ${f(r.means.picture)} | ${f(r.means.language)} | ${f(r.means.level)} | ${f(r.means.overall)} | ${r.use.yes} / ${r.use.changes} / ${r.use.no} |`,
    ),
    '',
  ].join('\n');
}
