// The book's home (index.html of an exported book): its cover, the way back into the last chapter, and the
// contents with each chapter's state (done with its first-try score, last opened, not opened yet).
import { dirOf, formatNumber, LANG_INFO, langInfo, translator } from '@warqa/i18n';
import { h, icon, markIcon, rich } from './dom.js';
import { type Theme, themeOf } from './theme.js';

export interface BookPageData {
  id: string;
  title: Record<string, string>;
  subtitle?: Record<string, string>;
  author?: string;
  langs: string[];
  defaultLang: string;
  digits?: 'latn' | 'arab';
  units: {
    title: Record<string, string>;
    chapters: { id: string; href: string; number?: number; title: Record<string, string>; minutes?: number }[];
  }[];
  source?: { title?: string; license?: string; url?: string };
  attribution?: string;
  /** sheet (the default), board, or chalk (shown as the board). */
  theme?: string;
}

declare global {
  interface Window {
    WARQA_BOOK?: BookPageData;
  }
}

const pick = (m: Record<string, string> | undefined, lang: string) =>
  m ? (m[lang] ?? m[lang.split('-')[0]!] ?? Object.values(m)[0] ?? '') : '';

/** The installable app prompt (Chromium), kept until the learner asks to install; only the book's home asks. */
let installPrompt: (Event & { prompt(): Promise<unknown> }) | null = null;
let installListening = false;
function listenForInstall() {
  if (installListening) return;
  installListening = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as typeof installPrompt;
    document.querySelector<HTMLElement>('.wq-bh-install')?.removeAttribute('hidden');
  });
}

/**
 * Saving the book on this device (its service worker, over http(s) only): saving with how far it is, ready with its
 * size, failed (with Save again), or off after "Delete it from this device" (the pages then leave the worker
 * unregistered until asked again). Everything is this book's own, named after its folder on the site ("/demo/"):
 * books sharing a site, and the web app, keep their copies and workers.
 */
const bookScope = () => new URL('./', location.href);
const offKey = () => `warqa:offline:${bookScope().pathname}`;
interface Offline {
  state: 'none' | 'saving' | 'ready' | 'off' | 'failed';
  done: number;
  total: number;
}
let offline: Offline = { state: 'none', done: 0, total: 0 };
let offlineListening = false;
const canSave = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);
function listenForOffline(redraw: () => void) {
  if (offlineListening || !canSave()) return;
  offlineListening = true;
  try {
    if (localStorage.getItem(offKey()) === 'off') offline = { state: 'off', done: 0, total: 0 };
  } catch {
    /* storage unavailable */
  }
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', (e) => {
    const d = e.data as { t?: string; done?: number; total?: number; ready?: boolean; failed?: boolean } | null;
    if (d?.t !== 'warqa-cache' || offline.state === 'off') return;
    offline = { state: d.failed ? 'failed' : d.ready ? 'ready' : 'saving', done: d.done ?? 0, total: d.total ?? 0 };
    redraw();
  });
  sw.startMessages?.();
  // a later visit: ask this book's worker how much is saved (it tops up a copy found incomplete)
  if (offline.state !== 'off')
    void sw.getRegistration(bookScope().href).then((r) => {
      if (r?.scope === bookScope().href) r.active?.postMessage({ t: 'warqa-status' });
    });
}
async function forgetOffline() {
  try {
    localStorage.setItem(offKey(), 'off');
  } catch {
    /* storage unavailable: the next visit saves it again */
  }
  offline = { state: 'off', done: 0, total: 0 };
  try {
    const prefix = `warqa:${bookScope().pathname}:`;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => caches.delete(k)));
    // only this book's worker (another book, or the web app, may have one on the same site)
    const r = await navigator.serviceWorker.getRegistration(bookScope().href);
    if (r?.scope === bookScope().href) await r.unregister();
  } catch {
    /* nothing saved here */
  }
}
async function saveOffline() {
  try {
    localStorage.removeItem(offKey());
  } catch {
    /* storage unavailable */
  }
  offline = { state: 'saving', done: 0, total: 0 };
  try {
    await navigator.serviceWorker.register(new URL('sw.js', bookScope()));
  } catch {
    offline = { state: 'failed', done: 0, total: 0 };
  }
}
/** Said once when the saving ends (the panel is redrawn as it goes; this stays). */
let offlineLive: HTMLElement | null = null;
let offlineSaid = '';

const THEME_KEY = 'warqa:theme';

/** Render the book's home: its cover and contents. */
export function renderBook(host: HTMLElement, data: BookPageData, initialLang?: string): void {
  listenForInstall();
  // the saving panel alone is redrawn as the worker reports (the rest of the page keeps its focus)
  listenForOffline(() => {
    const el = host.querySelector('.wq-bh-offline');
    if (el && drawOffline) el.replaceWith(drawOffline());
  });
  let lang = initialLang && data.langs.includes(initialLang) ? initialLang : data.defaultLang;
  const progressKey = `warqa:progress:${data.id}`;
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(progressKey) ?? '{}');
      const at =
        Array.isArray(v?.at) && v.at.length === 2 && v.at.every((n: unknown) => typeof n === 'number')
          ? v.at
          : undefined;
      return {
        last: typeof v?.last === 'string' ? v.last : undefined,
        done: Array.isArray(v?.done) ? ((v.done as unknown[]).filter((x) => typeof x === 'string') as string[]) : [],
        lang: typeof v?.lang === 'string' ? v.lang : undefined,
        at: at as [number, number] | undefined,
      };
    } catch {
      return { done: [] as string[], last: undefined, lang: undefined, at: undefined };
    }
  };
  /** First-try score of a chapter's questions (the player saves them per chapter). */
  const score = (chapter: string) => {
    try {
      const v = JSON.parse(localStorage.getItem(`warqa:scores:${data.id}:${chapter}`) ?? '{}') as Record<
        string,
        { right?: number; total?: number }
      >;
      let right = 0;
      let total = 0;
      for (const s of Object.values(v)) {
        right += s.right ?? 0;
        total += s.total ?? 0;
      }
      return { right, total };
    } catch {
      return { right: 0, total: 0 };
    }
  };
  if (!initialLang) {
    const saved = read().lang;
    if (saved && data.langs.includes(saved)) lang = saved;
  }
  let theme: Theme = 'sheet';
  try {
    theme =
      themeOf(new URLSearchParams(location.search).get('theme')) ??
      themeOf(localStorage.getItem(THEME_KEY)) ??
      themeOf(data.theme) ??
      'sheet';
  } catch {
    theme = themeOf(data.theme) ?? 'sheet';
  }

  let drawOffline: (() => HTMLElement) | null = null;
  const render = () => {
    const t = translator(lang, { digits: data.digits ?? 'latn' });
    const fmt = (n: number) => formatNumber(n, lang, { digits: data.digits ?? 'latn' });
    const dir = dirOf(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    const p = read();
    const all = data.units.flatMap((u) => u.chapters);
    const last = all.find((c) => c.id === p.last);
    const first = all[0];
    const numberOf = (c: (typeof all)[number]) => c.number ?? all.indexOf(c) + 1;
    const title = pick(data.title, lang);
    document.title = title;
    const withLang = (href: string) => `${href}${href.includes('?') ? '&' : '?'}lang=${encodeURIComponent(lang)}`;
    const mb = (n: number) => `${fmt(Math.round(n / 1e5) / 10)} MB`;
    // saving on this device: a bar while it saves, then ready with its size and a way to delete it; after that,
    // a way to save it again
    drawOffline = () => {
      const o = offline;
      // redrawn in place; the focus goes to what replaced the button that had it
      const redraw = (focus?: string) => {
        host.querySelector('.wq-bh-offline')?.replaceWith(drawOffline!());
        if (focus) host.querySelector<HTMLElement>(focus)?.focus();
      };
      const ready = o.state === 'ready' ? t('book.ready', { size: `\u2066${mb(o.total)}\u2069` }) : '';
      const said = o.state === 'ready' ? ready : o.state === 'failed' ? t('book.saveFailed') : '';
      if (!offlineLive) {
        offlineLive = h('p', { class: 'wq-sr', role: 'status' });
        document.body.append(offlineLive);
      }
      if (said !== offlineSaid) {
        offlineSaid = said;
        offlineLive.textContent = said;
      }
      if (o.state === 'none' || !canSave()) return h('div', { class: 'wq-bh-offline', hidden: true });
      const save = h(
        'button',
        {
          type: 'button',
          class: 'wq-bh-save',
          onclick: () => {
            void saveOffline().then(() => redraw('.wq-bh-offline'));
            redraw('.wq-bh-offline');
          },
        },
        icon('download'),
        t('book.saveOffline'),
      );
      if (o.state === 'off') return h('div', { class: 'wq-bh-offline wq-bh-offline-off', tabindex: '-1' }, save);
      const share = o.total ? Math.min(1, o.done / o.total) : 0;
      return h(
        'section',
        {
          class: `wq-bh-offline wq-bh-offline-${o.state}`,
          tabindex: '-1',
          'aria-label': o.state === 'saving' ? t('book.saving') : said,
        },
        o.state === 'saving'
          ? h(
              'div',
              { class: 'wq-bh-off-row' },
              h('span', {}, t('book.saving')),
              h('bdi', { class: 'wq-mono', dir: 'ltr' }, o.total ? `${mb(o.done)} / ${mb(o.total)}` : ''),
            )
          : null,
        o.state === 'saving'
          ? h('div', { class: 'wq-bh-off-bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${share * 100}%` } }))
          : null,
        o.state === 'failed' ? h('p', { class: 'wq-bh-off-row wq-bh-off-failed' }, t('book.saveFailed')) : null,
        o.state === 'ready' || o.state === 'failed'
          ? h(
              'div',
              { class: 'wq-bh-off-foot' },
              o.state === 'ready' ? h('span', { class: 'wq-bh-off-ready' }, icon('check', 16), ready) : save,
              // offline, the saved copy is the only one: no way to delete it from here then
              o.state === 'ready' && navigator.onLine !== false
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'wq-bh-forget',
                      onclick: () => {
                        void forgetOffline().then(() => redraw('.wq-bh-save'));
                        redraw('.wq-bh-save');
                      },
                    },
                    t('book.forget'),
                  )
                : null,
            )
          : null,
      );
    };
    const setLang = (l: string) => {
      lang = l;
      try {
        localStorage.setItem(progressKey, JSON.stringify({ ...read(), lang }));
      } catch {
        /* storage unavailable */
      }
      render();
    };
    const langs =
      data.langs.length > 1
        ? h(
            'div',
            { class: 'wq-bh-langs', role: 'group', 'aria-label': t('bar.language') },
            data.langs.map((l) =>
              h(
                'button',
                {
                  type: 'button',
                  lang: l,
                  dir: dirOf(l),
                  'aria-pressed': String(l === lang),
                  onclick: () => setLang(l),
                },
                LANG_INFO[l as keyof typeof LANG_INFO]?.name ?? langInfo(l).name,
              ),
            ),
          )
        : null;
    const themeLabel = t(theme === 'sheet' ? 'theme.toBoard' : 'theme.toSheet');
    const themeBtn = h(
      'button',
      {
        type: 'button',
        class: 'wq-bh-theme',
        'aria-label': themeLabel,
        title: themeLabel,
        onclick: () => {
          theme = theme === 'sheet' ? 'board' : 'sheet';
          try {
            localStorage.setItem(THEME_KEY, theme);
          } catch {
            /* storage unavailable */
          }
          render();
        },
      },
      icon(theme === 'sheet' ? 'board-theme' : 'sheet-theme'),
    );
    const go = last ?? first;
    const status = (c: (typeof all)[number]) => {
      if (p.done.includes(c.id)) {
        const s = score(c.id);
        return h(
          'span',
          { class: 'wq-bh-done' },
          icon('check', 16),
          s.total ? t('book.done', { right: s.right, total: s.total }) : t('book.finished'),
        );
      }
      if (c.id === p.last) return h('span', { class: 'wq-bh-last' }, t('book.lastOpened'));
      return h('span', { class: 'wq-bh-new' }, t('book.notOpened'));
    };
    host.replaceChildren(
      h(
        'div',
        { class: `wq-book wq-theme-${theme}`, dir, lang },
        h(
          'header',
          { class: 'wq-bh-head' },
          h(
            'div',
            { class: 'wq-bh-in' },
            h('a', { class: 'wq-bh-brand', href: '#cover' }, markIcon(28), h('span', {}, rich(title))),
            h('div', { class: 'wq-bh-tools' }, langs, themeBtn),
          ),
        ),
        h(
          'main',
          { class: 'wq-bh-main' },
          h(
            'section',
            { class: 'wq-bh-cover', id: 'cover', 'aria-labelledby': 'wq-bh-title' },
            h(
              'div',
              { class: 'wq-bh-cover-in' },
              h('p', { class: 'wq-bh-kind' }, t('book.kind')),
              h('h1', { id: 'wq-bh-title' }, rich(title)),
              data.subtitle ? h('p', { class: 'wq-bh-sub' }, rich(pick(data.subtitle, lang))) : null,
              data.author ? h('p', { class: 'wq-bh-sub wq-bh-author' }, data.author) : null,
              h(
                'p',
                { class: 'wq-bh-meta' },
                h('span', {}, t('book.chapters', { n: all.length })),
                h('span', { 'aria-hidden': 'true' }, '·'),
                h('span', { class: 'wq-bh-sound' }, icon('voice', 18), t('book.withSound')),
                p.done.length ? h('span', { 'aria-hidden': 'true' }, '·') : null,
                p.done.length ? h('span', {}, t('book.finishedOf', { k: p.done.length, n: all.length })) : null,
              ),
              h(
                'div',
                { class: 'wq-bh-actions' },
                go
                  ? h(
                      'a',
                      { class: 'wq-bh-primary', href: withLang(go.href) },
                      icon('play'),
                      t(last ? 'book.continue' : 'book.start', { n: numberOf(go) }),
                    )
                  : null,
                h('a', { class: 'wq-bh-secondary', href: '#contents' }, icon('book'), t('book.openContents')),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'wq-bh-install',
                  hidden: !installPrompt,
                  onclick: () => {
                    void installPrompt?.prompt();
                    installPrompt = null;
                  },
                },
                icon('download'),
                t('book.install'),
              ),
              drawOffline(),
            ),
          ),
          h(
            'section',
            { class: 'wq-bh-contents', id: 'contents', 'aria-labelledby': 'wq-bh-toc' },
            h('div', { class: 'wq-bh-toc-head' }, h('h2', { id: 'wq-bh-toc' }, t('book.contents'))),
            data.units.map((u, ui) =>
              h(
                'section',
                { class: 'wq-unit' },
                h(
                  'h3',
                  {},
                  h('span', { class: 'wq-unit-n' }, t('book.unit', { n: ui + 1 })),
                  h('span', { 'aria-hidden': 'true' }, ' · '),
                  rich(pick(u.title, lang)),
                ),
                h(
                  'ol',
                  {},
                  u.chapters.map((c) =>
                    h(
                      'li',
                      {},
                      h(
                        'a',
                        {
                          class: 'wq-bh-ch',
                          href: withLang(c.href),
                          'aria-current': c.id === p.last ? 'true' : undefined,
                        },
                        h(
                          'span',
                          { class: 'wq-ch-n', 'aria-hidden': 'true' },
                          c.number !== undefined ? fmt(c.number) : '',
                        ),
                        h(
                          'span',
                          { class: 'wq-bh-ch-text' },
                          h(
                            'span',
                            { class: 'wq-bh-ch-k' },
                            [
                              c.number !== undefined ? t('head.chapter', { n: c.number }) : '',
                              c.minutes ? t('book.minutes', { n: c.minutes }) : '',
                            ]
                              .filter(Boolean)
                              .join(' · '),
                          ),
                          h('span', { class: 'wq-ch-t' }, rich(pick(c.title, lang))),
                          c.id === p.last && p.at && !p.done.includes(c.id)
                            ? h(
                                'span',
                                { class: 'wq-bh-prog' },
                                h(
                                  'span',
                                  {
                                    class: 'wq-bh-bar',
                                    role: 'progressbar',
                                    'aria-label': t('book.progress', { n: numberOf(c) }),
                                    'aria-valuemin': '0',
                                    'aria-valuemax': String(p.at[1]),
                                    'aria-valuenow': String(p.at[0]),
                                  },
                                  h('i', {
                                    style: { width: `${Math.round((100 * p.at[0]) / Math.max(1, p.at[1]))}%` },
                                  }),
                                ),
                                h('bdi', { class: 'wq-mono', dir: 'ltr' }, `${fmt(p.at[0])} / ${fmt(p.at[1])}`),
                              )
                            : null,
                        ),
                        status(c),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        h(
          'footer',
          { class: 'wq-bh-foot' },
          h(
            'div',
            { class: 'wq-bh-foot-in' },
            h('span', { class: 'wq-bh-made' }, markIcon(18), t('book.madeWith')),
            data.attribution ? h('p', {}, data.attribution) : null,
            data.source?.title
              ? h(
                  'p',
                  {},
                  `${t('book.source')}: ${data.source.title}${data.source.license ? ` (${data.source.license})` : ''}`,
                )
              : null,
          ),
        ),
      ),
    );
  };
  render();
}

export function bootBook(): void {
  const data = window.WARQA_BOOK;
  if (!data) return;
  const lang = new URLSearchParams(location.search).get('lang') ?? undefined;
  renderBook(document.getElementById('warqa') ?? document.body, data, lang);
}
