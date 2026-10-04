// @warqa/lesson/player — the DOM player. `mount()` embeds a lesson; `bootPage()` starts a static lesson page.
import { Player, type PlayerData, type PlayerOptions } from './player.js';

export { runPacks } from '../packs.js';
export { type BookPageData, bootBook, renderBook } from './book.js';
export { kit } from './kit.js';
export { Player, type PlayerData, type PlayerEvent, type PlayerOptions } from './player.js';
export { registerView, slotBoxes, VIEWS } from './scene.js';
export { setAssetBase } from './views/map.js';
export type { Box, View, ViewCtx, ViewFactory } from './views/types.js';

/** Wait for the fonts the stage measures text with (Latin, Arabic and math). */
export async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads = ['500 34px "Readex Pro"', '600 34px "Readex Pro"', '400 40px "STIX Two Text"'].map((f) =>
    document.fonts.load(f, 'aB1 عربي −').catch(() => []),
  );
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]);
}

/** Embed a lesson player in an element. */
export async function mount(el: HTMLElement, data: PlayerData, opts: PlayerOptions = {}): Promise<Player> {
  await fontsReady();
  return new Player(el, data, { keyboard: 'local', ...opts });
}

declare global {
  interface Window {
    WARQA_DATA?: PlayerData;
    warqa?: Player;
  }
}

/**
 * Start the lesson on a static page: reads window.WARQA_DATA, honours ?lang=, ?beat=N&t=S (frozen review
 * frame) and ?autoplay=1.
 */
export async function bootPage(): Promise<Player | undefined> {
  const data = window.WARQA_DATA;
  const host = document.getElementById('warqa') ?? document.body;
  if (!data) {
    host.textContent = 'Warqa: no lesson data on this page.';
    return undefined;
  }
  const q = new URLSearchParams(location.search);
  let lang = q.get('lang') ?? undefined;
  if (!lang) {
    try {
      const p = JSON.parse(localStorage.getItem(`warqa:progress:${data.book?.id ?? 'lesson'}`) ?? '{}');
      if (typeof p?.lang === 'string') lang = p.lang;
    } catch {
      /* storage unavailable */
    }
  }
  const beat = q.get('beat');
  const opts: PlayerOptions = { keyboard: 'global', autoplay: q.get('autoplay') === '1' };
  if (beat !== null) opts.review = { beat: Number(beat) || 0, t: Number(q.get('t') ?? 0) || 0 };
  await fontsReady();
  const player = new Player(host, lang ? { ...data, lang } : data, opts);
  window.warqa = player;
  document.documentElement.lang = player.lang;
  document.documentElement.dir = player.dir;
  return player;
}
