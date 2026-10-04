// Warqa web app service worker. The studio's server runs inside an open Warqa tab (a Web Worker), not on the
// network. The page's own fetch() calls reach it directly; what the browser loads by itself does not: audio and
// images in the lesson preview, an exported book opened in a new tab, download links. This worker catches those
// requests (…/api/… and …/books/… under its scope) and hands them to an open Warqa tab, which answers them.
// It caches nothing and touches no other request.
const SCOPE = new URL(self.registration.scope);
const SERVER = /^(api|books)(\/|$)/;
/** Tabs whose in-browser server is ready (they say "hello"). */
const servers = new Set();
const waiting = new Set();
/** After asking every tab in vain, do not ask again for a while (each ask waits for answers). */
let noTabUntil = 0;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  if (e.data?.t !== 'hello' || !e.source?.id) return;
  servers.add(e.source.id);
  for (const w of waiting) w(e.source.id);
  waiting.clear();
});

/** A Warqa tab that can answer: the one asking first, else any known one, else ask every tab. */
async function serverTab(preferred) {
  for (const id of [preferred, ...servers]) {
    if (!id || !servers.has(id)) continue;
    const c = await self.clients.get(id);
    if (c) return c;
    servers.delete(id);
  }
  // this worker was restarted and forgot the tabs: ask them
  const all = await self.clients.matchAll({ type: 'window' });
  if (!all.length || Date.now() < noTabUntil) return null;
  const id = await new Promise((ok) => {
    waiting.add(ok);
    setTimeout(() => {
      waiting.delete(ok);
      ok(null);
    }, 3000);
    for (const c of all) c.postMessage({ t: 'who' });
  });
  if (!id) noTabUntil = Date.now() + 10000;
  return id ? self.clients.get(id) : null;
}

const NO_TAB = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warqa</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem">
<p>This book lives in your Warqa tab. Open <a href="${SCOPE.pathname}">Warqa</a> in this browser, then open the book again.</p>
<p dir="rtl" lang="ar">هذا الكتاب محفوظ في علامة تبويب ورقة. افتح <a href="${SCOPE.pathname}">ورقة</a> في هذا المتصفح، ثم افتح الكتاب من جديد.</p>
<p lang="fr">Ce livre se trouve dans votre onglet Warqa. Ouvrez <a href="${SCOPE.pathname}">Warqa</a> dans ce navigateur, puis rouvrez le livre.</p>`;

async function relay(e) {
  const tab = await serverTab(e.clientId);
  if (!tab) {
    // no Warqa tab: maybe a real server answers this address (e.g. the desktop studio on the same origin)
    const res = await fetch(e.request).catch(() => null);
    if (res && res.status !== 404) return res;
    return new Response(NO_TAB, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const req = e.request;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const { port1, port2 } = new MessageChannel();
  tab.postMessage(
    { t: 'sw-req', method: req.method, url: req.url, headers: [...req.headers], body },
    body ? [port2, body] : [port2],
  );
  return new Promise((resolve, reject) => {
    let ctrl = null;
    port1.onmessage = (m) => {
      const d = m.data;
      if (d.t === 'head') {
        const empty = req.method === 'HEAD' || [101, 204, 205, 304].includes(d.status);
        const stream = empty
          ? null
          : new ReadableStream({
              start(c) {
                ctrl = c;
              },
              cancel() {
                port1.postMessage({ t: 'cancel' });
                port1.close();
              },
            });
        resolve(new Response(stream, { status: d.status, statusText: d.statusText, headers: d.headers }));
      } else if (d.t === 'chunk') {
        ctrl?.enqueue(d.data);
      } else if (d.t === 'end') {
        try {
          ctrl?.close();
        } catch {}
        port1.close();
      } else if (d.t === 'fail') {
        if (ctrl) ctrl.error(new TypeError(d.message));
        else reject(new TypeError(d.message));
        port1.close();
      }
    };
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const rest = url.pathname.slice(SCOPE.pathname.length);
  if (!SERVER.test(rest)) return;
  // an exported book registers its own offline worker; inside Warqa it must not take over the book's URLs
  if (/^books\/.+\/sw\.js$/.test(rest)) {
    e.respondWith(new Response('', { status: 404 }));
    return;
  }
  e.respondWith(relay(e));
});
