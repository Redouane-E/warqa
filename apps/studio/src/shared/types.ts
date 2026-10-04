// Types shared by the studio server (src/server) and the React app (src/client): the JSON API contract.

export type LTextMap = Record<string, string>;

export type JobType =
  | 'ingest'
  | 'plan'
  | 'build'
  | 'translate'
  | 'narrate'
  | 'export'
  | 'qa'
  | 'rewrite'
  | 'estimate'
  | 'improve'
  | 'geo'
  | 'panel';
export const JOB_TYPES: JobType[] = [
  'ingest',
  'plan',
  'build',
  'translate',
  'narrate',
  'export',
  'qa',
  'rewrite',
  'estimate',
  'improve',
  'geo',
  'panel',
];

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobEvent {
  seq: number;
  ts: number;
  kind: 'status' | 'progress' | 'log' | 'result' | 'error';
  /** progress: pipeline stage (plan, storyboard, write, translate:fr, narrate:ar, export, …). */
  stage?: string;
  /** progress: start | done | skip | beat | error. */
  status?: string;
  detail?: string;
  /** Beat progress (write and narrate stages). */
  index?: number;
  total?: number;
  /** Chapter the event belongs to (build, translate, narrate). */
  chapter?: string;
  message?: string;
  level?: 'info' | 'warn' | 'error';
  result?: unknown;
  error?: string;
  jobStatus?: JobStatus;
}

export interface JobInfo {
  id: string;
  projectId: string;
  type: JobType;
  args: Record<string, unknown>;
  status: JobStatus;
  created: number;
  started?: number;
  finished?: number;
  error?: string;
  result?: unknown;
  /** Last progress line, for lists. */
  last?: string;
}

export interface KeyInfo {
  name: string;
  set: boolean;
  /** "••••abcd" (last 4 characters only). */
  masked?: string;
  source?: 'studio' | 'env';
  /** Provider or speech engine that uses it. */
  usedBy: string[];
}

export interface PresetInfo {
  id: string;
  label: string;
  description: string;
  roles: Record<string, string>;
  needs: string[][];
  available: boolean;
  /** Keys still missing (first of each unmet group). */
  missing: string[];
}

export interface ModelSummary {
  id: string;
  name?: string;
  tier: 'A' | 'B' | 'C';
  vision: boolean;
  structured: boolean;
  context: number;
  input: number;
  output: number;
  openWeights?: boolean;
  license?: string;
  notes?: string;
}

export interface TtsInfo {
  id: string;
  note?: string;
  costPerMChars?: number;
  wordTimes: boolean;
  /** Default voice per language (ar, fr, en). */
  voices: Record<string, string>;
  keys: string[];
}

/**
 * What the host running the API can do. The local studio can do everything; the web app (the studio in a browser
 * tab, no server) cannot run local programs (Edge voices, the Python worker, Playwright checks).
 */
export interface Capabilities {
  platform: 'desktop' | 'browser';
  /** Speech engines this host cannot run. */
  ttsUnavailable: string[];
  /** Job types this host cannot run. */
  jobsUnavailable: JobType[];
  /** Where provider keys are kept: a file on this computer, or this browser's storage. */
  keyStore: 'file' | 'browser';
  /** The optional Python worker (OCR fallback, local voices) can be used. */
  worker: boolean;
}

export interface StatusInfo {
  version: string;
  host: string;
  localOnly: boolean;
  keysFile: string;
  /** Absent from older servers: treat as the desktop studio. */
  capabilities?: Capabilities;
  providers: {
    id: string;
    name: string;
    kind: string;
    configured: boolean;
    missing: string[];
    env: string[];
    docs: string;
  }[];
  presets: PresetInfo[];
  roles: { id: string; info: string }[];
  models: ModelSummary[];
  tts: TtsInfo[];
  ingest: boolean;
  qa: boolean;
}

export interface LessonSummary {
  id: string;
  title: LTextMap;
  lang: string;
  langs: string[];
  beats: number;
  hasAudio: Record<string, boolean>;
  errors: number;
  warnings: number;
  updated: number;
}

export interface PlanChapter {
  id: string;
  section: string;
  title: string;
  unit?: string;
  pages: [number, number];
  objectives: string[];
  minutes: number;
  visuals: string[];
  packs: string[];
  include: boolean;
}

export interface BookPlan {
  status: 'draft' | 'approved';
  title: string;
  subtitle?: string;
  audience: string;
  lang: string;
  chapters: PlanChapter[];
  glossary: { terms: Record<string, string>; note?: string }[];
  conventions: { notation: string; colors: string; tone: string };
}

export interface DocSummary {
  pages: number;
  lang: string;
  blocks: number;
  title?: string;
  methods: Record<string, number>;
  sections: { id: string; title: string; start: number; end: number; unit?: string }[];
}

export interface ProjectConfig {
  preset?: string;
  models: Record<string, string>;
  tts: { provider: string; voices: Record<string, string>; rate?: string; tashkeel: boolean };
  budget: { usd?: number };
  audience?: string;
  tone?: string;
  worker?: string;
  packs?: string[];
}

export interface BookInfo {
  id: string;
  title: string | LTextMap;
  subtitle?: string | LTextMap;
  author?: string;
  langs: string[];
  defaultLang?: string;
  sourceLang?: string;
  digits: 'latn' | 'arab';
  audience?: string;
  units: { title: string | LTextMap; chapters: string[] }[];
}

export type StepId = 'read' | 'plan' | 'make' | 'voice' | 'export';
export type StepState = 'ready' | 'done' | 'partial' | 'blocked' | 'skipped';

export interface ProjectSummary {
  id: string;
  title: LTextMap;
  langs: string[];
  defaultLang: string;
  chapters: number;
  built: number;
  updated: number;
  hasPdf: boolean;
  exported: boolean;
  steps: Record<StepId, StepState>;
}

export interface ProjectDetail extends ProjectSummary {
  book: BookInfo;
  config: ProjectConfig;
  plan: BookPlan | null;
  lessons: LessonSummary[];
  ledger: { total: number; calls: number; byStage: Record<string, number>; byModel: Record<string, number> };
  document: DocSummary | null;
  pdf?: string;
  exportInfo: { exported: boolean; zip: boolean; at?: number };
  /** A teacher review kit was exported (its zip and key can be downloaded). */
  panelKit?: { at: number };
  jobs: JobInfo[];
  next: StepId;
  /** Model per role as resolved now (or an error message). */
  roles: Record<string, { model?: string; error?: string }>;
}

export interface Issue {
  level: 'error' | 'warn';
  message: string;
  beat?: string;
  lang?: string;
  path?: string;
}

export interface StringEntry {
  key: string;
  text: string;
  where: string;
  kind: 'narration' | 'text' | 'math-template';
}

export interface LessonDetail {
  id: string;
  lesson: Record<string, unknown> & { beats: Record<string, unknown>[]; lang: string; title: string };
  langs: string[];
  strings: Record<string, Record<string, string | { text: string; speak?: string }>>;
  timings: Record<string, Record<string, unknown>>;
  entries: StringEntry[];
  issues: Issue[];
  /** checkStrings issues by language and string key. */
  stringIssues: Record<string, Record<string, string[]>>;
  audio: Record<string, string[]>;
  moves: string[];
  /** All languages of the book (some may not be translated yet). */
  bookLangs: string[];
  bookId: string;
}

export interface EstimateInfo {
  p50: number;
  p90: number;
  lines: string[];
  error?: string;
}

/* ---------- translation review (book-wide) ---------- */

export type ReviewState = 'machine' | 'approved' | 'edited' | 'stale' | 'missing';

export interface ReviewItem {
  lesson: string;
  key: string;
  where: string;
  kind: string;
  source: string;
  text: string;
  state: ReviewState;
  /** Glossary misses and string-table problems (marks, answer boxes). */
  flags: string[];
}

export interface ReviewInfo {
  lang: string;
  /** The language the lessons are written in (sources), per lesson. */
  sourceLangs: Record<string, string>;
  lessons: { id: string; title: string }[];
  items: ReviewItem[];
  counts: Record<ReviewState | 'flagged' | 'total', number>;
}

export interface ReviewImportResult {
  edited: number;
  approved: number;
  errors: { key: string; error: string }[];
}

/* ---------- judge, map layers, teacher panel ---------- */

export interface JudgeScore {
  id: string;
  score: number;
  problem?: string;
  fix?: string;
}

/** Result of an "improve" job: one report per lesson. */
export interface ImproveResult {
  lessons: {
    lesson: string;
    before: JudgeScore[];
    after: JudgeScore[];
    rewritten: string[];
    failed: { id: string; error: string }[];
  }[];
}

export interface GeoLayerInfo {
  id: string;
  regions: { name: string; iso?: string }[];
  attribution: string;
}

/** Result of a "geo" job. */
export interface GeoResult {
  id: string;
  name: string;
  source: string;
  license: string;
  attribution: string;
  regions: number;
}

/** Result of a "panel" job (a teacher review kit). */
export interface PanelResult {
  kit: string;
  lessons: string[];
  zip: string;
  key: string;
}
