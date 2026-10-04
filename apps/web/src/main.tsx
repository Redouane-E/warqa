// Warqa in the browser. The studio's server and pipeline run in a Web Worker; the studio's React app runs here,
// its /api calls answered by that worker. Nothing is sent to a Warqa server (there is none).
import '../../studio/src/client/styles.css';
import './ui/web.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BASE, withBase } from '../../studio/src/client/base';
import { applyDocument, getLang } from '../../studio/src/client/i18n';
import { Bridge, installEventSource, installFetch, installLinkFallback, installServiceWorker } from './bridge/client';
import { WEB_CATALOGS } from './ui/messages';
import { testMode } from './ui/prefs';
import { WebApp } from './ui/WebApp';

// the player's stylesheet also declares the interface fonts (Readex Pro, Noto Naskh Arabic, STIX Two)
document.head.append(
  Object.assign(document.createElement('link'), { rel: 'stylesheet', href: withBase('/player/player.css') }),
);

// the studio's theme choice (it is applied by the studio screens too, once they show)
try {
  const theme = localStorage.getItem('warqa-studio:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* storage unavailable */
}

const bridge = new Bridge({ base: BASE, fake: testMode() });
installFetch(bridge);
installEventSource(bridge);
const serviceWorker = installServiceWorker(bridge, BASE);
// work in progress runs in this tab: closing or reloading it would stop it (the browser asks first)
window.addEventListener('beforeunload', (e) => {
  if (bridge.running > 0) e.preventDefault();
});
installLinkFallback(() => window.alert((WEB_CATALOGS[getLang()] ?? WEB_CATALOGS.en!)['banner.noSw']));

applyDocument();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebApp bridge={bridge} serviceWorker={serviceWorker} />
  </StrictMode>,
);
