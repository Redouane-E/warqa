// Static files with HTTP Range support (audio seeking needs it) and strict path containment.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { Readable } from 'node:stream';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.zip': 'application/zip',
};

export const contentType = (p: string): string => TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream';

/**
 * Resolve `rel` (a URL path, already decoded or not) inside `base`. Returns undefined when the path escapes
 * the base (.., absolute paths, NUL bytes, symlinks pointing outside).
 */
export function safeJoin(base: string, rel: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const cleaned = decoded.replace(/^\/+/, '');
  if (isAbsolute(cleaned)) return undefined;
  if (cleaned.split('/').some((s) => s === '..')) return undefined;
  const p = normalize(join(base, cleaned));
  const r = relative(base, p);
  if (r.startsWith('..') || isAbsolute(r)) return undefined;
  if (existsSync(p)) {
    try {
      const real = realpathSync(p);
      const realBase = realpathSync(base);
      if (real !== realBase && !real.startsWith(realBase + sep)) return undefined;
    } catch {
      return undefined;
    }
  }
  return p;
}

/** Serve a file (with Range support). 404 when it does not exist or is a directory. */
export function sendFile(req: Request, path: string, opts: { cache?: string; download?: string } = {}): Response {
  if (!existsSync(path))
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  const st = statSync(path);
  if (!st.isFile())
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  const size = st.size;
  const headers: Record<string, string> = {
    'content-type': contentType(path),
    'accept-ranges': 'bytes',
    'cache-control': opts.cache ?? 'no-cache',
    'last-modified': st.mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  };
  if (opts.download)
    headers['content-disposition'] = `attachment; filename="${opts.download.replace(/[^\w.-]+/g, '_')}"`;
  const head = req.method === 'HEAD';
  const range = req.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (!m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (start >= size || end < start)
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    end = Math.min(end, size - 1);
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
    headers['content-length'] = String(end - start + 1);
    const body = head ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream);
    return new Response(body, { status: 206, headers });
  }
  headers['content-length'] = String(size);
  const body = head ? null : (Readable.toWeb(createReadStream(path)) as ReadableStream);
  return new Response(body, { status: 200, headers });
}
