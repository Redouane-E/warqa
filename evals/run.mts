// Model evaluation: build the same chapter with each model and measure what matters for Warqa.
//   pnpm --filter @warqa/evals eval -- --pdf ../packages/pipeline/test-fixtures/textbook-ar.pdf \
//        --models anthropic:claude-sonnet-5-5,google:gemini-3.8-flash,ollama:qwen3:14b --langs ar --chapter ch01
// Writes results/<date>.json and updates LEADERBOARD.md.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateLesson } from '@warqa/lesson';
import * as P from '@warqa/pipeline';

const { values: a } = parseArgs({
  options: {
    pdf: { type: 'string' },
    models: { type: 'string' },
    langs: { type: 'string', default: 'ar' },
    chapter: { type: 'string', default: 'ch01' },
    vision: { type: 'string' },
    qa: { type: 'boolean', default: true },
    /** Also export a blind teacher-panel kit of every model's chapter into this folder. */
    panel: { type: 'string' },
  },
});
if (!a.pdf || !a.models) {
  console.error(
    'usage: tsx run.mts --pdf book.pdf --models provider:model,… [--langs ar,fr] [--chapter ch01] [--vision provider:model]',
  );
  process.exit(1);
}
for (const f of [resolve('.env'), resolve('../.env')]) if (existsSync(f)) process.loadEnvFile(f);

interface Row {
  model: string;
  ok: boolean;
  error?: string;
  beats: number;
  calls: number;
  repairs: number;
  errors: number;
  warnings: number;
  qaIssues: number;
  usd: number;
  seconds: number;
}

const langs = a.langs!.split(',');
const pdf = resolve(a.pdf);
// ingest once (with the first model's vision role or --vision)
const base = mkdtempSync(join(tmpdir(), 'warqa-eval-'));
const seed = P.Project.create(join(base, 'seed'), {
  id: 'evalbook',
  title: basename(pdf, '.pdf'),
  langs,
  defaultLang: langs[0],
});
copyFileSync(pdf, seed.path('source', basename(pdf)));
const doc = await P.ingestPdf(pdf, { ocr: 'never' });
console.log(`ingested ${doc.source.pages} pages, ${doc.sections.length} sections, lang ${doc.lang}`);

const rows: Row[] = [];
const built: { project: P.Project; label: string }[] = [];
for (const model of a.models.split(',')) {
  const t0 = Date.now();
  const root = join(base, model.replace(/[^a-z0-9]+/gi, '_'));
  const p = P.Project.create(root, { id: 'evalbook', title: basename(pdf, '.pdf'), langs, defaultLang: langs[0] });
  p.writeJson('source/document.json', doc);
  p.config.models = {
    planner: model,
    storyboard: model,
    writer: model,
    translator: model,
    judge: model,
    vision: a.vision ?? model,
  };
  p.config.tts.provider = 'none';
  p.saveBook();
  const llm = P.projectLlm(p);
  const row: Row = {
    model,
    ok: false,
    beats: 0,
    calls: 0,
    repairs: 0,
    errors: 0,
    warnings: 0,
    qaIssues: 0,
    usd: 0,
    seconds: 0,
  };
  try {
    await P.ensurePlan(p, { llm, approve: true });
    const r = await P.buildChapter(p, a.chapter!, { llm, narrate: false, approve: true });
    const v = validateLesson(r.lesson, { pacing: true, requireSources: true });
    row.beats = r.lesson.beats.length;
    row.errors = v.issues.filter((i) => i.level === 'error').length;
    row.warnings = v.issues.length - row.errors;
    if (a.qa) {
      const site = P.exportSite(p);
      const { server, url } = await P.serveStatic(site.out, 0);
      try {
        for (const lang of langs)
          row.qaIssues += (await P.checkLesson({ url: `${url}${a.chapter}/index.html`, lang })).issues.length;
      } finally {
        server.close();
      }
    }
    row.ok = row.errors === 0;
    built.push({ project: p, label: model });
  } catch (e) {
    row.error = (e as Error).message.slice(0, 300);
  }
  const ledger = existsSync(p.path('.ledger.jsonl'))
    ? readFileSync(p.path('.ledger.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as P.LedgerEntry)
    : [];
  row.calls = ledger.length;
  row.repairs = ledger.filter((e) => !e.ok).length;
  row.usd = ledger.reduce((s, e) => s + e.usd, 0);
  row.seconds = Math.round((Date.now() - t0) / 1000);
  rows.push(row);
  console.log(JSON.stringify(row));
}

const date = new Date().toISOString().slice(0, 10);
const result = { date, pdf: basename(pdf), langs, chapter: a.chapter, rows };
writeFileSync(join('results', `${date}-${basename(pdf, '.pdf')}.json`), `${JSON.stringify(result, null, 2)}\n`);
const md = [
  `# Model leaderboard`,
  '',
  `Latest run: ${date}, \`${basename(pdf)}\`, chapter ${a.chapter}, languages ${langs.join(', ')}. Lower repairs, errors and QA issues are better. Reproduce with \`evals/run.mts\`.`,
  '',
  '| model | valid | beats | calls | repairs | errors | warnings | QA issues | cost | time |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows
    .sort((x, y) => Number(y.ok) - Number(x.ok) || x.repairs - y.repairs)
    .map(
      (r) =>
        `| ${r.model} | ${r.ok ? '✓' : `✗${r.error ? ` (${r.error.slice(0, 60)})` : ''}`} | ${r.beats} | ${r.calls} | ${r.repairs} | ${r.errors} | ${r.warnings} | ${r.qaIssues} | $${r.usd.toFixed(3)} | ${r.seconds}s |`,
    ),
  '',
];
// keep teacher-panel sections from earlier runs
const previous = existsSync('LEADERBOARD.md') ? readFileSync('LEADERBOARD.md', 'utf8') : '';
const panels = previous.indexOf('## Teacher panel');
writeFileSync('LEADERBOARD.md', `${md.join('\n')}${panels >= 0 ? `\n${previous.slice(panels)}` : ''}`);
if (a.panel && built.length) {
  const kit = P.exportPanelKit(
    built.map((b) => ({ ...b, lesson: a.chapter! })),
    { out: resolve(a.panel), kit: `${date}-${basename(pdf, '.pdf')}` },
  );
  console.log(`teacher panel kit → ${kit.out} (key: ${kit.keyFile})`);
  console.log('after the panel: warqa panel results ratings/*.json --key <key> --leaderboard evals/LEADERBOARD.md');
}
console.log('results →', join('results', `${date}-${basename(pdf, '.pdf')}.json`));
