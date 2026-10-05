// Check a provider key without spending anything: list the models (or the key's own info). The start guide asks
// this before a key is saved. Runs on the studio server, and in the web app's worker (the same server).
import { type KeyCheck, providerById } from '../shared/providers';

async function probe(url: string, headers: Record<string, string>): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { ok: false, reason: 'network', message: (e as Error).message };
  }
  if (res.ok) return { ok: true };
  const text = (await res.text().catch(() => '')).slice(0, 300);
  if (res.status === 429) return { ok: true, warning: 'rate' };
  // Gemini and xAI answer a wrong key with 400 ("API key not valid", "Incorrect API key")
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key/i.test(text)))
    return { ok: false, reason: 'key', status: res.status, message: text };
  if (res.status === 402) return { ok: false, reason: 'credits', status: res.status, message: text };
  return { ok: false, reason: 'http', status: res.status, message: text };
}

/** `fake`: the test model is a provider here (the web app's test mode); it needs no key. */
export async function checkKey(provider: string, key: string, fake = false): Promise<KeyCheck | null> {
  const p = providerById(provider, fake);
  if (!p) return null;
  if (p.id === 'fake') return { ok: true };
  const value = key.trim();
  if (!value && !p.local) return { ok: false, reason: 'key', message: 'empty key' };
  // a local server's address: only http(s), and only its own path (no query that would swallow "/tags")
  if (p.local && value) {
    let u: URL;
    try {
      u = new URL(value);
    } catch {
      return { ok: false, reason: 'network', message: 'not a web address' };
    }
    if (!/^https?:$/.test(u.protocol) || /[?#@]/.test(value))
      return { ok: false, reason: 'network', message: 'use an address like http://localhost:11434/api' };
  }
  const req = p.check!(value);
  return probe(req.url, req.headers);
}
