// The editor's stage: the lesson's own player draws the beat being edited (the stage alone, 16:9), and Lift:
// "Preview" grows that same player to the whole window with its bar, from where the stage sits; Close or Esc puts
// it back on the beat it reached.
import {
  forwardRef,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { api, errorText } from '../../api';
import { trapTab, useEscape } from '../../components/tools';
import { Button, Notice } from '../../components/ui';
import { useI18n } from '../../i18n';
import { loadPacks, loadPlayer, type WarqaPlayer } from '../../player';
import type { Timings } from './shared';

export interface StageHandle {
  /** Grow the stage into the full-window preview, from the beat being edited. */
  lift(): void;
}

/** A motion token's value in ms ("400ms"), 0 when unset. */
const ms = (name: string): number => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.endsWith('ms') ? Number.parseFloat(v) : v.endsWith('s') ? Number.parseFloat(v) * 1000 : 0;
};
const ease = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const Stage = forwardRef<
  StageHandle,
  {
    id: string;
    lid: string;
    /** The rating mode files ratings under the book (the kit) and the lesson (its code). */
    bookId: string;
    lang: string;
    /** The beat being edited (its index). */
    beat: number;
    reloadKey: number;
    stale: boolean;
    /** The figure's name ("Preview of beat 3 with its marks"). */
    label: string;
    /** What the lifted preview's strip names: "Chapter 5", else the lesson's title. */
    strip: string;
    langName: string;
    playerRef: MutableRefObject<WarqaPlayer | null>;
    /** The player went to another beat (played on, or in the lifted preview). */
    onBeat: (i: number) => void;
    /**
     * The player's timings for each language (synthetic where there is no audio) and its narration files by language
     * and beat: the clock, the marks' timeline and Listen use them.
     */
    onData?: (d: { timings: Timings; audio: Record<string, Record<string, string>> }) => void;
    /** A beat's new version to show instead of the saved one (Compare, "After"). */
    candidate?: string | undefined;
    /** The stage and what is under it (the marks' timeline): the threads are drawn over both. */
    zoneRef?: RefObject<HTMLDivElement | null>;
    /** Under the stage (the marks' timeline). */
    below?: ReactNode;
    /** Over the stage and what is under it (the threads). */
    overlay?: ReactNode;
    /** Over the stage alone (the judge's note, a beat being written). */
    children?: ReactNode;
  }
>(function Stage(
  {
    id,
    lid,
    bookId,
    lang,
    beat,
    reloadKey,
    stale,
    label,
    strip,
    langName,
    playerRef,
    onBeat,
    onData,
    candidate,
    zoneRef,
    below,
    overlay,
    children,
  },
  ref,
) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [rating, setRating] = useState(false);
  const [lifted, setLifted] = useState(false);
  // the stage's box before a Lift (or its lifted box before closing): the frame grows from it (FLIP)
  const from = useRef<DOMRect | null>(null);
  const beatRef = useRef(beat);
  beatRef.current = beat;
  const langRef = useRef(lang);
  langRef.current = lang;
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const tRef = useRef(t);
  tRef.current = t;
  // the player reports its first beat while it starts: only beats it reaches afterwards are news
  const live = useRef(false);

  const close = () => {
    from.current = frame.current?.getBoundingClientRect() ?? null;
    setLifted(false);
  };
  useImperativeHandle(ref, () => ({
    lift: () => {
      from.current = frame.current?.getBoundingClientRect() ?? null;
      setLifted(true);
    },
  }));
  useEscape(lifted, close);

  // lifted, it covers the window: the focus moves to Close and Tab stays inside; closing gives it back
  const wasLifted = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (lifted) el?.querySelector<HTMLElement>('.lift-strip .lift-close')?.focus();
    else if (wasLifted.current) document.querySelector<HTMLElement>('.lift-btn')?.focus();
    wasLifted.current = lifted;
    if (!lifted || !el) return;
    const trap = (e: KeyboardEvent) => trapTab(e, el);
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, [lifted]);

  // Lift: the bar comes with the full window; the stage grows from its box, or shrinks back into it
  useLayoutEffect(() => {
    const p = playerRef.current;
    p?.setBare(!lifted);
    if (!lifted) p?.pause();
    // a beat resting in the editor is previewed from its start
    else if (p?.resting) p.seek(p.i, false);
    const el = frame.current;
    const f = from.current;
    from.current = null;
    if (!el || !f) return;
    const l = el.getBoundingClientRect();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !l.width || !l.height) {
      el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120, easing: 'linear' });
      return;
    }
    const k = lifted ? 1 : 0.7;
    el.animate(
      [
        {
          transformOrigin: '0 0',
          transform: `translate(${f.left - l.left}px, ${f.top - l.top}px) scale(${f.width / l.width}, ${f.height / l.height})`,
        },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      {
        duration: ms('--wq-t-tray') * k || 400 * k,
        easing: lifted
          ? ease('--wq-ease-settle', 'cubic-bezier(.2,.8,.2,1)')
          : ease('--wq-ease-lift', 'cubic-bezier(.4,0,1,1)'),
      },
    );
  }, [lifted, playerRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey remounts the player after a save
  useEffect(() => {
    let cancelled = false;
    let mounted: WarqaPlayer | null = null;
    live.current = false;
    setError('');
    setReady(false);
    (async () => {
      try {
        const W = await loadPlayer();
        const data = (await api.playerData(id, lid, langRef.current, candidate)) as {
          lesson: { beats: { id: string }[] };
          packs?: string[];
          panel?: { kit: string; code: string };
          timings?: Timings;
          audio?: Record<string, Record<string, string>>;
        };
        // the book's own components (packs) must be registered before the player draws them
        if (data.packs?.length) await loadPacks(W, data.packs);
        if (rating) data.panel = { kit: bookId, code: lid };
        if (cancelled || !host.current) return;
        host.current.replaceChildren();
        mounted = await W.mount(host.current, data, {
          storage: false,
          keyboard: 'local',
          head: false,
          bare: !wasLifted.current,
          onEvent: (e) => {
            if (live.current && e.type === 'beat' && typeof e.index === 'number') onBeatRef.current(e.index);
          },
        });
        if (cancelled) {
          mounted.destroy();
          return;
        }
        playerRef.current = mounted;
        onDataRef.current?.({ timings: data.timings ?? {}, audio: data.audio ?? {} });
        mounted.showAt(Math.min(beatRef.current, data.lesson.beats.length - 1));
        live.current = true;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(errorText(e, tRef.current));
      }
    })();
    return () => {
      cancelled = true;
      mounted?.destroy();
      playerRef.current = null;
    };
  }, [id, lid, reloadKey, rating, candidate]);

  // another beat chosen in the editor: the stage draws it, at its end (everything it shows)
  useEffect(() => {
    const p = playerRef.current;
    if (ready && p && p.i !== beat) p.showAt(beat);
  }, [beat, ready, playerRef]);

  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    p.setLang(lang);
    if (!p.playing) p.showAt(beatRef.current);
  }, [lang, ready, playerRef]);

  return (
    <section
      ref={box}
      className={`stage-box${lifted ? ' is-lifted' : ''}`}
      // lifted, it covers the page: a modal dialog for assistive technology too
      {...(lifted ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'lift-title' } : { 'aria-label': label })}
    >
      {lifted && (
        <div className="lift-strip">
          <span className="lift-strip-text" id="lift-title">
            <strong>{t('editor.preview')}</strong> · <bdi>{strip}</bdi> · {langName}
          </span>
          <label className="check lift-rating" title={t('editor.ratingHint')}>
            <input type="checkbox" checked={rating} onChange={(e) => setRating(e.target.checked)} />
            <span>{t('editor.rating')}</span>
          </label>
          <Button icon="close" className="lift-close" onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      )}
      <div className="stage-zone" ref={zoneRef}>
        <div className="stage-frame" ref={frame}>
          <div className="stage-host" ref={host} />
          {!lifted && children}
        </div>
        {!lifted && below}
        {!lifted && overlay}
      </div>
      {!lifted && stale && <p className="preview-stale">{t('editor.previewStale')}</p>}
      {error && <Notice tone="error">{t('editor.previewFailed', { error })}</Notice>}
    </section>
  );
});
