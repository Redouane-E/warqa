#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): format and safely fix the edited file with Biome, the project's
// formatter and linter. Silent on success; files Biome does not cover (biome.json "files.includes") are skipped.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let file = '';
try {
  file = JSON.parse(input).tool_input?.file_path ?? '';
} catch {
  process.exit(0);
}
if (!/\.(ts|tsx|mts|mjs|js|jsx)$/.test(file) || !existsSync(file)) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const biome = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.cmd' : 'biome');
if (!existsSync(biome)) process.exit(0); // dependencies not installed yet
const r = spawnSync(biome, ['check', '--write', '--no-errors-on-unmatched', file], { cwd: root, encoding: 'utf8' });
// remaining lint errors are reported back to Claude (exit 2 on PostToolUse shows stderr without undoing the edit)
if (r.status !== 0 && /error/i.test(r.stdout + r.stderr)) {
  process.stderr.write(`Biome found problems in ${file}:\n${(r.stdout + r.stderr).slice(0, 3000)}\n`);
  process.exit(2);
}
process.exit(0);
