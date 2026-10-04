// A book project is a folder on disk (git-diffable JSON), shared by the CLI and the studio:
//   warqa.json                       book metadata + pipeline settings
//   source/book.pdf                  the source (private, never exported)
//   source/document.json             ingested text blocks with page/bbox anchors
//   plan.json, glossary.json         book plan and terminology per language
//   lessons/<id>/lesson.json         language-neutral lesson skeleton (author language text)
//   lessons/<id>/strings.<lang>.json translations
//   lessons/<id>/timings.<lang>.json narration timings
//   lessons/<id>/audio/<lang>/*.mp3  narration audio
//   assets/                          images used by lessons
//   cache/                           content-hashed model and TTS results
//   dist/                            exported static book
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Book, type Lesson, parseLesson, Strings, Timings } from '@warqa/lesson';
import * as z from 'zod';
import { loadPacks } from './packs.js';

export const PipelineConfig = z
  .object({
    /** A preset name (see models/presets) or per-role "provider:model" ids. */
    preset: z.string().optional(),
    models: z.record(z.string(), z.string()).default({}),
    tts: z
      .object({
        provider: z.string().default('none'),
        voices: z.record(z.string(), z.string()).default({}),
        rate: z.string().optional(),
        /** Add Arabic diacritics before synthesis (via the worker or a model). */
        tashkeel: z.boolean().default(false),
      })
      .prefault({}),
    budget: z.object({ usd: z.number().positive().optional() }).prefault({}),
    audience: z.string().optional(),
    tone: z.string().optional(),
    /** Optional Python worker for OCR, alignment, diacritics and local TTS. */
    worker: z.string().optional(),
    /** Component packs the writer may use. */
    packs: z.array(z.string()).optional(),
    /** Third-party component packs (scripts in the book, e.g. "packs/clock.js"; see `warqa pack add`). */
    components: z.array(z.string()).optional(),
  })
  .prefault({});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** Write JSON atomically (temp file + rename) so a crash never leaves half a file. */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export class Project {
  readonly root: string;
  book: Book;
  config: PipelineConfig;

  constructor(root: string) {
    this.root = resolve(root);
    const file = join(this.root, 'warqa.json');
    if (!existsSync(file)) throw new Error(`not a Warqa project (no warqa.json): ${this.root}`);
    this.book = Book.parse(json(file));
    this.config = PipelineConfig.parse(this.book.pipeline ?? {});
    loadPacks(this.root, this.config.components);
  }

  static create(root: string, book: z.input<typeof Book>): Project {
    const r = resolve(root);
    mkdirSync(join(r, 'lessons'), { recursive: true });
    mkdirSync(join(r, 'source'), { recursive: true });
    writeJson(join(r, 'warqa.json'), Book.parse(book));
    writeFileSync(
      join(r, '.gitignore'),
      'source/*.pdf\nsource/pages/\ncache/\ndist/\ndist*.zip\nflashcards.*\n*.mp4\nqa/\n.ledger.jsonl\n',
    );
    return new Project(r);
  }

  static isProject(root: string): boolean {
    return existsSync(join(resolve(root), 'warqa.json'));
  }

  path(...p: string[]): string {
    return join(this.root, ...p);
  }

  saveBook(): void {
    this.book.pipeline = this.config as unknown as Record<string, unknown>;
    writeJson(this.path('warqa.json'), this.book);
  }

  /** Lesson ids in book order (units first, then any others alphabetically). */
  lessonIds(): string[] {
    const dir = this.path('lessons');
    const found = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'lesson.json'))) : [];
    const ordered = this.book.units.flatMap((u) => u.chapters).filter((c) => found.includes(c));
    return [...ordered, ...found.filter((f) => !ordered.includes(f)).sort()];
  }

  lessonDir(id: string): string {
    return this.path('lessons', id);
  }

  hasLesson(id: string): boolean {
    return existsSync(join(this.lessonDir(id), 'lesson.json'));
  }

  loadLessonRaw(id: string): unknown {
    return json(join(this.lessonDir(id), 'lesson.json'));
  }

  loadLesson(id: string): Lesson {
    return parseLesson(this.loadLessonRaw(id));
  }

  saveLesson(id: string, lesson: unknown): void {
    writeJson(join(this.lessonDir(id), 'lesson.json'), lesson);
  }

  langsOf(id: string): string[] {
    const dir = this.lessonDir(id);
    const out = new Set<string>();
    if (!existsSync(dir)) return [];
    for (const f of readdirSync(dir)) {
      const m = /^(?:strings|timings)\.([\w-]+)\.json$/.exec(f);
      if (m) out.add(m[1]!);
    }
    return [...out];
  }

  loadStrings(id: string, lang: string): Strings | undefined {
    const p = join(this.lessonDir(id), `strings.${lang}.json`);
    return existsSync(p) ? Strings.parse(json(p)) : undefined;
  }

  saveStrings(id: string, lang: string, s: Strings): void {
    writeJson(join(this.lessonDir(id), `strings.${lang}.json`), s);
  }

  loadTimings(id: string, lang: string): Timings | undefined {
    const p = join(this.lessonDir(id), `timings.${lang}.json`);
    return existsSync(p) ? Timings.parse(json(p)) : undefined;
  }

  saveTimings(id: string, lang: string, t: Timings): void {
    writeJson(join(this.lessonDir(id), `timings.${lang}.json`), t);
  }

  audioDir(id: string, lang: string): string {
    return join(this.lessonDir(id), 'audio', lang);
  }

  /** Audio files of a language: beat id → file name (mp3 or wav). */
  audioFiles(id: string, lang: string): Record<string, string> {
    const d = this.audioDir(id, lang);
    if (!existsSync(d)) return {};
    const out: Record<string, string> = {};
    for (const f of readdirSync(d)) {
      const m = /^(.+)\.(mp3|wav)$/.exec(f);
      if (m && statSync(join(d, f)).size > 0) out[m[1]!] = f;
    }
    return out;
  }

  readJson<T>(rel: string, fallback: T): T {
    const p = this.path(rel);
    return existsSync(p) ? (json(p) as T) : fallback;
  }

  writeJson(rel: string, data: unknown): void {
    writeJson(this.path(rel), data);
  }

  /** The source PDF, if present. */
  sourcePdf(): string | undefined {
    const dir = this.path('source');
    if (!existsSync(dir)) return undefined;
    const f = readdirSync(dir).find((x) => x.toLowerCase().endsWith('.pdf'));
    return f ? join(dir, f) : undefined;
  }
}
