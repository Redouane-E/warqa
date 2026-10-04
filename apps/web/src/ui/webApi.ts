// Calls to the web app's own routes (/api/web/*, served by the worker: worker/routes.ts).
import { withBase } from '../../../studio/src/client/base';
import type { KeyCheck } from '../providers';

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

export const webApi = {
  demo: () => call<{ id: string; created: boolean }>('POST', '/api/web/demo'),
  importZip(file: File) {
    const form = new FormData();
    form.set('file', file);
    return call<{ id: string }>('POST', '/api/web/import', form);
  },
  remove: (id: string) => call<{ deleted: string }>('DELETE', `/api/web/projects/${encodeURIComponent(id)}`),
  checkKey: (provider: string, key: string) => call<KeyCheck>('POST', '/api/web/check-key', { provider, key }),
  storage: () =>
    call<{ books: number; usage: number | null; quota: number | null; pending: number }>('GET', '/api/web/storage'),
  reset: () => call<{ reset: boolean }>('POST', '/api/web/reset'),
  archiveUrl: (id: string) => withBase(`/api/web/projects/${encodeURIComponent(id)}/archive`),
};
