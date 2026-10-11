// Calls to the web app's own routes (/api/web/*, served by the worker: worker/routes.ts).
import { withBase } from '../../../studio/src/client/base';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(withBase(path), {
    method,
    ...(body instanceof FormData
      ? { body }
      : body !== undefined
        ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
        : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

/** The book a backup would replace: the one already in this browser, and when the backup was made. */
export interface ImportConflict {
  id: string;
  title: Record<string, string> | string;
  defaultLang: string;
  exported?: string;
}

export const webApi = {
  demo: () => call<{ id: string; created: boolean }>('POST', '/api/web/demo'),
  /** `ask`: a book already here comes back as `exists` (nothing imported); `copy` adds it; `replace` takes its place. */
  async importZip(
    file: File,
    mode: 'ask' | 'copy' | 'replace' = 'copy',
  ): Promise<{ id: string } | { exists: ImportConflict }> {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch(withBase(`/api/web/import?mode=${mode}`), { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { id?: string; exists?: ImportConflict; error?: string };
    if (res.status === 409 && data.exists) return { exists: data.exists };
    if (!res.ok || !data.id) throw new Error(data.error ?? res.statusText);
    return { id: data.id };
  },
  remove: (id: string) => call<{ deleted: string }>('DELETE', `/api/web/projects/${encodeURIComponent(id)}`),
  storage: (books = false) =>
    call<{
      books: number;
      usage: number | null;
      quota: number | null;
      pending: number;
      /** With `books`: each book's size, largest first. */
      list?: { id: string; title: Record<string, string> | string; defaultLang: string; bytes: number }[];
    }>('GET', `/api/web/storage${books ? '?books=1' : ''}`),
  reset: () => call<{ reset: boolean }>('POST', '/api/web/reset'),
  archiveUrl: (id: string) => withBase(`/api/web/projects/${encodeURIComponent(id)}/archive`),
};
