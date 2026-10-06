// The studio API from the browser.

import type { KeyCheck } from '../shared/providers';
import type {
  AiDefaults,
  BookPlan,
  CheckDetail,
  EditorCatalog,
  EstimateInfo,
  GeoLayerInfo,
  Issue,
  JobEvent,
  JobInfo,
  JobType,
  KeyInfo,
  LanguageInfo,
  LearnEstimateInfo,
  LearnLevel,
  LessonDetail,
  ProjectDetail,
  ProjectSummary,
  ReviewImportResult,
  ReviewInfo,
  ReviewItem,
  ReviewState,
  StagePart,
  StatusInfo,
  StringEntry,
  VoiceSample,
} from '../shared/types';
import { withBase } from './base';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A body sent as it is (e.g. CSV text), not as JSON. */
class Raw {
  constructor(
    readonly text: string,
    readonly type: string,
  ) {}
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withBase(url), {
      method,
      headers:
        body instanceof Raw
          ? { 'content-type': body.type }
          : body !== undefined && !(body instanceof FormData)
            ? { 'content-type': 'application/json' }
            : {},
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : body instanceof Raw ? body.text : JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new HttpError(0, 'network');
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!res.ok) throw new HttpError(res.status, String(data.error ?? res.statusText), data);
  return data as T;
}

export type ProjectListItem = ProjectSummary & { error?: string };

export interface SaveLessonResult {
  saved: boolean;
  issues: Issue[];
  stringIssues?: Record<string, Record<string, string[]>>;
  entries?: StringEntry[];
  error?: string;
  /** What is on the stage during each beat (a dry run returns it, so new nodes get their parts). */
  parts?: Record<string, StagePart[]>;
}

export const api = {
  status: () => req<StatusInfo>('GET', '/api/status'),
  keys: () => req<{ keys: KeyInfo[]; file: string }>('GET', '/api/keys'),
  /** `undo`: the keys removed can be put back for a few minutes (`restoreKeys`). */
  saveKeys: (patch: Record<string, string | null>, opts: { undo?: boolean } = {}) =>
    req<{ keys: KeyInfo[]; file: string }>('PUT', opts.undo ? '/api/keys?undo=1' : '/api/keys', patch),
  projects: () => req<{ projects: ProjectListItem[]; root: string }>('GET', '/api/projects'),
  createProject: (form: FormData) => req<ProjectDetail>('POST', '/api/projects', form),
  project: (id: string) => req<ProjectDetail>('GET', `/api/projects/${encodeURIComponent(id)}`),
  saveSettings: (id: string, s: Record<string, unknown>) =>
    req<ProjectDetail>('PUT', `/api/projects/${encodeURIComponent(id)}/settings`, s),
  estimate: (id: string) => req<EstimateInfo>('GET', `/api/projects/${encodeURIComponent(id)}/estimate`),
  learnEstimate: (id: string, chapter?: string) =>
    req<LearnEstimateInfo>(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/estimate?learn=1${chapter ? `&chapter=${encodeURIComponent(chapter)}` : ''}`,
    ),
  checkKey: (provider: string, key: string, secret?: string) =>
    req<KeyCheck>('POST', '/api/keys/check', { provider, key, ...(secret ? { secret } : {}) }),
  /** Undo: put back keys removed a moment ago (the server kept them aside). */
  restoreKeys: (names: string[]) =>
    req<{ restored: string[]; keys: KeyInfo[]; file: string }>('POST', '/api/keys/restore', { names }),
  /** Is a model server answering on this computer (free)? */
  localModels: (provider: 'ollama' | 'compat' = 'ollama') =>
    req<{ ok: boolean; base: string; models: string[] }>('GET', `/api/keys/local?provider=${provider}`),
  /** What new books start with (AI and voices). */
  defaults: () => req<AiDefaults>('GET', '/api/defaults'),
  saveDefaults: (patch: Record<string, unknown>) => req<AiDefaults>('PUT', '/api/defaults', patch),
  /** A voice reading its language's fixed sentence (kept: a second play is free). */
  voiceSample: (s: { engine: string; voice: string; lang: string; rate?: string; book?: string }) =>
    req<VoiceSample>('POST', '/api/voices/sample', s),
  /** `from`: the level the chapter was made at (a changed answer moves from there, never two steps). */
  learnFeedback: (id: string, feedback: 'too-easy' | 'right' | 'too-hard', from?: LearnLevel) =>
    req<{ level: LearnLevel }>('POST', `/api/projects/${encodeURIComponent(id)}/learn/feedback`, {
      feedback,
      ...(from ? { from } : {}),
    }),
  savePlan: (id: string, plan: BookPlan) =>
    req<{ plan: BookPlan }>('PUT', `/api/projects/${encodeURIComponent(id)}/plan`, plan),
  approvePlan: (id: string) => req<{ plan: BookPlan }>('POST', `/api/projects/${encodeURIComponent(id)}/plan/approve`),
  startJob: (id: string, type: JobType, args: Record<string, unknown> = {}) =>
    req<{ jobId: string; job: JobInfo }>('POST', `/api/projects/${encodeURIComponent(id)}/jobs`, { type, args }),
  job: (jobId: string) => req<{ job: JobInfo; events: JobEvent[] }>('GET', `/api/jobs/${jobId}`),
  jobs: (id: string) => req<{ jobs: JobInfo[] }>('GET', `/api/projects/${encodeURIComponent(id)}/jobs`),
  cancelJob: (jobId: string) => req<{ job: JobInfo }>('POST', `/api/jobs/${jobId}/cancel`),
  /** "Try now": a job waiting for a service that asked to slow down tries again at once. */
  retryNow: (jobId: string) => req<{ job: JobInfo }>('POST', `/api/jobs/${jobId}/retry-now`),
  lesson: (id: string, lid: string) =>
    req<LessonDetail>('GET', `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}`),
  /** Move the keys of a lesson's translations after ids changed or cues were removed (batches, in order). */
  moveStrings: (id: string, lid: string, batches: { from: string; to: string | null }[][]) =>
    req<{ moved: number }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/strings/move`,
      { batches },
    ),
  /** Components, actions and question kinds as JSON Schemas: the editor's forms are generated from them. */
  components: (id: string) => req<EditorCatalog>('GET', `/api/projects/${encodeURIComponent(id)}/components`),
  async saveLesson(
    id: string,
    lid: string,
    lesson: unknown,
    opts: { force?: boolean; dry?: boolean } = {},
  ): Promise<SaveLessonResult> {
    const q = new URLSearchParams();
    if (opts.force) q.set('force', '1');
    if (opts.dry) q.set('dry', '1');
    try {
      return await req<SaveLessonResult>(
        'PUT',
        `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}${q.size ? `?${q}` : ''}`,
        lesson,
      );
    } catch (e) {
      if (e instanceof HttpError && e.status === 422 && Array.isArray(e.body.issues))
        return { saved: false, issues: e.body.issues as Issue[], error: e.message };
      throw e;
    }
  },
  saveStrings: (id: string, lid: string, lang: string, strings: Record<string, unknown>) =>
    req<{ saved: boolean; issues: Issue[]; stringIssues: Record<string, Record<string, string[]>> }>(
      'PUT',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/strings/${encodeURIComponent(lang)}`,
      strings,
    ),
  review: (id: string, lang: string) =>
    req<ReviewInfo>('GET', `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}`),
  /** The book's languages: the original and each translation, with their voices and recordings. */
  languages: (id: string) =>
    req<{ languages: LanguageInfo[] }>('GET', `/api/projects/${encodeURIComponent(id)}/languages`),
  /** A sample of a language's voice (the book's own recording, or a free voice reading a sentence). */
  voiceSampleUrl: (id: string, lang: string) =>
    withBase(`/api/projects/${encodeURIComponent(id)}/voices/${encodeURIComponent(lang)}/sample`),
  reviewString: (
    id: string,
    lang: string,
    body: { lesson: string; key: string; text?: string; approve?: boolean; keep?: boolean },
  ) =>
    req<{ state: ReviewState; item?: ReviewItem }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/strings`,
      body,
    ),
  /** Approve many strings; `approve: false` takes those approvals back (Undo). */
  reviewApprove: (id: string, lang: string, items: { lesson: string; key: string }[], approve = true) =>
    req<{ approved: number; errors: ReviewImportResult['errors'] }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/approve`,
      approve ? { items } : { items, approve: false },
    ),
  /** A reviewed spreadsheet: `dry` says what it would change and writes nothing (the preview before Apply). */
  reviewImport: (id: string, lang: string, csv: string, dry = false) =>
    req<ReviewImportResult>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/import${dry ? '?dry=1' : ''}`,
      new Raw(csv, 'text/csv'),
    ),
  /** A chapter's check in one language (the Check step). */
  check: (id: string, lid: string, lang: string) =>
    req<CheckDetail>(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/check/${encodeURIComponent(lid)}?lang=${encodeURIComponent(lang)}`,
    ),
  /** The book's questions as flashcards: Anki (tab-separated) or CSV. */
  flashcardsUrl: (id: string, lang: string, format: 'anki' | 'csv') =>
    withBase(
      `/api/projects/${encodeURIComponent(id)}/flashcards/${encodeURIComponent(lang)}${format === 'csv' ? '?format=csv' : ''}`,
    ),
  scormUrl: (id: string) => withBase(`/api/projects/${encodeURIComponent(id)}/scorm.zip`),
  videoUrl: (id: string, lid: string, lang: string) =>
    withBase(`/api/projects/${encodeURIComponent(id)}/videos/${encodeURIComponent(lid)}/${encodeURIComponent(lang)}`),
  /** The whole book as a zip (a backup). */
  archiveUrl: (id: string) => withBase(`/api/projects/${encodeURIComponent(id)}/archive`),
  /** Where the review queue downloads as CSV (a link): the whole book, or one chapter. */
  reviewCsvUrl: (id: string, lang: string, lesson?: string) =>
    withBase(
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}.csv${lesson ? `?lesson=${encodeURIComponent(lesson)}` : ''}`,
    ),
  geo: (id: string) => req<{ layers: GeoLayerInfo[] }>('GET', `/api/projects/${encodeURIComponent(id)}/geo`),
  /** The lesson as the player reads it; `candidate`: with the new version of that beat in it (Compare). */
  playerData: (id: string, lid: string, lang?: string, candidate?: string) => {
    const q = new URLSearchParams();
    if (lang) q.set('lang', lang);
    if (candidate) q.set('candidate', candidate);
    return req<Record<string, unknown>>(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/player${q.size ? `?${q}` : ''}`,
    );
  },
  /** Keep the new version of a beat (Regenerate), drop it, or take the kept one back. */
  acceptBeat: (id: string, lid: string, bid: string) =>
    req<{ ok: boolean; langs: string[] }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/beats/${encodeURIComponent(bid)}/accept`,
    ),
  dropCandidate: (id: string, lid: string, bid: string) =>
    req<{ ok: boolean }>(
      'DELETE',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/beats/${encodeURIComponent(bid)}/candidate`,
    ),
  restoreBeat: (id: string, lid: string, bid: string) =>
    req<{ ok: boolean }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/beats/${encodeURIComponent(bid)}/restore`,
    ),
};

/** A readable message for an error, in the interface language. */
export function errorText(
  e: unknown,
  t: (k: 'err.network' | 'err.generic', p?: Record<string, string>) => string,
): string {
  if (e instanceof HttpError && e.status === 0) return t('err.network');
  return (e as Error)?.message ?? String(e);
}

/** Wait for a job to finish (screens without an activity board); resolves with its final state. */
export async function waitForJob(jobId: string, every = 700): Promise<JobInfo> {
  for (;;) {
    const { job } = await api.job(jobId);
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return job;
    await new Promise((ok) => setTimeout(ok, every));
  }
}

/**
 * Save a file the API makes (a backup, flashcards, a package): fetched, then handed to the browser as a download
 * under the name the server gives. Works the same on the desktop and in the web app, with or without its
 * service worker.
 */
export async function saveFile(url: string, fallbackName: string): Promise<{ name: string; bytes: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return { name, bytes: blob.size };
}
