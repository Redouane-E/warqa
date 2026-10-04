// Files the server reads from "disk" that ship with the app: the lesson player bundle (an export copies it into
// every book). They are fetched from the app's own static files once, into /app (memory only).
import { dirname, join } from 'pathe';
import { vfs } from './vfs';

/** Where the pipeline looks for @warqa/lesson/dist/bundle (see shims/module.ts). */
export const PLAYER_DIR = '/app/lesson/dist/bundle';

let loading: Promise<void> | null = null;

export function ensurePlayerBundle(base: string): Promise<void> {
  loading ??= (async () => {
    const at = (f: string) => new URL(`${base}player/${f}`, self.location.origin);
    const res = await fetch(at('manifest.json'));
    if (!res.ok)
      throw new Error(`the lesson player is missing from this site (player/manifest.json: HTTP ${res.status})`);
    const files = (await res.json()) as string[];
    await Promise.all(
      files.map(async (f) => {
        const r = await fetch(at(f));
        if (!r.ok) throw new Error(`player/${f}: HTTP ${r.status}`);
        const target = join(PLAYER_DIR, f);
        vfs.mkdirSync(dirname(target), { recursive: true });
        vfs.writeFileSync(target, new Uint8Array(await r.arrayBuffer()));
      }),
    );
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
