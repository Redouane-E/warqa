// Job runners in the browser: the studio's own, except export (zipped here with fflate instead of the zip
// command) and the visual checks (they drive a real browser with Playwright: desktop only).
import * as P from '@warqa/pipeline';
import { dirname } from 'pathe';
import { geoRunner, RUNNERS, type Runner } from '../../../studio/src/server/jobs';
import { zipPath } from '../../../studio/src/server/zip';
import type { JobType } from '../../../studio/src/shared/types';
import { ensurePlayerBundle } from './assets';
import { vfs } from './vfs';

/** Speech engines that run programs on the computer (Edge voices via Python, the local Python worker). */
export const desktopOnlyVoices = ['edge', 'worker'];
/** Jobs that need the desktop version: they drive a real browser (Playwright) or package for the desktop. */
export const desktopOnlyJobs: JobType[] = ['qa', 'improve', 'panel'];

/**
 * geoBoundaries' API allows web pages (CORS), but its download links go through github.com/<owner>/<repo>/raw/…,
 * which redirects without CORS headers, so a browser refuses them. The same Git LFS files come with CORS headers
 * from media.githubusercontent.com (and plain files from raw.githubusercontent.com).
 */
export const corsFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/(.+)$/.exec(url);
  if (!m) return fetch(input, init);
  const media = await fetch(`https://media.githubusercontent.com/media/${m[1]}/${m[2]}/${m[3]}`, init);
  return media.ok ? media : fetch(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, init);
};

export function browserRunners(base: string, onRunning: (n: number) => void = () => {}): Record<string, Runner> {
  let running = 0;
  const runners: Record<string, Runner> = {
    ...RUNNERS,
    async export(ctx) {
      const p = ctx.project;
      ctx.progress({ stage: 'export', status: 'start' });
      await ensurePlayerBundle(base);
      const r = P.exportSite(p);
      const zip = zipPath(p.root);
      vfs.mkdirSync(dirname(zip), { recursive: true });
      P.zipFolder(r.out, zip);
      ctx.progress({
        stage: 'export',
        status: 'done',
        detail: `${r.lessons.length} lessons, ${r.langs.join('/')}, ${r.audio} audio clips`,
      });
      return {
        lessons: r.lessons,
        langs: r.langs,
        audio: r.audio,
        zip: true,
        url: `${base}books/${encodeURIComponent(ctx.projectId)}/`,
      };
    },
    async qa() {
      throw new Error('Visual checks drive a real browser, so they need the desktop version of Warqa.');
    },
    geo: geoRunner({ fetch: corsFetch }),
  };
  // a job saves what it wrote when it ends (it also saves along the way, every few hundred milliseconds)
  return Object.fromEntries(
    Object.entries(runners).map(([type, run]) => [
      type,
      async (ctx: Parameters<Runner>[0]) => {
        onRunning(++running);
        try {
          return await run(ctx);
        } finally {
          await vfs.flush().catch(() => {});
          onRunning(--running);
        }
      },
    ]),
  );
}
