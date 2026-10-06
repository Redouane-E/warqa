// ⑤ Check (redesign 4f, the Check board): for one chapter in one language, a contact sheet of every beat's last
// picture with the judge's score in red pen and a red frame where an automatic check found something; the beat
// chosen opens under it (its picture with the finding circled, the judge's note, its narration, what to change,
// Regenerate, Open in the editor). Then Improve weak beats (it spends: a money dialog first) and Ask teachers (a
// review kit). Checks draw each beat in a hidden browser: the desktop version only, said where it applies.
import { dirOf, langInfo, t as playerT } from '@warqa/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CheckBeat, CheckDetail, CheckIssue, JobType, ProjectDetail, StatusInfo } from '../../shared/types';
import { api, errorText, saveFile } from '../api';
import { withBase } from '../base';
import { DesktopOnly, DesktopOnlyChip } from '../components/DesktopOnly';
import { useJobs } from '../components/JobBoard';
import { useConfirm, useToast } from '../components/overlays';
import { PenNote, ScoreMark } from '../components/RedPen';
import { Button, Icon, Loading, Notice } from '../components/ui';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link, navigate, useLocation } from '../router';
import { segmentsOf } from './editor/Marks';
import { useCompName } from './editor/Parts';

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

const two = (n: number) => String(n).padStart(2, '0');
const THRESHOLDS = [3, 4, 5];
const CRITERIA = ['panel.accuracy', 'panel.clarity', 'panel.picture', 'panel.language', 'panel.level'] as const;

/** How a part on the stage is named for a person: its component, and its own short text or its id. */
function usePartName() {
  const compName = useCompName();
  return (n: NonNullable<CheckIssue['nodes']>[number]) =>
    n.text ? `${compName(n.type)} «${n.text}»` : `${compName(n.type)} ${n.id}`.trim();
}

/** What an automatic check found, short (under a tile) or as a sentence (the opened beat). */
function useFinding() {
  const { t, num } = useI18n();
  const name = usePartName();
  return {
    short: (i: CheckIssue) => t(`qa.${i.kind}` as MsgKey),
    long: (i: CheckIssue) => {
      const [a, b] = i.nodes ?? [];
      switch (i.kind) {
        case 'overlap':
          return a && b ? t('qa.overlap.long', { a: name(a), b: name(b) }) : t('qa.overlap');
        case 'blank':
          return i.from !== undefined && i.to !== undefined
            ? t('qa.blank.long', { from: num(i.from), to: num(i.to) })
            : t('qa.blank');
        case 'overflow':
          return a && i.fit !== undefined
            ? t('qa.overflow.long', { a: name(a), pct: num(Math.round(i.fit * 100)) })
            : t('qa.overflow');
        case 'offstage':
          return a ? t('qa.offstage.long', { a: name(a) }) : t('qa.offstage');
        default:
          return i.message;
      }
    },
  };
}

/** "Checked today, 14:05" or "Checked 3 Oct". */
function useCheckedAt() {
  const { t, locale } = useI18n();
  return (at: number) => {
    const d = new Date(at);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? t('check.checkedToday', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d) })
      : t('check.checkedOn', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d) });
  };
}

function Tile({ b, selected, href, onPick }: { b: CheckBeat; selected: boolean; href: string; onPick: () => void }) {
  const { t } = useI18n();
  const f = useFinding();
  const issue = b.issues[0];
  const name = [
    t('check.tile', { n: b.n, title: b.title }),
    b.score !== undefined ? t('check.tileScore', { n: b.score }) : '',
    b.attention ? t('check.tileAttention') : '',
    issue ? f.short(issue) : '',
    selected ? t('check.tileOpen') : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <li className={`beat-tile${b.attention ? ' is-flagged' : ''}${b.changed ? ' is-changed' : ''}`}>
      <a
        href={href}
        className="beat-tile-pic"
        aria-label={name}
        aria-current={selected ? 'true' : undefined}
        onClick={(e) => {
          e.preventDefault();
          onPick();
        }}
      >
        {b.thumb ? (
          <img src={b.thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="beat-thumb" aria-hidden="true" />
        )}
      </a>
      <div className="beat-tile-cap">
        <span className="mono muted small">{two(b.n)}</span>
        <bdi className="beat-tile-title">{b.title}</bdi>
        {b.score !== undefined && <ScoreMark score={b.score} index={b.n - 1} weak={b.score < 4} />}
      </div>
      {b.changed ? (
        <p className="beat-tile-note muted">{t('check.beatChanged')}</p>
      ) : issue ? (
        <p className="beat-tile-issue">
          <Icon name="warn" size={16} /> {f.short(issue)}
        </p>
      ) : b.score !== undefined && b.score < 4 && (b.problem || b.fix) ? (
        <PenNote className="beat-tile-pen">{b.problem ?? b.fix}</PenNote>
      ) : null}
    </li>
  );
}

/** The chosen beat, opened under the contact sheet. */
function BeatDetail({
  b,
  lang,
  instruction,
  onInstruction,
  rewriteUsd,
  busy,
  onRegenerate,
  editorHref,
  headRef,
}: {
  b: CheckBeat;
  lang: string;
  instruction: string;
  onInstruction: (s: string) => void;
  rewriteUsd: number | undefined;
  busy: boolean;
  onRegenerate: () => void;
  editorHref: string;
  headRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { t, usd, langName } = useI18n();
  const f = useFinding();
  const issue = b.issues[0];
  const box = b.issues.find((i) => i.box)?.box;
  const moveName = t(`move.${b.move}` as MsgKey);
  const id = `chk-b${b.n}`;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return (
    <section className="sheet beat-detail" aria-labelledby={id}>
      <figure className="beat-detail-pic">
        <div className="beat-detail-frame">
          {b.shot ? <img src={b.shot} alt="" /> : <span className="beat-thumb" aria-hidden="true" />}
          {box && (
            // the finding circled in red pen, in the picture's own coordinates (never mirrored)
            <svg className="pen-loop" viewBox="0 0 1600 900" aria-hidden="true" preserveAspectRatio="none">
              <ellipse
                cx={box.x + box.w / 2}
                cy={box.y + box.h / 2}
                rx={box.w / 2 + 34}
                ry={box.h / 2 + 26}
                transform={`rotate(-4 ${box.x + box.w / 2} ${box.y + box.h / 2})`}
              />
            </svg>
          )}
        </div>
        <figcaption>
          <span>{t('check.endOf', { n: b.n, lang: langName(lang) })}</span>
          {b.dur !== undefined && (
            <bdi className="mono" dir="ltr">
              0:00–{mmss(b.dur)}
            </bdi>
          )}
        </figcaption>
      </figure>
      <div className="beat-detail-text">
        <div className="beat-detail-head">
          <p className="mono muted small">{t('check.kicker', { n: two(b.n), move: moveName })}</p>
          <h2 id={id} ref={headRef} tabIndex={-1} className="beat-detail-title">
            <bdi>{b.title}</bdi>
          </h2>
        </div>
        {issue && (
          <div className="finding">
            <Icon name="warn" size={20} />
            <p>
              <strong>{f.short(issue)}.</strong> <bdi>{f.long(issue)}</bdi>
            </p>
          </div>
        )}
        {b.score !== undefined && (
          <figure className="pen-figure">
            <ScoreMark score={b.score} size="lg" weak={b.score < 4} label />
            {(b.problem || b.fix) && (
              <figcaption className="pen-note is-big" dir="auto">
                {[b.problem, b.fix].filter(Boolean).join(' ')}
              </figcaption>
            )}
          </figure>
        )}
        <div className="beat-detail-narr">
          <p className="small-title">{t('check.narration')}</p>
          <p lang={lang} dir={dirOf(lang)}>
            {segmentsOf(b.narration).map((s, k) =>
              'mark' in s ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: runs of one text
                <mark key={k} className="narr-marked">
                  {s.word}
                </mark>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: runs of one text
                <span key={k}>{s.text}</span>
              ),
            )}
          </p>
        </div>
        <label className="field">
          <span className="small-title">{t('check.instruction')}</span>
          <textarea rows={2} value={instruction} dir="auto" onChange={(e) => onInstruction(e.target.value)} />
        </label>
        <div className="beat-detail-actions">
          <Button icon="regenerate" busy={busy} disabled={busy} onClick={onRegenerate}>
            {t('editor.regen')}
          </Button>
          {rewriteUsd !== undefined && (
            <span className="mono muted small">{t('learn.est.cost', { cost: usd(Math.max(rewriteUsd, 0.001)) })}</span>
          )}
          <Link className="btn btn-quiet beat-detail-edit" to={editorHref}>
            <Icon name="edit" size={18} />
            <span>{t('check.openEditor')}</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export function CheckStep({
  p,
  status,
  run,
}: {
  p: ProjectDetail;
  status: StatusInfo | null;
  run: Run;
  reload: () => Promise<void>;
}) {
  // the criteria come from the player's catalog (in every interface language)
  const { t, usd, num, ago, lang: ui } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const jobs = useJobs();
  const { query } = useLocation();
  const checkedAt = useCheckedAt();
  const book = encodeURIComponent(p.id);
  const caps = status?.capabilities;
  const canCheck = !!caps && !caps.jobsUnavailable.includes('qa') && caps.playwright !== false;
  const canImprove = !!caps && !caps.jobsUnavailable.includes('improve') && caps.playwright !== false;
  // a desktop without Playwright's browser is told to install it (not to get the desktop version)
  const noPlaywright = caps?.platform === 'desktop' && caps.playwright === false;
  const deskReason = (web: string) => (noPlaywright ? t('check.needsPlaywright') : web);
  const deskChip = noPlaywright ? { chip: t('cap.needsPlaywright') } : {};
  const canKit = !caps?.jobsUnavailable.includes('panel');

  // the chapters to make that are made, numbered among them (as Make and the editor's kicker)
  const order = p.plan?.chapters.filter((c) => c.include).map((c) => c.id) ?? [];
  const chapters = p.lessons
    .map((l) => ({
      id: l.id,
      title: l.title[l.lang] ?? l.id,
      n: order.indexOf(l.id) + 1,
      langs: l.langs,
      lang: l.lang,
    }))
    .sort((a, b) => (a.n || 999) - (b.n || 999));
  const asked = query.get('chapter') ?? '';
  const flagged = chapters.find((c) => p.checks?.[c.id]?.some((x) => x.attention > 0));
  const chapter = chapters.find((c) => c.id === asked) ?? flagged ?? chapters[0];
  const askedLang = query.get('lang') ?? '';
  const lang =
    chapter && (chapter.langs.includes(askedLang) || askedLang === chapter.lang)
      ? askedLang
      : chapter && p.book.defaultLang && chapter.langs.includes(p.book.defaultLang)
        ? p.book.defaultLang
        : (chapter?.lang ?? '');

  const [d, setD] = useState<CheckDetail | null>(null);
  const [error, setError] = useState('');
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [threshold, setThreshold] = useState(4);
  const [kit, setKit] = useState<Set<string>>(() => new Set(chapter ? [chapter.id] : []));
  const [starting, setStarting] = useState('');
  const head = useRef<HTMLHeadingElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  const chapterId = chapter?.id;
  const load = useCallback(async () => {
    if (!chapterId) return;
    try {
      setD(await api.check(p.id, chapterId, lang));
      setError('');
    } catch (e) {
      setError(errorText(e, tRef.current));
    }
  }, [p.id, chapterId, lang]);
  useEffect(() => {
    setD(null);
    void load();
  }, [load]);

  const go = (next: { chapter?: string; lang?: string; beat?: number | null }) => {
    const q = new URLSearchParams({ step: 'check' });
    const c = next.chapter ?? chapter?.id;
    if (c) q.set('chapter', c);
    const l = next.lang ?? (next.chapter && next.chapter !== chapter?.id ? '' : lang);
    if (l) q.set('lang', l);
    const beat = next.beat === undefined ? query.get('beat') : next.beat;
    if (beat && !next.chapter && !next.lang) q.set('beat', String(beat));
    navigate(`/project/${book}?${q}`, { replace: true });
  };

  // a check, an improvement or a rewrite of this book ends: the sheet shows it
  useEffect(
    () =>
      jobs.onEnd(p.id, (job) => {
        if (job.type === 'qa' || job.type === 'improve') void load();
        if (job.type === 'rewrite' && job.status === 'done' && (job.result as { candidate?: boolean })?.candidate) {
          const lid = String(job.args.lesson ?? '');
          const bid = String(job.args.beat ?? '');
          const n = (d?.lesson === lid ? d.beats.find((b) => b.id === bid)?.n : undefined) ?? 1;
          toast({
            text: t('editor.rewritten', { n }),
            tone: 'good',
            action: {
              label: t('editor.compare'),
              run: () => navigate(`/project/${book}/lesson/${encodeURIComponent(lid)}?beat=${n}&compare=1`),
            },
          });
        }
      }),
    [jobs, p.id, load, toast, t, d, book],
  );

  const beats = d?.beats ?? [];
  const beatQ = Number(query.get('beat') ?? 0);
  const selected = beats.find((b) => b.n === beatQ) ?? beats.find((b) => b.attention);
  // the chosen beat takes the focus when it is chosen (not on load)
  const picked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the chosen beat changes
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    head.current?.focus();
    head.current?.closest('section')?.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [selected?.id]);

  const weak = useMemo(
    () => beats.filter((b) => b.score !== undefined && b.score < threshold && (b.problem || b.fix)),
    [beats, threshold],
  );
  const scored = beats.some((b) => b.score !== undefined);
  const improveCost = d?.rewriteUsd !== undefined ? weak.length * (d.rewriteUsd + (d.judge?.beatUsd ?? 0)) : undefined;
  const attention = beats.filter((b) => b.attention).length;
  const runCost = d?.judge?.lessonUsd;

  const start = async (key: string, type: JobType, args: Record<string, unknown>) => {
    if (starting) return;
    setStarting(key);
    try {
      await run(type, args);
    } finally {
      setStarting('');
    }
  };

  if (!chapter)
    return (
      <section className="sheet make-sheet" aria-labelledby="chk-title">
        <div className="make-head">
          <h2 id="chk-title" className="card-title">
            {t('step.check')}
          </h2>
        </div>
        <div className="make-empty">
          <h3 className="block-title">{t('check.emptyTitle')}</h3>
          <p className="hint">{t('check.emptyBody')}</p>
          <Link className="btn btn-primary" to={`/project/${book}?step=make`}>
            <span>{t('check.toMake')}</span>
            <Icon name="next" className="flip-rtl" />
          </Link>
        </div>
      </section>
    );

  // its title in the language checked (a book without a plan names the chapter by it)
  const title = chapter.n
    ? t('check.title', { n: chapter.n })
    : t('check.titleLesson', { title: d?.title ?? chapter.title });
  const summary = !d
    ? ''
    : !d.checked
      ? `${t('common.beats', { n: beats.length })} · ${t('check.notYet')}`
      : attention
        ? `${t('common.beats', { n: beats.length })} · ${t('check.good', { n: beats.length - attention })} · `
        : `${t('common.beats', { n: beats.length })} · ${t('check.allGood')}`;

  return (
    <div className="check-step">
      <section className="sheet check-sheet" aria-labelledby="chk-title">
        <div className="check-head">
          <div className="check-head-start">
            <h2 id="chk-title" className="card-title">
              {title}
            </h2>
            <p className="check-summary">
              {summary}
              {d?.checked && attention > 0 && (
                <strong className="pen-text">{t('check.attention', { n: attention })}</strong>
              )}
            </p>
          </div>
          <div className="check-head-end">
            {chapters.length > 1 && (
              <label className="rv-field">
                <span>{t('check.chapter')}</span>
                <select value={chapter.id} onChange={(e) => go({ chapter: e.target.value })}>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t('check.chapterOption', { n: c.n || c.id, title: c.title })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="rv-field">
              <span>{t('check.lang')}</span>
              <select value={lang} onChange={(e) => go({ lang: e.target.value })}>
                {[chapter.lang, ...chapter.langs.filter((l) => l !== chapter.lang)].map((l) => (
                  <option key={l} value={l} lang={l}>
                    {langInfo(l).name}
                  </option>
                ))}
              </select>
            </label>
            {canCheck && (
              <span className="check-run">
                <Button
                  icon="regenerate"
                  busy={starting === 'qa'}
                  disabled={!!starting}
                  onClick={() => void start('qa', 'qa', { chapters: [chapter.id], langs: [lang], judge: !!d?.judge })}
                >
                  {t('check.run')}
                </Button>
                <span className="mono muted small">
                  {runCost ? t('learn.est.cost', { cost: usd(Math.max(runCost, 0.001)) }) : t('learn.est.free')}
                </span>
              </span>
            )}
          </div>
        </div>
        {!canCheck && (
          <div className="check-desk">
            <Button icon="regenerate" disabled aria-describedby="chk-desk">
              {t('check.run')}
            </Button>
            <DesktopOnly id="chk-desk" reason={deskReason(t('cap.qa'))} {...deskChip} />
          </div>
        )}
        <div className="check-legend">
          <span>
            <span className="pen-score is-sm" aria-hidden="true" dir="ltr" style={{ rotate: '-5deg' }}>
              4
            </span>
            {t('check.legendScore')}
          </span>
          <span>
            <span className="legend-flag" aria-hidden="true" />
            {t('check.legendIssue')}
          </span>
          {d?.checked && <span className="mono check-when">{checkedAt(d.checked)}</span>}
        </div>
        {d && !d.checked && canCheck && <p className="hint">{t('check.notYetHint')}</p>}
        {d?.stale && <Notice>{t('check.stale')}</Notice>}
        {d && !d.judge && d.checked && (
          <Notice>
            {t('check.noJudge')} <Link to={`/ai?book=${encodeURIComponent(p.id)}#roles`}>{t('nav.ai')}</Link>
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {!d ? (
          <Loading />
        ) : (
          <ol className="contact-sheet" aria-label={t('check.beatsOf', { n: chapter.n || chapter.id })}>
            {beats.map((b) => (
              <Tile
                key={b.id}
                b={b}
                selected={selected?.id === b.id}
                href={withBase(
                  `/project/${book}?step=check&chapter=${encodeURIComponent(chapter.id)}&lang=${encodeURIComponent(lang)}&beat=${b.n}`,
                )}
                onPick={() => {
                  picked.current = true;
                  go({ beat: b.n });
                }}
              />
            ))}
          </ol>
        )}
      </section>

      {d && selected && (
        <BeatDetail
          key={selected.id}
          b={selected}
          lang={lang}
          instruction={instructions[selected.id] ?? selected.fix ?? selected.problem ?? ''}
          onInstruction={(s) => setInstructions((cur) => ({ ...cur, [selected.id]: s }))}
          rewriteUsd={d.rewriteUsd}
          busy={starting === `rewrite:${selected.id}`}
          onRegenerate={() =>
            void start(`rewrite:${selected.id}`, 'rewrite', {
              lesson: chapter.id,
              beat: selected.id,
              instruction: instructions[selected.id] ?? selected.fix ?? selected.problem ?? '',
              candidate: true,
            })
          }
          editorHref={`/project/${book}/lesson/${encodeURIComponent(chapter.id)}?beat=${selected.n}`}
          headRef={head}
        />
      )}

      <div className="check-cards">
        <section className="sheet check-card" aria-labelledby="chk-imp">
          <div className="check-card-head">
            <h2 id="chk-imp" className="check-card-title">
              {t('improve.title')}
            </h2>
            <p className="hint">{t('improve.intro')}</p>
          </div>
          <div className="improve-row">
            <label className="rv-field">
              <span>{t('improve.threshold')}</span>
              <select className="mono" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
                {THRESHOLDS.map((n) => (
                  <option key={n} value={n}>
                    {num(n)}
                  </option>
                ))}
              </select>
            </label>
            {scored && d?.fresh && (
              <p className="improve-count mono">
                {t('common.beats', { n: weak.length })}
                {improveCost !== undefined && weak.length > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="muted">{t('learn.est.cost', { cost: usd(Math.max(improveCost, 0.001)) })}</span>
                  </>
                )}
              </p>
            )}
          </div>
          {!scored ? (
            <p className="hint">{t('improve.needCheck')}</p>
          ) : weak.length && !d?.fresh ? (
            // the judge scored an older lesson: Improve would judge it all again first (a cost not shown here)
            <p className="hint">{t('improve.needFresh')}</p>
          ) : weak.length ? (
            <ul className="improve-list">
              {weak.map((b) => (
                <li key={b.id}>
                  <span className="mono muted small">{two(b.n)}</span>
                  <bdi className="improve-title">{b.title}</bdi>
                  <span className="pen-num" dir="ltr">
                    {num(b.score ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">{t('improve.none', { n: threshold })}</p>
          )}
          {!weak.length || !d?.fresh ? null : canImprove ? (
            <Button
              variant="primary"
              icon="edit"
              busy={starting === 'improve'}
              disabled={!weak.length || !!starting}
              onClick={async () => {
                const beats = t('common.beats', { n: weak.length });
                const ok = await confirm({
                  title:
                    improveCost !== undefined
                      ? t('improve.dlgTitle', { beats, cost: usd(Math.max(improveCost, 0.001)) })
                      : t('improve.dlgTitleNoCost', { beats }),
                  body: t('improve.dlgBody', { list: weak.map((b) => two(b.n)).join(', ') }),
                  confirm: t('improve.runN', { n: weak.length }),
                  cancel: t('dlg.notNow'),
                });
                if (ok)
                  void start('improve', 'improve', {
                    chapters: [chapter.id],
                    lang,
                    threshold,
                    reuse: true,
                    rejudge: 'rewritten',
                  });
              }}
            >
              {t('improve.runN', { n: weak.length })}
            </Button>
          ) : (
            <div className="check-desk">
              <Button variant="primary" icon="edit" disabled aria-describedby="imp-desk">
                {t('improve.runN', { n: weak.length })}
              </Button>
              <DesktopOnly id="imp-desk" reason={deskReason(t('cap.improve'))} {...deskChip} />
            </div>
          )}
          <div className="improve-note" role="status">
            <Icon name="info" size={20} />
            <p>{t('improve.note')}</p>
          </div>
        </section>

        <section className="sheet check-card" aria-labelledby="chk-teach">
          <div className="check-card-head">
            <h2 id="chk-teach" className="check-card-title">
              {t('panel.title')}
            </h2>
            <p className="hint">{t('panel.intro')}</p>
          </div>
          <fieldset className="kit-chapters">
            <legend>{t('panel.chapters')}</legend>
            {chapters.map((c) => (
              <label key={c.id} className={kit.has(c.id) ? 'is-on' : ''}>
                <input
                  type="checkbox"
                  checked={kit.has(c.id)}
                  onChange={(e) =>
                    setKit((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                />
                <span className="mono muted small">{c.n ? two(c.n) : c.id}</span>
                <bdi>{c.title}</bdi>
              </label>
            ))}
          </fieldset>
          <div className="criteria">
            <p className="small-title">{t('panel.criteria')}</p>
            <ul>
              {CRITERIA.map((k) => (
                <li key={k}>{playerT(ui, k)}</li>
              ))}
            </ul>
          </div>
          <div className="kit-actions">
            {canKit ? (
              <Button
                icon="download"
                busy={starting === 'panel'}
                disabled={!kit.size || !!starting}
                onClick={() => void start('panel', 'panel', { chapters: [...kit] })}
              >
                {t('panel.run')}
              </Button>
            ) : (
              <DesktopOnlyChip />
            )}
            <span className="muted small">{t('panel.count', { chapters: t('common.chapters', { n: kit.size }) })}</span>
          </div>
          {p.panelKit && (
            <p className="kit-last">
              <button
                type="button"
                className="link-btn"
                onClick={() => void saveFile(withBase(`/api/projects/${book}/panel/kit.zip`), `${p.id}-review-kit.zip`)}
              >
                {t('panel.zip')}
              </button>{' '}
              <span className="muted small">{t('panel.last', { when: ago(p.panelKit.at) })}</span>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
