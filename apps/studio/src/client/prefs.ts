// Small preferences kept in this browser (localStorage; nothing needs them to work).

const ONBOARDED = 'warqa-studio:onboarded';
/** Set by the web app before the start guide moved into the studio: people who finished it there stay done. */
const OLD_ONBOARDED = 'warqa-web:onboarded';

const get = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** The start guide was finished or skipped. */
export const onboarded = (): boolean => get(ONBOARDED) === '1' || get(OLD_ONBOARDED) === '1';

export function setOnboarded(v: boolean): void {
  try {
    if (v) localStorage.setItem(ONBOARDED, '1');
    else {
      localStorage.removeItem(ONBOARDED);
      localStorage.removeItem(OLD_ONBOARDED);
    }
  } catch {
    /* storage unavailable */
  }
}

const MODE = 'warqa-studio:mode';

/** "I teach" or "I'm learning for myself", from the start guide: the learner's home is What I'm learning. */
export type Mode = 'teach' | 'learn';
export const mode = (): Mode => (get(MODE) === 'learn' ? 'learn' : 'teach');
export function setMode(m: Mode): void {
  try {
    localStorage.setItem(MODE, m);
  } catch {
    /* storage unavailable */
  }
}
