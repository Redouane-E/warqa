// Export a book project as a static site: works from any web server and from file:// (data is inlined).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { dirOf } from '@warqa/i18n';
import { completeTimings, type Lesson, type LText, localize, ltext, type Strings, type Timings } from '@warqa/lesson';
import type { Project } from '../project/index.js';
import { lessonMath } from './math.js';
import { addPwa } from './pwa.js';

export interface ExportOptions {
  out?: string;
  /** Add a manifest and an offline service worker (installable book). Default true. */
  pwa?: boolean;
  /** Only these lessons (default: all). */
  lessons?: string[];
  /** Only these languages (default: the book's). */
  langs?: string[];
  clean?: boolean;
  /** Teacher panel: every lesson shows the rating dialog; codes name the lessons in the ratings file. */
  panel?: { kit: string; codes: Record<string, string> };
}

export interface ExportResult {
  out: string;
  lessons: string[];
  langs: string[];
  audio: number;
}

const require = createRequire(import.meta.url);

/** Folder with player.js, player.css and fonts/ from @warqa/lesson. */
export function playerBundleDir(): string {
  const pkg = dirname(require.resolve('@warqa/lesson/package.json'));
  const dir = join(pkg, 'dist', 'bundle');
  if (!existsSync(join(dir, 'player.js')))
    throw new Error('player bundle missing: run `pnpm --filter @warqa/lesson build`');
  return dir;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** JSON safe to inline in a <script> element. */
const inline = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

function page(opts: {
  lang: string;
  dir: string;
  title: string;
  base: string;
  script: string;
  description?: string;
  /** Component pack scripts, loaded before the player so it can register their components. */
  packs?: string[];
}): string {
  return `<!doctype html>
<html lang="${esc(opts.lang)}" dir="${opts.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
${opts.description ? `<meta name="description" content="${esc(opts.description)}">\n` : ''}<meta name="generator" content="Warqa">
<link rel="stylesheet" href="${opts.base}_warqa/player.css">
<style>html,body{margin:0;height:100%;background:#121b18}#warqa{height:100%}</style>
</head>
<body>
<div id="warqa"></div>
<script>${opts.script}</script>
${(opts.packs ?? []).map((f) => `<script src="${opts.base}_warqa/packs/${esc(f)}"></script>\n`).join('')}<script src="${opts.base}_warqa/player.js"></script>
<noscript>This interactive book needs JavaScript.</noscript>
</body>
</html>
`;
}

const ltextMap = (v: LText | undefined, langs: string[]): Record<string, string> =>
  v === undefined ? {} : Object.fromEntries(langs.map((l) => [l, ltext(v, l)]));

/** Export the whole book (or some lessons) to a static folder. */
export function exportSite(project: Project, opts: ExportOptions = {}): ExportResult {
  const out = opts.out ?? project.path('dist');
  if (opts.clean !== false && existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const book = project.book;
  const langs = opts.langs ?? book.langs;
  const ids = (opts.lessons ?? project.lessonIds()).filter((id) => project.hasLesson(id));
  const lessons = new Map<string, Lesson>(ids.map((id) => [id, project.loadLesson(id)]));
  // map data is large: ship it only with books that have maps
  const hasMaps = [...lessons.values()].some((l) => l.beats.some((b) => b.scene.add.some((n) => n.type === 'map')));
  cpSync(playerBundleDir(), join(out, '_warqa'), {
    recursive: true,
    filter: (src) => !src.endsWith('.map') && (hasMaps || !/geo-world[\w-]*\.js$/.test(src)),
  });
  if (existsSync(project.path('assets'))) cpSync(project.path('assets'), join(out, 'assets'), { recursive: true });
  // third-party component packs: their script goes next to the player
  const packs = (project.config.components ?? []).map((f) => {
    const name = basename(f);
    mkdirSync(join(out, '_warqa', 'packs'), { recursive: true });
    copyFileSync(project.path(f), join(out, '_warqa', 'packs', name));
    return name;
  });
  let audioCount = 0;

  ids.forEach((id, k) => {
    const lesson = lessons.get(id)!;
    const dir = join(out, id);
    mkdirSync(dir, { recursive: true });
    const strings: Record<string, Strings> = {};
    const timings: Record<string, Timings> = {};
    const audio: Record<string, Record<string, string>> = {};
    const available: string[] = [];
    for (const lang of langs) {
      const s = lang === lesson.lang ? undefined : project.loadStrings(id, lang);
      if (lang !== lesson.lang && !s) continue;
      available.push(lang);
      if (s) strings[lang] = s;
      const localized = localize(lesson, s);
      timings[lang] = completeTimings(localized, lang, project.loadTimings(id, lang));
      const files = project.audioFiles(id, lang);
      const beatIds = new Set(localized.beats.map((b) => b.id));
      const usable = Object.entries(files).filter(([b]) => beatIds.has(b));
      if (usable.length) {
        mkdirSync(join(dir, 'audio', lang), { recursive: true });
        audio[lang] = {};
        for (const [b, f] of usable) {
          copyFileSync(join(project.audioDir(id, lang), f), join(dir, 'audio', lang, f));
          audio[lang][b] = `audio/${lang}/${f}`;
          audioCount++;
        }
      }
    }
    const defaultLang = available.includes(book.defaultLang ?? '') ? book.defaultLang! : available[0]!;
    const math = lessonMath(lesson);
    const data = {
      lesson,
      langs: available,
      lang: defaultLang,
      strings,
      timings,
      audio,
      book: {
        id: book.id,
        title: ltext(book.title, defaultLang),
        digits: book.digits,
        home: '../index.html#contents',
        ...(ids[k + 1] ? { next: `../${ids[k + 1]}/index.html` } : {}),
        ...(ids[k - 1] ? { prev: `../${ids[k - 1]}/index.html` } : {}),
      },
      assetsBase: '../assets/',
      ...(math ? { math } : {}),
      ...(opts.panel ? { panel: { kit: opts.panel.kit, code: opts.panel.codes[id] ?? id } } : {}),
    };
    const title = `${localize(lesson, strings[defaultLang]).title} — ${ltext(book.title, defaultLang)}`;
    const dirAttr = dirOf(defaultLang);
    writeFileSync(
      join(dir, 'index.html'),
      page({
        lang: defaultLang,
        dir: dirAttr,
        title,
        base: '../',
        script: `window.WARQA_DATA=${inline(data)};`,
        packs,
      }),
    );
  });

  // cover + contents
  const titleOf = (id: string) => {
    const l = lessons.get(id)!;
    return Object.fromEntries(
      langs.map((lang) => [lang, localize(l, lang === l.lang ? undefined : project.loadStrings(id, lang)).title]),
    );
  };
  const units = book.units.length ? book.units : [{ title: book.title, chapters: ids }];
  const placed = new Set<string>();
  const unitData = units
    .map((u) => ({
      title: ltextMap(u.title, langs),
      chapters: u.chapters
        .filter((c) => lessons.has(c))
        .map((c) => {
          placed.add(c);
          const l = lessons.get(c)!;
          return {
            id: c,
            href: `${c}/index.html`,
            ...(l.number !== undefined ? { number: l.number } : {}),
            title: titleOf(c),
            ...(l.minutes ? { minutes: l.minutes } : {}),
          };
        }),
    }))
    .filter((u) => u.chapters.length);
  const rest = ids.filter((id) => !placed.has(id));
  if (rest.length)
    unitData.push({
      title: ltextMap(book.title, langs),
      chapters: rest.map((c) => ({ id: c, href: `${c}/index.html`, title: titleOf(c) })),
    });
  const defaultLang = book.defaultLang ?? langs[0]!;
  const bookData = {
    id: book.id,
    title: ltextMap(book.title, langs),
    ...(book.subtitle ? { subtitle: ltextMap(book.subtitle, langs) } : {}),
    ...(book.author ? { author: book.author } : {}),
    langs,
    defaultLang,
    digits: book.digits,
    units: unitData,
    ...(book.source ? { source: book.source } : {}),
    ...(book.attribution ? { attribution: book.attribution } : {}),
  };
  const dir = ['ar', 'fa', 'he', 'ur'].includes(defaultLang.split('-')[0]!) ? 'rtl' : 'ltr';
  writeFileSync(
    join(out, 'index.html'),
    page({
      lang: defaultLang,
      dir,
      title: ltext(book.title, defaultLang),
      base: '',
      script: `window.WARQA_BOOK=${inline(bookData)};`,
    }),
  );
  writeFileSync(
    join(out, 'LICENSE-warqa-player.txt'),
    'The Warqa player (_warqa/) is licensed under the Apache License 2.0 and contains portions derived from Papermorph (MIT). Fonts in _warqa/fonts are under the SIL Open Font License 1.1. The lesson content belongs to its authors.\n',
  );
  if (opts.pwa !== false)
    addPwa(out, {
      title: ltext(book.title, defaultLang),
      lang: defaultLang,
      dir,
      ...(book.subtitle ? { description: ltext(book.subtitle, defaultLang) } : {}),
    });
  return { out, lessons: ids, langs, audio: audioCount };
}

/** List files of a directory recursively (for zips and reports). */
export function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) out.push(...listFiles(p, base));
    else out.push(p.slice(base.length + 1));
  }
  return out;
}
