// Development: the API with tsx watch on STUDIO_API_PORT, and Vite (hot reload) proxying to it.
//   pnpm --filter @warqa/studio dev -- --root ../../examples
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const argv = process.argv.slice(2).filter((a) => a !== '--');
const i = argv.indexOf('--root');
const root = resolve(i >= 0 ? argv[i + 1] : join(app, '../../examples'));
const apiPort = process.env.STUDIO_API_PORT ?? '5171';
const env = { ...process.env, STUDIO_API_PORT: apiPort };

const procs = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts', '--root', root, '--port', apiPort], { cwd: app, env, stdio: 'inherit' }),
  spawn('npx', ['vite'], { cwd: app, env, stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
