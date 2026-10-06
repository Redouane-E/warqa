// The web app: a start screen while the in-browser server loads, the start guide for new users, then the studio
// itself (the same React app as the local studio) with the web additions.
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { App } from '../../../studio/src/client/App';
import { Button, Mark } from '../../../studio/src/client/components/ui';
import { getLang, I18nContext, makeI18n, subscribeLang } from '../../../studio/src/client/i18n';
import type { Bridge } from '../bridge/client';
import { FAKE_MODEL } from '../worker/fake';
import { HomeActions, ProjectActions, WebStatus } from './Chrome';
import { useW } from './i18n';
import { webApi } from './webApi';

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
          <Mark size={40} />
          <span className="brand-latin" lang="en">
            Warqa
          </span>
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
  const [sw, setSw] = useState(true);
  const fake = state === 'ready' && !!bridge.info?.fake;

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
      topbarStatus: <WebStatus bridge={bridge} serviceWorker={sw} />,
      homeActions: <HomeActions />,
      projectActions: (id: string) => <ProjectActions id={id} />,
      ...(__WARQA_REPO__ ? { desktopUrl: `${__WARQA_REPO__}#readme` } : {}),
      // the start guide (now in the studio): the test model in test mode, and the bundled example book
      guide: {
        ...(fake ? { fakeModel: FAKE_MODEL } : {}),
        example: async () => {
          const r = await webApi.demo();
          return `/project/${encodeURIComponent(r.id)}/lesson/ch05`;
        },
      },
    }),
    // the bridge's info (test mode) arrives once the in-browser server is ready
    [bridge, sw, fake],
  );

  if (state !== 'ready')
    return (
      <I18nContext.Provider value={i18n}>
        <Boot bridge={bridge} />
      </I18nContext.Provider>
    );
  return <App extras={extras} />;
}
