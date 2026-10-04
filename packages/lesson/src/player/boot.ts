// Entry of the standalone player bundle (dist/bundle/player.js): exposes window.Warqa and starts the lesson
// on pages that define window.WARQA_DATA.
import { bootBook } from './book.js';
import * as api from './index.js';
import { setAssetBase } from './views/map.js';

// remember where the bundle lives, to load optional data files (geography) next to it
const me = document.currentScript as HTMLScriptElement | null;
if (me?.src) setAssetBase(me.src);

(globalThis as unknown as { Warqa: typeof api }).Warqa = api;
// component packs loaded before this script queued their setup in window.WARQA_PACKS
const runQueued = () => api.runPacks({ registerView: api.registerView, kit: api.kit });
runQueued();
const start = () => {
  runQueued(); // packs loaded after the player (async or deferred scripts)
  if (window.WARQA_DATA) void api.bootPage();
  else if (window.WARQA_BOOK) bootBook();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
