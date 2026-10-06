// Translate & narrate (redesign 4e, the Languages board): one workspace instead of three screens. Every language of
// the book is a card (the original; each translation with how much is translated and how much a person checked; the
// languages not translated yet with what translating costs), each with its voice, a sample and whether it is
// narrated; under the cards, one language's review queue. Translating and narrating run in the tray.
import { dirOf, langInfo } from '@warqa/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobInfo, JobType, LanguageInfo, ProjectDetail, StatusInfo } from '../../shared/types';
import { api, errorText } from '../api';
import { useJobStream, useJobs } from '../components/JobBoard';
import { useToast } from '../components/overlays';
import { Button, Icon, Loading, Notice } from '../components/ui';
import { useI18n } from '../i18n';
import { Link, navigate, useLocation } from '../router';
import { ReviewQueue } from './translate/Queue';

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

const ENGINES: Record<string, string> = {
  edge: 'Edge',
  azure: 'Azure Speech',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  gemini: 'Gemini',
  google: 'Google Cloud',
  worker: 'Warqa helper',
};

/** The job at work on a language (translating or narrating it), if any. */
function jobFor(p: ProjectDetail, type: 'translate' | 'narrate', lang: string): JobInfo | undefined {
  return p.jobs.find(
    (j) =>
      j.type === type &&
      (j.status === 'running' || j.status === 'queued') &&
      (j.args.lang === lang || (Array.isArray(j.args.langs) && (j.args.langs as string[]).includes(lang))),
  );
}

/** "Translating · 2 of 8 chapters": where a running job is, from its events. */
function RunningChip({ job, lang }: { job: JobInfo; lang: string }) {
  const { t } = useI18n();
  const jobs = useJobs();
  const { events } = useJobStream(job.id);
  const starts = events.filter((e) => e.stage === `${job.type}:${lang}` && e.status === 'start');
  const last = starts.at(-1);
  const i = (last?.index ?? 0) + 1;
  const n = last?.total ?? 1;
  return (
    <button type="button" className="status-chip is-running" onClick={() => jobs.show()}>
      <span className="chip-dot" aria-hidden="true" />
      <span aria-live="polite">
        {job.type === 'translate' ? t('voice.translatingChip', { i, n }) : t('voice.narratingChip', { i, n })}
      </span>
    </button>
  );
}

function LanguageCard({
  info,
  p,
  current,
  playing,
  starting,
  onReview,
  onTranslate,
  onNarrate,
  onSample,
}: {
  info: LanguageInfo;
  p: ProjectDetail;
  current: boolean;
  playing: boolean;
  starting: string | null;
  onReview: () => void;
  onTranslate: () => void;
  onNarrate: () => void;
  onSample: () => void;
}) {
  const { t, langName, usd, num } = useI18n();
  const { lang } = info;
  const native = langInfo(lang).name;
  const original = info.role === 'original';
  const todo = !original && info.translated === 0;
  const short = lang === 'ary' ? t('lang.ary.short') : langName(lang);
  const translating = jobFor(p, 'translate', lang);
  const narrating = jobFor(p, 'narrate', lang);
  const v = info.voice;
  const voiceLabel = v.free
    ? t('voice.voiceFree', { voice: v.name, engine: ENGINES[v.engine] ?? v.engine })
    : t('voice.voicePaid', { voice: v.name, engine: ENGINES[v.engine] ?? v.engine });
  const a = info.audio;
  const pct = (x: number) => (info.texts ? Math.round((x / info.texts) * 100) : 0);
  // what translating still has to do (missing texts, or the model's whose original changed)
  // (the model's whose original changed are in the estimate; a person's stay theirs, the queue shows them)
  const tr = info.estimate?.translate;
  const rest = !original && !todo && (info.missing > 0 || (tr !== undefined ? tr > 0 : info.stale > 0));
  const narrateCost = info.estimate?.narrate;
  const id = `lc-${lang}`;
  const chip = original ? (
    <span className="lang-chip is-original">{t('voice.author')}</span>
  ) : todo ? (
    <span className="lang-chip is-todo">{t('voice.notTr')}</span>
  ) : current ? (
    <span className="lang-chip is-current">{t('voice.reviewing')}</span>
  ) : (
    <button type="button" className="link-btn lang-review" onClick={onReview}>
      {t('voice.review')}
    </button>
  );
  const narrateBtn = (label: string) => (
    <Button variant="quiet" busy={starting === `narrate:${lang}`} disabled={!!starting} onClick={onNarrate}>
      {label}
    </Button>
  );
  const narration = (() => {
    if (narrating) return <RunningChip job={narrating} lang={lang} />;
    if (v.engine === 'none') return null;
    if (!v.available)
      return (
        <div className="lang-narr">
          <span className="lang-chip is-desktop">{t('voice.desktopOnly')}</span>
          <span className="muted small">{t('voice.edgeDesktop')}</span>
        </div>
      );
    if (todo) return <p className="lang-narr-text muted">{t('voice.narrateAfter')}</p>;
    const free = v.free ? '' : narrateCost !== undefined ? t('learn.est.cost', { cost: usd(narrateCost) }) : '';
    if (a.changed)
      return (
        <div className="lang-narr">
          <span className="lang-chip is-changed">
            <span className="chip-dot" aria-hidden="true" />
            {t('voice.changedSince', { n: a.changed })}
          </span>
          {narrateBtn(v.free ? t('voice.narrateAgainFree') : t('voice.narrateAgain'))}
          {free && <span className="mono muted small">{free}</span>}
        </div>
      );
    if (a.chapters && a.narrated === a.chapters)
      return (
        <p className="lang-narr-text good">
          <Icon name="check" size={16} />{' '}
          {original
            ? t('voice.narratedMin', { min: num(Math.max(1, Math.round(a.seconds / 60))) })
            : t('voice.narratedAll', { n: a.chapters })}
        </p>
      );
    if (a.narrated)
      return (
        <div className="lang-narr">
          <span className="muted">{t('voice.narratedSome', { k: a.narrated, n: a.chapters })}</span>
          {narrateBtn(v.free ? t('voice.narrateRestFree') : t('voice.narrateRest'))}
          {free && <span className="mono muted small">{free}</span>}
        </div>
      );
    return (
      <div className="lang-narr">
        <span className="muted">{t('voice.notNarrated')}</span>
        {narrateBtn(v.free ? t('voice.narrateFree') : t('voice.narrateNow'))}
        {free && <span className="mono muted small">{free}</span>}
      </div>
    );
  })();
  return (
    <section
      className={`lang-card is-${original ? 'original' : todo ? 'todo' : current ? 'current' : 'translated'}`}
      aria-labelledby={`${id}-h`}
      aria-current={current ? 'true' : undefined}
    >
      <div className="lang-card-head">
        <h3 id={`${id}-h`}>
          <span lang={lang} dir={dirOf(lang)}>
            {native}
          </span>
          <span className="visually-hidden">
            {' '}
            · {original ? t('voice.cardOriginal', { lang: langName(lang) }) : langName(lang)}
          </span>
        </h3>
        {translating ? <RunningChip job={translating} lang={lang} /> : chip}
      </div>
      <p className="lang-card-meta">
        {original
          ? t('voice.writtenFirst', {
              texts: t('voice.texts', { n: info.texts }),
              chapters: t('common.chapters', { n: info.chapters }),
            })
          : todo
            ? lang === 'ary'
              ? t('voice.about.ary')
              : t('voice.about', { lang: langName(lang) })
            : t('voice.trDone', { done: num(info.translated), total: num(info.texts), checked: num(info.checked) })}
      </p>
      {!todo &&
        (original ? (
          <div className="lang-bar is-full" aria-hidden="true">
            <i style={{ inlineSize: '100%' }} />
          </div>
        ) : (
          <div
            className="lang-bar"
            role="img"
            aria-label={
              info.translated === info.texts
                ? t('voice.barAll', { checked: num(info.checked), total: num(info.texts) })
                : t('voice.barSome', { done: num(info.translated), total: num(info.texts), checked: num(info.checked) })
            }
          >
            <i className="is-checked" style={{ inlineSize: `${pct(info.checked)}%` }} />
            <i className="is-translated" style={{ inlineSize: `${pct(info.translated - info.checked)}%` }} />
          </div>
        ))}
      {(todo || rest) && !translating && (
        <div className="lang-card-act">
          <Button
            variant={todo ? 'primary' : 'quiet'}
            busy={starting === `translate:${lang}`}
            disabled={!!starting}
            onClick={onTranslate}
          >
            {todo ? t('voice.translate', { lang: short }) : t('voice.translateRest')}
          </Button>
          {!!tr && <span className="card-meta">{t('learn.est.cost', { cost: usd(Math.max(tr, 0.001)) })}</span>}
        </div>
      )}
      {v.engine === 'none' ? (
        <div className="lang-voice">
          <p className="lang-voice-row">
            <Icon name="voice" size={20} />
            <span className="lang-voice-name">{t('voice.noVoice')}</span>
            <Link to={`/ai?book=${encodeURIComponent(p.id)}#voices`}>{t('learn.setup.change')}</Link>
          </p>
        </div>
      ) : (
        <div className="lang-voice">
          <div className="lang-voice-row">
            <Icon name="voice" size={20} />
            <span className="lang-voice-name">
              <bdi>{voiceLabel}</bdi>
            </span>
            {v.sample && (
              <button
                type="button"
                className="lang-sample"
                aria-label={playing ? t('voice.samplePause') : t('voice.sample', { voice: v.name })}
                onClick={onSample}
              >
                <Icon name={playing ? 'pause' : 'play'} size={18} />
              </button>
            )}
          </div>
          {narration}
        </div>
      )}
    </section>
  );
}

export function LanguagesStep({
  p,
  status,
  run,
  reload,
}: {
  p: ProjectDetail;
  status: StatusInfo | null;
  run: Run;
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const jobs = useJobs();
  const toast = useToast();
  const { query } = useLocation();
  const [langs, setLangs] = useState<LanguageInfo[] | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  void status;

  const load = useCallback(async () => {
    try {
      setLangs((await api.languages(p.id)).languages);
      setError('');
    } catch (e) {
      setError(errorText(e, tRef.current));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);
  // a row checked in the queue: the cards' counts follow once the person pauses (not after every click)
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useCallback(() => {
    if (later.current) clearTimeout(later.current);
    later.current = setTimeout(() => void load(), 800);
  }, [load]);
  useEffect(
    () => () => {
      if (later.current) clearTimeout(later.current);
    },
    [],
  );
  // a translation or a recording ends: the cards (and the book) catch up
  useEffect(
    () =>
      jobs.onEnd(p.id, (job) => {
        if (job.type === 'translate' || job.type === 'narrate') void Promise.all([load(), reload()]);
      }),
    [jobs, p.id, load, reload],
  );
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  const translations = useMemo(() => (langs ?? []).filter((l) => l.role === 'translation'), [langs]);
  const asked = query.get('lang') ?? '';
  const lang =
    translations.find((l) => l.lang === asked)?.lang ??
    translations.find((l) => l.translated > 0)?.lang ??
    translations[0]?.lang ??
    '';
  const chapter = query.get('chapter') ?? '';
  const go = (next: { lang?: string; chapter?: string }) => {
    const q = new URLSearchParams({ step: 'voice' });
    const l = next.lang ?? lang;
    const c = next.chapter ?? (next.lang && next.lang !== lang ? '' : chapter);
    if (l) q.set('lang', l);
    if (c) q.set('chapter', c);
    navigate(`/project/${encodeURIComponent(p.id)}?${q}`, { replace: true });
  };

  const start = async (key: string, type: 'translate' | 'narrate', args: Record<string, unknown>) => {
    if (starting) return;
    setStarting(key);
    try {
      await run(type, args);
    } finally {
      setStarting(null);
    }
  };
  const sample = (l: string) => {
    if (playing === l) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(api.voiceSampleUrl(p.id, l));
    audio.current = el;
    // a sample that cannot play says so (an engine down, nothing recorded yet)
    const failed = () => {
      setPlaying(null);
      toast({ text: t('voice.sampleFailed'), tone: 'error' });
    };
    el.onended = () => setPlaying(null);
    el.onerror = failed;
    setPlaying(l);
    void el.play().catch(failed);
  };

  const head = (
    <header className="lang-head">
      <h2 id="voice-title" className="card-title">
        {t('step.voice')}
      </h2>
      <div role="note" className="lang-note">
        <Icon name="locked" size={20} />
        <p>{t('voice.note')}</p>
      </div>
    </header>
  );
  if (!p.lessons.length)
    return (
      <div className="lang-step">
        {head}
        <div className="sheet make-empty">
          <p className="hint">{t('voice.noLessons')}</p>
          <Link className="btn btn-primary" to={`/project/${encodeURIComponent(p.id)}?step=make`}>
            <span>{t('step.make')}</span>
            <Icon name="next" className="flip-rtl" />
          </Link>
        </div>
      </div>
    );

  return (
    <div className="lang-step">
      {head}
      {error && <Notice tone="error">{error}</Notice>}
      {!langs ? (
        <Loading />
      ) : (
        <>
          <div className="lang-cards">
            {langs.map((l) => (
              <LanguageCard
                key={l.lang}
                info={l}
                p={p}
                current={l.lang === lang}
                playing={playing === l.lang}
                starting={starting}
                onReview={() => {
                  go({ lang: l.lang });
                  requestAnimationFrame(() => document.getElementById('rv-title')?.focus());
                }}
                onTranslate={() =>
                  void start(`translate:${l.lang}`, 'translate', {
                    lang: l.lang,
                    chapters: p.lessons.map((x) => x.id),
                  })
                }
                onNarrate={() => void start(`narrate:${l.lang}`, 'narrate', { lang: l.lang })}
                onSample={() => sample(l.lang)}
              />
            ))}
          </div>
          {!translations.length ? (
            <Notice>{t('review.noLangs')}</Notice>
          ) : (
            lang && (
              <ReviewQueue
                key={lang}
                id={p.id}
                lang={lang}
                chapter={chapter}
                onChapter={(c) => go({ chapter: c })}
                run={run}
                onChanged={changed}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
