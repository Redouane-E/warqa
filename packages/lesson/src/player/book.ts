// The book's cover and contents page (index.html of an exported book).
import { dirOf, formatNumber, LANG_INFO, langInfo, translator } from '@warqa/i18n';
import { h, rich } from './dom.js';

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
}

declare global {
  interface Window {
    WARQA_BOOK?: BookPageData;
  }
}

const pick = (m: Record<string, string> | undefined, lang: string) =>
  m ? (m[lang] ?? m[lang.split('-')[0]!] ?? Object.values(m)[0] ?? '') : '';

/** Render the cover and contents into an element. */
export function renderBook(host: HTMLElement, data: BookPageData, initialLang?: string): void {
  let lang = initialLang && data.langs.includes(initialLang) ? initialLang : data.defaultLang;
  const progressKey = `warqa:progress:${data.id}`;
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(progressKey) ?? '{}');
      return {
        last: typeof v?.last === 'string' ? v.last : undefined,
        done: Array.isArray(v?.done) ? ((v.done as unknown[]).filter((x) => typeof x === 'string') as string[]) : [],
        lang: typeof v?.lang === 'string' ? v.lang : undefined,
      };
    } catch {
      return { done: [] as string[], last: undefined, lang: undefined };
    }
  };
  if (!initialLang) {
    const saved = read().lang;
    if (saved && data.langs.includes(saved)) lang = saved;
  }

  const render = () => {
    const t = translator(lang, { digits: data.digits ?? 'latn' });
    const fmt = (n: number) => formatNumber(n, lang, { digits: data.digits ?? 'latn' });
    const dir = dirOf(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    const p = read();
    const all = data.units.flatMap((u) => u.chapters);
    const last = all.find((c) => c.id === p.last);
    const title = pick(data.title, lang);
    document.title = title;
    const langSel =
      data.langs.length > 1
        ? h(
            'select',
            {
              class: 'wq-lang',
              'aria-label': t('bar.language'),
              onchange: (e: Event) => {
                lang = (e.target as HTMLSelectElement).value;
                try {
                  localStorage.setItem(progressKey, JSON.stringify({ ...read(), lang }));
                } catch {
                  /* storage unavailable */
                }
                render();
              },
            },
            data.langs.map((l) =>
              h(
                'option',
                { value: l, selected: l === lang },
                LANG_INFO[l as keyof typeof LANG_INFO]?.name ?? langInfo(l).name,
              ),
            ),
          )
        : null;
    const withLang = (href: string) => `${href}${href.includes('?') ? '&' : '?'}lang=${encodeURIComponent(lang)}`;
    host.replaceChildren(
      h(
        'div',
        { class: 'wq-book', dir, lang },
        h(
          'header',
          { class: 'wq-book-cover', id: 'cover' },
          h('div', { class: 'wq-book-top' }, h('span', { class: 'wq-book-brand' }, '∞ ', t('book.madeWith')), langSel),
          h('h1', {}, rich(title)),
          data.subtitle ? h('p', { class: 'wq-book-sub' }, rich(pick(data.subtitle, lang))) : null,
          data.author ? h('p', { class: 'wq-book-author' }, data.author) : null,
          h(
            'p',
            { class: 'wq-book-meta' },
            `${t('book.chapters', { n: all.length })} · ${t('book.withSound')}`,
            p.done.length ? ` · ${t('book.finishedOf', { k: p.done.length, n: all.length })}` : '',
          ),
          h(
            'div',
            { class: 'wq-actions' },
            h('a', { class: 'wq-btn wq-primary', href: '#contents' }, t('book.open')),
            last
              ? h(
                  'a',
                  { class: 'wq-btn', href: withLang(last.href) },
                  t('book.continue', { n: last.number ?? all.indexOf(last) + 1 }),
                )
              : null,
          ),
        ),
        h(
          'main',
          { class: 'wq-book-contents', id: 'contents' },
          h('h2', {}, t('book.contents')),
          data.units.map((u, ui) =>
            h(
              'section',
              { class: 'wq-unit' },
              h(
                'h3',
                {},
                h('span', { class: 'wq-unit-n' }, t('book.unit', { n: ui + 1 })),
                ' ',
                rich(pick(u.title, lang)),
              ),
              h(
                'ol',
                {},
                u.chapters.map((c) =>
                  h(
                    'li',
                    { class: `${p.done.includes(c.id) ? 'wq-done' : ''} ${c.id === p.last ? 'wq-last' : ''}`.trim() },
                    h(
                      'a',
                      { href: withLang(c.href) },
                      h('span', { class: 'wq-ch-n' }, c.number !== undefined ? fmt(c.number) : ''),
                      h('span', { class: 'wq-ch-t' }, rich(pick(c.title, lang))),
                      h(
                        'span',
                        { class: 'wq-ch-m' },
                        c.minutes ? t('book.minutes', { n: c.minutes }) : '',
                        p.done.includes(c.id)
                          ? ` · ✓ ${t('book.finished')}`
                          : c.id === p.last
                            ? ` · ${t('book.lastOpened')}`
                            : '',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          data.source || data.attribution
            ? h(
                'footer',
                { class: 'wq-book-foot' },
                data.attribution ? h('p', {}, data.attribution) : null,
                data.source?.title
                  ? h(
                      'p',
                      {},
                      `${t('book.source')}: ${data.source.title}${data.source.license ? ` (${data.source.license})` : ''}`,
                    )
                  : null,
              )
            : null,
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
