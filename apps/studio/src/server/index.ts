// warqa studio — one local process: the JSON API and the React app.
//   node apps/studio/dist/server/index.js --root <project or folder of projects> [--port 5170] [--host 127.0.0.1]
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { applyKeys, keysFile } from './keys.js';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback?: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const a = argv[i]!;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[i + 1];
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: warqa-studio --root <project or folder of projects> [--port 5170] [--host 127.0.0.1]');
  process.exit(0);
}

const root = resolve(arg('root', process.cwd())!);
const port = Number(arg('port', process.env.PORT ?? '5170'));
const host = arg('host', '127.0.0.1')!;
// dist/server/index.js → dist/client; src/server/index.ts (dev) → no client (Vite serves it)
const clientDir = [join(here, '../client'), join(here, '../../dist/client')].find((d) =>
  existsSync(join(d, 'index.html')),
);

// .env files (cwd, then the root) without overriding real environment variables, like the CLI
for (const f of [join(process.cwd(), '.env'), join(root, '.env')]) {
  if (existsSync(f)) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* ignore malformed .env */
    }
  }
}
applyKeys();

if (!existsSync(root)) {
  console.error(`The folder does not exist: ${root}`);
  process.exit(1);
}

const { app } = createApp({ root, host, ...(clientDir ? { clientDir } : {}) });

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  console.log(`Warqa studio → http://${shown}:${info.port}/`);
  console.log(`  books in ${root}`);
  console.log(`  keys are stored on this computer only: ${keysFile()}`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn(
      `  ⚠ listening on ${host}: anyone who can reach this address can use your API keys and spend your budget.`,
    );
    console.warn('    Keys are meant to stay local; prefer the default 127.0.0.1.');
  }
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Try --port ${port + 1}.`);
  else console.error(e.message);
  process.exit(1);
});

const stop = () => {
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
