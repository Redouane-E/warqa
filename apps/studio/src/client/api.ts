// The studio API from the browser.
import type {
  BookPlan,
  EstimateInfo,
  GeoLayerInfo,
  Issue,
  JobEvent,
  JobInfo,
  JobType,
  KeyInfo,
  LessonDetail,
  ProjectDetail,
  ProjectSummary,
  ReviewImportResult,
  ReviewInfo,
  ReviewItem,
  ReviewState,
  StatusInfo,
  StringEntry,
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
}

export const api = {
  status: () => req<StatusInfo>('GET', '/api/status'),
  keys: () => req<{ keys: KeyInfo[]; file: string }>('GET', '/api/keys'),
  saveKeys: (patch: Record<string, string | null>) => req<{ keys: KeyInfo[]; file: string }>('PUT', '/api/keys', patch),
  projects: () => req<{ projects: ProjectListItem[]; root: string }>('GET', '/api/projects'),
  createProject: (form: FormData) => req<ProjectDetail>('POST', '/api/projects', form),
  project: (id: string) => req<ProjectDetail>('GET', `/api/projects/${encodeURIComponent(id)}`),
  saveSettings: (id: string, s: Record<string, unknown>) =>
    req<ProjectDetail>('PUT', `/api/projects/${encodeURIComponent(id)}/settings`, s),
  estimate: (id: string) => req<EstimateInfo>('GET', `/api/projects/${encodeURIComponent(id)}/estimate`),
  savePlan: (id: string, plan: BookPlan) =>
    req<{ plan: BookPlan }>('PUT', `/api/projects/${encodeURIComponent(id)}/plan`, plan),
  approvePlan: (id: string) => req<{ plan: BookPlan }>('POST', `/api/projects/${encodeURIComponent(id)}/plan/approve`),
  startJob: (id: string, type: JobType, args: Record<string, unknown> = {}) =>
    req<{ jobId: string; job: JobInfo }>('POST', `/api/projects/${encodeURIComponent(id)}/jobs`, { type, args }),
  job: (jobId: string) => req<{ job: JobInfo; events: JobEvent[] }>('GET', `/api/jobs/${jobId}`),
  cancelJob: (jobId: string) => req<{ job: JobInfo }>('POST', `/api/jobs/${jobId}/cancel`),
  lesson: (id: string, lid: string) =>
    req<LessonDetail>('GET', `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}`),
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
  reviewString: (id: string, lang: string, body: { lesson: string; key: string; text?: string; approve?: boolean }) =>
    req<{ state: ReviewState; item?: ReviewItem }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/strings`,
      body,
    ),
  reviewApprove: (id: string, lang: string, items: { lesson: string; key: string }[]) =>
    req<{ approved: number; errors: ReviewImportResult['errors'] }>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/approve`,
      { items },
    ),
  reviewImport: (id: string, lang: string, csv: string) =>
    req<ReviewImportResult>(
      'POST',
      `/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}/import`,
      new Raw(csv, 'text/csv'),
    ),
  /** Where the review queue downloads as CSV (a link). */
  reviewCsvUrl: (id: string, lang: string) =>
    withBase(`/api/projects/${encodeURIComponent(id)}/review/${encodeURIComponent(lang)}.csv`),
  geo: (id: string) => req<{ layers: GeoLayerInfo[] }>('GET', `/api/projects/${encodeURIComponent(id)}/geo`),
  playerData: (id: string, lid: string, lang?: string) =>
    req<Record<string, unknown>>(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lid)}/player${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`,
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
