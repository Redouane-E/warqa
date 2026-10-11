// Keyboard shortcuts (redesign phase 5): every key of the studio, the lesson editor and the lesson player, in a side
// sheet opened by ? (؟ on an Arabic keyboard) or from Go to. Keys are physical: on an Arabic keyboard the letter
// keys carry Arabic letters, shown beside the Latin one.
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { SideSheet } from './SideSheet';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';
/** The letters on an Arabic keyboard's keys. */
const AR: Record<string, string> = { K: 'ن', S: 'س', J: 'ت', C: 'ؤ', T: 'ف', F: 'ب', '?': '؟' };

/** Said when ? opens the sheet (App listens); Go to sends it too. */
export const SHORTCUTS_EVENT = 'warqa:shortcuts';

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const cap = (k: string, main = false) => (
    <kbd key={k} className={`kbd-cap${main ? ' is-main' : ''}`}>
      {k}
      {lang === 'ar' && AR[k] && (
        <span className="kbd-ar" lang="ar">
          {` ${AR[k]}`}
        </span>
      )}
    </kbd>
  );
  /** Keys pressed together (+), or either of two (/). */
  const keys = (...parts: (string | string[])[]): ReactNode =>
    parts.map((p, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
      <span key={i} className="kbd-combo">
        {i > 0 && <span className="kbd-sep">{Array.isArray(p) ? ' + ' : ' / '}</span>}
        {Array.isArray(p) ? p.map((k, j) => [j > 0 && ' + ', cap(k, j === p.length - 1)]) : cap(p, true)}
      </span>
    ));
  const [prev, next] = lang === 'ar' ? ['→', '←'] : ['←', '→'];
  const group = (title: MsgKey, rows: [ReactNode, MsgKey][]) => (
    <section className="keys-group" aria-labelledby={`keys-${title}`}>
      <h3 id={`keys-${title}`} className="keys-title">
        {t(title)}
      </h3>
      <dl className="keys-list">
        {rows.map(([k, what]) => (
          <div key={what} className="keys-row">
            <dt dir="ltr">{k}</dt>
            <dd>{t(what)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <SideSheet open={open} onClose={onClose} title={t('keys.title')} className="shortcuts">
      {group('keys.studio', [
        [keys([MOD, 'K']), 'keys.goto'],
        [keys([ALT, '1…6']), 'keys.steps'],
        [keys('↑', '↓', prev, next), 'keys.rail'],
        [keys([ALT, '↑']), 'keys.up'],
        [keys('Esc'), 'keys.esc'],
        [keys('?'), 'keys.help'],
      ])}
      {group('keys.editor', [
        [keys([MOD, 'S']), 'keys.save'],
        [keys('J', 'K'), 'keys.beats'],
        [keys('Enter'), 'keys.inspector'],
      ])}
      {group('keys.player', [
        [keys('Space'), 'keys.playPause'],
        [keys(prev, next), 'keys.prevNext'],
        [keys('Home'), 'keys.restart'],
        [keys('<', '>'), 'keys.speed'],
        [keys('C'), 'keys.captions'],
        [keys('T'), 'keys.transcript'],
        [keys('F'), 'keys.fullscreen'],
        [keys('?'), 'keys.playerHelp'],
      ])}
    </SideSheet>
  );
}
