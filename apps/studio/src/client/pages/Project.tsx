import { dirOf, parsePageRanges } from '@warqa/i18n';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FAKE_PROVIDER, PROVIDERS } from '../../shared/providers';
import type {
  BookPlan,
  DocSummary,
  EstimateInfo,
  JobInfo,
  JobType,
  ProjectDetail,
  ReadMethod,
  StatusInfo,
  StepId,
  StepState,
} from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText } from '../api';
import { buildProgress, type ChapterRun, useJobStream, useJobs, writingBeat } from '../components/JobBoard';
import { useConfirm, useToast, useUnsavedGuard } from '../components/overlays';
import { Button, Field, Icon, LangTag, Loading, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { bookPlaceOf, STEPS, useSetPlace } from '../place';
import { confirmLeave, Link, navigate, useLocation } from '../router';
import { CheckStep } from './Check';
import { bookTitle } from './Home';
import { LanguagesStep } from './Languages';
import { ShareStep } from './Share';

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

interface StepProps {
  p: ProjectDetail;
  status: StatusInfo | null;
  run: Run;
  live: Set<JobType>;
  reload: () => Promise<void>;
  /** The book's estimate (with the plan's cost and each chapter's), when there is one. */
  estimate?: EstimateInfo | null;
}

/* ---------- ① read the PDF ---------- */

const METHODS: ReadMethod[] = ['text', 'ocr-vision', 'ocr-worker', 'none'];
/** Each language under its own name (glossary headers), else the interface's name for it. */
const NATIVE: Record<string, string> = { ar: 'العربية', ary: 'الدارجة', fr: 'Français', en: 'English' };

/** The page being read and the pages read so far, from the read job's progress ("page 12 · ocr-vision"). */
function useReading(p: ProjectDetail, on: boolean) {
  const job = on
    ? p.jobs.find((j) => j.type === 'ingest' && (j.status === 'running' || j.status === 'queued'))
    : undefined;
  const { events } = useJobStream(job?.id ?? null);
  return useMemo(() => {
    const read = new Map<number, ReadMethod>();
    let page = 0;
    let at = 0;
    let total = 0;
    let max = 0;
    for (const e of events) {
      const m =
        e.kind === 'progress' &&
        e.stage === 'read' &&
        e.status === 'beat' &&
        /^page (\d+) · ([\w-]+)/.exec(e.detail ?? '');
      if (!m) continue;
      page = Number(m[1]);
      max = Math.max(max, page);
      read.set(page, m[2] as ReadMethod);
      at = (e.index ?? 0) + 1;
      total = e.total ?? total;
    }
    return { read, page, at, total, max };
  }, [events]);
}

/** One tile per page of the PDF, coloured by how it was read; while reading, the page being read is ringed. */
function PageStrip({
  doc,
  total,
  reading,
}: {
  doc: DocSummary | null;
  total: number;
  reading?: { read: Map<number, ReadMethod>; page: number };
}) {
  const { t, num } = useI18n();
  const by = new Map<number, ReadMethod>(doc?.read.map((r) => [r.n, r.method]));
  if (reading) for (const [n, m] of reading.read) by.set(n, m);
  return (
    <ol className="page-strip" aria-label={t('common.pages', { n: total })}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const method = by.get(n) ?? 'unread';
        const name = t(`read.method.${method}` as MsgKey);
        return (
          <li
            key={n}
            className={`page-tile is-${method}${reading?.page === n ? ' is-now' : ''}`}
            aria-label={t('read.tile', { n: num(n), method: name })}
            title={t('read.tile', { n: num(n), method: name })}
          >
            <i />
            <i />
            <i />
          </li>
        );
      })}
    </ol>
  );
}

function ReadStep({ p, status, run, live, estimate }: StepProps) {
  const i18n = useI18n();
  const { t, num, langName, usd, bytes, ago } = i18n;
  const [ocr, setOcr] = useState<'auto' | 'never' | 'always'>('auto');
  const [pages, setPages] = useState('');
  const [pagesError, setPagesError] = useState('');
  const doc = p.document;
  const reading = live.has('ingest');
  const now = useReading(p, reading);
  const canRead = !!p.pdf && status?.ingest !== false;
  const chapters = doc?.sections.filter((s) => s.id.startsWith('ch')) ?? [];
  const lastChapter = chapters.at(-1)?.end ?? 0;
  const extra = doc?.sections.filter((s) => !s.id.startsWith('ch') && s.start > lastChapter) ?? [];
  const repaired =
    doc?.read.filter((r) => r.quality === 'ocr' && r.method !== 'text' && r.method !== 'none').length ?? 0;
  const noText = doc?.read.filter((r) => r.method === 'none').map((r) => r.n) ?? [];
  const planTitle = (id: string) => p.plan?.chapters.find((c) => c.section === id || c.id === id)?.title;
  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };
  // "3-8, 31-38" (the same reading as the server's), checked here so a typo never starts a job
  let ranges: [number, number][] | null;
  try {
    ranges = parsePageRanges(pages);
  } catch {
    ranges = null;
  }
  const pastEnd = !!doc && !!ranges?.length && ranges[0]![0] > doc.pages;
  const asked = ranges?.length
    ? ranges.reduce((n, [a, b]) => n + Math.min(b, doc?.pages ?? b) - a + 1, 0)
    : (doc?.pages ?? 0);
  const read = () => {
    const bad = !ranges ? t('read.pagesBad') : pastEnd ? t('read.pastEnd', { n: num(doc!.pages) }) : '';
    setPagesError(bad);
    if (!bad) void run('ingest', { ocr, ...(pages.trim() ? { pages: pages.trim() } : {}) });
  };
  // what reading costs: nothing without the vision model; else per page read from its image
  const perPage = ocr !== 'never' && !p.roles.vision?.error ? estimate?.visionPage : undefined;
  const costNote = [
    !perPage
      ? t('learn.est.free')
      : ocr === 'always' && asked
        ? t('read.costAlways', { n: asked, cost: usd(perPage * asked) })
        : t('read.costAuto', { cost: usd(perPage) }),
    doc ? t('read.kept') : '',
  ]
    .filter(Boolean)
    .join(' · ');

  if (!p.pdf) return <Notice>{t('read.noPdf')}</Notice>;
  return (
    <>
      {status && !status.ingest && <Notice tone="warn">{t('read.unavailable')}</Notice>}
      {(doc || reading) && (
        <section className="sheet read-found" aria-labelledby="read-found">
          <div className="card-head">
            <h2 id="read-found" className="card-title">
              {t('read.found')}
            </h2>
            {doc && (
              <p className="card-meta">
                <Icon name="file" size={16} />{' '}
                {t('read.fileMeta', {
                  file: p.pdf,
                  size: p.pdfBytes ? bytes(p.pdfBytes) : '',
                  ago: doc.readAt ? ago(doc.readAt) : '',
                })}
              </p>
            )}
          </div>
          {reading && (
            <div className="read-waiting">
              <span className="notebook" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <p>
                {t('read.reading')}
                {now.total ? (
                  <span className="mono muted"> {t('read.pageOf', { n: num(now.at), total: num(now.total) })}</span>
                ) : null}
              </p>
            </div>
          )}
          {doc && !reading && (
            <dl className="read-facts">
              <div>
                <dt>{t('read.fact.pages')}</dt>
                <dd className="fact-big">{num(doc.pages)}</dd>
              </div>
              <div>
                <dt>{t('read.fact.langs')}</dt>
                <dd className="fact-words">{list(doc.langs.map((l) => langName(l)))}</dd>
              </div>
              <div>
                <dt>{t('read.fact.chapters')}</dt>
                <dd className="fact-big">{num(chapters.length)}</dd>
              </div>
              {repaired > 0 && (
                <div>
                  <dt>{t('read.fact.repaired')}</dt>
                  <dd className="fact-big">
                    <span className="hl">{num(repaired)}</span>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="read-pages">
            <div className="read-pages-head">
              <h3 className="block-title">{t('read.how')}</h3>
              {doc && !reading && (
                <ul className="read-legend">
                  {METHODS.filter((m) => doc.methods[m]).map((m) => (
                    <li key={m}>
                      <span className={`page-tile is-${m} legend-tile`} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      {t(`read.legend.${m}` as MsgKey)} <span className="mono muted">{num(doc.methods[m] ?? 0)}</span>
                    </li>
                  ))}
                  {doc.read.length < doc.pages && (
                    <li>
                      <span className="page-tile is-unread legend-tile" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      {t('read.legend.unread')} <span className="mono muted">{num(doc.pages - doc.read.length)}</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <PageStrip
              doc={doc}
              total={doc?.pages ?? now.max}
              {...(reading ? { reading: { read: now.read, page: now.page } } : {})}
            />
            {doc && (
              <p className="strip-foot mono">
                <span>{t('common.pageShort', { n: num(1) })}</span>
                {!reading && noText.length > 0 && (
                  <span className="strip-note">
                    {t('read.noText', {
                      n: noText.length,
                      // a scanned book: the first pages, then "…"
                      pages: list(noText.slice(0, 6).map((n) => num(n))) + (noText.length > 6 ? '…' : ''),
                    })}
                  </span>
                )}
                <span>{t('common.pageShort', { n: num(doc.pages) })}</span>
              </p>
            )}
          </div>
          {doc && !reading && chapters.length > 0 && (
            <div className="read-chapters">
              <h3 className="block-title">{t('read.chapters')}</h3>
              <div className="table-wrap">
                <table className="table read-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('read.col.id')}</th>
                      {p.plan && <th scope="col">{t('read.col.title')}</th>}
                      <th scope="col">{t('read.col.pdfTitle')}</th>
                      <th scope="col" className="num">
                        {t('read.col.pages')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {chapters.map((c) => (
                      <tr key={c.id}>
                        <td className="mono muted">{c.id}</td>
                        {p.plan && <td dir="auto">{planTitle(c.id) ?? ''}</td>}
                        <td dir="auto" className="pdf-title">
                          {c.title}
                        </td>
                        <td className="num mono">
                          <bdi dir="ltr">
                            {num(c.start)}–{num(c.end)}
                          </bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {extra.length > 0 && (
                <p className="hint">
                  {t('read.extraPages', { from: num(extra[0]!.start), to: num(extra.at(-1)!.end) })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="sheet read-again" aria-labelledby="read-again">
        <h2 id="read-again" className="block-title">
          {doc ? t('read.again') : t('read.run')}
        </h2>
        {p.roles.vision?.error && ocr !== 'never' && <Notice tone="warn">{t('read.noVision')}</Notice>}
        <div className="read-again-row">
          <Field label={t('read.pages')} hint={t('read.pagesHint')}>
            {(id, d) => (
              <input
                id={id}
                className="pages-input"
                value={pages}
                onChange={(e) => {
                  setPages(e.target.value);
                  setPagesError('');
                }}
                placeholder={doc ? `1-${doc.pages}` : '1-20'}
                dir="ltr"
                aria-describedby={pagesError ? `${d} pages-error` : d}
                aria-invalid={!!pagesError || undefined}
              />
            )}
          </Field>
          <fieldset className="field ocr-choice">
            <legend>{t('read.ocr')}</legend>
            {/* the fieldset groups the radios; they look like a segmented control */}
            <div className="seg">
              {(['auto', 'never', 'always'] as const).map((o) => (
                <label key={o} className={ocr === o ? 'is-on' : ''}>
                  <input
                    type="radio"
                    name="ocr"
                    className="visually-hidden"
                    checked={ocr === o}
                    onChange={() => setOcr(o)}
                  />
                  {t(`read.ocr.${o}`)}
                </label>
              ))}
            </div>
            <p className="hint">{t('read.ocr.help')}</p>
          </fieldset>
          <div className="read-go">
            <Button
              variant={doc ? 'default' : 'primary'}
              icon={doc ? 'regenerate' : undefined}
              busy={reading}
              disabled={!canRead}
              onClick={read}
            >
              {doc ? t('read.again') : t('read.run')}
            </Button>
            <span className="mono muted small">{costNote}</span>
          </div>
        </div>
        {pagesError && (
          <p className="field-error" id="pages-error">
            {pagesError}
          </p>
        )}
      </section>

      {doc && !reading && !p.plan && (
        <section className="sheet next-card" aria-labelledby="read-next">
          <div>
            <h2 id="read-next" className="block-title">
              {t('read.next')}
            </h2>
            <p className="hint">{t('read.nextBody')}</p>
          </div>
          <div className="next-go">
            {estimate?.plan ? (
              <span className="mono muted small">{t('learn.est.cost', { cost: usd(estimate.plan) })}</span>
            ) : null}
            <Button variant="primary" busy={live.has('plan')} onClick={() => run('plan')}>
              {t('plan.draft')}
              <Icon name="next" className="flip-rtl" />
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

/* ---------- ② plan ---------- */

type PlanChapterT = BookPlan['chapters'][number];

/** What the teacher changed in a chapter since the plan was last saved (one line, the most telling). */
function changeOf(now: PlanChapterT, before: PlanChapterT | undefined): MsgKey | null {
  if (!before) return null;
  if (now.objectives.length > before.objectives.length) return 'plan.edited.objectiveAdded';
  if (now.objectives.length < before.objectives.length) return 'plan.edited.objectiveRemoved';
  if (now.objectives.join('\n') !== before.objectives.join('\n')) return 'plan.edited.objectives';
  if (now.title !== before.title) return 'plan.edited.title';
  if (now.minutes !== before.minutes) return 'plan.edited.minutes';
  return null;
}

/** Consecutive chapters of the same unit, as the plan lists them (a book's table of contents). */
function unitsOf(plan: BookPlan): { name: string; rows: { c: PlanChapterT; i: number }[] }[] {
  const out: { name: string; rows: { c: PlanChapterT; i: number }[] }[] = [];
  plan.chapters.forEach((c, i) => {
    const name = c.unit ?? plan.title;
    const last = out.at(-1);
    if (last && last.name === name) last.rows.push({ c, i });
    else out.push({ name, rows: [{ c, i }] });
  });
  return out;
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The objectives, one per line. The box keeps what you type (an empty line while you start a new objective);
 * the plan gets the lines that have words, at most 6, and never none.
 */
function ObjectivesBox({ lines, label, onLines }: { lines: string[]; label: string; onLines: (l: string[]) => void }) {
  const [text, setText] = useState(lines.join('\n'));
  const typing = useRef(false);
  const joined = lines.join('\n');
  useEffect(() => {
    if (!typing.current) setText(joined);
  }, [joined]);
  return (
    <textarea
      aria-label={label}
      rows={Math.max(2, text.split('\n').length)}
      value={text}
      dir="auto"
      onFocus={() => {
        typing.current = true;
      }}
      onBlur={() => {
        typing.current = false;
        setText(joined);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const kept = e.target.value
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 6);
        if (kept.length) onLines(kept);
      }}
    />
  );
}

function PlanStep({ p, run, live, reload, estimate }: StepProps) {
  const { t, num, langName, usd, ago, locale } = useI18n();
  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<BookPlan | null>(p.plan);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  useUnsavedGuard(dirty);
  const [busy, setBusy] = useState<'' | 'save' | 'approve'>('');
  const [error, setError] = useState('');
  const added = useRef(-1);
  const server = useRef(JSON.stringify(p.plan));
  useEffect(() => {
    // the book reloads after any job: the same plan keeps the edits; a new one (a redraft, Undo) replaces them
    const now = JSON.stringify(p.plan);
    if (now === server.current) return;
    server.current = now;
    setDraft(p.plan);
    setDirty(false);
  }, [p.plan]);
  // after Approve, Edit the plan or Close the button that had the focus is gone: the plan's title takes it
  const focusTitle = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: after those switches
  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    document.getElementById('plan-title')?.focus({ preventScroll: true });
  }, [editing, draft?.status]);
  // a new glossary row: its first cell takes the focus
  // biome-ignore lint/correctness/useExhaustiveDependencies: after a row is added
  useEffect(() => {
    if (added.current < 0) return;
    document.querySelector<HTMLInputElement>(`#gloss-${added.current} input`)?.focus();
    added.current = -1;
  }, [draft?.glossary.length]);

  if (!draft) {
    if (!p.document) return <Notice>{p.lessons.length ? t('plan.noPlan') : t('plan.needsRead')}</Notice>;
    return (
      <section className="sheet next-card" aria-labelledby="plan-first">
        <div>
          <h2 id="plan-first" className="block-title">
            {t('read.next')}
          </h2>
          <p className="hint">{t('read.nextBody')}</p>
        </div>
        <div className="next-go">
          {estimate?.plan ? (
            <span className="mono muted small">{t('learn.est.cost', { cost: usd(estimate.plan) })}</span>
          ) : null}
          <Button variant="primary" busy={live.has('plan')} onClick={() => run('plan')}>
            {t('plan.draft')}
            <Icon name="next" className="flip-rtl" />
          </Button>
        </div>
      </section>
    );
  }

  const saved = p.plan;
  const made = new Set(p.lessons.map((l) => l.id));
  const costOf = (id: string) => estimate?.chapters?.[id];
  const spread = estimate?.spread ?? 2.2;
  // what making the ticked chapters (not made yet) costs, following the ticks before any save
  const toMake = draft.chapters.filter((c) => c.include && !made.has(c.id));
  const sum = toMake.reduce((a, c) => a + (costOf(c.id) ?? 0), 0);
  // a range of money reads left to right in every language (isolated inside Arabic text)
  const range = sum > 0 ? `\u2066${usd(sum)}–${usd(sum * spread)}\u2069` : '';

  const edit = (fn: (d: BookPlan) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setDirty(true);
  };
  const save = async (): Promise<boolean> => {
    setError('');
    try {
      await api.savePlan(p.id, draft);
      setDirty(false);
      return true;
    } catch (e) {
      setError(errorText(e, t));
      return false;
    }
  };
  const approve = async () => {
    setBusy('approve');
    if (dirty && !(await save())) return setBusy('');
    try {
      await api.approvePlan(p.id);
      await reload();
      focusTitle.current = true;
      setEditing(false);
      // a result, with a way back
      toast({
        text: t('plan.approvedToast'),
        action: {
          label: t('common.undo'),
          // back to a draft: the plan as the server has it now (a later edit and save is kept)
          run: () =>
            void api
              .project(p.id)
              .then((d) => (d.plan ? api.savePlan(p.id, { ...d.plan, status: 'draft' }) : undefined))
              .then(() => reload())
              .catch((e) => toast({ text: errorText(e, t), tone: 'error' })),
        },
      });
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy('');
  };
  const redraft = async () => {
    const ok = await confirm({
      title: t('plan.redraftConfirm'),
      ...(estimate?.plan ? { body: t('plan.redraftBody', { cost: usd(estimate.plan) }) } : {}),
      confirm: t('dlg.redraft'),
      cancel: t('dlg.keepPlan'),
      danger: true,
    });
    if (ok) await run('plan', { redo: true });
  };

  const approved = draft.status === 'approved';
  const status = (
    <span className={`status-chip ${approved ? 'is-approved' : 'is-draft'}`}>
      {approved ? <Icon name="check" size={16} /> : <span className="chip-dot" aria-hidden="true" />}
      {t(`plan.status.${draft.status}`)}
    </span>
  );
  const when = p.planUpdated ? ago(p.planUpdated) : '';

  // approved: the plan reads as a table of contents; "Edit the plan" opens it again
  if (approved && !editing) {
    const left = draft.chapters.filter((c) => !c.include);
    return (
      <section className="sheet plan-sheet" aria-labelledby="plan-title">
        <div className="plan-head">
          <div className="plan-head-row">
            <h2 id="plan-title" className="card-title">
              {t('step.plan')}
            </h2>
            {status}
            <span className="hint">{when ? t('plan.approvedAgo', { ago: when }) : t('plan.approvedNote')}</span>
            <Button
              icon="edit"
              className="plan-edit"
              onClick={() => {
                focusTitle.current = true;
                setEditing(true);
              }}
            >
              {t('plan.edit')}
            </Button>
          </div>
        </div>
        {unitsOf(draft).map((u) => (
          <div key={`${u.name}-${u.rows[0]!.i}`} className="plan-unit">
            <h3 className="unit-head">
              <span className="unit-k">{t('plan.unit')}</span> <bdi>{u.name}</bdi>
            </h3>
            <ol className="toc">
              {u.rows
                .filter(({ c }) => c.include)
                .map(({ c, i }) => (
                  <li key={c.id}>
                    <span className="mono muted toc-n">{num(i + 1)}</span>
                    <bdi className="toc-title">{c.title}</bdi>
                    <span className="mono muted">
                      {t('common.pageRange', { from: num(c.pages[0]), to: num(c.pages[1]) })}
                    </span>
                    <span className="mono muted">
                      {num(c.minutes)} {t('plan.minUnit')}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        ))}
        {left.length > 0 && (
          <p className="hint plan-left">
            {t('plan.leftOut', {
              n: left.length,
              chapters: list(
                // each title isolated: an Arabic title in an English sentence keeps its order
                left.map((c) =>
                  t('plan.chapterRef', { n: num(draft.chapters.indexOf(c) + 1), title: `\u2068${c.title}\u2069` }),
                ),
              ),
            })}
          </p>
        )}
      </section>
    );
  }

  const langs = [...p.book.langs].sort((a, b) => Number(b === p.document?.lang) - Number(a === p.document?.lang));
  const first = p.book.defaultLang ?? p.book.langs[0] ?? 'en';
  return (
    <section className="sheet plan-sheet" aria-labelledby="plan-title">
      <div className="plan-head">
        <div className="plan-head-row">
          <h2 id="plan-title" className="card-title">
            {t('step.plan')}
          </h2>
          {status}
          {when && !approved && <span className="hint">{t('plan.drafted', { ago: when })}</span>}
        </div>
        <Field label={t('new.audience')} className="plan-audience">
          {(id) => (
            <input
              id={id}
              value={draft.audience}
              dir="auto"
              onChange={(e) => edit((d) => void (d.audience = e.target.value))}
            />
          )}
        </Field>
      </div>

      {unitsOf(draft).map((u) => {
        const kept = u.rows.filter(({ c }) => c.include);
        const minutes = kept.reduce((a, { c }) => a + c.minutes, 0);
        return (
          <div key={`${u.name}-${u.rows[0]!.i}`} className="plan-unit">
            <div className="unit-bar">
              <h3 className="unit-head">
                <span className="unit-k">{t('plan.unit')}</span> <bdi>{u.name}</bdi>
              </h3>
              <span className="hint">
                {t('common.chapters', { n: u.rows.length })} · {t('plan.included', { n: kept.length })} ·{' '}
                {t('plan.minutesOfLessons', { n: minutes })}
              </span>
            </div>
            <ol className="plan-rows">
              {u.rows.map(({ c, i }) => {
                const change = c.include
                  ? changeOf(
                      c,
                      saved?.chapters.find((x) => x.id === c.id),
                    )
                  : null;
                const cost = costOf(c.id);
                return (
                  <li key={c.id} className={`plan-chapter${c.include ? '' : ' is-off'}${change ? ' is-edited' : ''}`}>
                    <label className="plan-tick">
                      <input
                        type="checkbox"
                        checked={c.include}
                        aria-label={t('plan.includeChapter', { n: num(i + 1) })}
                        onChange={(e) => edit((d) => void (d.chapters[i]!.include = e.target.checked))}
                      />
                    </label>
                    <span className="plan-n mono" aria-hidden="true">
                      {two(i + 1)}
                    </span>
                    <div className="plan-body">
                      <input
                        className="plan-title"
                        aria-label={t('plan.titleOf', { n: num(i + 1) })}
                        value={c.title}
                        dir="auto"
                        onChange={(e) => edit((d) => void (d.chapters[i]!.title = e.target.value))}
                      />
                      {c.include ? (
                        <>
                          {c.objectives.length > 0 && (
                            <ul className="plan-objectives" dir="auto">
                              {c.objectives.map((o, k) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: objectives are plain lines
                                <li key={k}>{o}</li>
                              ))}
                            </ul>
                          )}
                          <details className="plan-edit-objectives">
                            <summary aria-label={t('plan.editObjectivesOf', { n: num(i + 1) })}>
                              {t('plan.editObjectives')}
                            </summary>
                            <ObjectivesBox
                              lines={c.objectives}
                              label={t('plan.objectivesOf', { n: num(i + 1) })}
                              onLines={(lines) => edit((d) => void (d.chapters[i]!.objectives = lines))}
                            />
                          </details>
                          {change && (
                            <p className="plan-change">
                              <Icon name="edit" size={14} /> {t(change)}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="hint">{t('plan.skipped', { from: num(c.pages[0]), to: num(c.pages[1]) })}</p>
                      )}
                    </div>
                    <div className="plan-meta mono">
                      <span>{t('common.pageRange', { from: num(c.pages[0]), to: num(c.pages[1]) })}</span>
                      {c.include ? (
                        <label className="plan-minutes">
                          <input
                            type="number"
                            min={2}
                            max={30}
                            value={c.minutes}
                            aria-label={t('plan.minutesOf', { n: num(i + 1) })}
                            onChange={(e) =>
                              edit(
                                (d) =>
                                  void (d.chapters[i]!.minutes = Math.min(
                                    30,
                                    Math.max(2, Number(e.target.value) || 2),
                                  )),
                              )
                            }
                          />
                          <span>{t('plan.minUnit')}</span>
                        </label>
                      ) : (
                        <span>
                          {num(c.minutes)} {t('plan.minUnit')}
                        </span>
                      )}
                      {cost !== undefined && !made.has(c.id) && (
                        <span className="plan-cost">{t('common.approx', { cost: usd(cost) })}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}

      <div className="plan-glossary">
        <div className="unit-bar">
          <h3 className="block-title">{t('plan.glossary')}</h3>
          <span className="hint">{t('plan.glossaryHint')}</span>
        </div>
        {draft.glossary.length ? (
          <div className="table-wrap">
            <table className="table gloss-table">
              <thead>
                <tr>
                  {langs.map((l) => (
                    <th key={l} scope="col" lang={l} dir={dirOf(l)}>
                      {NATIVE[l] ?? langName(l)}
                    </th>
                  ))}
                  <th scope="col">{t('plan.note')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('common.remove')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.glossary.map((g, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: glossary rows have no id
                  <tr key={i} id={`gloss-${i}`}>
                    {langs.map((l) => (
                      <td key={l}>
                        <input
                          className="cell-input"
                          lang={l}
                          dir="auto"
                          aria-label={`${NATIVE[l] ?? langName(l)} ${num(i + 1)}`}
                          value={g.terms[l] ?? ''}
                          onChange={(e) => edit((d) => void (d.glossary[i]!.terms[l] = e.target.value))}
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        className="cell-input cell-note"
                        dir="auto"
                        aria-label={`${t('plan.note')} ${num(i + 1)}`}
                        value={g.note ?? ''}
                        onChange={(e) => edit((d) => void (d.glossary[i]!.note = e.target.value || undefined))}
                      />
                    </td>
                    <td className="cell-remove">
                      <Button
                        variant="quiet"
                        icon="close"
                        aria-label={t('plan.removeTermNamed', {
                          term: g.terms[first] || Object.values(g.terms).find(Boolean) || num(i + 1),
                        })}
                        onClick={() => edit((d) => void d.glossary.splice(i, 1))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t('plan.empty')}</p>
        )}
        <Button
          variant="quiet"
          icon="plus"
          className="add-term"
          onClick={() => {
            added.current = draft.glossary.length;
            edit((d) => void d.glossary.push({ terms: Object.fromEntries(langs.map((l) => [l, ''])) }));
          }}
        >
          {t('plan.addTerm')}
        </Button>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="plan-bar">
        <p className="plan-bar-text">
          {dirty && <span className="dirty">{t('common.unsaved')}</span>}
          {range && <span>{t('plan.making', { n: toMake.length, cost: range })}</span>}
        </p>
        <div className="plan-bar-actions">
          <Button variant="quiet" busy={live.has('plan')} onClick={() => void redraft()}>
            {t('plan.redraft')}
          </Button>
          <Button
            busy={busy === 'save'}
            disabled={!dirty}
            onClick={async () => {
              setBusy('save');
              if (await save()) {
                toast({ text: t('common.saved') });
                // the saved plan becomes the one edits are compared with; the rail and estimates follow
                await reload();
              }
              setBusy('');
            }}
          >
            {t('plan.save')}
          </Button>
          {!approved ? (
            <Button variant="primary" icon="check" busy={busy === 'approve'} onClick={() => void approve()}>
              {t('plan.approve')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={dirty}
              onClick={() => {
                focusTitle.current = true;
                setEditing(false);
              }}
            >
              {t('common.close')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- ③ make the lessons ---------- */

/** Speech engines by their usual names ("Also narrate with free Edge voices"). */
const ENGINES: Record<string, string> = {
  edge: 'Edge',
  azure: 'Azure Speech',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

type MakeState = 'made' | 'todo' | 'making' | 'waiting' | 'stopped';

/**
 * Make (its own card, the Make board): every chapter of the plan with what making it costs before the click, each
 * made lesson's facts (beats, problems, languages, what it cost), the chapter being made with the beat being
 * written, and a chapter stopped partway with what is left. The work itself shows in the tray.
 */
function MakeStep({ p, status, run, reload, estimate }: StepProps) {
  const { t, usd, langName } = useI18n();
  const confirm = useConfirm();
  const jobs = useJobs();
  const engine = p.config.tts.provider;
  const engineOff = !!status?.capabilities?.ttsUnavailable.includes(engine);
  const [narrate, setNarrate] = useState(engine !== 'none' && !engineOff);
  const approved = p.plan?.status === 'approved';
  const lessons = new Map(p.lessons.map((l) => [l.id, l]));
  const book = encodeURIComponent(p.id);

  // this book's builds: the one at work (its events say where it is) and those waiting their turn. A job just
  // started is listed as queued until the book reloads; the oldest one listed (the list is newest first) goes first
  const builds = p.jobs.filter((j) => j.type === 'build' && (j.status === 'running' || j.status === 'queued'));
  const atWork = builds.find((j) => j.status === 'running') ?? builds.at(-1);
  // its end reloads the book even when the tray follows another job
  const { events } = useJobStream(atWork?.id ?? null, () => void reload());
  const prog = useMemo(() => buildProgress(events), [events]);
  const madeNow = prog.chapters.filter((c) => c.done).length;
  // a chapter made while the job goes on to the next shows as made at once
  // biome-ignore lint/correctness/useExhaustiveDependencies: when a chapter of the running job is made
  useEffect(() => {
    if (madeNow) void reload();
  }, [madeNow]);
  const asks = (j: JobInfo, id: string) =>
    Array.isArray(j.args.chapters) ? (j.args.chapters as string[]).includes(id) : !lessons.has(id);
  const stateOf = (id: string): MakeState => {
    const c = prog.chapters.find((x) => x.id === id);
    // a chapter made in this job stays "being made" until the book reloads with its lesson (no flash of Make)
    if (c && (!c.done || !lessons.has(id))) return 'making';
    if (!c?.done && builds.some((j) => asks(j, id))) return 'waiting';
    if (p.drafts?.[id] || p.stale?.[id]) return 'stopped';
    return lessons.has(id) ? 'made' : 'todo';
  };

  // the chapters to make, numbered among themselves (as the rail's "1/3" and the tray); a book without a plan
  // lists its lessons
  const rows = p.plan
    ? p.plan.chapters.filter((c) => c.include).map((c, i) => ({ id: c.id, title: c.title, n: i + 1 }))
    : p.lessons.map((l, i) => ({ id: l.id, title: l.title[l.lang] ?? l.id, n: i + 1 }));
  // what a made chapter cost: the ledger by chapter, else this session's build results
  const session = new Map<string, number>();
  for (const j of [...p.jobs].reverse()) {
    const r = j.result as { chapters?: { chapter: string; usd: number }[] } | undefined;
    if (j.type === 'build' && r?.chapters) for (const c of r.chapters) session.set(c.chapter, c.usd);
  }
  const spentOn = (id: string) => p.ledger.byChapter?.[id] ?? session.get(id);
  // what is left to pay: the chapter's estimate, or the part of it its unwritten beats need
  const toPay = (id: string) => {
    const e = estimate?.chapters?.[id];
    const d = p.drafts?.[id];
    // only translations left: a small part the estimate doesn't single out
    if (!d && p.stale?.[id]) return undefined;
    return e === undefined ? undefined : d ? (e * (d.total - d.written)) / d.total : e;
  };
  const left = rows.filter((r) => ['todo', 'stopped'].includes(stateOf(r.id)));
  const leftCost = left.some((r) => toPay(r.id) !== undefined)
    ? left.reduce((a, r) => a + (toPay(r.id) ?? 0), 0)
    : undefined;
  const args = (ids: string[], again = false) => ({
    chapters: ids,
    narrate: narrate && !engineOff,
    ...(again ? { force: ['storyboard', 'translate'] } : {}),
  });
  // a job starts once (a double click would queue a second one): the button waits for the server, then the
  // focus goes to the row it makes, as the button is gone
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (key: string, ids: string[], again = false) => {
    if (starting) return;
    setStarting(key);
    try {
      await run('build', args(ids, again));
    } finally {
      setStarting(null);
    }
    document.getElementById(`make-row-${ids[0]}`)?.focus();
  };

  const provider = (model?: string) => {
    const id = model?.split(':')[0];
    return id === FAKE_PROVIDER.id ? FAKE_PROVIDER.name : (PROVIDERS.find((x) => x.id === id)?.name ?? id);
  };
  const writer = provider(p.roles.writer?.model);
  const set = status?.presets.find((x) => x.id === p.config.preset)?.label;

  // replacing a teacher's work is the only thing here that asks first
  const again = async (r: { id: string; n: number }) => {
    const beats = t('common.beats', { n: lessons.get(r.id)?.beats ?? 0 });
    const cost = estimate?.chapters?.[r.id];
    const ok = await confirm({
      title: t('make.againTitle', { n: r.n }),
      body: cost !== undefined ? t('make.againBody', { beats, cost: usd(cost) }) : t('make.againBodyNoCost', { beats }),
      confirm: t('dlg.rebuild'),
      cancel: t('dlg.keepLesson'),
      danger: true,
    });
    if (ok) void start(`again:${r.id}`, [r.id], true);
  };

  // where the chapter being made is: the stage, the beat being written
  const chip = (c: ChapterRun | undefined): string => {
    const busy = (l: { lang: string; state: string }[]) => l.find((x) => x.state === 'running')?.lang.toUpperCase();
    if (!c) return t('make.chip.start');
    const voice = busy(c.narrate);
    if (voice) return t('make.chip.narrate', { lang: voice });
    const lang = busy(c.translate);
    if (lang) return t('make.chip.translate', { lang });
    if (c.write === 'running') {
      const w = writingBeat(c);
      return w ? t('make.chip.write', { i: w.i, n: w.n }) : t('make.chip.writing');
    }
    if (c.storyboard === 'running') return t('make.chip.storyboard');
    return c.write === 'done' ? t('make.chip.finishing') : t('make.chip.start');
  };

  const title = (
    <h2 id="make-title" className="card-title">
      {t('step.make')}
    </h2>
  );
  if (!rows.length)
    return (
      <section className="sheet make-sheet" aria-labelledby="make-title">
        <div className="make-head">{title}</div>
        <div className="make-empty">
          <h3 className="block-title">{t('make.emptyTitle')}</h3>
          <p className="hint">{t('make.emptyBody')}</p>
          <Link className="btn btn-primary" to={`/project/${book}?step=plan`}>
            <span>{t('make.toPlan')}</span>
            <Icon name="next" className="flip-rtl" />
          </Link>
        </div>
      </section>
    );

  return (
    <section className="sheet make-sheet" aria-labelledby="make-title">
      <div className="make-head">
        <div className="make-head-start">
          {title}
          {writer && (
            <p className="make-models">
              <bdi>{set ? t('make.models', { set, writer }) : t('make.writer', { writer })}</bdi>{' '}
              <Link to="/ai">{t('learn.setup.change')}</Link>
            </p>
          )}
          {approved && engine !== 'none' && (
            <label className="check make-narrate">
              <input
                type="checkbox"
                checked={narrate && !engineOff}
                disabled={engineOff}
                onChange={(e) => setNarrate(e.target.checked)}
              />
              <span>
                {engine === 'edge'
                  ? t('make.narrateFree', { engine: ENGINES.edge! })
                  : t('make.narrate', { engine: ENGINES[engine] ?? engine })}
              </span>
              {engineOff && <span className="muted small">{t('cap.desktopOnly')}</span>}
            </label>
          )}
        </div>
        {approved && (
          <div className="make-head-end">
            {left.length ? (
              <>
                <span className="card-meta">
                  {t('make.leftN', { n: left.length })}
                  {leftCost !== undefined && ` · ${t('learn.est.cost', { cost: usd(leftCost) })}`}
                </span>
                <Button
                  variant="primary"
                  icon="play"
                  busy={starting === 'left'}
                  disabled={!!starting}
                  onClick={() =>
                    void start(
                      'left',
                      left.map((r) => r.id),
                    )
                  }
                >
                  {t('make.makeLeft', { n: left.length })}
                </Button>
              </>
            ) : (
              !builds.length && (
                <span className="card-meta make-all">
                  <Icon name="check" size={16} /> {t('make.allMade')}
                </span>
              )
            )}
          </div>
        )}
      </div>
      {p.plan && !approved && (
        <Notice
          action={
            <Link className="btn btn-default" to={`/project/${book}?step=plan`}>
              {t('make.toPlan')}
            </Link>
          }
        >
          {t('make.needsPlan')}
        </Notice>
      )}
      <ol className="make-rows">
        {rows.map((r) => {
          const l = lessons.get(r.id);
          const state = stateOf(r.id);
          const c = prog.chapters.find((x) => x.id === r.id);
          const d = p.drafts?.[r.id];
          const stale = p.stale?.[r.id];
          const spent = state === 'made' ? spentOn(r.id) : undefined;
          const pay = state === 'todo' || state === 'stopped' ? toPay(r.id) : undefined;
          return (
            <li key={r.id} id={`make-row-${r.id}`} tabIndex={-1} className={`make-row is-${state}`}>
              <span className="make-n mono">{two(r.n)}</span>
              <div className="make-main">
                <bdi className="make-title">{r.title}</bdi>
                <span className="make-meta">
                  {state === 'made' && l ? (
                    <>
                      <span>{t('common.beats', { n: l.beats })}</span>
                      {l.errors ? (
                        <span className="bad">
                          <Icon name="error" size={16} /> {t('common.errors', { n: l.errors })}
                        </span>
                      ) : l.warnings ? (
                        <span className="warn">
                          <Icon name="warn" size={16} /> {t('common.warnings', { n: l.warnings })}
                        </span>
                      ) : (
                        <span className="good">
                          <Icon name="check" size={16} /> {t('make.ok')}
                        </span>
                      )}
                      {l.errors && l.warnings ? (
                        <span className="warn">{t('common.warnings', { n: l.warnings })}</span>
                      ) : null}
                      <span className="langs mono">
                        {l.langs.map((g, i) => (
                          <Fragment key={g}>
                            {i ? ' · ' : ''}
                            <abbr title={langName(g)}>{g}</abbr>
                          </Fragment>
                        ))}
                      </span>
                      {spent !== undefined && <span className="mono">{usd(spent)}</span>}
                    </>
                  ) : state === 'making' ? (
                    <span className="make-now">{t('make.now')}</span>
                  ) : state === 'waiting' ? (
                    <span>{t('job.status.queued')}</span>
                  ) : state === 'stopped' && (d || stale) ? (
                    <span className="make-stopped">
                      {d
                        ? d.written
                          ? t('make.stopped', { b: d.written, n: d.total })
                          : t('make.stoppedNone')
                        : t('make.stoppedLangs', { langs: (stale ?? []).map((g) => g.toUpperCase()).join(' · ') })}
                    </span>
                  ) : (
                    <span>{t('make.notMade')}</span>
                  )}
                </span>
              </div>
              <div className="make-end">
                {state === 'making' ? (
                  // the chip says where the work is; the tray has the rest
                  <button type="button" className="status-chip is-running make-chip" onClick={() => jobs.show()}>
                    <span className="chip-dot" aria-hidden="true" />
                    <span aria-live="polite">{chip(c)}</span>
                  </button>
                ) : (
                  <>
                    {pay !== undefined && approved && (
                      <span className="card-meta">{t('learn.est.cost', { cost: usd(pay) })}</span>
                    )}
                    {approved && (state === 'todo' || state === 'stopped') && (
                      <Button
                        icon="play"
                        busy={starting === `row:${r.id}`}
                        disabled={!!starting}
                        onClick={() => void start(`row:${r.id}`, [r.id])}
                      >
                        {state === 'todo' ? t('make.build') : t('make.rest')}
                      </Button>
                    )}
                    {l && state !== 'waiting' && (
                      <Link className="btn btn-default" to={`/project/${book}/lesson/${encodeURIComponent(r.id)}`}>
                        <Icon name="edit" />
                        <span>{t('make.edit')}</span>
                      </Link>
                    )}
                    {approved && l && state === 'made' && (
                      <Button
                        variant="quiet"
                        busy={starting === `again:${r.id}`}
                        disabled={!!starting}
                        onClick={() => void again(r)}
                      >
                        {t('make.rebuild')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- ④ translate & narrate: pages/Languages.tsx ---------- */

/* ---------- ⑤ check and ⑥ share: pages/Check.tsx and pages/Share.tsx ---------- */

/* ---------- the page ---------- */

const STATE_KEY: Record<StepState, MsgKey> = {
  done: 'state.done',
  ready: 'state.ready',
  partial: 'state.partial',
  blocked: 'state.blocked',
  skipped: 'state.skipped',
};

function Stepper({ p, current, onSelect }: { p: ProjectDetail; current: StepId; onSelect: (s: StepId) => void }) {
  const { t, num } = useI18n();
  const ref = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the current step changes
  useEffect(() => {
    // on narrow screens the stations scroll sideways: keep the current one visible
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const ol = el?.closest('ol');
    if (el && ol && ol.scrollWidth > ol.clientWidth) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  // the facts a step has found: "48 p." read, "Draft" or "6 ch." planned, "3/6" made
  const meta = (s: StepId): string => {
    if (s === 'read' && p.document) return t('step.meta.pages', { n: num(p.document.pages) });
    if (s === 'plan' && p.plan)
      return p.plan.status === 'approved'
        ? t('step.meta.chapters', { n: num(p.plan.chapters.filter((c) => c.include).length) })
        : t('plan.status.draft');
    if (s === 'make' && p.plan?.status === 'approved') {
      const ids = p.plan.chapters.filter((c) => c.include).map((c) => c.id);
      const made = ids.filter((id) => p.lessons.some((l) => l.id === id)).length;
      return t('step.meta.made', { made, total: ids.length });
    }
    // beats that need attention in the chapters' latest checks (red pen; said in full to a screen reader)
    if (s === 'check' && p.checks) {
      // each beat once per chapter, whatever the language it was checked in
      const n = Object.values(p.checks).reduce((a, cs) => a + new Set(cs.flatMap((c) => c.flagged ?? [])).size, 0);
      if (n) return `pen:${n}`;
    }
    // languages every lesson has ("3/4"), all of them once done ("4 lang.")
    if (s === 'voice' && p.lessons.length && p.book.langs.length > 1) {
      const done = p.book.langs.filter((l) => p.lessons.every((ls) => ls.langs.includes(l))).length;
      return p.steps.voice === 'done'
        ? t('step.meta.langsDone', { n: p.book.langs.length })
        : t('step.meta.langs', { done, total: p.book.langs.length });
    }
    return '';
  };
  return (
    <nav className="stepper" aria-label={t('project.steps')} ref={ref}>
      <ol>
        {STEPS.map((s, i) => {
          const st = p.steps[s];
          return (
            <li key={s}>
              <button
                type="button"
                className={`station is-${st} ${p.next === s ? 'is-next' : ''}`}
                aria-current={current === s ? 'step' : undefined}
                onClick={() => onSelect(s)}
              >
                <span className="station-dot" aria-hidden="true">
                  {st === 'done' ? <Icon name="check" size={14} /> : num(i + 1)}
                </span>
                <span className="station-text">
                  <span className="station-name">{t(`step.${s}` as MsgKey)}</span>
                  <span className="station-state">
                    {t(STATE_KEY[st])}
                    {meta(s).startsWith('pen:') ? (
                      <span className="station-meta">
                        {' · '}
                        <span className="pen-text" aria-hidden="true">
                          {num(Number(meta(s).slice(4)))}
                        </span>
                        <span className="visually-hidden">
                          {t('step.meta.attention', { n: Number(meta(s).slice(4)) })}
                        </span>
                      </span>
                    ) : (
                      meta(s) && <span className="station-meta"> · {meta(s)}</span>
                    )}
                    {p.next === s && st !== 'done' && <span className="next-badge">{t('project.nextBadge')}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ProjectPage({ id }: { id: string }) {
  const i18n = useI18n();
  const { t, usd, lang, num } = i18n;
  const { status } = useStatus();
  const { projectActions } = useExtras();
  const { query } = useLocation();
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [estimate, setEstimate] = useState<EstimateInfo | null>(null);
  const jobs = useJobs();
  // "?step=export" is the old name of Share
  const asked = query.get('step') === 'export' ? 'share' : (query.get('step') as StepId | null);
  const wanted = asked && STEPS.includes(asked) ? asked : null;
  const [step, setStep] = useState<StepId | null>(wanted);
  // the address can change while the book stays open (Go to, the browser's Back)
  useEffect(() => setStep(wanted), [wanted]);

  const loadEstimate = useCallback(() => {
    api
      .estimate(id)
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [id]);

  const tRef = useRef(t);
  tRef.current = t;
  const load = useCallback(async () => {
    try {
      const d = await api.project(id);
      setP(d);
      setError('');
    } catch (e) {
      setError(errorText(e, tRef.current));
    }
  }, [id]);

  useEffect(() => {
    void load();
    loadEstimate();
  }, [load, loadEstimate]);

  const run: Run = useCallback(
    async (type, args = {}) => {
      setActionError('');
      try {
        const r = await api.startJob(id, type, args);
        // the work sinks to the tray, which follows you from screen to screen
        jobs.track(id, r.job);
        setP((cur) => (cur ? { ...cur, jobs: [r.job, ...cur.jobs] } : cur));
      } catch (e) {
        setActionError(errorText(e, tRef.current));
      }
    },
    [id, jobs],
  );

  const onEnd = useCallback(
    (job: JobInfo) => {
      setP((cur) => (cur ? { ...cur, jobs: cur.jobs.map((j) => (j.id === job.id ? job : j)) } : cur));
      void load();
      if (job.type !== 'estimate') loadEstimate();
    },
    [load, loadEstimate],
  );
  useEffect(() => jobs.onEnd(id, onEnd), [jobs, id, onEnd]);
  // a running job of this book (after a reload) goes back to the tray
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the book first loads
  useEffect(() => {
    const running = p?.jobs.find((j) => j.status === 'running') ?? p?.jobs.find((j) => j.status === 'queued');
    if (running && jobs.current?.jobId !== running.id) jobs.track(id, running);
  }, [p?.id]);
  // a job of this book started elsewhere (the tray's Make the rest, Go to) shows on its step
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the tray follows another job
  useEffect(() => {
    const cur = jobs.current;
    if (cur?.projectId === id && p && !p.jobs.some((j) => j.id === cur.jobId)) void load();
  }, [jobs.current?.jobId]);
  useSetPlace(p ? { book: bookPlaceOf(p, step ?? p.next, lang) } : null);

  const live = useMemo(
    () => new Set((p?.jobs ?? []).filter((j) => j.status === 'running' || j.status === 'queued').map((j) => j.type)),
    [p],
  );

  if (error && !p)
    return (
      <div className="page">
        <Notice tone="error" action={<Button onClick={() => void load()}>{t('common.retry')}</Button>}>
          {error === 'no project "' + id + '"' ? t('project.notFound') : error}
        </Notice>
      </div>
    );
  if (!p)
    return (
      <div className="page">
        <Loading />
      </div>
    );

  const current = step ?? p.next;
  // every step is its own card with its own title (redesign 4b–4f)
  const bare = true;
  const select = async (s: StepId) => {
    // a step with unsaved work (the plan) asks before it is closed
    if (s !== current && !(await confirmLeave())) return;
    setStep(s);
    navigate(`/project/${encodeURIComponent(id)}?step=${s}`, { replace: true });
  };
  const title = bookTitle(p.title, lang, p.defaultLang);
  // stay on the step whose work was just started, so its results show when it finishes
  const runHere: Run = (type, args) => {
    setStep(current);
    return run(type, args);
  };
  const props: StepProps = { p, status, run: runHere, live, reload: load, estimate };
  const Panel = {
    read: ReadStep,
    plan: PlanStep,
    make: MakeStep,
    voice: LanguagesStep,
    check: CheckStep,
    share: ShareStep,
  }[current];

  return (
    <div className="page page-project">
      <header className="project-head">
        <div className="project-title">
          <h1 className="display">
            <bdi>{title}</bdi>
          </h1>
          <div className="project-meta">
            {p.langs.map((l) => (
              <LangTag key={l} code={l} active={l === p.defaultLang} />
            ))}
            <span className="muted">{t('common.chapters', { n: p.chapters })}</span>
            {p.book.audience && (
              <span className="muted" dir="auto">
                · {p.book.audience}
              </span>
            )}
          </div>
        </div>
        <div className="project-side">
          <dl className="money">
            <div>
              <dt>{t('project.spent')}</dt>
              <dd>
                {usd(p.ledger.total)} <span className="muted small">{t('project.calls', { n: p.ledger.calls })}</span>
              </dd>
            </div>
            <div>
              <dt>{t('project.estimate')}</dt>
              <dd>
                {estimate && !estimate.error ? (
                  `≈ ${usd(estimate.p50)} – ${usd(estimate.p90)}`
                ) : (
                  <span className="muted small">{t('project.estimateNone')}</span>
                )}
              </dd>
            </div>
          </dl>
          <Link className="btn btn-default" to={`/project/${encodeURIComponent(id)}/settings`}>
            <Icon name="settings" />
            <span>{t('common.settings')}</span>
          </Link>
          {projectActions?.(id)}
        </div>
      </header>
      <p className="visually-hidden">{t('project.cached')}</p>
      <div className="project-grid">
        <Stepper p={p} current={current} onSelect={select} />
        {/* Read, Plan, Make and Translate & narrate are their own cards, each with its title (redesign 4b–4e) */}
        <section
          className={`step-panel${bare ? ' step-bare' : ' sheet'}`}
          {...(bare ? { 'aria-label': t(`step.${current}` as MsgKey) } : { 'aria-labelledby': 'step-title' })}
        >
          {!bare && (
            <h2 id="step-title" className="step-title">
              <span className="step-num" aria-hidden="true">
                {num(STEPS.indexOf(current) + 1)}
              </span>
              {t(`step.${current}` as MsgKey)}
            </h2>
          )}
          {actionError && <Notice tone="error">{actionError}</Notice>}
          <Panel {...props} />
        </section>
      </div>
    </div>
  );
}
