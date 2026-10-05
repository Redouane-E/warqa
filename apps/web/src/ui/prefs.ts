// Small preferences of the web app, kept in this browser (never needed for anything to work). Whether the start
// guide was done is the studio's (client/prefs.ts).

const FAKE = 'warqa-web:fake';

const read = (store: () => Storage, key: string): string | null => {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
};
const write = (store: () => Storage, key: string, value: string | null) => {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

/**
 * Test mode (scripted model, no network): ?warqa-fake=1 in the address turns it on for this tab (it survives
 * reloads of the tab), ?warqa-fake=0 turns it off; VITE_WARQA_FAKE=1 at build time turns it on everywhere.
 */
export function testMode(): boolean {
  const q = new URLSearchParams(location.search).get('warqa-fake');
  if (q === '1') write(() => sessionStorage, FAKE, '1');
  if (q === '0') write(() => sessionStorage, FAKE, null);
  return import.meta.env.VITE_WARQA_FAKE === '1' || read(() => sessionStorage, FAKE) === '1';
}
