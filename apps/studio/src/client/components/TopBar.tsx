// The top bar (the same six things everywhere: the mark, Go to, the book's spend, AI and voices, the interface
// language, Sheet or Board) and the stack strips that show the places under the one you are on.
import { useEffect, useSyncExternalStore } from 'react';
import { useExtras } from '../extras';
import { setLang, UI_LANGS, type UiLang, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { STEPS, usePlace } from '../place';
import { mode } from '../prefs';
import { go, Link, match, useLocation } from '../router';
import { useJobs } from './JobBoard';
import { Menu } from './Menu';
import { Icon, Mark } from './ui';

export const LANG_NAMES: Record<UiLang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };

/* ---------- theme: Sheet or Board; the first visit follows the computer ---------- */

export type Theme = 'light' | 'dark';
const THEME_KEY = 'warqa-studio:theme';
const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const themeListeners = new Set<() => void>();
dark?.addEventListener?.('change', () => {
  for (const f of themeListeners) f();
});

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}
export const effectiveTheme = (): Theme => storedTheme() ?? (dark?.matches ? 'dark' : 'light');
export function applyTheme(): void {
  const s = storedTheme();
  if (s) document.documentElement.dataset.theme = s;
  else delete document.documentElement.dataset.theme;
}
export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable */
  }
  applyTheme();
  for (const f of themeListeners) f();
}
const subscribeTheme = (f: () => void) => {
  themeListeners.add(f);
  return () => themeListeners.delete(f);
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The place AI and voices was opened from (it "stacks on whatever you were doing"): its strip leads back there, and
 * a book you came from gets a line to change its own model set.
 */
export const cameFrom: {
  current: { book?: { id: string; title: string; step: (typeof STEPS)[number] }; learn?: boolean } | null;
} = { current: null };

export function TopBar({ onGoTo }: { onGoTo: () => void }) {
  const { t, lang, usd } = useI18n();
  const { path } = useLocation();
  const place = usePlace();
  const jobs = useJobs();
  const { topbarStatus, menuItems } = useExtras();
  const theme = useSyncExternalStore(subscribeTheme, effectiveTheme);
  const book = place.book;
  const ai = path === '/ai' || path === '/settings';
  // phones: back to the place under this one (named after it), and this place's own title
  const strips = useStrips();
  const parent = strips[strips.length - 1];
  const here =
    place.lesson?.title ??
    book?.title ??
    (ai ? t('nav.ai') : path.startsWith('/learn') ? t('learn.home.title') : t('nav.books'));
  const learner = mode() === 'learn';
  // remember where you are, for AI and voices' strip
  const [bookId, bookName, bookStep] = [book?.id, book?.title, book?.step];
  useEffect(() => {
    if (path === '/ai' || path === '/settings') return;
    cameFrom.current = {
      ...(bookId && bookName && bookStep ? { book: { id: bookId, title: bookName, step: bookStep } } : {}),
      ...(path.startsWith('/learn') ? { learn: true } : {}),
    };
  }, [path, bookId, bookName, bookStep]);
  return (
    <header className="topbar">
      {/* the first stop on every page; on a book, straight to its step */}
      {book && path === `/project/${encodeURIComponent(book.id)}` ? (
        <a className="skip" href="#step">
          {t('nav.skipStep')}
        </a>
      ) : (
        <a className="skip" href="#main">
          {t('nav.skip')}
        </a>
      )}
      {parent && (
        <Link to={parent.to} className="topbar-back" aria-label={parent.title} title={parent.title}>
          <Icon name="back" />
        </Link>
      )}
      {/* someone learning on their own comes home to What I'm learning */}
      <Link
        to={learner ? '/learn' : '/'}
        className="brand"
        aria-label={learner ? t('learn.home.title') : t('nav.homeName')}
        title={learner ? t('learn.home.title') : t('nav.books')}
      >
        <Mark />
        <span className="brand-latin" lang="en">
          Warqa
        </span>
        <span className="brand-ar" lang="ar">
          ورقة
        </span>
      </Link>
      <p className="topbar-place" dir="auto">
        {here}
      </p>
      <button type="button" className="goto-btn" onClick={onGoTo} aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <Icon name="search" size={18} />
        <span className="goto-btn-text">{t('goto.button')}</span>
        <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      <div className="topbar-tools">
        {/* the host's status (the web app's): on a phone only its warnings button stays */}
        {topbarStatus && <div className="topbar-status">{topbarStatus}</div>}
        {book && (
          <button
            type="button"
            className="spend-chip"
            title={t('topbar.spendHint')}
            aria-label={t('topbar.spend', {
              spent: usd(book.spent),
              limit: book.limit !== undefined ? usd(book.limit) : '—',
            })}
            onClick={() => (jobs.current?.projectId === book.id ? jobs.show() : undefined)}
          >
            <bdi dir="ltr">
              {usd(book.spent)}
              {book.limit !== undefined && <span className="spend-limit"> / {usd(book.limit)}</span>}
            </bdi>
          </button>
        )}
        <Link to="/ai" className="topbar-link" aria-current={ai ? 'page' : undefined}>
          <Icon name="key" size={18} />
          <span>{t('nav.ai')}</span>
        </Link>
        <Menu
          className="lang-menu"
          label={t('ui.language')}
          button={
            <>
              <Icon name="language" size={18} />
              <span className="menu-button-text">{LANG_NAMES[lang]}</span>
            </>
          }
          items={UI_LANGS.map((l) => ({
            key: l,
            label: LANG_NAMES[l],
            lang: l,
            checked: l === lang,
            onSelect: () => setLang(l),
          }))}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={t(theme === 'dark' ? 'theme.toSheet' : 'theme.toBoard')}
          title={t(theme === 'dark' ? 'theme.toSheet' : 'theme.toBoard')}
        >
          <Icon name={theme === 'dark' ? 'sheet-theme' : 'board-theme'} />
        </button>
        {/* phones: AI and voices, the interface language, Sheet or Board (and the host's own) in one menu */}
        <Menu
          className="phone-menu"
          label={t('nav.menu')}
          button={<Icon name="more" size={20} />}
          items={[
            // (through the unsaved-work guard, as the desktop link)
            { key: 'ai', label: t('nav.ai'), onSelect: () => void go('/ai') },
            ...UI_LANGS.map((l) => ({
              key: `lang-${l}`,
              label: LANG_NAMES[l],
              lang: l,
              checked: l === lang,
              onSelect: () => setLang(l),
            })),
            {
              key: 'theme',
              label: t(theme === 'dark' ? 'theme.toSheet' : 'theme.toBoard'),
              onSelect: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
            },
            ...(menuItems ?? []),
          ]}
        />
      </div>
    </header>
  );
}

/* ---------- the stack strips: the places under this one ---------- */

export interface Strip {
  to: string;
  title: string;
  meta?: string;
}

/** The places under the current one, farthest first (Your books, then the book). */
export function useStrips(): Strip[] {
  const { t, num } = useI18n();
  const { path } = useLocation();
  const place = usePlace();
  // a learner's course and chapter lie on What I'm learning
  if (path !== '/learn/new' && (match('/learn/:id', path) || match('/learn/:id/:lid', path)))
    return [{ to: '/learn', title: t('learn.home.title') }];
  // AI and voices lies on the place it was opened from: a book at its step, What I'm learning, or Your books
  if (path === '/ai') {
    const from = cameFrom.current;
    if (from?.book)
      return [
        {
          to: `/project/${encodeURIComponent(from.book.id)}?step=${from.book.step}`,
          title: from.book.title,
          meta: t('strips.step', {
            k: num(STEPS.indexOf(from.book.step) + 1),
            n: num(STEPS.length),
            name: t(`step.${from.book.step}` as MsgKey),
          }),
        },
      ];
    if (from?.learn) return [{ to: '/learn', title: t('learn.home.title') }];
    return [{ to: '/', title: t('nav.books') }];
  }
  const m = match('/project/:id', path) ?? match('/project/:id/:sub', path) ?? match('/project/:id/lesson/:lid', path);
  if (!m) return [];
  const strips: Strip[] = [{ to: '/', title: t('nav.books') }];
  // the book's settings are a sheet over the book itself
  if (match('/project/:id', path) || match('/project/:id/settings', path)) return strips;
  const id = m.id!;
  const book = place.book?.id === id ? place.book : undefined;
  const step = book?.step;
  strips.push({
    to: `/project/${encodeURIComponent(id)}${step ? `?step=${step}` : ''}`,
    title: book?.title ?? id,
    ...(step
      ? {
          meta: t('strips.step', {
            k: num(STEPS.indexOf(step) + 1),
            n: num(STEPS.length),
            name: t(`step.${step}` as MsgKey),
          }),
        }
      : {}),
  });
  return strips;
}

export function StackStrips() {
  const { t } = useI18n();
  const strips = useStrips();
  if (!strips.length) return null;
  return (
    <nav className="strips" aria-label={t('strips.label')}>
      <ol>
        {strips.map((s, i) => (
          <li key={s.to} className={`strip strip-${strips.length - i}`}>
            <Link to={s.to} aria-keyshortcuts={i === strips.length - 1 ? 'Alt+ArrowUp' : undefined}>
              <bdi className="strip-title">{s.title}</bdi>
              {s.meta && <span className="strip-meta">{s.meta}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
