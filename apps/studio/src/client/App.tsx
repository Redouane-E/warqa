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
import { GoTo } from './components/GoTo';
import { JobsProvider } from './components/JobBoard';
import { OverlayProvider } from './components/overlays';
import { applyTheme, StackStrips, TopBar, useStrips } from './components/TopBar';
import { inField, toolOpen } from './components/tools';
import { Icon } from './components/ui';
import { ExtrasContext, type StudioExtras } from './extras';
import { getLang, I18nContext, makeI18n, subscribeLang } from './i18n';
import { HomePage } from './pages/Home';
import { KeysPage } from './pages/Keys';
import { LearnCoursePage, LearnHomePage, LearnNewPage, LearnPlayerPage } from './pages/Learn';
import { LessonPage } from './pages/Lesson';
import { ProjectPage } from './pages/Project';
import { ReviewPage } from './pages/Review';
import { SettingsPage } from './pages/Settings';
import { WelcomePage } from './pages/Welcome';
import { PlaceProvider } from './place';
import { go, match, useLocation } from './router';

/* ---------- server status (providers, presets, engines) shared by every screen ---------- */

interface StatusCtx {
  status: StatusInfo | null;
  reload: () => Promise<void>;
}
const StatusContext = createContext<StatusCtx>({ status: null, reload: async () => {} });
export const useStatus = () => useContext(StatusContext);

function Routes() {
  const { path } = useLocation();
  let m: Record<string, string> | null;
  if ((m = match('/project/:id/lesson/:lid', path)))
    return <LessonPage key={`${m.id}/${m.lid}`} id={m.id!} lid={m.lid!} />;
  if ((m = match('/project/:id/settings', path))) return <SettingsPage key={m.id} id={m.id!} />;
  if ((m = match('/project/:id/review', path))) return <ReviewPage key={m.id} id={m.id!} />;
  if ((m = match('/project/:id', path))) return <ProjectPage key={m.id} id={m.id!} />;
  // learning on your own
  if (path === '/learn') return <LearnHomePage />;
  if (path === '/learn/new') return <LearnNewPage />;
  if ((m = match('/learn/:id/:lid', path))) return <LearnPlayerPage key={`${m.id}/${m.lid}`} id={m.id!} lid={m.lid!} />;
  if ((m = match('/learn/:id', path))) return <LearnCoursePage key={m.id} id={m.id!} />;
  // AI and voices: /ai (the old /settings address still works)
  if (path === '/ai' || path === '/settings') return <KeysPage />;
  return <HomePage />;
}

export function App({ extras = {} }: { extras?: StudioExtras } = {}) {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [goto, setGoto] = useState(false);
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
  useEffect(() => applyTheme(), []);

  // ⌘ K (Ctrl K elsewhere) opens Go to, from anywhere. The physical key counts, so an Arabic layout works too;
  // on a Mac, Ctrl K stays the text fields' "delete to the end of the line".
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const key = (e: KeyboardEvent) => {
      const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setGoto((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // move focus to the new place after navigation (screen readers announce it)
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
          <OverlayProvider>
            <JobsProvider>
              <PlaceProvider>
                {path === '/welcome' || path === '/welcome/start' ? (
                  // the first visit: the welcome page and the start guide, full window
                  <WelcomePage />
                ) : (
                  <>
                    <TopBar onGoTo={() => setGoto(true)} />
                    {status && !status.localOnly && (
                      <div className="remote-warning" role="alert">
                        <Icon name="warn" /> {i18n.t('settings.remote', { host: status.host })}
                      </div>
                    )}
                    {extras.banner}
                    <Places mainRef={mainRef} />
                    <GoTo open={goto} onClose={() => setGoto(false)} />
                  </>
                )}
              </PlaceProvider>
            </JobsProvider>
          </OverlayProvider>
        </ExtrasContext.Provider>
      </StatusContext.Provider>
    </I18nContext.Provider>
  );
}

/** The place you are on, laid on the strips of the places under it (Alt+↑ goes up one). */
function Places({ mainRef }: { mainRef: React.RefObject<HTMLElement | null> }) {
  const { path } = useLocation();
  const strips = useStrips();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key !== 'ArrowUp' || !strips.length) return;
      // in a text field Option+↑ moves the caret, in a list box Alt+↑ closes it; an open tool or dialog comes first
      if (e.defaultPrevented || inField(e) || toolOpen()) return;
      e.preventDefault();
      void go(strips[strips.length - 1]!.to);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [strips]);
  // the place's key: a new place lays a new sheet on top (the Stack motion)
  const level = path.startsWith('/project/')
    ? path
        .split('/')
        .slice(0, path.includes('/lesson/') ? 5 : 3)
        .join('/')
    : path;
  return (
    <div className="places">
      <StackStrips />
      <main id="main" ref={mainRef} tabIndex={-1} key={level} className="place">
        <Routes />
      </main>
    </div>
  );
}
