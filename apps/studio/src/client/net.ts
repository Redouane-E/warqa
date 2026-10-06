// Which work needs the internet (redesign 4h): the services of the models a job calls (a model on this computer
// does not), the voice that narrates, the map regions' site. Pure, so it is tested without a browser.
import type { JobType, ProjectDetail } from '../shared/types';

/** Services that run on this computer (or the user's own server): their work goes on without the internet. */
export const LOCAL_SERVICES = new Set(['ollama', 'lmstudio', 'llamacpp', 'vllm', 'compat']);

const ROLES_OF: Partial<Record<JobType, string[]>> = {
  plan: ['planner'],
  build: ['storyboard', 'writer', 'translator'],
  translate: ['translator'],
  rewrite: ['writer'],
  improve: ['judge', 'writer'],
  learn: ['planner', 'storyboard', 'writer', 'vision'],
  ingest: ['vision'],
  qa: ['judge'],
};

export interface NetOptions {
  /** A build that narrates too (its voice may be online). */
  narrate?: boolean;
}

/**
 * Does this work need the internet? Any of its roles on a cloud service (the test model counts as cloud, so the
 * tests see the gate). A role with no model is left out (that job stops on its missing key instead); a book in
 * one language needs no translator; narrating needs it unless the voice is the local helper or none.
 */
export function needsNet(
  p: Pick<ProjectDetail, 'roles' | 'config' | 'book'>,
  type: JobType,
  o: NetOptions = {},
): boolean {
  if (type === 'geo') return true;
  const voiceOnline = !['worker', 'none'].includes(p.config.tts.provider);
  if (type === 'narrate') return voiceOnline;
  let roles = ROLES_OF[type];
  if (!roles) return false;
  if (type === 'build' && p.book.langs.length < 2) roles = roles.filter((r) => r !== 'translator');
  const cloud = roles.some((r) => {
    const model = p.roles[r]?.model;
    return !!model && !LOCAL_SERVICES.has(model.split(':')[0] ?? '');
  });
  return cloud || (type === 'build' && !!o.narrate && voiceOnline);
}
