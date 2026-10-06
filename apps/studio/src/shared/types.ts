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
  | 'panel'
  | 'learn'
  | 'scorm'
  | 'video';
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
  'learn',
  'scorm',
  'video',
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
  /** Model spend of the job so far in USD (the learn and build jobs report it). */
  usd?: number;
  /** A written beat's title (write stage). */
  title?: string;
  /**
   * A build's chapter events (stage "chapter") and translate/narrate starts: the chapter's number in the plan, the
   * estimate in USD, the book's limit.
   */
  n?: number;
  estimate?: number;
  limit?: number;
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
  /** What one chapter of about 15 beats in three languages costs with it (AI and voices' prices). */
  chapterUsd?: number;
  /** How it is paid for. */
  pricing?: 'paid' | 'free-tier' | 'free' | 'prepaid';
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
  /** Default voice per language (ar, ary, fr, en). */
  voices: Record<string, string>;
  keys: string[];
  /** Costs nothing (Edge, the local helper, no voice). */
  free?: boolean;
  /** Free up to a monthly amount (Azure). */
  freeTier?: boolean;
  /** Its keys are set. */
  keyReady?: boolean;
  /** The voices it offers (engines without a list take their default or a typed name). */
  catalog?: { id: string; langs: string[] | 'all'; style?: string }[];
  /** What one sample costs (USD). */
  sampleUsd?: number;
}

/** What new books start with (AI and voices, "New books"). */
export interface AiDefaults {
  preset?: string;
  models: Record<string, string>;
  tts: { provider?: string; voices: Record<string, string>; rate?: string; tashkeel: boolean };
  worker?: string;
}

/** A sample of a voice (`POST /api/voices/sample`). */
export interface VoiceSample {
  url: string;
  cached: boolean;
  usd: number;
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
  /** Playwright's Chromium can run here (the checks, the judge, videos). */
  playwright?: boolean;
  /** ffmpeg can run here (videos). */
  ffmpeg?: boolean;
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
  /** The sentence a voice sample reads, per language. */
  sampleText?: Record<string, string>;
}

export interface LessonSummary {
  id: string;
  title: LTextMap;
  lang: string;
  langs: string[];
  beats: number;
  /** Questions in it (the Share step's facts). */
  questions?: number;
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

export type ReadMethod = 'text' | 'ocr-vision' | 'ocr-worker' | 'none';

export interface DocSummary {
  pages: number;
  lang: string;
  blocks: number;
  title?: string;
  methods: Record<string, number>;
  /** Each page read and how (pages not listed were not read: a page range, or a learner's later chapters).
   *  quality "ocr": the text layer was broken (Arabic), so the page was read again from its image. */
  read: { n: number; method: ReadMethod; quality?: string }[];
  /** The languages of a good share of the pages read, the main one first. */
  langs: string[];
  /** When the PDF was last read (ms). */
  readAt?: number;
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
  /** A self-learner's book: the level its next chapters are made at. */
  learn?: { level: LearnLevel };
}

export type LearnLevel = 'beginner' | 'some' | 'advanced';

/** The six steps of a book. "check" is optional (never the next step); "?step=export" is an alias of "share". */
export type StepId = 'read' | 'plan' | 'make' | 'voice' | 'check' | 'share';
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
  /** A self-learner's book ("What I'm learning"): its level. */
  learn?: { level: LearnLevel };
  /** The chapters made, in plan order, with their titles (the learner's home and player). */
  made?: { id: string; title: LTextMap }[];
  /** Spent on this book (USD), for sorting Your books. */
  spent: number;
  /** The PDF once read: its pages and language ("From a French PDF · 64 pages"). */
  source?: { pages: number; lang: string };
}

export interface ProjectDetail extends ProjectSummary {
  book: BookInfo;
  /** The PDF's size in bytes. */
  pdfBytes?: number;
  /** When plan.json last changed (ms): "Drafted 3 minutes ago". */
  planUpdated?: number;
  config: ProjectConfig;
  plan: BookPlan | null;
  lessons: LessonSummary[];
  ledger: {
    total: number;
    calls: number;
    byStage: Record<string, number>;
    byModel: Record<string, number>;
    /** Spent on each chapter (storyboard, beats, translation); calls recorded before 4c have no chapter. */
    byChapter?: Record<string, number>;
  };
  /** Chapters whose writing stopped partway: the beats written so far (kept) of how many. */
  drafts?: Record<string, { written: number; total: number }>;
  /** Chapters written again whose translations into these languages are still the old beats' (a Stop came first). */
  stale?: Record<string, string[]>;
  document: DocSummary | null;
  pdf?: string;
  exportInfo: {
    exported: boolean;
    zip: boolean;
    at?: number;
    /** The zip's size in bytes. */
    zipBytes?: number;
    /** A lesson, its strings or audio, or the book changed after the export. */
    stale?: boolean;
    /** The SCORM package, once made. */
    scorm?: { at: number; bytes: number };
    /** The videos made, by lesson and language. */
    videos?: { lesson: string; lang: string; bytes: number; at: number }[];
  };
  /** A teacher review kit was exported (its zip can be downloaded). */
  panelKit?: { at: number; bytes?: number };
  /** The latest check of each chapter, per language: how many beats need attention. */
  checks?: Record<
    string,
    { lang: string; at: number; beats: number; attention: number; flagged?: string[]; stale?: boolean }[]
  >;
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

/** A JSON Schema (draft 2020-12, the input side of a Zod schema). */
export type JsonSchema = Record<string, unknown>;

/** A part on the stage during a beat: a node, its named parts (cues target "id#part") and the beat that added it. */
export interface StagePart {
  id: string;
  type: string;
  parts: string[];
  /** Index of the beat that put it on the stage. */
  from: number;
}

/** A component as the editor's forms need it (from its definition). */
export interface ComponentInfo {
  type: string;
  pack: string;
  defaultSlot: string;
  /** Localizable prop paths ("items.*.text"): the editor marks those fields as translated. */
  text: string[];
  props: JsonSchema;
  /** Its own actions: their arguments, localizable arguments and usual duration in seconds. */
  actions: Record<string, { args: JsonSchema; text?: string[]; dur?: number }>;
  /** Props of its first example: a new node on the stage starts from them. */
  example: Record<string, unknown>;
}

/** GET /api/projects/:id/components: what the structured inspector is generated from. */
export interface EditorCatalog {
  components: ComponentInfo[];
  /** Actions every node and part has (show, hide, highlight…). */
  generic: string[];
  question: JsonSchema;
  card: JsonSchema;
  colors: string[];
  slots: string[];
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
  /** Its number among the chapters to make (as on the Make step), and its unit in the book, for the kicker. */
  chapter?: number;
  /** What is on the stage during each beat (by beat id), for the cue and question editors. */
  parts?: Record<string, StagePart[]>;
  /** New versions of beats waiting to be compared (Regenerate), by beat id. */
  candidates?: Record<
    string,
    {
      at: number;
      instruction?: string;
      beat?: Record<string, unknown>;
      /** The beat was saved with changes after this version was written (keeping it replaces them). */
      changed?: boolean;
    }
  >;
  /** The judge's last verdict per beat (red pen): its score out of 5, the problem and the fix it suggests. */
  judge?: Record<string, { score: number; problem?: string; fix?: string }>;
  /** What writing one beat again costs, in USD (shown beside Regenerate). */
  rewriteUsd?: number;
  unit?: { index: number; title: string | Record<string, string> };
}

export interface EstimateInfo {
  p50: number;
  p90: number;
  lines: string[];
  error?: string;
  /** Drafting the plan (once there is a document). */
  plan?: number;
  /** Making each chapter of the plan (ticked or not), so the plan screen adds up the ticked ones live. */
  chapters?: Record<string, number>;
  /** The high end of a range is `spread` times the estimate. */
  spread?: number;
  /** Reading one page from its image with the vision model (absent: no vision model). */
  visionPage?: number;
}

/** The learner's summary ("About 3 minutes · about $0.03 · your limit $1.00"): GET estimate?learn=1. */
export interface LearnEstimateInfo {
  usd: { p50: number; p90: number };
  seconds: number;
  pages: number;
  /** The chapter the run will make, once there is a plan. */
  chapter?: string;
  visionPages: number;
  limit?: number;
  spent: number;
  /** The PDF's language, when its text says so. */
  sourceLang?: string;
  /** No AI service connected yet (the PDF facts are still there). */
  error?: string;
}

/* ---------- translation review (book-wide) ---------- */

export type ReviewState = 'machine' | 'approved' | 'edited' | 'stale' | 'missing';

export type StringField =
  | 'lesson-title'
  | 'unit'
  | 'title'
  | 'narration'
  | 'part'
  | 'question'
  | 'choice'
  | 'answer'
  | 'cue';

export interface ReviewProblem {
  code: 'missing' | 'marks' | 'speak-marks' | 'boxes' | 'dollars' | 'glossary';
  /** Marks or answer boxes the translation lost, and those it has that the original doesn't. */
  lost?: string[];
  extra?: string[];
  /** Glossary: the original's term and the agreed translation. */
  term?: string;
  expected?: string;
  /** Approving waits until it is fixed (marks, answer boxes, $); a glossary miss does not block. */
  blocking: boolean;
}

export interface ReviewItem {
  lesson: string;
  key: string;
  where: string;
  kind: string;
  source: string;
  text: string;
  state: ReviewState;
  /** Glossary misses and string-table problems (marks, answer boxes), in English (spreadsheet, CLI). */
  flags: string[];
  /** The beat it belongs to (1-based), its title in the original language. */
  beat?: { n: number; id: string; title: string };
  field: StringField;
  part?: { type: string; path: string };
  problems: ReviewProblem[];
  /** Every glossary term the original uses, and whether the translation uses the agreed one. */
  glossary: { term: string; expected: string; used: boolean }[];
  /** "Original changed": the original as it was when this was translated or checked. */
  before?: string;
  /** Checked by a person: when, and where from. */
  reviewed?: { at: string; by?: 'studio' | 'sheet' | 'cli' };
  /** The lesson's number among the chapters to make. */
  chapter?: number;
}

export interface ReviewInfo {
  lang: string;
  /** The language the lessons are written in (sources), per lesson. */
  sourceLangs: Record<string, string>;
  lessons: { id: string; title: string; n?: number }[];
  items: ReviewItem[];
  counts: Record<ReviewState | 'flagged' | 'total', number>;
  /** What translating one string again costs (about), when the translator has a price. */
  perString?: number;
}

export interface ReviewImportResult {
  edited: number;
  approved: number;
  errors: { key: string; error: string }[];
  /** The preview (`?dry=1`): what the file would change, row by row. */
  changes?: { lesson: string; key: string; kind: 'edited' | 'approved'; before: string; after: string }[];
}

/** One language of a book, for the Translate & narrate step's cards and the rail. */
export interface LanguageInfo {
  lang: string;
  /** The original: every lesson is written in it. */
  role: 'original' | 'translation';
  /** Texts to translate (for the original: written) and the lessons that have them. */
  texts: number;
  chapters: number;
  translated: number;
  /** Checked by a person (approved or their own wording). */
  checked: number;
  stale: number;
  problems: number;
  missing: number;
  audio: {
    /** Lessons that can be narrated in this language (written or translated). */
    chapters: number;
    /** Lessons with a recording of every beat. */
    narrated: number;
    /** Beats whose recording no longer matches what they say, or the voice chosen. */
    changed: number;
    /** Beats with no recording yet, in lessons that can be narrated. */
    unrecorded: number;
    seconds: number;
  };
  voice: {
    engine: string;
    id: string;
    /** A short name ("Mouna" for ar-MA-MounaNeural). */
    name: string;
    free: boolean;
    /** This host can run the engine (Edge needs the desktop version). */
    available: boolean;
    /** A sample can be played (the book's own recording, or a free engine reading a sentence). */
    sample: boolean;
  };
  /** What the missing part costs, in USD, when known. */
  estimate?: { translate?: number; narrate?: number };
}

/* ---------- the Check step (redesign 4f) ---------- */

export type QaKind = 'blank' | 'overlap' | 'overflow' | 'offstage' | 'error' | 'compile';

export interface CheckIssue {
  kind: QaKind;
  /** The checker's own words (English), for errors. */
  message: string;
  /** The parts involved, with a name a person reads ("label t1"). */
  nodes?: { id: string; type: string; text?: string }[];
  /** Where on the stage (1600 × 900). */
  box?: { x: number; y: number; w: number; h: number };
  from?: number;
  to?: number;
  fit?: number;
}

export interface CheckBeat {
  id: string;
  /** 1-based. */
  n: number;
  title: string;
  move: string;
  /** A question beat (the judge does not score it). */
  ask: boolean;
  /** Its narration in the language checked, with [[marks]]. */
  narration: string;
  score?: number;
  problem?: string;
  fix?: string;
  issues: CheckIssue[];
  /** Picture URLs (small and full), when a check saved them. */
  thumb?: string;
  shot?: string;
  dur?: number;
  /** It changed after the check. */
  changed?: boolean;
  /** Scored under 4, or an automatic finding. */
  attention: boolean;
}

export interface CheckDetail {
  lesson: string;
  lang: string;
  /** Its number among the chapters to make. */
  chapter?: number;
  title: string;
  /** The languages the lesson has, and when each was last checked. */
  langs: { lang: string; checked?: number }[];
  beats: CheckBeat[];
  /** When this chapter and language were last checked. */
  checked?: number;
  /** The lesson changed after the check. */
  stale?: boolean;
  /** The judge's verdict scored the lesson as it is now (Improve starts from it). */
  fresh?: boolean;
  /** The judge, when a Checker model is set: what scoring the whole chapter costs, and one beat. */
  judge?: { model: string; lessonUsd?: number; beatUsd?: number };
  /** What rewriting one beat costs. */
  rewriteUsd?: number;
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
