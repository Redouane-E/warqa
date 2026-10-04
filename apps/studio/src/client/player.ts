// Loads the lesson player bundle (/player/player.js → window.Warqa) once, for previews.
import { withBase } from './base';

export interface WarqaPlayer {
  seek(i: number, play?: boolean): void;
  setLang(lang: string): void;
  freeze(beat: number, t: number): void;
  destroy(): void;
  qa(): unknown;
  i: number;
  lang: string;
}

export interface WarqaApi {
  /** Run the setups that component packs queued in window.WARQA_PACKS. */
  runPacks?: (extra: { registerView?: unknown; kit?: unknown }) => string[];
  registerView?: unknown;
  kit?: unknown;
  mount(
    el: HTMLElement,
    data: unknown,
    opts?: {
      storage?: boolean;
      keyboard?: 'global' | 'local';
      autoplay?: boolean;
      onEvent?: (e: { type: string; index?: number; id?: string; lang?: string }) => void;
    },
  ): Promise<WarqaPlayer>;
}

declare global {
  interface Window {
    Warqa?: WarqaApi;
  }
}

let loading: Promise<WarqaApi> | null = null;

export function loadPlayer(): Promise<WarqaApi> {
  if (window.Warqa) return Promise.resolve(window.Warqa);
  loading ??= new Promise<WarqaApi>((ok, fail) => {
    const s = document.createElement('script');
    s.src = withBase('/player/player.js');
    s.async = true;
    s.onload = () => (window.Warqa ? ok(window.Warqa) : fail(new Error('player.js did not define window.Warqa')));
    s.onerror = () => {
      loading = null;
      fail(new Error('could not load /player/player.js'));
    };
    document.head.append(s);
  });
  return loading;
}

const packsLoaded = new Map<string, Promise<void>>();

/** Load a book's component packs (scripts), then register what they queued with the player. */
export async function loadPacks(W: WarqaApi, urls: string[] = []): Promise<void> {
  await Promise.all(
    urls.map((src) => {
      let p = packsLoaded.get(src);
      if (!p) {
        p = new Promise<void>((ok, fail) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = () => ok();
          s.onerror = () => {
            packsLoaded.delete(src);
            fail(new Error(`could not load the component pack ${src}`));
          };
          document.head.append(s);
        });
        packsLoaded.set(src, p);
      }
      return p;
    }),
  );
  W.runPacks?.({ registerView: W.registerView, kit: W.kit });
}
