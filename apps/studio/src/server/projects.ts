// Book projects on disk: discovery under --root, summaries for the home page and the project page, creation.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
import { panelKeyPath, zipReady } from './zip.js';

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
    /** Speech engine of new projects. */
    private defaultTts = 'edge',
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
    p.config.tts.provider = this.defaultTts;
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
    sections: doc.sections.map((s) => ({
      id: s.id,
      title: s.title,
      start: s.start,
      end: s.end,
      ...(s.unit ? { unit: s.unit } : {}),
    })),
  };
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
  return { id, title, lang: lesson.lang, langs, beats: lesson.beats.length, hasAudio, errors, warnings, updated };
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
    export: exported ? 'done' : hasLessons ? 'ready' : 'blocked',
  };
}

export function nextStep(s: Record<StepId, StepState>): StepId {
  const order: StepId[] = ['read', 'plan', 'make', 'voice', 'export'];
  return order.find((k) => s[k] !== 'done' && s[k] !== 'skipped') ?? 'export';
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
  };
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
  return {
    ...s,
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
    },
    config: p.config as ProjectDetail['config'],
    plan,
    lessons,
    ledger: P.ledgerSummary(p.path('.ledger.jsonl')),
    document: doc,
    ...(pdf ? { pdf: basename(pdf) } : {}),
    exportInfo: {
      exported: s.exported,
      zip: zipReady(p.root),
      ...(s.exported ? { at: mtime(p.path('dist', 'index.html')) } : {}),
    },
    jobs,
    next: nextStep(s.steps),
    roles,
    ...(existsSync(panelKeyPath(p.root)) ? { panelKit: { at: mtime(panelKeyPath(p.root)) } } : {}),
  };
}

/** Languages with a UI catalog, for pickers. */
export const UI_LANGS = Object.keys(LANG_INFO);
