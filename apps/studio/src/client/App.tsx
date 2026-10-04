import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { StatusInfo } from '../shared/types';
import { api } from './api';
import { Icon, Sheet } from './components/ui';
import { ExtrasContext, type StudioExtras } from './extras';
import { getLang, I18nContext, makeI18n, setLang, subscribeLang, UI_LANGS, type UiLang, useI18n } from './i18n';
import { HomePage } from './pages/Home';
import { KeysPage } from './pages/Keys';
import { LessonPage } from './pages/Lesson';
import { ProjectPage } from './pages/Project';
import { ReviewPage } from './pages/Review';
import { SettingsPage } from './pages/Settings';
import { Link, match, useLocation } from './router';

/* ---------- server status (providers, presets, engines) shared by every screen ---------- */

interface StatusCtx {
  status: StatusInfo | null;
  reload: () => Promise<void>;
}
const StatusContext = createContext<StatusCtx>({ status: null, reload: async () => {} });
export const useStatus = () => useContext(StatusContext);

/* ---------- theme ---------- */

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'warqa-studio:theme';
function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
function applyTheme(t: Theme) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function TopBar({ theme, onTheme }: { theme: Theme; onTheme: (t: Theme) => void }) {
  const { t, lang } = useI18n();
  const { path } = useLocation();
  const next: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  const short: Record<UiLang, string> = { ar: 'عربي', fr: 'FR', en: 'EN' };
  const full: Record<UiLang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };
  return (
    <header className="topbar">
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <Link to="/" className="brand" aria-label={t('app.name')}>
        <Sheet />
        <span className="brand-ar" lang="ar">
          ورقة
        </span>
        <span className="brand-studio">{lang === 'ar' ? 'استوديو' : 'studio'}</span>
      </Link>
      <nav aria-label={t('nav.main')} className="topnav">
        <Link to="/" aria-current={path === '/' || path.startsWith('/project') ? 'page' : undefined}>
          {t('nav.books')}
        </Link>
        <Link to="/settings" aria-current={path === '/settings' ? 'page' : undefined}>
          <Icon name="key" size={16} /> {t('nav.keys')}
        </Link>
      </nav>
      <div className="topbar-tools">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
        <div className="seg" role="group" aria-label={t('ui.language')}>
          {UI_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={lang === l}
              title={full[l]}
              aria-label={full[l]}
              onClick={() => setLang(l)}
            >
              {short[l]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onTheme(next[theme])}
          aria-label={t(`theme.${theme}`)}
          title={t(`theme.${theme}`)}
        >
          <Icon name={theme === 'auto' ? 'auto' : theme === 'light' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}

function Routes() {
  const { path } = useLocation();
  let m: Record<string, string> | null;
  if ((m = match('/project/:id/lesson/:lid', path)))
    return <LessonPage key={`${m.id}/${m.lid}`} id={m.id!} lid={m.lid!} />;
  if ((m = match('/project/:id/settings', path))) return <SettingsPage key={m.id} id={m.id!} />;
  if ((m = match('/project/:id/review', path))) return <ReviewPage key={m.id} id={m.id!} />;
  if ((m = match('/project/:id', path))) return <ProjectPage key={m.id} id={m.id!} />;
  if (path === '/settings') return <KeysPage />;
  return <HomePage />;
}

export function App({ extras = {} }: { extras?: StudioExtras } = {}) {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const { path } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      /* screens show their own errors */
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  // move focus to the new screen after navigation (screen readers announce it)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose after each navigation
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [path]);

  const ctx = useMemo(() => ({ status, reload }), [status, reload]);
  return (
    <I18nContext.Provider value={i18n}>
      <StatusContext.Provider value={ctx}>
        <ExtrasContext.Provider value={extras}>
          <TopBar theme={theme} onTheme={setTheme} />
          {status && !status.localOnly && (
            <div className="remote-warning" role="alert">
              <Icon name="warn" /> {i18n.t('settings.remote', { host: status.host })}
            </div>
          )}
          {extras.banner}
          <main id="main" ref={mainRef} tabIndex={-1}>
            <Routes />
          </main>
        </ExtrasContext.Provider>
      </StatusContext.Provider>
    </I18nContext.Provider>
  );
}
