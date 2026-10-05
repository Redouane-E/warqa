// Learning on your own: the setup (a PDF, the language and the level, an AI service if none is connected, then
// "Teach me" with the time and cost said first), the one go (read, plan, write chapter 1, voice) with its live
// progress, the chapter in the player with the learner's finish card, and What I'm learning.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAKE_PROVIDER, type GuideProvider } from '../../shared/providers';
import type { JobEvent, JobInfo, LearnEstimateInfo, LearnLevel, PlanChapter, ProjectDetail } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, type ProjectListItem } from '../api';
import { BASE, stripBase } from '../base';
import { useJobStream } from '../components/JobBoard';
import { Button, Icon, Loading, Mark, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { passPdf, takePdf } from '../handoff';
import { type I18n, makeI18n, UI_LANGS, type UiLang, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { type LessonPlace, useSetPlace } from '../place';
import { loadPacks, loadPlayer, type WarqaPlayer } from '../player';
import { Link, navigate, useLocation } from '../router';
import { bookTitle } from './Home';
import { KeyStep, PdfDrop } from './Welcome';

const LEVELS: LearnLevel[] = ['beginner', 'some', 'advanced'];
const LANGS = ['ar', 'ary', 'fr', 'en'] as const;
/** Each language under its own name, in every interface language. */
const NATIVE: Record<string, string> = { ar: 'العربية', ary: 'الدارجة', fr: 'Français', en: 'English' };
const ROLES = ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'];
const levelName = (t: I18n['t'], l: LearnLevel | undefined) => t(`learn.level.${l ?? 'beginner'}` as MsgKey);
const live = (j: JobInfo) => j.status === 'running' || j.status === 'queued';

/** What a run was estimated at when it started (the one-go screen shows it next to what is spent). */
const started = new Map<string, LearnEstimateInfo>();

/** "About 3 minutes · about $0.03 · your limit $1.00" */
function estimateParts(e: LearnEstimateInfo, i18n: I18n): string[] {
  const { t, usd } = i18n;
  return [
    t('learn.est.minutes', { n: Math.max(1, Math.round(e.seconds / 60)) }),
    e.usd.p50 > 0 ? t('learn.est.cost', { cost: usd(e.usd.p50) }) : t('learn.est.free'),
    ...(e.limit !== undefined ? [t('learn.est.limit', { limit: usd(e.limit) })] : []),
  ];
}

function Estimate({ e }: { e: LearnEstimateInfo }) {
  const i18n = useI18n();
  const parts = estimateParts(e, i18n);
  return (
    <p className="learn-estimate">
      <Icon name="speed" size={18} />
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

/** Arrow keys move the focus between the cards of a choice (a tap or Enter chooses). */
function arrowsBetween(e: React.KeyboardEvent<HTMLElement>) {
  const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowRight: 1, ArrowLeft: -1 };
  let d = keys[e.key];
  if (!d) return;
  // reading order: in right-to-left, the left arrow moves forward
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && getComputedStyle(e.currentTarget).direction === 'rtl')
    d = -d;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = cards.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  cards[(i + d + cards.length) % cards.length]?.focus();
}

/** The three bars of a level: one, two or three filled. */
function LevelBars({ n }: { n: number }) {
  return (
    <span className="level-bars" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

const chapterTitle = (c: Pick<PlanChapter, 'title'> | undefined) => c?.title ?? '';
/** The interface language closest to a lesson's (the studio speaks en, fr and ar; Darija reads the Arabic). */
const levelLang = (l: string): UiLang => (l === 'ary' ? 'ar' : UI_LANGS.includes(l as UiLang) ? (l as UiLang) : 'en');
const included = (p: ProjectDetail | null) => p?.plan?.chapters.filter((c) => c.include) ?? [];

/* ---------- the setup: /learn/new ---------- */

type SetupStep = 'pdf' | 'lang' | 'level' | 'connect' | 'start';

export function LearnNewPage() {
  const i18n = useI18n();
  const { t, lang: ui, langName, bytes } = i18n;
  const { guide } = useExtras();
  const fake = guide?.fakeModel;
  const [step, setStep] = useState<SetupStep>('pdf');
  const [file, setFile] = useState<File | null>(() => takePdf());
  const [id, setId] = useState('');
  const [est, setEst] = useState<LearnEstimateInfo | null>(null);
  const [lang, setLang] = useState<string>('');
  const [level, setLevel] = useState<LearnLevel | null>(null);
  const [needsAi, setNeedsAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<GuideProvider | null>(fake ? FAKE_PROVIDER : null);
  const [keyReady, setKeyReady] = useState(false);
  const steps: SetupStep[] = ['pdf', 'lang', 'level', ...(needsAi ? (['connect'] as const) : []), 'start'];
  const n = steps.indexOf(step);
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(advance.current), []);
  // a new question: the focus goes to its heading (the cards of the last one are gone)
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each new step
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    bodyRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [step]);

  /** The estimate (it also reads the PDF's text, free, the first time): no AI service yet → the connect step. */
  const estimate = useCallback(async (book: string) => {
    const e = await api.learnEstimate(book);
    setEst(e);
    setNeedsAi(!!e.error);
    return e;
  }, []);

  // leaving the PDF step: the book is made (named after the file) and its text read, to know its language
  const openPdf = async () => {
    if (!file) return;
    if (id) return setStep('lang');
    setBusy(true);
    setError('');
    try {
      const first = LANGS.includes(ui as (typeof LANGS)[number]) ? ui : 'en';
      const form = new FormData();
      form.set('pdf', file);
      form.set(
        'title',
        file.name
          .replace(/\.pdf$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
      );
      form.set('langs', first);
      form.set('defaultLang', first);
      const p = await api.createProject(form);
      await api.saveSettings(p.id, {
        budget: { usd: 1 },
        ...(fake ? { models: Object.fromEntries(ROLES.map((r) => [r, fake])) } : {}),
      });
      setId(p.id);
      await estimate(p.id);
      setStep('lang');
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  const pickLang = async (l: string) => {
    setLang(l);
    setError('');
    try {
      await api.saveSettings(id, { langs: [l], defaultLang: l });
    } catch (e) {
      setError(errorText(e, t));
      return;
    }
    clearTimeout(advance.current);
    advance.current = setTimeout(() => setStep('level'), 280);
  };

  const pickLevel = (l: LearnLevel) => {
    setLevel(l);
    clearTimeout(advance.current);
    advance.current = setTimeout(() => void toStart(), 280);
  };

  const toStart = async () => {
    setBusy(true);
    setError('');
    try {
      const e = await estimate(id);
      setStep(e.error ? 'connect' : 'start');
    } catch (err) {
      setError(errorText(err, t));
    }
    setBusy(false);
  };

  // a key checked in the connect step: this book uses that provider's ready-made models
  useEffect(() => {
    if (step !== 'connect' || !keyReady || !provider || !id) return;
    void (async () => {
      try {
        await api.saveSettings(id, {
          ...(provider.id === 'fake' && fake
            ? { models: Object.fromEntries(ROLES.map((r) => [r, fake])) }
            : provider.preset
              ? { preset: provider.preset }
              : {}),
        });
        const e = await estimate(id);
        if (e.error) setError(e.error);
        else setStep('start');
      } catch (err) {
        setError(errorText(err, t));
      }
    })();
  }, [keyReady, provider, step, id, fake, estimate, t]);

  const teach = async () => {
    if (!level || !est) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.startJob(id, 'learn', { level });
      started.set(id, est);
      navigate(`/learn/${encodeURIComponent(id)}?job=${encodeURIComponent(r.job.id)}`);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  const src = est?.sourceLang;
  const canNext = step === 'pdf' ? !!file : step === 'lang' ? !!lang : step === 'level' ? !!level : false;
  const next = () => {
    if (step === 'pdf') void openPdf();
    else if (step === 'lang') setStep('level');
    else if (step === 'level') void toStart();
  };

  let body: ReactNode;
  if (step === 'pdf')
    body = (
      <>
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.pdfTitle')}
        </h1>
        <p className="lede">{t('learn.setup.pdfSub')}</p>
        {file ? (
          <div className="learn-file">
            <span className="learn-file-icon" aria-hidden="true">
              <Icon name="file" size={26} />
            </span>
            <span className="learn-file-text">
              <bdi className="learn-file-name">{file.name}</bdi>
              <span className="learn-file-meta">
                {est?.pages
                  ? [
                      t('learn.setup.pages', { n: est.pages }),
                      src ? t('learn.setup.writtenIn', { lang: langName(src) }) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : bytes(file.size)}
              </span>
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setFile(null);
                setId('');
                setEst(null);
              }}
            >
              {t('learn.setup.change')}
            </button>
          </div>
        ) : (
          <PdfDrop
            className="learn-drop"
            title={t('learn.setup.drop')}
            hint={t('learn.setup.choose')}
            onFile={setFile}
          />
        )}
        <p className="note" role="note">
          <Icon name="info" size={18} /> {t('pdf.copyright')}
        </p>
      </>
    );
  else if (step === 'lang')
    body = (
      <>
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.langTitle')}
        </h1>
        <p className="lede">{src ? t('learn.setup.langSubKnown', { src: langName(src) }) : t('learn.setup.langSub')}</p>
        <div
          className="choice-grid choice-langs"
          role="radiogroup"
          aria-label={t('learn.setup.langTitle')}
          onKeyDown={arrowsBetween}
        >
          {LANGS.map((l) => (
            // biome-ignore lint/a11y/useSemanticElements: a large choice card (a radio with a description)
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              className={`choice-card ${lang === l ? 'is-on' : ''}`}
              onClick={() => void pickLang(l)}
            >
              <span className="choice-name" lang={l} dir={l === 'ar' || l === 'ary' ? 'rtl' : 'ltr'}>
                {NATIVE[l]}
              </span>
              <span className="choice-sub">{src === l ? t('learn.lang.same') : t(`learn.lang.${l}` as MsgKey)}</span>
            </button>
          ))}
        </div>
        {src && lang && (
          <p className="note" role="status">
            <Icon name="language" size={18} />{' '}
            {src === lang
              ? t('learn.setup.noteSame', { src: langName(src) })
              : t('learn.setup.note', { src: langName(src), lang: langName(lang) })}
          </p>
        )}
      </>
    );
  else if (step === 'level')
    body = (
      <>
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.levelTitle')}
        </h1>
        <p className="lede">{t('learn.setup.levelSub')}</p>
        <div
          className="choice-grid choice-levels"
          role="radiogroup"
          aria-label={t('learn.setup.levelTitle')}
          onKeyDown={arrowsBetween}
        >
          {LEVELS.map((l, i) => (
            // biome-ignore lint/a11y/useSemanticElements: a large choice card (a radio with a description)
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={level === l}
              className={`choice-card ${level === l ? 'is-on' : ''}`}
              onClick={() => pickLevel(l)}
            >
              <LevelBars n={i + 1} />
              <span className="choice-name">{levelName(t, l)}</span>
              <span className="choice-sub">{t(`learn.level.${l}Sub` as MsgKey)}</span>
            </button>
          ))}
        </div>
      </>
    );
  else if (step === 'connect')
    body = (
      <>
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.connTitle')}
        </h1>
        <p className="lede">{t('learn.setup.connSub')}</p>
        <KeyStep fake={!!fake} provider={provider} setProvider={setProvider} ready={keyReady} setReady={setKeyReady} />
      </>
    );
  else
    body = (
      <>
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.sumTitle')}
        </h1>
        <dl className="learn-summary">
          <div>
            <dt>{t('learn.setup.sumFile')}</dt>
            <dd>
              <bdi>{file?.name}</bdi>
              <button type="button" className="link-btn" onClick={() => setStep('pdf')}>
                {t('learn.setup.change')}
              </button>
            </dd>
          </div>
          <div>
            <dt>{t('learn.setup.sumLang')}</dt>
            <dd>
              <span lang={lang}>{NATIVE[lang] ?? langName(lang)}</span>
              <button type="button" className="link-btn" onClick={() => setStep('lang')}>
                {t('learn.setup.change')}
              </button>
            </dd>
          </div>
          <div>
            <dt>{t('learn.setup.sumLevel')}</dt>
            <dd>
              <span>{levelName(t, level ?? undefined)}</span>
              <button type="button" className="link-btn" onClick={() => setStep('level')}>
                {t('learn.setup.change')}
              </button>
            </dd>
          </div>
        </dl>
        {est && !est.error && <Estimate e={est} />}
        <p className="learn-what">{t('learn.setup.what')}</p>
        <Button
          variant="primary"
          className="teach-me"
          busy={busy}
          disabled={busy || !est || !!est.error}
          onClick={() => void teach()}
        >
          <Mark size={22} />
          {t('learn.setup.teachMe')}
        </Button>
        <div className="learn-start-foot">
          <span className="hint">{t('learn.setup.stopNote')}</span>
          <Link className="learn-plan-link" to={`/project/${encodeURIComponent(id)}?step=plan`}>
            {t('learn.setup.reviewPlan')}
          </Link>
        </div>
      </>
    );

  return (
    <div className="page learn-page">
      <section className="learn-card sheet" aria-labelledby="learn-step">
        <div className="learn-top">
          <span className="learn-mode">
            <Icon name="book" size={16} /> {t('learn.use.self')}
          </span>
          <p className="welcome-step" id="learn-step">
            {t('learn.setup.stepOf', { i: n + 1, n: steps.length })}
            <span className="welcome-dots" aria-hidden="true">
              {steps.map((s, i) => (
                <i key={s} className={i < n ? 'on' : i === n ? 'now' : ''} />
              ))}
            </span>
          </p>
        </div>
        <div className="learn-body" key={step} ref={bodyRef}>
          {body}
        </div>
        {busy && step !== 'start' && (
          <p className="loading" role="status">
            <span className="spinner" aria-hidden="true" />{' '}
            {step === 'pdf' ? t('learn.setup.opening') : t('common.loading')}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="welcome-actions">
          <Button
            variant="quiet"
            icon="back"
            disabled={busy}
            onClick={() => (n > 0 ? setStep(steps[n - 1]!) : navigate('/learn'))}
          >
            {t('ob.back')}
          </Button>
          {step !== 'start' && step !== 'connect' && (
            <Button variant="primary" disabled={!canNext || busy} onClick={next}>
              {t('ob.next')}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------- the one go: /learn/:id ---------- */

interface Progress {
  stage: 'read' | 'chapters' | 'write' | 'voice' | 'open';
  beats: { i: number; title: string; question?: boolean }[];
  beat?: { i: number; n: number };
  usd: number;
  voice: 'none' | 'running' | 'done' | 'skipped';
  result?: { chapter: string };
}

function progressOf(events: JobEvent[], status: string | undefined): Progress {
  const p: Progress = { stage: 'read', beats: [], usd: 0, voice: 'none' };
  for (const e of events) {
    if (typeof e.usd === 'number') p.usd = e.usd;
    if (e.kind === 'result') p.result = e.result as { chapter: string };
    if (e.kind !== 'progress' || !e.stage) continue;
    if (e.stage === 'plan') p.stage = e.status === 'done' || e.status === 'skip' ? 'write' : 'chapters';
    else if (e.stage === 'storyboard' || e.stage === 'write') {
      p.stage = 'write';
      if (e.stage === 'write' && e.status === 'beat' && typeof e.index === 'number') {
        p.beat = { i: e.index + 1, n: e.total ?? 0 };
        if (!p.beats.some((b) => b.i === e.index! + 1)) p.beats.push({ i: e.index + 1, title: e.detail ?? '' });
      }
    } else if (e.stage.startsWith('narrate')) {
      p.stage = 'voice';
      p.voice = e.status === 'done' ? 'done' : 'running';
    } else if (e.stage !== 'read' && p.stage === 'read') p.stage = 'chapters';
  }
  p.beats.sort((a, b) => a.i - b.i);
  if (status === 'done') {
    p.stage = 'open';
    if (p.voice === 'none') p.voice = 'skipped';
  }
  return p;
}

function Making({ p, jobId, onJob }: { p: ProjectDetail; jobId: string; onJob: (id: string) => void }) {
  const i18n = useI18n();
  const { t, usd, langName } = i18n;
  const { status } = useStatus();
  const [book, setBook] = useState(p);
  const [error, setError] = useState('');
  const [cont, setCont] = useState<LearnEstimateInfo | null>(null);
  const [now, setNow] = useState(Date.now());
  const est = started.get(p.id);
  const first = !p.lessons.length;
  const id = p.id;
  const { events, info, lost } = useJobStream(jobId);
  const prog = useMemo(() => progressOf(events, info?.status), [events, info?.status]);
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(h);
  }, []);
  // the chapters, once the plan is made
  const planned = prog.stage !== 'read' && prog.stage !== 'chapters';
  useEffect(() => {
    if (!planned) return;
    api
      .project(id)
      .then(setBook)
      .catch(() => {});
  }, [planned, id]);
  // done: chapter 1 lifts open in the player
  useEffect(() => {
    if (info?.status !== 'done' || !prog.result) return;
    // the chapter replaces this screen in the history: Back does not come back to a finished run
    const h = setTimeout(
      () =>
        navigate(`/learn/${encodeURIComponent(id)}/${encodeURIComponent(prog.result!.chapter)}?play=1`, {
          replace: true,
        }),
      600,
    );
    return () => clearTimeout(h);
  }, [info?.status, prog.result, id]);

  const chapters = included(book);
  const target =
    prog.result?.chapter ?? est?.chapter ?? chapters.find((c) => !book.lessons.some((l) => l.id === c.id))?.id;
  const k = Math.max(1, chapters.findIndex((c) => c.id === target) + 1);
  const title = bookTitle(p.title, i18n.lang, p.defaultLang);
  // stopped, or gone (a server that restarted forgot the job): either way Continue is offered
  const stopped = info?.status === 'cancelled' || (lost && !info);
  const failed = info?.status === 'error';
  // what is left to pay, before Continue can be pressed
  const [contError, setContError] = useState(false);
  useEffect(() => {
    if (!stopped && !failed) return;
    api
      .learnEstimate(id)
      .then((e) => (e.error ? setContError(true) : setCont(e)))
      .catch(() => setContError(true));
  }, [stopped, failed, id]);
  const startedAt = info?.started ?? info?.created ?? now;
  const left = est ? Math.round((est.seconds * 1000 - (now - startedAt)) / 60000) : undefined;
  const leftText =
    info?.status === 'done'
      ? t('learn.making.ready')
      : left === undefined
        ? ''
        : left >= 1
          ? t('learn.making.left', { n: left })
          : t('learn.making.almost');

  const stages: { key: Progress['stage']; label: string; sub: string }[] = [
    {
      key: 'read',
      label: t('learn.making.read'),
      sub: p.document?.pages || est?.pages ? t('learn.setup.pages', { n: p.document?.pages || est?.pages || 0 }) : '',
    },
    {
      key: 'chapters',
      label: t('learn.making.chapters'),
      sub: chapters.length ? t('learn.making.chapterCount', { n: chapters.length }) : '',
    },
    {
      key: 'write',
      label: t('learn.making.write', { n: k }),
      sub: prog.beat?.n ? t('learn.making.beatOf', { i: prog.beat.i, n: prog.beat.n }) : '',
    },
    {
      key: 'voice',
      label: t('learn.making.voice'),
      sub: prog.voice === 'skipped' ? t('learn.making.noVoice') : t('learn.making.readAlong'),
    },
    { key: 'open', label: t('learn.making.open', { n: k }), sub: t('learn.making.opensItself') },
  ];
  const order = stages.map((s) => s.key);
  const at = order.indexOf(prog.stage);

  const again = async () => {
    setError('');
    try {
      const e = cont;
      if (!e) return;
      // the book keeps its level (it may have moved with "How was this chapter?")
      const r = await api.startJob(id, 'learn', {});
      started.set(id, e);
      setCont(null);
      setContError(false);
      onJob(r.job.id);
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  return (
    <div className="page learn-making">
      <header className="making-head">
        <div>
          <p className="kicker">
            <bdi>{title}</bdi> ·{' '}
            {t('learn.making.kicker', {
              lang: langName(p.defaultLang),
              level: levelName(t, p.book.learn?.level),
            })}
          </p>
          <h1 className="display">{first ? t('learn.making.title') : t('learn.making.titleN', { n: k })}</h1>
        </div>
        {leftText && !stopped && !failed && (
          <p className="making-left" role="status">
            <Icon name="speed" size={20} /> {leftText}
          </p>
        )}
      </header>
      <div className="making-cols">
        <section className="making-card sheet" aria-labelledby="making-stages">
          <h2 id="making-stages" className="visually-hidden">
            {first ? t('learn.making.title') : t('learn.making.titleN', { n: k })}
          </h2>
          <ol className="making-stages" aria-live="polite">
            {stages.map((s, i) => {
              const state =
                i < at || info?.status === 'done' ? 'done' : i === at && !stopped && !failed ? 'now' : 'todo';
              return (
                <li
                  key={s.key}
                  className={`making-stage is-${state}`}
                  aria-current={state === 'now' ? 'step' : undefined}
                >
                  <span className="making-dot" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  <span className="making-label">{s.label}</span>
                  <span className="making-sub">
                    {state === 'now' && <span className="run-dot" aria-hidden="true" />}
                    {s.sub}
                    {state === 'done' && s.key !== 'open' && s.sub ? ` · ${t('learn.making.done')}` : ''}
                  </span>
                  {s.key === 'write' && state === 'now' && prog.beat?.n ? (
                    <span
                      className="bar making-bar"
                      role="progressbar"
                      aria-label={s.label}
                      aria-valuemin={0}
                      aria-valuemax={prog.beat.n}
                      aria-valuenow={prog.beat.i}
                    >
                      <span style={{ inlineSize: `${Math.round((prog.beat.i * 100) / prog.beat.n)}%` }} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="making-foot">
            <p className="making-spent">
              <span className="mono">{t('learn.making.spent', { spent: usd(prog.usd) })}</span>
              {est && est.usd.p50 > 0 && (
                <span className="muted"> · {t('learn.est.cost', { cost: usd(est.usd.p50) })}</span>
              )}
              {est?.limit !== undefined && (
                <span className="muted"> · {t('learn.est.limit', { limit: usd(est.limit) })}</span>
              )}
            </p>
            {status?.capabilities?.platform === 'browser' && !stopped && !failed && info?.status !== 'done' && (
              <p className="note">
                <Icon name="info" size={18} /> {t('learn.making.keepOpen')}
              </p>
            )}
            {failed && (
              <Notice tone="error">
                {t('learn.making.failed')}: <bdi>{info?.error}</bdi>
              </Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {stopped || failed ? (
              <div className="making-stopped">
                {stopped && <p>{t('learn.making.stopped')}</p>}
                {contError && <Notice tone="warn">{t('learn.setup.noAi')}</Notice>}
                <Button variant="primary" icon="play" disabled={!cont} onClick={() => void again()}>
                  {cont && cont.usd.p50 > 0
                    ? t('learn.making.continue', { cost: usd(cont.usd.p50) })
                    : t('learn.making.continueFree')}
                </Button>
              </div>
            ) : (
              info?.status !== 'done' && (
                <div className="making-stop">
                  <Button icon="stop" onClick={() => void api.cancelJob(jobId)}>
                    {t('learn.making.stop')}
                  </Button>
                  <span className="hint">{t('learn.making.stopNote')}</span>
                </div>
              )
            )}
          </div>
        </section>
        <div className="making-side">
          <section className="making-panel sheet" aria-labelledby="making-found">
            <h2 id="making-found">
              {t('learn.making.found')}
              {chapters.length > 0 && (
                <span className="mono muted"> {t('learn.making.chapterCount', { n: chapters.length })}</span>
              )}
            </h2>
            {chapters.length ? (
              <ol className="found-list" lang={p.defaultLang} dir="auto">
                {chapters.map((c, i) => {
                  const made = book.lessons.some((l) => l.id === c.id);
                  return (
                    <li key={c.id} className={c.id === target ? 'is-now' : ''}>
                      <span className="mono">{i + 1}</span>
                      <bdi className="found-title">{chapterTitle(c)}</bdi>
                      <span className={`found-chip ${c.id === target ? 'is-now' : ''}`}>
                        {c.id === target
                          ? t('learn.making.now')
                          : made
                            ? t('learn.home.rowReady')
                            : t('learn.making.later')}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted">{t('learn.making.foundWaiting')}</p>
            )}
          </section>
          <section className="making-panel sheet" aria-labelledby="making-beats">
            <h2 id="making-beats">{t('learn.making.beats', { n: k })}</h2>
            {prog.beats.length ? (
              <ol className="beat-tiles" lang={p.defaultLang}>
                {prog.beats.map((b, i) => {
                  const now = i === prog.beats.length - 1 && prog.stage === 'write';
                  return (
                    <li key={b.i} className={now ? 'is-now' : ''}>
                      <span className="beat-thumb" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="beat-cap">
                        <span className="mono">{b.i}</span> <bdi>{b.title}</bdi>
                        {now && <span className="visually-hidden"> · {t('learn.making.writing')}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="muted">{t('learn.making.beatsWaiting', { n: k })}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function LearnCoursePage({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { query } = useLocation();
  const asked = query.get('job');
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let on = true;
    api
      .project(id)
      .then((d) => {
        if (!on) return;
        setP(d);
        // the job running now wins; the job in the address counts only if this server still knows it (jobs are
        // forgotten when the server restarts) and it did not finish (a finished one opens its chapter)
        const running = d.jobs.find((j) => j.type === 'learn' && live(j));
        const named = asked ? d.jobs.find((j) => j.id === asked && j.status !== 'done') : undefined;
        const job = running ?? named;
        if (job) {
          setJobId(job.id);
          return;
        }
        setJobId(null);
        // the job in the address just finished (a fast run): its chapter opens and plays, as after the one go
        const finished = asked ? d.jobs.find((j) => j.id === asked && j.status === 'done') : undefined;
        const made = (finished?.result as { chapter?: string } | undefined)?.chapter;
        const last = made ?? d.made?.[d.made.length - 1]?.id;
        if (last)
          navigate(`/learn/${encodeURIComponent(id)}/${encodeURIComponent(last)}${finished ? '?play=1' : ''}`, {
            replace: true,
          });
        else if (asked) navigate(`/learn/${encodeURIComponent(id)}`, { replace: true });
      })
      .catch((e) => on && setError(errorText(e, tRef.current)));
    return () => {
      on = false;
    };
  }, [id, asked]);
  useSetPlace(p ? { book: { ...placeOf(p, lang), step: 'make' } } : null);
  if (error) return <div className="page">{<Notice tone="error">{error}</Notice>}</div>;
  if (!p) return <Loading />;
  if (jobId) return <Making p={p} jobId={jobId} onJob={setJobId} />;
  return <LearnRestart p={p} onJob={setJobId} />;
}

/** A course with nothing made and nothing running (stopped before chapter 1): the summary and "Teach me" again. */
function LearnRestart({ p, onJob }: { p: ProjectDetail; onJob: (id: string) => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [est, setEst] = useState<LearnEstimateInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .learnEstimate(p.id)
      .then(setEst)
      .catch((e) => setError(errorText(e, t)));
  }, [p.id, t]);
  const teach = async () => {
    try {
      const r = await api.startJob(p.id, 'learn', {});
      if (est) started.set(p.id, est);
      onJob(r.job.id);
    } catch (e) {
      setError(errorText(e, t));
    }
  };
  return (
    <div className="page learn-page">
      <section className="learn-card sheet">
        <h1 className="guide-q" tabIndex={-1}>
          {t('learn.setup.sumTitle')}
        </h1>
        <p className="lede">
          <bdi>{bookTitle(p.title, i18n.lang, p.defaultLang)}</bdi>
        </p>
        {est && !est.error && <Estimate e={est} />}
        <p className="learn-what">{t('learn.setup.what')}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {est?.error && <Notice tone="warn">{t('learn.setup.noAi')}</Notice>}
        <Button variant="primary" className="teach-me" disabled={!est || !!est.error} onClick={() => void teach()}>
          <Mark size={22} />
          {t('learn.setup.teachMe')}
        </Button>
      </section>
    </div>
  );
}

/* ---------- the chapter in the player: /learn/:id/:lid ---------- */

function placeOf(p: ProjectDetail, lang: string) {
  return {
    id: p.id,
    title: bookTitle(p.title, lang, p.defaultLang),
    spent: p.ledger.total,
    ...(p.config.budget.usd !== undefined ? { limit: p.config.budget.usd } : {}),
    step: 'make' as const,
    lessons: p.lessons.map((l) => ({ id: l.id, title: bookTitle(l.title, lang, l.lang) })),
    hasPdf: p.hasPdf,
    hasPlan: !!p.plan,
    planApproved: p.plan?.status === 'approved',
    steps: p.steps,
  };
}

export function LearnPlayerPage({ id, lid }: { id: string; lid: string }) {
  const i18n = useI18n();
  const { t, usd, lang } = i18n;
  const { query } = useLocation();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<WarqaPlayer | null>(null);
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [nextJob, setNextJob] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    api
      .project(id)
      .then(setP)
      .catch((e) => setError(errorText(e, tRef.current)));
  }, [id]);

  const chapters = included(p);
  const k = chapters.findIndex((c) => c.id === lid);
  const next = k >= 0 ? chapters[k + 1] : undefined;
  const lessonTitle = p ? bookTitle(p.lessons.find((l) => l.id === lid)?.title ?? {}, lang, p.defaultLang) : '';
  useSetPlace(
    p
      ? {
          book: placeOf(p, lang),
          lesson: { id: lid, title: lessonTitle || lid, beats: [] } satisfies LessonPlace,
        }
      : null,
  );

  // the next chapter being made from the finish card: its progress goes into the card
  const nextId = next?.id;
  // the job ended: later updates (a slow first lookup of the job can arrive after its end) change nothing
  const nextEnded = useRef<string | null>(null);
  const onNextEnd = useCallback(
    (job: JobInfo) => {
      nextEnded.current = job.id;
      const pl = player.current;
      if (!pl?.learnerNext || !nextId) return;
      if (job.status === 'done')
        pl.learnerNext({
          status: 'ready',
          open: () => navigate(`/learn/${encodeURIComponent(id)}/${encodeURIComponent(nextId)}?play=1`),
        });
      else if (job.status === 'error') pl.learnerNext({ status: 'error', message: job.error ?? '' });
      else pl.learnerNext({ status: 'idle' });
    },
    [id, nextId],
  );
  const stream = useJobStream(nextJob, onNextEnd);
  useEffect(() => {
    const beat = [...stream.events].reverse().find((e) => e.stage === 'write' && e.status === 'beat');
    if (nextJob && nextEnded.current !== nextJob && stream.info && live(stream.info))
      player.current?.learnerNext?.({
        status: 'making',
        ...(beat?.total ? { pct: Math.round((((beat.index ?? 0) + 1) * 100) / beat.total) } : {}),
      });
  }, [stream.events, stream.info, nextJob]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount once per chapter and book data
  useEffect(() => {
    if (!p) return;
    let cancelled = false;
    let mounted: WarqaPlayer | null = null;
    (async () => {
      try {
        const W = await loadPlayer();
        const data = (await api.playerData(id, lid, p.defaultLang)) as {
          packs?: string[];
          book?: Record<string, unknown>;
        };
        if (data.packs?.length) await loadPacks(W, data.packs);
        // a chapter not made yet is offered only with its cost known (a free model shows none)
        let cost: string | undefined;
        let offer = !!next;
        if (next && !p.lessons.some((l) => l.id === next.id)) {
          const e = await api.learnEstimate(id, next.id).catch(() => null);
          offer = !!e && !e.error;
          if (e && !e.error && e.usd.p50 > 0) cost = usd(e.usd.p50);
        }
        let asked = false;
        if (cancelled || !host.current) return;
        const lessonT = makeI18n(levelLang(p.defaultLang)).t;
        host.current.replaceChildren();
        mounted = await W.mount(host.current, data, {
          storage: true,
          keyboard: 'global',
          autoplay: query.get('play') === '1',
          learner: {
            // the card speaks the lesson's language: so does the level's name (Darija takes the Arabic one)
            level: levelName(lessonT, p.book.learn?.level),
            onFeedback: async (f) => {
              const r = await api.learnFeedback(id, f, p.book.learn?.level);
              return levelName(lessonT, r.level);
            },
            ...(next && offer
              ? {
                  next: {
                    n: k + 2,
                    title: chapterTitle(next),
                    made: p.lessons.some((l) => l.id === next.id),
                    ...(cost ? { cost } : {}),
                    run: () => {
                      if (p.lessons.some((l) => l.id === next.id))
                        navigate(`/learn/${encodeURIComponent(id)}/${encodeURIComponent(next.id)}?play=1`);
                      else if (!asked) {
                        // once: a second click must not queue the same paid chapter again
                        asked = true;
                        void api
                          .startJob(id, 'learn', { chapter: next.id })
                          .then((r) => {
                            setNextJob(r.job.id);
                            mounted?.learnerNext?.({ status: 'making' });
                          })
                          .catch((e) => {
                            asked = false;
                            mounted?.learnerNext?.({ status: 'error', message: errorText(e, tRef.current) });
                          });
                      }
                    },
                  },
                }
              : {}),
            home: () => navigate('/learn'),
          },
        });
        if (cancelled) {
          mounted.destroy();
          return;
        }
        player.current = mounted;
      } catch (e) {
        if (!cancelled) setError(errorText(e, tRef.current));
      }
    })();
    return () => {
      cancelled = true;
      mounted?.destroy();
      player.current = null;
    };
  }, [p, id, lid]);

  // links inside the player that point into the studio (its "All lessons") stay in this page
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
    e.preventDefault();
    navigate(`${stripBase(url.pathname)}${url.search}`);
  };

  return (
    <div className={`page learn-player${query.get('play') === '1' ? ' is-lifted-in' : ''}`}>
      <header className="learn-player-head">
        {p && k >= 0 && <p className="kicker">{t('learn.player.kicker', { k: k + 1, n: chapters.length })}</p>}
        <Link className="learn-teacher" to={`/project/${encodeURIComponent(id)}`}>
          {t('learn.home.openAsTeacher')}
        </Link>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: only lets the player's own links navigate inside the studio */}
      <div className="learn-player-host" ref={host} onClick={onClick} />
    </div>
  );
}

/* ---------- What I'm learning: /learn ---------- */

interface Course {
  item: ProjectListItem;
  detail: ProjectDetail | null;
  est: LearnEstimateInfo | null;
}

function CourseCard({ c, onMake, busy }: { c: Course; onMake: (c: Course) => void; busy: boolean }) {
  const i18n = useI18n();
  const { t, lang, langName, usd } = i18n;
  const p = c.detail;
  const item = c.item;
  const chapters = included(p);
  const made = new Set(p?.lessons.map((l) => l.id) ?? []);
  const total = Math.max(chapters.length, made.size);
  const making = p?.jobs.some((j) => j.type === 'learn' && live(j));
  const nextC = chapters.find((ch) => !made.has(ch.id));
  const nextN = nextC ? chapters.indexOf(nextC) + 1 : 0;
  const rows = chapters.slice(0, 3);
  const base = `/learn/${encodeURIComponent(item.id)}`;
  return (
    <li className="course-card">
      <h3 className="course-title" dir="auto">
        <Link to={base}>{bookTitle(item.title, lang, item.defaultLang)}</Link>
      </h3>
      <div className="course-chips">
        {item.source && (
          <span className="chip">
            {t('learn.home.from', {
              lang: langName(item.source.lang),
              pages: t('learn.setup.pages', { n: item.source.pages }),
            })}
          </span>
        )}
        <span className="chip">
          {NATIVE[item.defaultLang] ?? langName(item.defaultLang)} · {levelName(t, item.learn?.level)}
        </span>
      </div>
      {total > 0 && (
        <span className="chapter-track" role="img" aria-label={t('learn.home.made', { k: made.size, n: total })}>
          {Array.from({ length: Math.min(total, 24) }, (_, i) => {
            const ch = chapters[i];
            const state = ch && made.has(ch.id) ? 'done' : ch && ch.id === nextC?.id ? 'next' : 'todo';
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot per chapter slot
            return <i key={i} className={`is-${state}`} />;
          })}
        </span>
      )}
      <p className="course-made">{t('learn.home.made', { k: made.size, n: total })}</p>
      {!!rows.length && (
        <ol className="course-rows" lang={item.defaultLang}>
          {rows.map((ch, i) => (
            <li key={ch.id}>
              <span className="mono">{i + 1}</span>
              {made.has(ch.id) ? (
                <Link to={`${base}/${encodeURIComponent(ch.id)}`} dir="auto">
                  {chapterTitle(ch)}
                </Link>
              ) : (
                <bdi className="muted">{chapterTitle(ch)}</bdi>
              )}
              <span className={`course-state ${made.has(ch.id) ? 'good' : 'muted'}`}>
                {made.has(ch.id) ? t('learn.home.rowReady') : t('learn.home.rowNotMade')}
              </span>
            </li>
          ))}
        </ol>
      )}
      {chapters.length > 3 && <p className="hint">{t('learn.home.more', { n: chapters.length - 3 })}</p>}
      <div className="course-actions">
        {making ? (
          <Link className="btn btn-default" to={base}>
            <span className="run-dot" aria-hidden="true" /> {t('learn.home.makingN', { n: nextN || 1 })}
          </Link>
        ) : nextC ? (
          // a paid run: only once its cost is known, and once
          <Button
            busy={busy}
            disabled={!c.est || !!c.est.error}
            title={c.est?.error ? t('learn.setup.noAi') : undefined}
            onClick={() => onMake(c)}
          >
            {c.est && !c.est.error && c.est.usd.p50 > 0
              ? t('learn.home.makeN', { n: nextN, cost: usd(c.est.usd.p50) })
              : t('learn.home.makeNFree', { n: nextN })}
          </Button>
        ) : null}
        <Link className="course-teacher" to={`/project/${encodeURIComponent(item.id)}`}>
          {t('learn.home.openAsTeacher')}
        </Link>
      </div>
    </li>
  );
}

export function LearnHomePage() {
  const i18n = useI18n();
  const { t, lang, langName } = i18n;
  const { guide } = useExtras();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    (async () => {
      try {
        const { projects } = await api.projects();
        const mine = projects.filter((p) => p.learn && !p.error);
        const list = await Promise.all(
          mine.map(async (item) => {
            const [detail, est] = await Promise.all([
              api.project(item.id).catch(() => null),
              api.learnEstimate(item.id).catch(() => null),
            ]);
            return { item, detail, est };
          }),
        );
        setCourses(list);
      } catch (e) {
        setError(errorText(e, tRef.current));
      }
    })();
  }, []);

  const [making, setMaking] = useState('');
  const make = async (c: Course) => {
    if (making) return;
    setMaking(c.item.id);
    try {
      const r = await api.startJob(c.item.id, 'learn', c.est?.chapter ? { chapter: c.est.chapter } : {});
      if (c.est) started.set(c.item.id, c.est);
      navigate(`/learn/${encodeURIComponent(c.item.id)}?job=${encodeURIComponent(r.job.id)}`);
    } catch (e) {
      setError(errorText(e, t));
      setMaking('');
    }
  };
  const newPdf = (f: File) => {
    passPdf(f);
    navigate('/learn/new');
  };

  const latest = courses?.length ? [...courses].sort((a, b) => b.item.updated - a.item.updated)[0] : undefined;
  const last = latest?.item.made?.[latest.item.made.length - 1];
  const lastK = latest && last ? included(latest.detail).findIndex((c) => c.id === last.id) + 1 : 0;

  return (
    <div className="page learn-home">
      <header className="page-head">
        <div>
          <h1 className="display">{t('learn.home.title')}</h1>
          <p className="lede">{t('learn.home.lede')}</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn btn-quiet" to="/">
            {t('learn.home.books')}
          </Link>
        </div>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {!courses && !error && <Loading />}
      {courses && !courses.length && (
        <section className="learn-empty sheet">
          <PdfDrop title={t('learn.home.emptyTitle')} hint={t('learn.home.emptyBody')} onFile={newPdf} />
          {guide?.example && (
            <button type="button" className="link-btn" onClick={() => void guide.example!().then((to) => navigate(to))}>
              {t('welcome.example')}
            </button>
          )}
        </section>
      )}
      {latest && last && (
        <section className="continue-card sheet" aria-labelledby="continue-title">
          <div className="continue-text">
            <p className="kicker">{t('learn.home.continueKicker')}</p>
            <h2 id="continue-title" dir="auto">
              {bookTitle(latest.item.title, lang, latest.item.defaultLang)}
            </h2>
            <div className="course-chips">
              <span className="chip chip-dark">
                {t('learn.home.learningIn', {
                  lang: NATIVE[latest.item.defaultLang] ?? langName(latest.item.defaultLang),
                })}
              </span>
              <span className="chip">{levelName(t, latest.item.learn?.level)}</span>
            </div>
            <p>
              {t('learn.home.chapterOf', { k: Math.max(1, lastK), n: Math.max(included(latest.detail).length, 1) })} ·{' '}
              <bdi>{bookTitle(last.title, lang, latest.item.defaultLang)}</bdi>
            </p>
            <Link
              className="btn btn-primary"
              to={`/learn/${encodeURIComponent(latest.item.id)}/${encodeURIComponent(last.id)}`}
            >
              <Icon name="play" />
              <span>{t('learn.home.continueBtn', { n: Math.max(1, lastK) })}</span>
            </Link>
          </div>
        </section>
      )}
      {!!courses?.length && (
        <section aria-labelledby="courses-title">
          <h2 id="courses-title" className="section-title">
            {t('learn.home.courses')}
          </h2>
          <ul className="courses">
            {courses.map((c) => (
              <CourseCard key={c.item.id} c={c} busy={making === c.item.id} onMake={(x) => void make(x)} />
            ))}
          </ul>
        </section>
      )}
      {!!courses?.length && (
        <section className="learn-new">
          <PdfDrop title={t('learn.home.newTitle')} hint={t('learn.home.newBody')} onFile={newPdf} />
        </section>
      )}
      <footer className="learn-foot">
        <span>{t('pdf.copyright')}</span>
        <span>{t('learn.home.device')}</span>
      </footer>
    </div>
  );
}
