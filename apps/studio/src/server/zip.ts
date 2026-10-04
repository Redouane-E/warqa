// The downloadable .zip of an exported book lives in the OS temp folder (not in the project, so it never
// ends up in git), and counts only while it is newer than the export it was made from.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const zipPath = (projectRoot: string): string =>
  join(tmpdir(), 'warqa-studio', `${createHash('sha1').update(projectRoot).digest('hex').slice(0, 16)}.zip`);

export function zipReady(projectRoot: string): boolean {
  const z = zipPath(projectRoot);
  const index = join(projectRoot, 'dist', 'index.html');
  if (!existsSync(z) || !existsSync(index)) return false;
  return statSync(z).mtimeMs >= statSync(index).mtimeMs;
}

/** The zip of a teacher review kit (made from <project>/dist-panel). */
export const panelZipPath = (projectRoot: string): string => zipPath(projectRoot).replace(/\.zip$/, '-panel.zip');

/** The kit folder and the key the organiser keeps (written next to the kit, not inside it). */
export const panelDir = (projectRoot: string): string => join(projectRoot, 'dist-panel');
export const panelKeyPath = (projectRoot: string): string => join(projectRoot, 'dist-panel-key.json');
