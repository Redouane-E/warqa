#!/usr/bin/env node
// warqa — the command line for Warqa book projects.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS } from '@warqa/i18n';
import { checkStrings, localize, validateLesson } from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import { Command, Option } from 'commander';

const here = dirname(fileURLToPath(import.meta.url));

// Load .env files (cwd, then the project) without overriding real environment variables.
function loadEnv(dir: string) {
  for (const f of [join(process.cwd(), '.env'), join(dir, '.env')]) {
    if (existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch {
        /* ignore malformed .env */
      }
    }
  }
}

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  err: (s: string) => `\x1b[31m${s}\x1b[0m`,
  b: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

function project(dir = '.'): P.Project {
  const root = resolve(dir);
  loadEnv(root);
  if (!P.Project.isProject(root)) {
    console.error(c.err(`Not a Warqa project: ${root}`));
    console.error(`Create one with: warqa init ${dir === '.' ? 'my-book' : dir} --pdf book.pdf`);
    process.exit(1);
  }
  return new P.Project(root);
}

function progress(e: P.ProgressEvent) {
  const tag = c.b(e.stage.padEnd(14));
  if (e.status === 'beat')
    console.log(
      `${tag} ${c.dim(`${(e as { index: number }).index + 1}/${(e as { total: number }).total}`)} ${e.detail}`,
    );
  else if (e.status === 'error') console.log(`${tag} ${c.err('error')} ${e.detail ?? ''}`);
  else if (e.status === 'skip') console.log(`${tag} ${c.dim('already done')}`);
  else console.log(`${tag} ${e.status === 'done' ? c.ok('done') : 'start'} ${e.detail ? c.dim(e.detail) : ''}`);
}

const llmEvents = (e: { type: string; stage: string; model: string; detail?: string }) => {
  if (e.type === 'repair') console.log(`  ${c.warn('repair')} ${c.dim(`${e.model}: ${e.detail ?? ''}`)}`);
  if (e.type === 'fallback')
    console.log(`  ${c.warn('json mode')} ${c.dim(`${e.model} rejected the schema; using JSON instructions`)}`);
};

function chaptersOf(p: P.Project, arg?: string): string[] {
  if (arg && arg !== 'all') return arg.split(',');
  const plan = P.loadPlan(p);
  if (plan) return plan.chapters.filter((x) => x.include).map((x) => x.id);
  return p.lessonIds();
}

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
const program = new Command();
program
  .name('warqa')
  .description('Turn PDFs into animated, narrated, interactive books — Arabic, French, English; any AI model.')
  .version(VERSION);

program
  .command('init')
  .argument('<dir>', 'folder for the new book project')
  .option('--pdf <file>', 'source PDF (copied into source/, never published)')
  .option('--title <title>', 'book title')
  .option('--langs <list>', 'book languages, e.g. ar,fr,en', 'ar,fr,en')
  .option('--default <lang>', 'language the lessons are written in first (default: the first of --langs)')
  .option('--audience <text>', 'who the lessons are for', 'secondary-school students')
  .option('--preset <id>', `model preset: ${P.PRESETS.map((x) => x.id).join(', ')}`)
  .option('--tts <engine>', `speech engine: ${P.TTS_IDS.join(', ')}`, 'edge')
  .description('create a book project')
  .action((dir: string, o) => {
    const root = resolve(dir);
    if (P.Project.isProject(root)) {
      console.error(c.err(`${root} is already a Warqa project`));
      process.exit(1);
    }
    const langs = String(o.langs)
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    const title = o.title ?? (o.pdf ? basename(o.pdf, '.pdf') : basename(root));
    const id =
      basename(root)
        .toLowerCase()
        .replace(/\.warqa$/, '')
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[^a-z]+/, '') || 'book';
    const p = P.Project.create(root, { id, title, langs, defaultLang: o.default ?? langs[0], audience: o.audience });
    p.config.tts.provider = o.tts;
    if (o.preset) p.config.preset = o.preset;
    p.config.audience = o.audience;
    p.saveBook();
    if (o.pdf) {
      mkdirSync(p.path('source'), { recursive: true });
      copyFileSync(resolve(o.pdf), p.path('source', basename(o.pdf)));
    }
    console.log(c.ok(`Created ${root}`));
    console.log(
      `Next: ${c.b(`cd ${dir}`)} then ${c.b('warqa ingest')} → ${c.b('warqa plan')} → ${c.b('warqa build --chapter ch01')} → ${c.b('warqa preview')}`,
    );
  });

program
  .command('ingest')
  .argument('[dir]', 'project folder', '.')
  .addOption(
    new Option('--ocr <mode>', 'OCR for scanned or garbled pages').choices(['auto', 'never', 'always']).default('auto'),
  )
  .option('--level <n>', 'bookmark depth of chapters (default: auto)')
  .option('--pages <range>', 'only these pages, e.g. 1-40')
  .description('read the source PDF: text, Arabic repairs, OCR fallback, chapter map')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const pdf = p.sourcePdf();
    if (!pdf) throw new Error('no PDF in source/ (copy one there or use warqa init --pdf)');
    const llm = P.projectLlm(p, { onEvent: llmEvents });
    let vision: P.VisionOcr | undefined;
    try {
      const model = P.resolveRole('vision', p.config);
      vision = async (png, ctx) =>
        llm.text({
          stage: 'ingest',
          role: 'vision',
          model,
          system: P.VISION_OCR_SYSTEM,
          prompt: `Transcribe page ${ctx.page}${ctx.lang ? ` (language: ${ctx.lang})` : ''}.`,
          images: [{ data: png, mediaType: 'image/png' }],
        });
    } catch {
      vision = undefined;
    }
    const range = o.pages ? (String(o.pages).split('-').map(Number) as [number, number]) : undefined;
    const doc = await P.ingestPdf(pdf, {
      ocr: o.ocr,
      ...(vision ? { vision } : {}),
      ...(p.config.worker ? { worker: p.config.worker } : {}),
      ...(range ? { pages: range } : {}),
      ...(o.level ? { level: Number(o.level) } : {}),
      onProgress: (e) => process.stdout.write(`\r${c.dim(`page ${e.page}/${e.total} ${e.method}     `)}`),
    });
    process.stdout.write('\n');
    p.writeJson('source/document.json', doc);
    const methods: Record<string, number> = {};
    for (const x of doc.pages) methods[x.method] = (methods[x.method] ?? 0) + 1;
    console.log(
      c.ok(`${doc.source.pages} pages, ${doc.blocks.length} blocks, language ${doc.lang}`),
      c.dim(JSON.stringify(methods)),
    );
    console.log(`${doc.sections.filter((s) => s.id.startsWith('ch')).length} chapters found:`);
    for (const s of doc.sections) console.log(`  ${s.id.padEnd(9)} p${s.start}-${s.end}  ${s.title}`);
  });

program
  .command('plan')
  .argument('[dir]', 'project folder', '.')
  .option('--approve', 'approve the plan (writes units into warqa.json)')
  .option('--redo', 'draft a new plan')
  .description('draft (or show) the book plan: chapters, objectives, glossary')
  .action(async (dir: string, o) => {
    const p = project(dir);
    if (o.redo) p.writeJson('plan.json', null);
    const plan = await P.ensurePlan(p, {
      llm: P.projectLlm(p, { onEvent: llmEvents }),
      approve: !!o.approve,
      onProgress: progress,
    });
    console.log(c.b(`${plan.title}`), c.dim(`(${plan.status}) — ${plan.audience}`));
    for (const ch of plan.chapters)
      console.log(
        `  ${ch.include ? ch.id : c.dim(ch.id)}  ${ch.include ? ch.title : c.dim(`${ch.title} (skipped)`)} ${c.dim(`p${ch.pages[0]}-${ch.pages[1]} · ${ch.minutes} min`)}`,
      );
    if (plan.status !== 'approved')
      console.log(`Review ${c.b('plan.json')} (or the studio), then ${c.b('warqa plan --approve')}.`);
  });

program
  .command('build')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--langs <list>', 'languages to translate and narrate (default: the book languages)')
  .option('--no-narrate', 'skip speech synthesis')
  .option('--force <stages>', 'redo stages: storyboard,write,translate,narrate')
  .option('-y, --yes', 'approve the plan without review')
  .option('--export', 'export the site afterwards')
  .description('make lessons: storyboard → write → translate → narrate')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const llm = P.projectLlm(p, { onEvent: llmEvents });
    await P.ensurePlan(p, { llm, approve: !!o.yes, onProgress: progress });
    for (const id of chaptersOf(p, o.chapter)) {
      console.log(c.b(`\n▸ ${id}`));
      const r = await P.buildChapter(p, id, {
        llm,
        ...(o.langs ? { langs: String(o.langs).split(',') } : {}),
        narrate: o.narrate,
        ...(o.force ? { force: String(o.force).split(',') as never } : {}),
        approve: !!o.yes,
        onProgress: progress,
      });
      const errors = r.issues.filter((i) => i.level === 'error');
      const warns = r.issues.filter((i) => i.level === 'warn');
      console.log(
        `${errors.length ? c.err(`${errors.length} errors`) : c.ok('valid')} ${c.dim(`${warns.length} warnings · $${r.usd.toFixed(3)}`)}`,
      );
      for (const i of [...errors, ...warns].slice(0, 12))
        console.log(`  ${i.level === 'error' ? c.err('✗') : c.warn('!')} ${i.beat ? `${i.beat}: ` : ''}${i.message}`);
    }
    if (o.export) console.log(c.ok(`exported → ${P.exportSite(p).out}`));
    console.log(c.dim(`total spent: $${llm.totalUsd.toFixed(3)}`));
  });

program
  .command('translate')
  .argument('[dir]', 'project folder', '.')
  .requiredOption('--to <lang>', 'target language')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--force', 're-translate machine translations (strings a person reviewed are kept)')
  .description('translate lessons into another language (keeps marks and math, reuses the book memory)')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const llm = P.projectLlm(p, { onEvent: llmEvents });
    const plan = P.loadPlan(p);
    for (const id of chaptersOf(p, o.chapter)) {
      await P.translateLesson(p, id, o.to, {
        llm,
        ...(plan ? { plan } : {}),
        force: !!o.force,
        onChunk: (e) => console.log(`${id} ${c.dim(`${e.chunk}/${e.total}`)}`),
        onMemory: (n) => n && console.log(c.dim(`${id}: ${n} strings reused from the book's translation memory`)),
        onGlossary: (issues) => {
          for (const g of issues.slice(0, 10))
            console.log(`  ${c.warn('glossary')} ${g.key}: “${g.term}” should be “${g.expected}”`);
          if (issues.length > 10) console.log(c.dim(`  … ${issues.length - 10} more (see \`warqa review\`)`));
        },
      });
      console.log(c.ok(`${id} → ${o.to}`));
    }
    if (!p.book.langs.includes(o.to)) {
      p.book.langs.push(o.to);
      p.saveBook();
    }
  });

program
  .command('review')
  .argument('[dir]', 'project folder', '.')
  .requiredOption('--lang <code>', 'language to review')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--export <file.csv>', 'write the strings to a spreadsheet for a teacher to check and edit')
  .option('--import <file.csv>', 'apply a reviewed spreadsheet (edited translations, rows marked ok)')
  .option('--approve <keys>', 'approve strings as they are: lesson/key,… or "all"')
  .description('review translations: what a person checked, what is still machine-made, glossary problems')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const plan = P.loadPlan(p);
    const lessons = chaptersOf(p, o.chapter).filter((x) => p.hasLesson(x));
    if (o.import) {
      const r = P.importReviewCsv(p, o.lang, readFileSync(o.import, 'utf8'));
      console.log(c.ok(`${r.edited} edited, ${r.approved} approved`));
      for (const e of r.errors) console.log(`  ${c.err(e.key)} ${e.error}`);
      if (r.errors.length) process.exitCode = 1;
      return;
    }
    const items = P.reviewQueue(p, o.lang, { lessons, ...(plan ? { plan } : {}) });
    if (o.approve) {
      const want = String(o.approve).split(',');
      let n = 0;
      for (const i of items)
        if ((want.includes('all') && i.state === 'machine') || want.includes(`${i.lesson}/${i.key}`)) {
          P.reviewString(p, i.lesson, o.lang, i.key, {});
          n++;
        }
      console.log(c.ok(`approved ${n} strings`));
      return;
    }
    if (o.export) {
      writeFileSync(o.export, P.reviewCsv(items));
      console.log(c.ok(`wrote ${items.length} strings to ${o.export}`));
      console.log(c.dim('Edit the "translation" column, put "yes" in "ok" for good rows, then: warqa review --import'));
      return;
    }
    const count = (s: string) => items.filter((i) => i.state === s).length;
    console.log(
      `${o.lang}: ${c.ok(`${count('approved') + count('edited')} checked`)}, ${count('machine')} machine-made, ${count('stale') ? c.warn(`${count('stale')} stale`) : '0 stale'}, ${count('missing') ? c.err(`${count('missing')} missing`) : '0 missing'}`,
    );
    const flagged = items.filter((i) => i.flags.length);
    for (const i of flagged.slice(0, 20)) console.log(`  ${c.warn(i.lesson)} ${i.key}: ${i.flags.join('; ')}`);
    if (flagged.length > 20) console.log(c.dim(`  … ${flagged.length - 20} more`));
  });

const geo = program.command('geo').description('region layers for maps (e.g. the regions of a country)');
geo
  .command('add')
  .argument('[country]', 'ISO 3166-1 alpha-3 code, e.g. MAR (Morocco), DZA, TUN, FRA')
  .option('-d, --dir <dir>', 'project folder', '.')
  .option('--level <n>', '1 = regions or states, 2 = provinces or departments', '1')
  .option('--file <geojson>', 'use your own GeoJSON file instead of downloading')
  .option('--name-field <prop>', 'feature property with the region name (file import)')
  .option('--iso-field <prop>', 'feature property with the region code (file import)')
  .option('--id <id>', 'layer id (default: <COUNTRY>-ADM<level>)')
  .option('--attribution <text>', 'credit shown on the map (what the data licence asks for)')
  .option('--license <text>', 'licence of the data')
  .description('download (geoBoundaries) or import a region layer into the book')
  .action(async (country: string | undefined, o) => {
    const p = project(o.dir);
    if (!country && !o.file) throw new Error('give a country code (e.g. MAR) or --file my-regions.geojson');
    const l = await P.addGeoLayer(p, {
      ...(country ? { country } : {}),
      level: Number(o.level) === 2 ? 2 : 1,
      ...(o.file ? { file: o.file } : {}),
      ...(o.nameField ? { nameField: o.nameField } : {}),
      ...(o.isoField ? { isoField: o.isoField } : {}),
      ...(o.id ? { id: o.id } : {}),
      ...(o.attribution ? { attribution: o.attribution } : {}),
      ...(o.license ? { license: o.license } : {}),
    });
    console.log(c.ok(`layer ${l.id}: ${l.regions.length} regions`), c.dim(`(${l.license})`));
    console.log(c.dim(l.regions.map((r) => (r.iso ? `${r.name} (${r.iso})` : r.name)).join(', ')));
    if (l.attribution) console.log(c.dim(`credited on maps as: ${l.attribution}`));
    console.log(
      c.dim(
        `use it in a map: "regions": {"layer": "${l.id}", "highlight": [{"region": "${l.regions[0]!.iso ?? l.regions[0]!.name}"}]}`,
      ),
    );
  });
geo
  .command('list')
  .option('-d, --dir <dir>', 'project folder', '.')
  .description('region layers in the book')
  .action((o) => {
    const layers = P.listGeoLayers(project(o.dir));
    if (!layers.length) console.log(c.dim('no region layers yet: warqa geo add MAR'));
    for (const l of layers) console.log(`${c.b(l.id)} ${l.regions.length} regions ${c.dim(l.attribution)}`);
  });

const pack = program.command('pack').description('third-party component packs (new kinds of pictures)');
pack
  .command('add')
  .argument('<pack>', 'a pack folder or .js file, or an npm package name (e.g. warqa-pack-clock)')
  .option('-d, --dir <dir>', 'project folder', '.')
  .description('add a component pack to the book (packs are code: only add packs you trust)')
  .action((spec: string, o) => {
    const p = project(o.dir);
    const src = P.packSource(spec, (name) => {
      const tmp = mkdtempSync(join(tmpdir(), 'warqa-pack-'));
      const r = spawnSync('npm', ['install', '--prefix', tmp, '--no-save', '--ignore-scripts', name], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      if (r.status !== 0) throw new Error(`npm could not install ${name}`);
      return join(tmp, 'node_modules', name);
    });
    mkdirSync(p.path('packs'), { recursive: true });
    copyFileSync(src.file, p.path('packs', src.name));
    const rel = `packs/${src.name}`;
    const types = P.loadPackFile(p.path(rel));
    p.config.components = [...new Set([...(p.config.components ?? []), rel])];
    p.saveBook();
    console.log(
      c.ok(`added ${rel}`),
      types.length ? `components: ${types.join(', ')}` : c.warn('(it registered no new components)'),
    );
  });
pack
  .command('list')
  .option('-d, --dir <dir>', 'project folder', '.')
  .description('component packs of the book')
  .action((o) => {
    const p = project(o.dir);
    const files = p.config.components ?? [];
    if (!files.length) console.log(c.dim('no component packs: warqa pack add <folder | npm name>'));
    for (const r of P.loadPacks(p.root, files))
      console.log(`${c.b(r.file)} ${r.types.join(', ') || c.dim('(already loaded)')}`);
  });
pack
  .command('remove')
  .argument('<file>', 'pack file as listed, e.g. packs/warqa-pack-clock.js')
  .option('-d, --dir <dir>', 'project folder', '.')
  .description('stop using a component pack (lessons that use its components will no longer validate)')
  .action((file: string, o) => {
    const p = project(o.dir);
    p.config.components = (p.config.components ?? []).filter((f) => f !== file);
    p.saveBook();
    console.log(c.ok(`removed ${file}`));
  });

const panel = program.command('panel').description('teacher panels: people rate the lessons models made');
panel
  .command('kit')
  .argument('<dirs...>', 'one or more book folders (e.g. the same chapter built with different models)')
  .requiredOption('-c, --chapter <id>', 'chapter to rate')
  .option('-o, --out <dir>', 'kit folder', 'panel-kit')
  .option('--kit <id>', 'kit id (default: kit-<date>)')
  .option('--lang <list>', 'languages to include')
  .option('--no-blind', 'show the model names instead of letters')
  .description('export a review kit: lessons with a rating dialog, plus a key file for you (not for raters)')
  .action((dirs: string[], o) => {
    const entries = dirs.map((d) => {
      const p = project(d);
      if (!p.hasLesson(o.chapter)) throw new Error(`${d} has no lesson ${o.chapter}`);
      return {
        project: p,
        lesson: o.chapter as string,
        label: p.config.models.writer ?? p.config.preset ?? basename(p.root),
      };
    });
    const r = P.exportPanelKit(entries, {
      out: resolve(o.out),
      blind: o.blind,
      ...(o.kit ? { kit: o.kit } : {}),
      ...(o.lang ? { langs: String(o.lang).split(',') } : {}),
    });
    console.log(c.ok(`kit ${r.key.kit}: ${Object.keys(r.key.codes).length} lessons → ${r.out}`));
    console.log(c.dim(`key (keep it, do not send it to raters): ${r.keyFile}`));
    console.log(
      c.dim('Share the kit folder (zip it, or put it on a web server). Raters send back their ratings file.'),
    );
  });
panel
  .command('results')
  .argument('<files...>', 'ratings files sent back by raters (warqa-ratings-*.json)')
  .requiredOption('--key <file>', 'the kit key written by `warqa panel kit`')
  .option('--leaderboard <file>', 'also add the table to this Markdown file (e.g. evals/LEADERBOARD.md)')
  .description('score a teacher panel: mean ratings per model and criterion')
  .action((files: string[], o) => {
    const key = JSON.parse(readFileSync(o.key, 'utf8')) as P.PanelKey;
    const ratings = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as P.RatingsFile);
    const others = ratings.filter((r) => r.kit !== key.kit).length;
    if (others) console.log(c.warn(`${others} file(s) belong to another kit and were skipped`));
    const md = P.panelMarkdown(P.scorePanel(ratings, key), key.kit);
    console.log(md);
    if (o.leaderboard) {
      const old = existsSync(o.leaderboard) ? readFileSync(o.leaderboard, 'utf8') : '# Model leaderboard\n';
      const marker = `## Teacher panel (${key.kit})`;
      // replace this kit's section if it is there (up to the next section), else append it
      const at = old.indexOf(marker);
      const end = at < 0 ? -1 : old.indexOf('\n## ', at + marker.length);
      const next =
        at < 0 ? `${old.trimEnd()}\n\n${md}` : `${old.slice(0, at)}${md}${end < 0 ? '' : `\n${old.slice(end + 1)}`}`;
      writeFileSync(o.leaderboard, next);
      console.log(c.ok(`added to ${o.leaderboard}`));
    }
  });

program
  .command('narrate')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--lang <list>', 'languages (default: all book languages)')
  .option('--engine <id>', `speech engine: ${P.TTS_IDS.join(', ')}`)
  .option('--voice <name>', 'voice name')
  .option('--rate <pct>', 'speaking rate, e.g. -4%')
  .option('--force', 'synthesize again')
  .description('synthesize narration audio with word-timed marks')
  .action(async (dir: string, o) => {
    const p = project(dir);
    for (const id of chaptersOf(p, o.chapter)) {
      for (const lang of o.lang ? String(o.lang).split(',') : p.book.langs) {
        const r = await P.narrateLesson(p, id, lang, {
          ...(o.engine ? { provider: o.engine } : {}),
          ...(o.voice ? { voice: o.voice } : {}),
          ...(o.rate ? { rate: o.rate } : {}),
          force: !!o.force,
          onProgress: (e) =>
            process.stdout.write(
              `${e.status === 'failed' ? c.err('✗') : e.status === 'cached' ? c.dim('·') : c.ok('♪')}`,
            ),
        });
        console.log(
          ` ${id} ${lang} ${c.dim(`${r.provider}/${r.voice}: ${r.synthesized.length} new, ${r.cached.length} cached`)}`,
        );
        for (const f of r.failed) console.log(`  ${c.err(f.beat)} ${f.error}`);
        for (const [b, m] of Object.entries(r.estimated))
          console.log(`  ${c.warn('estimated marks')} ${b}: ${m.join(', ')}`);
      }
    }
  });

program
  .command('validate')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .description('check lessons and translations')
  .action((dir: string, o) => {
    const p = project(dir);
    let bad = 0;
    for (const id of chaptersOf(p, o.chapter).filter((x) => p.hasLesson(x))) {
      const lesson = p.loadLesson(id);
      for (const lang of p.book.langs) {
        const strings = lang === lesson.lang ? undefined : p.loadStrings(id, lang);
        if (lang !== lesson.lang && !strings) {
          console.log(`${id} ${lang} ${c.warn('not translated')}`);
          continue;
        }
        const issues = [
          ...(strings ? checkStrings(lesson, strings, lang) : []),
          ...validateLesson(localize(lesson, strings), {
            lang,
            ...(p.loadTimings(id, lang) ? { timings: p.loadTimings(id, lang)! } : {}),
            pacing: true,
          }).issues,
        ];
        const errors = issues.filter((i) => i.level === 'error');
        bad += errors.length;
        console.log(
          `${id} ${lang} ${errors.length ? c.err(`${errors.length} errors`) : c.ok('ok')} ${c.dim(`${issues.length - errors.length} warnings`)}`,
        );
        for (const i of issues.slice(0, 10))
          console.log(`  ${i.level === 'error' ? c.err('✗') : c.warn('!')} ${i.beat ? `${i.beat}: ` : ''}${i.message}`);
      }
    }
    if (bad) process.exitCode = 1;
  });

program
  .command('export')
  .argument('[dir]', 'project folder', '.')
  .option('-o, --out <dir>', 'output folder (default: dist/)')
  .option('--zip', 'also write a .zip of the site')
  .option('--scorm', 'write a SCORM 1.2 package for Moodle and other LMSs')
  .option('--anki <lang>', 'write flashcards for Anki (tab-separated) in a language')
  .option('--csv <lang>', 'write flashcards as CSV in a language')
  .option('--video <lang>', 'render each lesson to MP4 in a language (needs ffmpeg)')
  .option('--fps <n>', 'video frames per second', '20')
  .description('export a static site (offline, file://) and optionally SCORM, flashcards or video')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const r = P.exportSite(p, { ...(o.out ? { out: resolve(o.out) } : {}) });
    console.log(c.ok(`${r.lessons.length} lessons, ${r.langs.join('/')}, ${r.audio} audio clips → ${r.out}`));
    if (o.zip) console.log(c.ok(`zip → ${P.zipFolder(r.out, `${r.out.replace(/\/$/, '')}.zip`)}`));
    if (o.scorm) console.log(c.ok(`SCORM → ${P.exportScorm(p)}`));
    if (o.anki) console.log(c.ok(`Anki → ${P.exportAnki(p, o.anki)}  ${c.dim('(Anki: File → Import, allow HTML)')}`));
    if (o.csv) console.log(c.ok(`CSV → ${P.exportCsv(p, o.csv)}`));
    if (o.video) {
      for (const id of r.lessons) {
        let shown = 0;
        const out = await P.exportVideo(p, id, {
          lang: o.video,
          fps: Number(o.fps),
          onProgress: (e) => {
            const pct = Math.floor((100 * e.frame) / e.frames);
            if (pct >= shown + 5) {
              shown = pct;
              process.stdout.write(`\r${id} ${pct}%   `);
            }
          },
        });
        console.log(`\r${c.ok(`video → ${out}`)}`);
      }
    }
    console.log(`Open ${c.b(join(r.out, 'index.html'))} or run ${c.b('warqa preview')}`);
  });

program
  .command('illustrate')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option(
    '--model <id>',
    'image model, e.g. openai:gpt-image-2, google:imagen-4.0-generate-001, xai:grok-imagine-image',
  )
  .option('--style <text>', 'house style for every picture')
  .option('--force', 'generate again')
  .description('generate pictures for image and storypage nodes that have a prompt')
  .action(async (dir: string, o) => {
    const p = project(dir);
    for (const id of chaptersOf(p, o.chapter).filter((x) => p.hasLesson(x))) {
      const r = await P.illustrateLesson(p, id, {
        config: { ...(o.model ? { model: o.model } : {}), ...(o.style ? { style: o.style } : {}) },
        force: !!o.force,
        onImage: (n) => console.log(`  ${c.ok('🖼')} ${n}`),
      });
      console.log(
        `${id}: ${r.generated.length} new, ${r.kept.length} kept${r.failed.length ? `, ${c.err(`${r.failed.length} failed`)}` : ''}`,
      );
      for (const f of r.failed) console.log(`  ${c.err(f.node)} ${f.error}`);
    }
  });

program
  .command('rewrite')
  .argument('[dir]', 'project folder', '.')
  .requiredOption('-c, --chapter <id>', 'chapter id')
  .requiredOption('-b, --beat <id>', 'beat id')
  .option('-i, --instruction <text>', 'what to change, e.g. "shorter, and use a balance scale"')
  .description('regenerate one beat (keeps the others)')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const doc = P.loadDocument(p);
    const plan = P.loadPlan(p);
    if (!doc || !plan) throw new Error('needs source/document.json and plan.json (run ingest and plan first)');
    const llm = P.projectLlm(p, { onEvent: llmEvents });
    await P.rewriteBeat(p, doc, plan, o.chapter, o.beat, {
      llm,
      ...(o.instruction ? { instruction: o.instruction } : {}),
    });
    console.log(
      c.ok(`rewrote ${o.chapter}/${o.beat}`),
      c.dim('— its old translations were removed; run `warqa translate` to redo just those strings'),
    );
  });

program
  .command('improve')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--lang <code>', 'language the judge looks at (default: the lesson language)')
  .option('--threshold <n>', 'rewrite beats the judge scores below this (1–5)', '4')
  .option('--rounds <n>', 'judge → rewrite rounds', '1')
  .description('judge every beat with a vision model and rewrite the weak ones using its notes')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const llm = P.projectLlm(p, { onEvent: llmEvents });
    for (const id of chaptersOf(p, o.chapter).filter((x) => p.hasLesson(x))) {
      console.log(c.b(id));
      const r = await P.improveLesson(p, id, {
        llm,
        threshold: Number(o.threshold),
        rounds: Number(o.rounds),
        ...(o.lang ? { lang: o.lang } : {}),
        onBeat: (e) =>
          console.log(
            `  ${e.status === 'rewritten' ? c.ok('rewrote') : c.err('failed')} ${e.id} ${c.dim(`(was ${e.score}/5)`)}${e.detail ? ` ${e.detail}` : ''}`,
          ),
      });
      const good = (v: { score: number }[]) => v.filter((x) => x.score >= Number(o.threshold)).length;
      console.log(
        `  judge: ${good(r.before)}/${r.before.length} → ${c.ok(`${good(r.after)}/${r.after.length}`)} beats look right`,
      );
      for (const v of r.after.filter((x) => x.score < Number(o.threshold)))
        console.log(`  ${c.warn(`${v.score}/5`)} ${v.id}: ${v.problem ?? ''}${v.fix ? c.dim(` → ${v.fix}`) : ''}`);
      if (r.rewritten.length && p.book.langs.length > 1)
        console.log(
          c.dim('  run `warqa translate` and `warqa narrate` to refresh the rewritten beats in other languages'),
        );
    }
  });

program
  .command('preview')
  .argument('[dir]', 'project folder', '.')
  .option('-p, --port <n>', 'port', '8765')
  .option('--no-export', 'serve the existing dist/ as is')
  .description('export and serve the book locally (with audio seeking)')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const out = o.export ? P.exportSite(p).out : p.path('dist');
    const { url } = await P.serveStatic(out, Number(o.port));
    console.log(c.ok(`Serving ${out}`));
    console.log(`Open ${c.b(url)}  ${c.dim('(Ctrl+C to stop)')}`);
  });

program
  .command('qa')
  .argument('[dir]', 'project folder', '.')
  .option('-c, --chapter <ids>', 'chapter id(s) or "all"', 'all')
  .option('--lang <list>', 'languages (default: all)')
  .option('--shots', 'write screenshots and contact sheets into qa/')
  .option('--browser <name>', 'chromium, firefox or webkit', 'chromium')
  .option('--judge', 'also ask the vision (judge) model whether each picture shows what is said')
  .description('render lessons headlessly and check blanks, overlaps, overflow and errors')
  .action(async (dir: string, o) => {
    const p = project(dir);
    const out = P.exportSite(p).out;
    const { server, url } = await P.serveStatic(out, 0);
    let problems = 0;
    try {
      for (const id of chaptersOf(p, o.chapter).filter((x) => p.hasLesson(x))) {
        for (const lang of o.lang ? String(o.lang).split(',') : p.book.langs) {
          const r = await P.checkLesson({
            url: `${url}${id}/index.html`,
            lang,
            browser: o.browser,
            ...(o.shots ? { shots: p.path('qa', id, lang) } : {}),
          });
          problems += r.issues.length;
          console.log(
            `${id} ${lang} ${r.issues.length ? c.warn(`${r.issues.length} issues`) : c.ok('clean')} ${c.dim(`${r.beats} beats`)}`,
          );
          for (const i of r.issues.slice(0, 15))
            console.log(`  ${c.warn(i.kind)} ${i.id ? `${i.id}: ` : ''}${i.message}`);
          if (r.sheets.length) console.log(c.dim(`  contact sheets: ${dirname(r.sheets[0]!)}`));
          if (o.judge) {
            const notes = await P.judgeLesson(p, id, { llm: P.projectLlm(p, { onEvent: llmEvents }), lang });
            for (const n of notes.filter((x) => x.score < 4))
              console.log(
                `  ${c.warn(`judge ${n.score}/5`)} ${n.id}: ${n.problem ?? ''}${n.fix ? c.dim(` → ${n.fix}`) : ''}`,
              );
            console.log(c.dim(`  judge: ${notes.filter((x) => x.score >= 4).length}/${notes.length} beats look right`));
          }
        }
      }
    } finally {
      server.close();
    }
    if (problems) process.exitCode = 1;
  });

const models = program.command('models').description('choose and inspect AI models');
models
  .command('status')
  .description('which providers have keys, and which presets you can use')
  .action(() => {
    loadEnv(process.cwd());
    for (const s of P.providerStatus())
      console.log(
        `${s.configured ? c.ok('✓') : c.dim('·')} ${s.id.padEnd(11)} ${s.name}${s.configured ? '' : c.dim(` — set ${s.missing.join(', ')}`)}`,
      );
    const avail = P.availablePresets().map((x) => x.id);
    console.log(
      `\nPresets you can use: ${avail.length ? c.b(avail.join(', ')) : c.warn('none yet (add a key, or install Ollama for "local")')}`,
    );
  });
models
  .command('presets')
  .description('list presets (role → model)')
  .action(() => {
    for (const pr of P.PRESETS) {
      console.log(`${c.b(pr.id.padEnd(11))} ${pr.label} — ${c.dim(pr.description)}`);
      for (const r of P.ROLES) console.log(`   ${r.padEnd(11)} ${pr.roles[r]}`);
    }
  });
models
  .command('list')
  .option('--provider <id>', 'only this provider')
  .description('known models with capabilities and prices')
  .action((o) => {
    for (const m of P.listModels().filter((x) => !o.provider || x.id.startsWith(`${o.provider}:`))) {
      console.log(
        `${m.id.padEnd(46)} tier ${m.tier}  ${m.vision ? 'vision' : '      '}  ${m.structured ? 'json-schema' : 'json-prompt'}  ${c.dim(`$${m.input}/$${m.output} per Mtok · ${Math.round(m.context / 1000)}k ctx${m.license ? ` · ${m.license}` : ''}`)}`,
      );
    }
  });
models
  .command('update')
  .description('refresh model capabilities and prices from models.dev')
  .action(async () => console.log(c.ok(`${await P.updateCatalog()} models cached`)));
models
  .command('set')
  .argument(
    '<assignments...>',
    'role=provider:model (roles: planner storyboard writer translator vision judge) or preset=<id>',
  )
  .option('-d, --dir <dir>', 'project folder', '.')
  .description('set models for a project')
  .action((assignments: string[], o) => {
    const p = project(o.dir);
    for (const a of assignments) {
      const i = a.indexOf('=');
      const k = a.slice(0, i);
      const v = a.slice(i + 1);
      if (k === 'preset') p.config.preset = v;
      else if ((P.ROLES as string[]).includes(k)) p.config.models[k] = v;
      else throw new Error(`unknown role "${k}" (${P.ROLES.join(', ')}, preset)`);
    }
    p.saveBook();
    for (const r of P.ROLES) {
      let m: string;
      try {
        m = P.resolveRole(r, p.config);
      } catch (e) {
        m = c.warn((e as Error).message);
      }
      console.log(`${r.padEnd(11)} ${m}`);
    }
  });
models
  .command('probe')
  .argument('<model>', 'provider:model')
  .description('check that a model answers and returns valid lesson JSON (5 small calls)')
  .action(async (model: string) => {
    loadEnv(process.cwd());
    const r = await P.probeModel(model);
    console.log(
      `${model}: ${r.ok}/${r.total} passed → suggested tier ${c.b(r.tier)} ${c.dim(`(${r.ms} ms, $${r.usd.toFixed(4)})`)}`,
    );
    for (const f of r.failures) console.log(`  ${c.warn('✗')} ${f}`);
  });

program
  .command('estimate')
  .argument('[dir]', 'project folder', '.')
  .description('estimate the cost of building the book with the current models')
  .action((dir: string) => {
    const p = project(dir);
    const e = P.estimateBuild(p);
    for (const l of e.lines) console.log(l);
    console.log(
      c.b(`≈ $${e.p50.toFixed(2)} (p90 $${e.p90.toFixed(2)})`),
      c.dim('— cached calls are free when you rebuild'),
    );
    const spent = P.ledgerSummary(p.path('.ledger.jsonl'));
    if (spent.calls) console.log(c.dim(`spent so far: $${spent.total.toFixed(3)} in ${spent.calls} calls`));
  });

program
  .command('doctor')
  .description('check the tools Warqa can use on this machine')
  .action(async () => {
    loadEnv(process.cwd());
    const has = (cmd: string, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
    const row = (ok: boolean, name: string, hint: string) =>
      console.log(`${ok ? c.ok('✓') : c.warn('·')} ${name.padEnd(22)} ${ok ? '' : c.dim(hint)}`);
    row(Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node}`, 'Node 22+ is required');
    row(
      has('uv') || has('python3', ['-c', 'import edge_tts']),
      'edge-tts (Edge voices)',
      'install uv, or `pip install edge-tts`, to use the free Edge voices',
    );
    row(has('ffmpeg', ['-version']), 'ffmpeg (optional)', 'used for video export');
    let pw = false;
    try {
      pw = existsSync((await P.loadPlaywright()).chromium.executablePath());
    } catch {
      pw = false;
    }
    row(pw, 'Playwright Chromium', 'needed for `warqa qa`: npx playwright install chromium');
    for (const s of P.providerStatus())
      if (s.kind !== 'local') row(s.configured, `${s.id} key`, `set ${s.missing.join(', ')} to use ${s.name}`);
    console.log(`Languages with UI catalogs: ${LANGS.join(', ')}`);
  });

program
  .command('studio')
  .argument('[dir]', 'project folder or a folder of projects', '.')
  .option('-p, --port <n>', 'port', '5170')
  .description('open the web studio')
  .action((dir: string, o) => {
    const entry = [
      join(here, '../../studio/dist/server/index.js'),
      join(here, '../node_modules/@warqa/studio/dist/server/index.js'),
    ].find(existsSync);
    if (!entry) {
      console.error(c.err('The studio is not built: pnpm --filter @warqa/studio build'));
      process.exit(1);
    }
    loadEnv(resolve(dir));
    spawnSync(process.execPath, [entry, '--root', resolve(dir), '--port', String(o.port)], { stdio: 'inherit' });
  });

program.parseAsync().catch((e: Error) => {
  console.error(c.err(e.message));
  if (process.env.WARQA_DEBUG) console.error(e.stack);
  process.exit(1);
});
