// Book projects on disk: discovery under --root, summaries for the home page and the project page, creation.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { LANG_INFO } from '@warqa/i18n';
import { checkStrings, type Lesson, type LText, localize, ltext, safeParseLesson, validateLesson } from '@warqa/lesson';
import * as P from '@warqa/pipeline';
import type {
  BookPlan,
  DocSummary,
  LessonSummary,
  LTextMap,
  ProjectDetail,
  ProjectSummary,
  StepId,
  StepState,
} from '../shared/types.js';
import { checkSummary } from './checks.js';
import type { AiDefaults } from './defaults.js';
import { panelKeyPath, panelZipPath, zipPath, zipReady } from './zip.js';

export const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Folder name → project id ("integers.warqa" → "integers"). */
export const idOf = (dir: string): string =>
  basename(dir)
    .replace(/\.warqa$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'book';

export class Registry {
  readonly root: string;
  /** Projects created during this session outside a scanned folder (when --root is itself a project). */
  private extra = new Set<string>();

  constructor(
    root: string,
    /** Speech engine of new projects (when the defaults name none, or one this host cannot run). */
    private defaultTts = 'edge',
    /** What new books start with (AI and voices), and what this host can run of it. */
    private newBook: { defaults?: () => AiDefaults; ttsUnavailable?: string[]; worker?: boolean } = {},
  ) {
    this.root = resolve(root);
  }

  /** The folder new projects are created in. */
  get home(): string {
    return P.Project.isProject(this.root) ? dirname(this.root) : this.root;
  }

  /** id → project folder. */
  scan(): Map<string, string> {
    const out = new Map<string, string>();
    const add = (dir: string) => {
      let id = idOf(dir);
      for (let n = 2; out.has(id) && out.get(id) !== dir; n++) id = `${idOf(dir)}-${n}`;
      out.set(id, dir);
    };
    if (P.Project.isProject(this.root)) add(this.root);
    else if (existsSync(this.root)) {
      for (const d of readdirSync(this.root, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
        const dir = join(this.root, d.name);
        if (P.Project.isProject(dir)) add(dir);
      }
    }
    for (const dir of this.extra) if (P.Project.isProject(dir)) add(dir);
    return out;
  }

  dir(id: string): string | undefined {
    return ID.test(id) ? this.scan().get(id) : undefined;
  }

  open(id: string): P.Project | undefined {
    const d = this.dir(id);
    return d ? new P.Project(d) : undefined;
  }

  idFor(dir: string): string | undefined {
    for (const [id, d] of this.scan()) if (d === dir) return id;
    return undefined;
  }

  /** Create `<home>/<slug>.warqa` with the source PDF. */
  create(input: {
    title: string;
    langs: string[];
    defaultLang: string;
    audience?: string;
    pdf?: { name: string; data: Uint8Array };
  }): { id: string; dir: string } {
    const langs = [
      ...new Set(input.langs.map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l))),
    ];
    if (!langs.length) throw new Error('choose at least one language');
    const defaultLang = langs.includes(input.defaultLang) ? input.defaultLang : langs[0]!;
    const title = input.title.trim() || (input.pdf ? basename(input.pdf.name, '.pdf') : 'Book');
    const base =
      title
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^[^a-z]+/, '')
        .replace(/-+$/, '')
        .slice(0, 40)
        .replace(/-+$/, '') || 'book';
    const home = this.home;
    mkdirSync(home, { recursive: true });
    let slug = base;
    for (let n = 2; existsSync(join(home, `${slug}.warqa`)); n++) slug = `${base}-${n}`;
    const dir = join(home, `${slug}.warqa`);
    const p = P.Project.create(dir, {
      id: slug.slice(0, 32).replace(/-+$/, ''),
      title: { [defaultLang]: title },
      langs,
      defaultLang,
      ...(input.audience ? { audience: input.audience } : {}),
    });
    // the defaults for new books: the model set and models, the voices (when this host can run their engine), the
    // local helper (when this host may reach one)
    const d = this.newBook.defaults?.();
    if (d?.preset) p.config.preset = d.preset;
    if (d && Object.keys(d.models).length) p.config.models = { ...d.models };
    // (no engine chosen: the host's, with the voices and rate chosen for it)
    const chosen = d?.tts.provider;
    const engine = chosen && !this.newBook.ttsUnavailable?.includes(chosen) ? chosen : this.defaultTts;
    p.config.tts.provider = engine as typeof p.config.tts.provider;
    if (d && (!chosen || chosen === engine)) {
      p.config.tts.voices = { ...d.tts.voices };
      if (d.tts.rate) p.config.tts.rate = d.tts.rate;
    }
    if (d?.tts.tashkeel) p.config.tts.tashkeel = true;
    if (d?.worker && this.newBook.worker !== false) p.config.worker = d.worker;
    if (input.audience) p.config.audience = input.audience;
    p.saveBook();
    if (input.pdf) {
      const name =
        basename(input.pdf.name)
          .replace(/[^\w.\-؀-ۿ]+/g, '_')
          .replace(/^\.+/, '') || 'book.pdf';
      writeFileSync(p.path('source', name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`), input.pdf.data);
    }
    if (!dir.startsWith(this.root + '/') && dir !== this.root) this.extra.add(dir);
    return { id: this.idFor(dir) ?? slug, dir };
  }
}

export const ltextMap = (v: LText | undefined, langs: string[]): LTextMap => {
  if (v === undefined) return {};
  if (typeof v === 'string') return Object.fromEntries(langs.map((l) => [l, v]));
  return Object.fromEntries(langs.map((l) => [l, ltext(v, l)]).filter(([, t]) => t));
};

const mtime = (p: string) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

export function loadPlanSafe(p: P.Project): BookPlan | null {
  try {
    return (P.loadPlan(p) as BookPlan | undefined) ?? null;
  } catch {
    return null;
  }
}

export function docSummary(p: P.Project): DocSummary | null {
  let doc: P.SourceDocument | undefined;
  try {
    doc = P.loadDocument(p);
  } catch {
    return null;
  }
  if (!doc) return null;
  const methods: Record<string, number> = {};
  for (const pg of doc.pages) methods[pg.method] = (methods[pg.method] ?? 0) + 1;
  return {
    pages: doc.source.pages,
    lang: doc.lang,
    blocks: doc.blocks.length,
    ...(doc.source.title ? { title: doc.source.title } : {}),
    methods,
    read: doc.pages.map((pg) => ({ n: pg.n, method: pg.method, ...(pg.quality ? { quality: pg.quality } : {}) })),
    langs: mainLangs(doc),
    readAt: mtime(p.path('source', 'document.json')),
    sections: doc.sections.map((s) => ({
      id: s.id,
      title: s.title,
      start: s.start,
      end: s.end,
      ...(s.unit ? { unit: s.unit } : {}),
    })),
  };
}

/** The languages of at least 15 % of the pages read, the commonest first (the document's main one leads). */
function mainLangs(doc: P.SourceDocument): string[] {
  const count = new Map<string, number>();
  for (const pg of doc.pages) if (pg.lang) count.set(pg.lang, (count.get(pg.lang) ?? 0) + 1);
  const read = doc.pages.length || 1;
  const langs = [...count.entries()]
    .filter(([, n]) => n / read >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
  return [doc.lang, ...langs.filter((l) => l !== doc.lang)];
}

/** Languages a lesson is available in (author language + translated). */
export function lessonLangs(p: P.Project, id: string, lesson: Lesson): string[] {
  return p.book.langs.filter((l) => l === lesson.lang || existsSync(join(p.lessonDir(id), `strings.${l}.json`)));
}

export function lessonSummary(p: P.Project, id: string): LessonSummary | null {
  let raw: unknown;
  try {
    raw = p.loadLessonRaw(id);
  } catch {
    return null;
  }
  const parsed = safeParseLesson(raw);
  const updated = Math.max(
    mtime(join(p.lessonDir(id), 'lesson.json')),
    ...p.book.langs.map((l) => mtime(join(p.lessonDir(id), `strings.${l}.json`))),
  );
  if (!parsed.success) {
    const r = raw as { title?: string; lang?: string; beats?: unknown[] };
    return {
      id,
      title: { [r.lang ?? 'en']: String(r.title ?? id) },
      lang: r.lang ?? '',
      langs: [],
      beats: r.beats?.length ?? 0,
      hasAudio: {},
      errors: parsed.error.issues.length,
      warnings: 0,
      updated,
    };
  }
  const lesson = parsed.data as Lesson;
  const langs = lessonLangs(p, id, lesson);
  const title: LTextMap = {};
  const hasAudio: Record<string, boolean> = {};
  let errors = 0;
  let warnings = 0;
  for (const l of langs) {
    let strings: ReturnType<P.Project['loadStrings']>;
    try {
      strings = l === lesson.lang ? undefined : p.loadStrings(id, l);
    } catch {
      strings = undefined;
      errors++;
    }
    title[l] =
      typeof strings?.['lesson.title'] === 'string'
        ? (strings['lesson.title'] as string)
        : l === lesson.lang
          ? lesson.title
          : (localize(lesson, strings).title ?? lesson.title);
    const audio = p.audioFiles(id, l);
    hasAudio[l] = lesson.beats.every((b) => audio[b.id]);
    if (strings) for (const i of checkStrings(lesson, strings, l)) i.level === 'error' ? errors++ : warnings++;
  }
  try {
    for (const i of validateLesson(lesson).issues) i.level === 'error' ? errors++ : warnings++;
  } catch {
    errors++;
  }
  const questions = lesson.beats.reduce((a, b) => a + (b.questions?.length ?? 0), 0);
  return {
    id,
    title,
    lang: lesson.lang,
    langs,
    beats: lesson.beats.length,
    questions,
    hasAudio,
    errors,
    warnings,
    updated,
  };
}

function steps(
  p: P.Project,
  plan: BookPlan | null,
  doc: DocSummary | null,
  lessons: LessonSummary[],
  exported: boolean,
): Record<StepId, StepState> {
  const planned = plan ? plan.chapters.filter((c) => c.include).map((c) => c.id) : [];
  const built = lessons.map((l) => l.id);
  const target = planned.length ? planned : built;
  const madeAll = target.length > 0 && target.every((id) => built.includes(id));
  const langs = p.book.langs;
  const voicedAll =
    lessons.length > 0 &&
    lessons.every(
      (l) =>
        langs.every((g) => l.langs.includes(g)) &&
        (p.config.tts.provider === 'none' || langs.every((g) => l.hasAudio[g])),
    );
  const voicedSome = lessons.some((l) => l.langs.length > 1 || Object.values(l.hasAudio).some(Boolean));
  const hasLessons = lessons.length > 0;
  return {
    read: doc ? 'done' : p.sourcePdf() ? 'ready' : hasLessons ? 'skipped' : 'blocked',
    plan: plan?.status === 'approved' ? 'done' : plan ? 'partial' : doc ? 'ready' : hasLessons ? 'skipped' : 'blocked',
    make: madeAll ? 'done' : built.length ? 'partial' : plan?.status === 'approved' ? 'ready' : 'blocked',
    voice: voicedAll ? 'done' : voicedSome ? 'partial' : hasLessons ? 'ready' : 'blocked',
    // checking is optional: done once the lessons were looked at (QA shots), never the next step
    check: hasLessons ? (existsSync(p.path('qa')) ? 'done' : 'ready') : 'blocked',
    share: exported ? 'done' : hasLessons ? 'ready' : 'blocked',
  };
}

export function nextStep(s: Record<StepId, StepState>): StepId {
  const order: StepId[] = ['read', 'plan', 'make', 'voice', 'share'];
  return order.find((k) => s[k] !== 'done' && s[k] !== 'skipped') ?? 'share';
}

export function projectSummary(id: string, p: P.Project): ProjectSummary {
  const plan = loadPlanSafe(p);
  const doc = existsSync(p.path('source', 'document.json')) ? docSummary(p) : null;
  const lessons = p
    .lessonIds()
    .map((l) => lessonSummary(p, l))
    .filter((x): x is LessonSummary => !!x);
  return summaryFrom(id, p, plan, doc, lessons);
}

function summaryFrom(
  id: string,
  p: P.Project,
  plan: BookPlan | null,
  doc: DocSummary | null,
  lessons: LessonSummary[],
): ProjectSummary {
  const exported = existsSync(p.path('dist', 'index.html'));
  const lessonTimes = lessons.map((l) => l.updated);
  const langs = p.book.langs;
  const planned = plan ? plan.chapters.filter((c) => c.include).length : 0;
  return {
    id,
    title: ltextMap(p.book.title, langs),
    langs,
    defaultLang: p.book.defaultLang ?? langs[0]!,
    chapters: Math.max(planned, lessons.length),
    built: lessons.length,
    updated: Math.max(
      mtime(p.path('warqa.json')),
      mtime(p.path('plan.json')),
      mtime(p.path('source', 'document.json')),
      ...lessonTimes,
    ),
    hasPdf: !!p.sourcePdf(),
    exported,
    steps: steps(p, plan, doc, lessons, exported),
    ...(p.book.learn ? { learn: { level: p.book.learn.level } } : {}),
    made: madeInOrder(plan, lessons),
    spent: P.ledgerSummary(p.path('.ledger.jsonl')).total,
    ...(doc ? { source: { pages: doc.pages, lang: doc.lang } } : {}),
  };
}

/** The lessons made, in the plan's order (lessons outside the plan last). */
function madeInOrder(plan: BookPlan | null, lessons: LessonSummary[]): { id: string; title: LTextMap }[] {
  const order = plan ? plan.chapters.map((c) => c.id) : [];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...lessons]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map((l) => ({ id: l.id, title: l.title }));
}

export function projectDetail(id: string, p: P.Project, jobs: ProjectDetail['jobs']): ProjectDetail {
  const plan = loadPlanSafe(p);
  const doc = docSummary(p);
  const lessons = p
    .lessonIds()
    .map((l) => lessonSummary(p, l))
    .filter((x): x is LessonSummary => !!x);
  const s = summaryFrom(id, p, plan, doc, lessons);
  const roles: ProjectDetail['roles'] = {};
  for (const r of P.ROLES) {
    try {
      roles[r] = { model: P.resolveRole(r, p.config) };
    } catch (e) {
      roles[r] = { error: (e as Error).message };
    }
  }
  const pdf = p.sourcePdf();
  let pdfBytes: number | undefined;
  try {
    pdfBytes = pdf ? statSync(pdf).size : undefined;
  } catch {
    pdfBytes = undefined;
  }
  const planUpdated = existsSync(p.path('plan.json')) ? mtime(p.path('plan.json')) : undefined;
  const drafts: NonNullable<ProjectDetail['drafts']> = {};
  const stale: NonNullable<ProjectDetail['stale']> = {};
  for (const c of plan?.chapters ?? []) {
    if (!c.include) continue;
    const d = P.unfinishedDraft(p, c.id);
    if (d) drafts[c.id] = d;
    const langs = P.staleTranslations(p, c.id);
    if (langs.length) stale[c.id] = langs;
  }
  return {
    ...s,
    ...(pdfBytes !== undefined ? { pdfBytes } : {}),
    ...(planUpdated ? { planUpdated } : {}),
    book: {
      id: p.book.id,
      title: p.book.title,
      ...(p.book.subtitle !== undefined ? { subtitle: p.book.subtitle } : {}),
      ...(p.book.author ? { author: p.book.author } : {}),
      langs: p.book.langs,
      ...(p.book.defaultLang ? { defaultLang: p.book.defaultLang } : {}),
      ...(p.book.sourceLang ? { sourceLang: p.book.sourceLang } : {}),
      digits: p.book.digits,
      ...(p.book.audience ? { audience: p.book.audience } : {}),
      units: p.book.units,
      ...(p.book.learn ? { learn: { level: p.book.learn.level } } : {}),
    },
    config: p.config as ProjectDetail['config'],
    plan,
    lessons,
    ...(Object.keys(drafts).length ? { drafts } : {}),
    ...(Object.keys(stale).length ? { stale } : {}),
    ledger: P.ledgerSummary(p.path('.ledger.jsonl')),
    document: doc,
    ...(pdf ? { pdf: basename(pdf) } : {}),
    exportInfo: exportInfo(p, s.exported),
    jobs,
    next: nextStep(s.steps),
    roles,
    ...(existsSync(panelKeyPath(p.root))
      ? {
          panelKit: {
            at: mtime(panelKeyPath(p.root)),
            ...(existsSync(panelZipPath(p.root)) ? { bytes: statSync(panelZipPath(p.root)).size } : {}),
          },
        }
      : {}),
    ...(() => {
      const checks = checkSummary(p);
      return Object.keys(checks).length ? { checks } : {};
    })(),
  };
}

/** The newest change under a folder (files only), 0 when there is nothing. */
function newestUnder(dir: string): number {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, f.name);
    max = Math.max(max, f.isDirectory() ? newestUnder(full) : statSync(full).mtimeMs);
  }
  return max;
}

/**
 * What the Share step says of the export: when, the zip's size, whether the lessons changed after it (a lesson, its
 * strings, timings or audio, the book's assets or the settings an export shows), and the SCORM package and videos.
 */
function exportInfo(p: P.Project, exported: boolean): ProjectDetail['exportInfo'] {
  const zip = zipReady(p.root);
  const at = exported ? mtime(p.path('dist', 'index.html')) : 0;
  // only what an export holds: each lesson, its strings, timings and audio, and the book's assets (not the
  // editor's candidates and history, the review marks, drafts or settings)
  const exportedOf = (lid: string) => {
    const dir = p.path('lessons', lid);
    if (!existsSync(dir)) return 0;
    return Math.max(
      ...readdirSync(dir)
        .filter((f) => f === 'lesson.json' || /^(strings|timings)\.[\w-]+\.json$/.test(f))
        .map((f) => mtime(join(dir, f))),
      newestUnder(join(dir, 'audio')),
      0,
    );
  };
  // the book's own settings (title, languages, digits…) changed since: the export shows the old ones
  const fp = p.path('cache', 'exported-book.json');
  const bookChanged = exported && existsSync(fp) && readFileSync(fp, 'utf8') !== P.bookFingerprint(p);
  const changed = Math.max(0, newestUnder(p.path('assets')), ...p.lessonIds().map(exportedOf));
  const scorm = p.path('dist-scorm.zip');
  const videos = existsSync(p.root)
    ? readdirSync(p.root).flatMap((f) => {
        const m = /^(.+)\.([\w-]+)\.mp4$/.exec(f);
        if (!m || !p.hasLesson(m[1]!)) return [];
        const st = statSync(p.path(f));
        return [{ lesson: m[1]!, lang: m[2]!, bytes: st.size, at: st.mtimeMs }];
      })
    : [];
  return {
    exported,
    zip,
    ...(exported ? { at } : {}),
    ...(zip ? { zipBytes: statSync(zipPath(p.root)).size } : {}),
    // a little slack: the export itself touches nothing under lessons/
    ...(exported && (changed > at + 1000 || bookChanged) ? { stale: true } : {}),
    ...(existsSync(scorm) ? { scorm: { at: mtime(scorm), bytes: statSync(scorm).size } } : {}),
    ...(videos.length ? { videos } : {}),
  };
}

/** Languages with a UI catalog, for pickers. */
export const UI_LANGS = Object.keys(LANG_INFO);
