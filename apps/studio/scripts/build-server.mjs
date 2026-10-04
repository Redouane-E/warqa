// Bundle the server (src/server) into dist/server/index.js. Workspace and npm packages stay external.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
await esbuild.build({
  entryPoints: [join(here, '../src/server/index.ts')],
  outfile: join(here, '../dist/server/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
});
console.log('studio server → dist/server/index.js');
