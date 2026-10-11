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
import { stripBase } from './base';
import { GoTo } from './components/GoTo';
import { JobsProvider } from './components/JobBoard';
import { OverlayProvider } from './components/overlays';
import { SHORTCUTS_EVENT, Shortcuts } from './components/Shortcuts';
import { OfflineBanner } from './components/states';
import { applyTheme, StackStrips, TopBar, useStrips } from './components/TopBar';
import { inField, toolOpen } from './components/tools';
import { Icon } from './components/ui';
import { ExtrasContext, type StudioExtras } from './extras';
import { getLang, I18nContext, makeI18n, subscribeLang } from './i18n';
import { AiPage } from './pages/Ai';
import { HomePage } from './pages/Home';
import { LearnCoursePage, LearnHomePage, LearnNewPage, LearnPlayerPage } from './pages/Learn';
import { LessonPage } from './pages/Lesson';
import { ProjectPage } from './pages/Project';
import { WelcomePage } from './pages/Welcome';
import { PlaceProvider, STEP_EVENT, STEPS } from './place';
import { go, match, navigate, useLocation } from './router';

/* ---------- server status (providers, presets, engines) shared by every screen ---------- */

interface StatusCtx {
  status: StatusInfo | null;
  reload: () => Promise<void>;
}
const StatusContext = createContext<StatusCtx>({ status: null, reload: async () => {} });
export const useStatus = () => useContext(StatusContext);

/** An address that moved: replaced at once by where it lives now. */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Routes() {
  const { path, query } = useLocation();
  let m: Record<string, string> | null;
  if ((m = match('/project/:id/lesson/:lid', path)))
    return <LessonPage key={`${m.id}/${m.lid}`} id={m.id!} lid={m.lid!} />;
  // the book's settings are a sheet over the book (its address opens it)
  if ((m = match('/project/:id/settings', path))) return <ProjectPage key={m.id} id={m.id!} />;
  // the book-wide review moved into Translate & narrate (redesign 4e)
  if ((m = match('/project/:id/review', path))) {
    const lang = query.get('lang');
    return (
      <Redirect
        to={`/project/${encodeURIComponent(m.id!)}?step=voice${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`}
      />
    );
  }
  if ((m = match('/project/:id', path))) return <ProjectPage key={m.id} id={m.id!} />;
  // learning on your own
  if (path === '/learn') return <LearnHomePage />;
  if (path === '/learn/new') return <LearnNewPage />;
  if ((m = match('/learn/:id/:lid', path))) return <LearnPlayerPage key={`${m.id}/${m.lid}`} id={m.id!} lid={m.lid!} />;
  if ((m = match('/learn/:id', path))) return <LearnCoursePage key={m.id} id={m.id!} />;
  // AI and voices: /ai (the old /settings address leads there, with its section)
  if (path === '/settings') return <Redirect to={`/ai${location.hash}`} />;
  if (path === '/ai') return <AiPage />;
  return <HomePage />;
}

export function App({ extras = {} }: { extras?: StudioExtras } = {}) {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [goto, setGoto] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
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
        return;
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || inField(e) || toolOpen()) return;
      // ? (؟ on an Arabic keyboard): every shortcut — except where a lesson player has its own ? (the learner's
      // player, or the focus inside a player)
      const target = e.target as Element | null;
      const here = stripBase(location.pathname);
      const inPlayer = !!target?.closest?.('.wq-player') || /^\/learn\/[^/]+\/[^/]+/.test(here);
      if ((e.key === '?' || e.key === '؟') && !e.altKey && !inPlayer && !here.startsWith('/welcome')) {
        e.preventDefault();
        setShortcuts((v) => !v);
        return;
      }
      // Alt + 1…6 on a book: its steps (the physical key: Option + digit types a character on a Mac)
      const m = /^Digit([1-6])$/.exec(e.code);
      const book = /^\/project\/([^/]+)/.exec(stripBase(location.pathname))?.[1];
      if (m && e.altKey && !e.shiftKey && book) {
        e.preventDefault();
        const to = STEPS[Number(m[1]) - 1]!;
        // on the book itself its page changes step (asking first when a step has unsaved work, as the rail does)
        if (here === `/project/${book}`) window.dispatchEvent(new CustomEvent(STEP_EVENT, { detail: to }));
        else void go(`/project/${book}?step=${to}`);
      }
    };
    window.addEventListener('keydown', key);
    const open = () => setShortcuts(true);
    window.addEventListener(SHORTCUTS_EVENT, open);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener(SHORTCUTS_EVENT, open);
    };
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
                  // the first visit: the welcome page and the start guide, full window (offline: said there too)
                  <>
                    <OfflineBanner />
                    <WelcomePage />
                  </>
                ) : (
                  <>
                    <TopBar onGoTo={() => setGoto(true)} />
                    {status && !status.localOnly && (
                      <div className="remote-warning" role="alert">
                        <Icon name="warn" /> {i18n.t('settings.remote', { host: status.host })}
                      </div>
                    )}
                    <OfflineBanner />
                    {extras.banner}
                    <Places mainRef={mainRef} />
                    <GoTo open={goto} onClose={() => setGoto(false)} />
                    <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
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
  // phones: a deeper place comes in from the inline end, going up slides it back (the place's key starts it)
  // the place's key: a new place lays a new sheet on top (the Stack motion)
  const level = path.startsWith('/project/')
    ? path
        .split('/')
        .slice(0, path.includes('/lesson/') ? 5 : 3)
        .join('/')
    : path;
  // phones: a deeper place comes in from the inline end, going up slides it back; decided once per place (the
  // renders that follow, as the place loads, keep it)
  const depth = strips.length;
  const moved = useRef({ level, depth, move: 'same' });
  if (moved.current.level !== level)
    moved.current = {
      level,
      depth,
      move: depth > moved.current.depth ? 'in' : depth < moved.current.depth ? 'up' : 'same',
    };
  else moved.current.depth = depth;
  const move = moved.current.move;
  return (
    <div className="places">
      <StackStrips />
      <main id="main" ref={mainRef} tabIndex={-1} key={level} className="place" data-move={move}>
        <Routes />
      </main>
    </div>
  );
}
