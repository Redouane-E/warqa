// Component packs of a book: plain scripts listed in warqa.json (pipeline.components, e.g. "packs/clock.js").
// They are run when the project opens, so validation, the writer and the export all know their components.
// A pack is code: only install packs you trust.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { type PackSetup, runPacks } from '@warqa/lesson';

const loaded = new Map<string, string[]>();

/** Run a pack file (once per process); returns the component types it registered. */
export function loadPackFile(file: string): string[] {
  const abs = resolve(file);
  const hit = loaded.get(abs);
  if (hit) return hit;
  if (!existsSync(abs)) throw new Error(`component pack not found: ${file}`);
  const sandbox: { WARQA_PACKS: PackSetup[]; console: Console; globalThis?: unknown } = { WARQA_PACKS: [], console };
  sandbox.globalThis = sandbox;
  runInNewContext(readFileSync(abs, 'utf8'), sandbox, { filename: basename(abs) });
  const types = runPacks({}, sandbox.WARQA_PACKS);
  loaded.set(abs, types);
  return types;
}

/** Load every pack a book lists; returns {file, types}. */
export function loadPacks(root: string, files: string[] = []): { file: string; types: string[] }[] {
  return files.map((f) => ({ file: f, types: loadPackFile(join(root, f)) }));
}

/**
 * Add a pack to a book: a .js file, a folder with a package.json ("warqa": {"pack": "pack.js"}), or (with
 * `fetchNpm`) an npm package name. The script is copied into the book (packs/<name>.js) so the book stays
 * self-contained, and listed in warqa.json.
 */
export function packSource(spec: string, fetchNpm?: (name: string) => string): { file: string; name: string } {
  let dir = '';
  if (existsSync(spec) && spec.endsWith('.js')) return { file: resolve(spec), name: basename(spec) };
  if (existsSync(join(spec, 'package.json'))) dir = resolve(spec);
  else if (fetchNpm) dir = fetchNpm(spec);
  else throw new Error(`no pack at ${spec}`);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name?: string;
    warqa?: { pack?: string };
  };
  const rel = pkg.warqa?.pack;
  if (!rel) throw new Error(`${spec}: package.json has no "warqa": {"pack": "…"} entry`);
  const name = `${(pkg.name ?? basename(dir)).replace(/^@/, '').replace(/[^\w.-]+/g, '-')}.js`;
  return { file: join(dir, rel), name };
}
