// The beats on the margin: each beat's number threaded on the red margin line (a diamond for a beat that asks
// questions), its title and teaching move, its problems; the current one on the highlighter. Up and down reorder.
import { dirOf } from '@warqa/i18n';
import type { Issue } from '../../../shared/types';
import { Button, Icon } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { MsgKey } from '../../messages';
import { type Beat, questionsOf } from './shared';

export function moveName(t: ReturnType<typeof useI18n>['t'], move: string | undefined): string {
  return t(`move.${move ?? 'example'}` as MsgKey);
}

export function BeatList({
  beats,
  sel,
  lang,
  issues,
  minutes,
  onSelect,
  onOpen,
  onMove,
  onAdd,
}: {
  beats: Beat[];
  sel: number;
  /** The lesson's language (titles are written in it). */
  lang: string;
  issues: Map<string, Issue[]>;
  /** The lesson's length in minutes, once the stage knows its timings. */
  minutes?: number;
  onSelect: (k: number) => void;
  /** Enter on a beat: its inspector (the side sheet). */
  onOpen: () => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}) {
  const { t, num } = useI18n();
  return (
    <nav className="beat-list" aria-label={t('editor.beatList')}>
      <div className="beat-list-head">
        <h2 className="beat-list-title">{t('editor.beats')}</h2>
        <span className="mono muted small">
          {num(beats.length)}
          {minutes ? ` · ${t('editor.minutesN', { n: minutes })}` : ''}
        </span>
      </div>
      <ol>
        {beats.map((b, k) => {
          const iss = issues.get(b.id) ?? [];
          const errs = iss.filter((x) => x.level === 'error').length;
          const q = questionsOf(b);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: beat ids can repeat while the author edits
            <li key={`${b.id}-${k}`} className={k === sel ? 'is-sel' : ''}>
              <button
                type="button"
                className="beat-btn"
                aria-current={k === sel ? 'true' : undefined}
                onClick={() => onSelect(k)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen();
                }}
              >
                <span className={`beat-n${q ? ' is-q' : ''}`} aria-hidden="true">
                  <span>{num(k + 1)}</span>
                </span>
                <span className="visually-hidden">{t('editor.beatOf', { i: k + 1, n: beats.length })}</span>
                <span className="beat-text">
                  <span className="beat-title" lang={lang} dir={dirOf(lang)}>
                    {b.title}
                  </span>
                  <span className="beat-move">
                    {moveName(t, b.move)}
                    {q ? ` · ${t('editor.questionsN', { n: q })}` : ''}
                  </span>
                </span>
                {iss.length > 0 && (
                  <span
                    className={`badge ${errs ? 'badge-error' : 'badge-warn'}`}
                    title={t('editor.issueBadge', { n: iss.length })}
                  >
                    <span className="visually-hidden">{t('editor.issueBadge', { n: iss.length })}</span>
                    <span aria-hidden="true">{num(iss.length)}</span>
                  </span>
                )}
              </button>
              <span className="beat-order">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={k === 0}
                  aria-label={t('editor.moveUp', { title: b.title })}
                  onClick={() => onMove(k, k - 1)}
                >
                  <Icon name="up" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={k === beats.length - 1}
                  aria-label={t('editor.moveDown', { title: b.title })}
                  onClick={() => onMove(k, k + 1)}
                >
                  <Icon name="down" size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <Button variant="quiet" icon="plus" className="add-beat" onClick={onAdd}>
        {t('editor.addBeat')}
      </Button>
    </nav>
  );
}
