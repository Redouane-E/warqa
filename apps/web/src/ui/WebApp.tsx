// The web app: a start screen while the in-browser server loads, the start guide for new users, then the studio
// itself (the same React app as the local studio) with the web additions.
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { App } from '../../../studio/src/client/App';
import { Button, Sheet } from '../../../studio/src/client/components/ui';
import { getLang, I18nContext, makeI18n, subscribeLang } from '../../../studio/src/client/i18n';
import { useLocation } from '../../../studio/src/client/router';
import type { Bridge } from '../bridge/client';
import { Banner, HomeActions, ProjectActions } from './Chrome';
import { useW } from './i18n';
import { Onboarding } from './Onboarding';
import { onboarded } from './prefs';

const TAKEOVER = 'warqa-web:takeover';

function Boot({ bridge }: { bridge: Bridge }) {
  const w = useW();
  const state = useSyncExternalStore(bridge.subscribe, () => bridge.state);
  let body: ReactNode;
  if (state === 'busy' || state === 'released')
    body = (
      <>
        <h1 className="display">{w(state === 'busy' ? 'boot.busy' : 'boot.released')}</h1>
        <p className="lede">{w('boot.busyHint')}</p>
        <Button
          variant="primary"
          onClick={() => {
            if (state === 'busy') bridge.takeover();
            else {
              // start afresh from what the other tab saved
              try {
                sessionStorage.setItem(TAKEOVER, '1');
              } catch {
                /* storage unavailable */
              }
              location.reload();
            }
          }}
        >
          {w('boot.useHere')}
        </Button>
      </>
    );
  else if (state === 'failed')
    body = (
      <>
        <h1 className="display">{w('boot.failed')}</h1>
        <p className="lede">{w('boot.failedHint')}</p>
        <pre className="boot-error" dir="ltr">
          {bridge.error}
        </pre>
      </>
    );
  else
    body = (
      <p className="loading" role="status">
        <span className="spinner" aria-hidden="true" /> {w('boot.loading')}
      </p>
    );
  return (
    <main id="main" className="boot">
      <div className="boot-card">
        <span className="brand">
          <Sheet size={40} />
          <span className="brand-ar" lang="ar">
            ورقة
          </span>
        </span>
        {body}
      </div>
    </main>
  );
}

export function WebApp({ bridge, serviceWorker }: { bridge: Bridge; serviceWorker: Promise<boolean> }) {
  const state = useSyncExternalStore(bridge.subscribe, () => bridge.state);
  const lang = useSyncExternalStore(subscribeLang, getLang);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { path } = useLocation();
  const [guide, setGuide] = useState(() => !onboarded());
  const [sw, setSw] = useState(true);

  useEffect(() => {
    void serviceWorker.then(setSw);
  }, [serviceWorker]);

  // a reload asked for by "Use Warqa in this tab" takes the books over without a second click
  useEffect(() => {
    if (state !== 'busy') return;
    try {
      if (sessionStorage.getItem(TAKEOVER)) {
        sessionStorage.removeItem(TAKEOVER);
        bridge.takeover();
      }
    } catch {
      /* storage unavailable */
    }
  }, [state, bridge]);

  const extras = useMemo(
    () => ({
      banner: <Banner bridge={bridge} serviceWorker={sw} />,
      homeActions: <HomeActions />,
      projectActions: (id: string) => <ProjectActions id={id} />,
    }),
    [bridge, sw],
  );

  if (state !== 'ready')
    return (
      <I18nContext.Provider value={i18n}>
        <Boot bridge={bridge} />
      </I18nContext.Provider>
    );
  if (path === '/welcome' || (guide && path === '/'))
    return (
      <I18nContext.Provider value={i18n}>
        <Onboarding fake={!!bridge.info?.fake} onDone={() => setGuide(false)} />
      </I18nContext.Provider>
    );
  return <App extras={extras} />;
}
