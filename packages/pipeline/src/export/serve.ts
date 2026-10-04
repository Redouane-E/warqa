// A small static server with HTTP Range support (audio seeking needs it; Python's http.server lacks it).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export function serveStatic(root: string, port = 8765, host = '127.0.0.1'): Promise<{ server: Server; url: string }> {
  const base = resolve(root);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      let p = normalize(join(base, decodeURIComponent(url.pathname)));
      if (!p.startsWith(base)) {
        res.writeHead(403).end();
        return;
      }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const size = statSync(p).size;
      const type = TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';
      const headers: Record<string, string | number> = {
        'content-type': type,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
      };
      const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range) {
        let start = range[1] ? Number(range[1]) : 0;
        let end = range[2] ? Number(range[2]) : size - 1;
        if (!range[1] && range[2]) {
          start = Math.max(0, size - Number(range[2]));
          end = size - 1;
        }
        if (start >= size || end < start) {
          res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
          return;
        }
        end = Math.min(end, size - 1);
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': end - start + 1,
        });
        if (req.method === 'HEAD') return void res.end();
        createReadStream(p, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': size });
      if (req.method === 'HEAD') return void res.end();
      createReadStream(p).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const a = server.address();
      const realPort = typeof a === 'object' && a ? a.port : port;
      ok({ server, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${realPort}/` });
    });
  });
}
