import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookPlan,
  EstimateInfo,
  ImproveResult,
  JobInfo,
  JobType,
  ProjectDetail,
  StatusInfo,
  StepId,
  StepState,
} from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText } from '../api';
import { withBase } from '../base';
import { JobBoard } from '../components/JobBoard';
import { Button, Field, Icon, LangTag, Loading, Notice, Toast } from '../components/ui';
import { useExtras } from '../extras';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link, navigate, useLocation } from '../router';
import { bookTitle } from './Home';

const STEPS: StepId[] = ['read', 'plan', 'make', 'voice', 'export'];

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

interface StepProps {
  p: ProjectDetail;
  status: StatusInfo | null;
  run: Run;
  live: Set<JobType>;
  reload: () => Promise<void>;
}

/* ---------- ① read the PDF ---------- */

function ReadStep({ p, status, run, live }: StepProps) {
  const { t, num, langName } = useI18n();
  const [ocr, setOcr] = useState('auto');
  const [pages, setPages] = useState('');
  const doc = p.document;
  const canRead = !!p.pdf && status?.ingest !== false;
  return (
    <>
      <p className="lede">{t('read.intro')}</p>
      {!p.pdf && <Notice>{t('read.noPdf')}</Notice>}
      {p.pdf && status && !status.ingest && <Notice tone="warn">{t('read.unavailable')}</Notice>}
      {p.pdf && (
        <div className="form-row">
          <Field label={t('read.ocr')}>
            {(id) => (
              <select id={id} value={ocr} onChange={(e) => setOcr(e.target.value)}>
                <option value="auto">{t('read.ocr.auto')}</option>
                <option value="never">{t('read.ocr.never')}</option>
                <option value="always">{t('read.ocr.always')}</option>
              </select>
            )}
          </Field>
          <Field label={t('read.pages')} hint={t('read.pagesHint')}>
            {(id, d) => (
              <input
                id={id}
                value={pages}
                onChange={(e) => setPages(e.target.value.replace(/[^\d-]/g, ''))}
                placeholder="1-40"
                dir="ltr"
                inputMode="numeric"
                aria-describedby={d}
                size={8}
              />
            )}
          </Field>
        </div>
      )}
      {p.pdf && (
        <div className="actions">
          <Button
            variant={doc ? 'default' : 'primary'}
            busy={live.has('ingest')}
            disabled={!canRead}
            onClick={() => run('ingest', { ocr, ...(/^\d+-\d+$/.test(pages) ? { pages } : {}) })}
          >
            {doc ? t('read.again') : t('read.run')}
          </Button>
          {p.roles.vision?.model && (
            <span className="muted small">{t('read.model', { model: p.roles.vision.model })}</span>
          )}
        </div>
      )}
      {doc && (
        <>
          <dl className="facts">
            {p.pdf && (
              <div>
                <dt>{t('read.file')}</dt>
                <dd>
                  <bdi>{p.pdf}</bdi>
                </dd>
              </div>
            )}
            <div>
              <dt>{t('read.col.pages')}</dt>
              <dd>{num(doc.pages)}</dd>
            </div>
            <div>
              <dt>{t('read.language')}</dt>
              <dd>{langName(doc.lang)}</dd>
            </div>
            <div>
              <dt>{t('read.blocks')}</dt>
              <dd>{num(doc.blocks)}</dd>
            </div>
          </dl>
          <h3>{t('read.how')}</h3>
          <ul className="methods">
            {Object.entries(doc.methods).map(([m, n]) => (
              <li key={m}>
                <span className={`method method-${m}`} aria-hidden="true" />
                {t(`read.method.${m}` as MsgKey)} — {t('common.pages', { n })}
              </li>
            ))}
          </ul>
          <h3>{t('read.sections')}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('read.col.section')}</th>
                  <th scope="col">{t('read.col.title')}</th>
                  <th scope="col">{t('read.col.pages')}</th>
                </tr>
              </thead>
              <tbody>
                {doc.sections.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <code>{s.id}</code>
                    </td>
                    <td dir="auto">{s.title}</td>
                    <td className="num">{t('common.pageRange', { from: s.start, to: s.end })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- ② plan ---------- */

function PlanStep({ p, run, live, reload }: StepProps) {
  const { t, langName } = useI18n();
  const [draft, setDraft] = useState<BookPlan | null>(p.plan);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'approve'>('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  useEffect(() => {
    setDraft(p.plan);
    setDirty(false);
  }, [p.plan]);

  if (!draft) {
    if (!p.document) return <Notice>{p.lessons.length ? t('plan.noPlan') : t('plan.needsRead')}</Notice>;
    return (
      <>
        <p className="lede">{t('plan.intro')}</p>
        <div className="actions">
          <Button variant="primary" busy={live.has('plan')} onClick={() => run('plan')}>
            {t('plan.draft')}
          </Button>
          {p.roles.planner?.model && (
            <span className="muted small">{t('plan.model', { model: p.roles.planner.model })}</span>
          )}
        </div>
      </>
    );
  }

  const edit = (fn: (d: BookPlan) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setDirty(true);
    setToast('');
  };
  const langs = p.book.langs;
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
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy('');
  };

  return (
    <>
      <p className="lede">{t('plan.intro')}</p>
      <div className="plan-status">
        <span className={`pill pill-${draft.status === 'approved' ? 'done' : 'queued'}`}>
          {t(`plan.status.${draft.status}`)}
        </span>
        {draft.status === 'approved' && <span className="muted">{t('plan.approvedNote')}</span>}
      </div>
      <Field label={t('plan.audience')}>
        {(id) => (
          <input
            id={id}
            value={draft.audience}
            dir="auto"
            onChange={(e) => edit((d) => void (d.audience = e.target.value))}
          />
        )}
      </Field>

      <h3>{t('plan.chapters')}</h3>
      <ol className="plan-chapters">
        {draft.chapters.map((c, i) => (
          <li key={c.id} className={`plan-chapter ${c.include ? '' : 'is-off'}`}>
            <div className="plan-chapter-top">
              <input
                type="checkbox"
                checked={c.include}
                aria-label={t('plan.includeLabel', { title: c.title })}
                title={t('plan.col.include')}
                onChange={(e) => edit((d) => void (d.chapters[i]!.include = e.target.checked))}
              />
              <code className="muted small">{c.id}</code>
              <input
                className="plan-title"
                aria-label={`${t('plan.col.title')} ${c.id}`}
                value={c.title}
                dir="auto"
                onChange={(e) => edit((d) => void (d.chapters[i]!.title = e.target.value))}
              />
            </div>
            <div className="plan-chapter-meta">
              <span className="muted small num">{t('common.pageRange', { from: c.pages[0], to: c.pages[1] })}</span>
              <label className="plan-minutes">
                <span className="small">{t('plan.col.minutes')}</span>
                <input
                  className="num-input"
                  type="number"
                  min={2}
                  max={30}
                  value={c.minutes}
                  onChange={(e) =>
                    edit((d) => void (d.chapters[i]!.minutes = Math.min(30, Math.max(2, Number(e.target.value) || 2))))
                  }
                />
              </label>
            </div>
            <label className="plan-objectives">
              <span className="small muted">{t('plan.col.objectives')}</span>
              <textarea
                rows={Math.max(2, c.objectives.length)}
                value={c.objectives.join('\n')}
                dir="auto"
                onChange={(e) => edit((d) => void (d.chapters[i]!.objectives = e.target.value.split('\n').slice(0, 6)))}
              />
            </label>
          </li>
        ))}
      </ol>

      <h3>{t('plan.glossary')}</h3>
      <p className="hint">{t('plan.glossaryHint')}</p>
      {draft.glossary.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {langs.map((l) => (
                  <th key={l} scope="col">
                    {langName(l)}
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
                <tr key={i}>
                  {langs.map((l) => (
                    <td key={l}>
                      <input
                        className="cell-input"
                        lang={l}
                        dir="auto"
                        aria-label={`${langName(l)} ${i + 1}`}
                        value={g.terms[l] ?? ''}
                        onChange={(e) => edit((d) => void (d.glossary[i]!.terms[l] = e.target.value))}
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      className="cell-input"
                      dir="auto"
                      aria-label={`${t('plan.note')} ${i + 1}`}
                      value={g.note ?? ''}
                      onChange={(e) => edit((d) => void (d.glossary[i]!.note = e.target.value || undefined))}
                    />
                  </td>
                  <td>
                    <Button
                      variant="quiet"
                      icon="x"
                      aria-label={t('plan.removeTerm')}
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
        onClick={() => edit((d) => void d.glossary.push({ terms: Object.fromEntries(langs.map((l) => [l, ''])) }))}
      >
        {t('plan.addTerm')}
      </Button>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions sticky-actions">
        {draft.status !== 'approved' && (
          <Button variant="primary" busy={busy === 'approve'} onClick={approve}>
            {t('plan.approve')}
          </Button>
        )}
        <Button
          busy={busy === 'save'}
          disabled={!dirty}
          onClick={async () => {
            setBusy('save');
            if (await save()) setToast(t('common.saved'));
            setBusy('');
          }}
        >
          {t('plan.save')}
        </Button>
        <Button
          variant="quiet"
          busy={live.has('plan')}
          onClick={() => window.confirm(t('plan.redraftConfirm')) && run('plan', { redo: true })}
        >
          {t('plan.redraft')}
        </Button>
        {dirty && <span className="dirty">{t('common.unsaved')}</span>}
        {toast && !dirty && <Toast>{toast}</Toast>}
      </div>
    </>
  );
}

/* ---------- ③ make lessons ---------- */

function MakeStep({ p, status, run, live }: StepProps) {
  const { t, usd } = useI18n();
  const engine = p.config.tts.provider;
  const engineOff = !!status?.capabilities?.ttsUnavailable.includes(engine);
  const [narrate, setNarrate] = useState(engine !== 'none' && !engineOff);
  const approved = p.plan?.status === 'approved';
  const lessons = new Map(p.lessons.map((l) => [l.id, l]));
  const rows = p.plan
    ? p.plan.chapters.filter((c) => c.include).map((c) => ({ id: c.id, title: c.title }))
    : p.lessons.map((l) => ({ id: l.id, title: l.title[l.lang] ?? l.id }));
  // cost per chapter from the latest build jobs of this session
  const cost = new Map<string, number>();
  for (const j of [...p.jobs].reverse()) {
    const r = j.result as { chapters?: { chapter: string; usd: number }[] } | undefined;
    if (j.type === 'build' && r?.chapters) for (const c of r.chapters) cost.set(c.chapter, c.usd);
  }
  const args = (ids?: string[], again = false) => ({
    ...(ids ? { chapters: ids } : {}),
    narrate,
    ...(again ? { force: ['storyboard', 'translate'] } : {}),
  });
  return (
    <>
      <p className="lede">{t('make.intro')}</p>
      {!approved && !p.lessons.length && <Notice>{t('make.needsPlan')}</Notice>}
      {approved && (
        <div className="actions">
          <Button variant="primary" busy={live.has('build')} onClick={() => run('build', args())}>
            {t('make.buildAll')}
          </Button>
          <label className="check">
            <input
              type="checkbox"
              checked={narrate && !engineOff}
              disabled={engine === 'none' || engineOff}
              onChange={(e) => setNarrate(e.target.checked)}
            />
            <span>{t('make.narrate', { engine })}</span>
          </label>
          {engineOff && <span className="muted small">{t('cap.desktopOnly')}</span>}
          {p.roles.writer?.model && (
            <span className="muted small">{t('make.model', { model: p.roles.writer.model })}</span>
          )}
        </div>
      )}
      <ol className="chapters">
        {rows.map((r) => {
          const l = lessons.get(r.id);
          const c = cost.get(r.id);
          return (
            <li key={r.id} className={`chapter ${l ? 'is-made' : ''}`}>
              <div className="chapter-main">
                <code className="chapter-id">{r.id}</code>
                <span className="chapter-title" dir="auto">
                  {r.title}
                </span>
              </div>
              <div className="chapter-meta">
                {l ? (
                  <>
                    <span>{t('common.beats', { n: l.beats })}</span>
                    {l.errors ? (
                      <span className="bad">{t('common.errors', { n: l.errors })}</span>
                    ) : (
                      <span className="good">{t('make.ok')}</span>
                    )}
                    {l.warnings ? <span className="warn">{t('common.warnings', { n: l.warnings })}</span> : null}
                    <span className="langs">
                      {l.langs.map((g) => (
                        <LangTag key={g} code={g} />
                      ))}
                    </span>
                  </>
                ) : (
                  <span className="muted">{t('make.notMade')}</span>
                )}
                {c !== undefined && <span className="muted">{t('make.cost', { usd: usd(c) })}</span>}
              </div>
              <div className="chapter-actions">
                {l && (
                  <Link
                    className="btn btn-default"
                    to={`/project/${encodeURIComponent(p.id)}/lesson/${encodeURIComponent(r.id)}`}
                  >
                    <Icon name="gear" />
                    <span>{t('make.edit')}</span>
                  </Link>
                )}
                {approved && (
                  <Button
                    variant={l ? 'quiet' : 'default'}
                    onClick={() => {
                      if (l && !window.confirm(t('make.rebuildConfirm', { title: r.title }))) return;
                      void run('build', args([r.id], !!l));
                    }}
                  >
                    {l ? t('make.rebuild') : t('make.build')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ---------- ④ translate & narrate ---------- */

function VoiceStep({ p, status, run, live }: StepProps) {
  const { t, langName } = useI18n();
  const engine = p.config.tts.provider;
  const engineOff = !!status?.capabilities?.ttsUnavailable.includes(engine);
  // a language needs translating unless every lesson is written in it
  const isAuthor = (l: string) => p.lessons.length > 0 && p.lessons.every((ls) => ls.lang === l);
  return (
    <>
      <p className="lede">{t('voice.intro')}</p>
      {p.lessons.some((ls) => ls.langs.length > 1) && (
        <div className="actions">
          <Link className="btn btn-default" to={`/project/${encodeURIComponent(p.id)}/review`}>
            <Icon name="check" />
            <span>{t('review.open')}</span>
          </Link>
        </div>
      )}
      <p className="engine-line">
        <span>{t('voice.engine', { engine })}</span>
        <Link to={`/project/${encodeURIComponent(p.id)}/settings#speech`}>{t('voice.change')}</Link>
      </p>
      {engine === 'none' && <Notice>{t('voice.none')}</Notice>}
      {engineOff && <Notice tone="warn">{t('cap.engine', { engine })}</Notice>}
      <div className="table-wrap">
        <table className="table voice-table">
          <thead>
            <tr>
              <th scope="col">{t('voice.lesson')}</th>
              {p.book.langs.map((l) => (
                <th key={l} scope="col">
                  <span lang={l}>{langName(l)}</span>
                  <div className="th-actions">
                    {!isAuthor(l) && (
                      <Button
                        variant="quiet"
                        busy={live.has('translate')}
                        disabled={!p.lessons.length}
                        onClick={() => run('translate', { lang: l })}
                      >
                        {t('voice.translate', { lang: langName(l) })}
                      </Button>
                    )}
                    {engine !== 'none' && !engineOff && (
                      <Button
                        variant="quiet"
                        busy={live.has('narrate')}
                        disabled={!p.lessons.length}
                        onClick={() => run('narrate', { lang: l })}
                      >
                        {t('voice.narrate', { lang: langName(l) })}
                      </Button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.lessons.map((ls) => (
              <tr key={ls.id}>
                <th scope="row">
                  <code>{ls.id}</code> <span dir="auto">{ls.title[ls.lang]}</span>
                </th>
                {p.book.langs.map((l) => {
                  const has = ls.langs.includes(l);
                  return (
                    <td key={l}>
                      <span className={has ? 'good' : 'muted'}>
                        {l === ls.lang ? t('voice.author') : has ? t('voice.translated') : t('voice.missing')}
                      </span>
                      {has && (
                        <span className={ls.hasAudio[l] ? 'good audio-mark' : 'muted audio-mark'}>
                          {ls.hasAudio[l] ? `♪ ${t('voice.audio')}` : t('voice.noAudio')}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- ⑤ export ---------- */

function ExportStep({ p, status, run, live }: StepProps) {
  const { t, ago } = useI18n();
  const ex = p.exportInfo;
  const qa = status?.qa !== false;
  return (
    <>
      <p className="lede">{t('export.intro')}</p>
      <div className="actions">
        <Button
          variant={ex.exported ? 'default' : 'primary'}
          busy={live.has('export')}
          disabled={!p.lessons.length}
          onClick={() => run('export')}
        >
          {ex.exported ? t('export.again') : t('export.run')}
        </Button>
        {ex.exported && (
          <a
            className="btn btn-primary"
            href={withBase(`/books/${encodeURIComponent(p.id)}/`)}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="external" />
            <span>{t('export.open')}</span>
          </a>
        )}
        {ex.zip && (
          <a className="btn btn-default" href={withBase(`/api/projects/${encodeURIComponent(p.id)}/download`)} download>
            <Icon name="download" />
            <span>{t('export.download')}</span>
          </a>
        )}
      </div>
      {ex.at && <p className="muted">{t('export.last', { when: ago(ex.at) })}</p>}
      <div className="qa-box">
        <Button variant="quiet" busy={live.has('qa')} disabled={!p.lessons.length || !qa} onClick={() => run('qa')}>
          {t('export.qa')}
        </Button>
        <p className="hint">{qa ? t('export.qaHint') : t('cap.qa')}</p>
      </div>
      <ImproveBox p={p} status={status} run={run} live={live} />
      <PanelBox p={p} status={status} run={run} live={live} />
    </>
  );
}

/* ---------- improve with the judge ---------- */

function ImproveBox({ p, status, run, live }: Omit<StepProps, 'reload'>) {
  const { t, num, langName } = useI18n();
  const [lesson, setLesson] = useState('');
  const [threshold, setThreshold] = useState(4);
  const can = !status?.capabilities?.jobsUnavailable.includes('improve');
  const engine = p.config.tts.provider;
  const canNarrate = engine !== 'none' && !status?.capabilities?.ttsUnavailable.includes(engine);
  // the latest finished improve job of this session carries the report
  const last = p.jobs.find((j) => j.type === 'improve' && j.status === 'done');
  const report = (last?.result as ImproveResult | undefined)?.lessons ?? [];
  const rewritten = report.filter((r) => r.rewritten.length).map((r) => r.lesson);
  const again = async () => {
    const author = new Map(p.lessons.map((l) => [l.id, l.lang]));
    const langs = p.book.langs.filter((l) => rewritten.some((id) => author.get(id) !== l));
    if (langs.length) await run('translate', { langs, chapters: rewritten });
    if (canNarrate) await run('narrate', { chapters: rewritten });
  };
  return (
    <section className="quality-box" aria-labelledby="improve-title">
      <h3 id="improve-title">{t('improve.title')}</h3>
      <p className="hint">{can ? t('improve.intro') : t('cap.improve')}</p>
      {can && (
        <>
          <div className="form-row">
            <Field label={t('improve.chapter')}>
              {(fid) => (
                <select id={fid} value={lesson} onChange={(e) => setLesson(e.target.value)} disabled={!can}>
                  <option value="">{t('improve.all')}</option>
                  {p.lessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id} · {l.title[l.lang] ?? l.id}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('improve.threshold')}>
              {(fid) => (
                <select
                  id={fid}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  disabled={!can}
                >
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {num(n)} / {num(5)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="actions">
            <Button
              busy={live.has('improve')}
              disabled={!p.lessons.length || !can}
              onClick={() => run('improve', { ...(lesson ? { chapters: [lesson] } : {}), threshold })}
            >
              {t('improve.run')}
            </Button>
          </div>
        </>
      )}
      {report.map((r) => {
        const after = new Map(r.after.map((b) => [b.id, b.score]));
        const failed = new Map(r.failed.map((f) => [f.id, f.error]));
        return (
          <div key={r.lesson} className="improve-report">
            <h4>{t('improve.report', { lesson: r.lesson })}</h4>
            {!r.rewritten.length && !r.failed.length ? <p className="muted">{t('improve.nothing')}</p> : null}
            <div className="table-wrap">
              <table className="table report-table">
                <thead>
                  <tr>
                    <th scope="col">{t('improve.beat')}</th>
                    <th scope="col" className="num">
                      {t('improve.before')}
                    </th>
                    <th scope="col" className="num">
                      {t('improve.after')}
                    </th>
                    <th scope="col">{t('improve.result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.before.map((b) => {
                    const state = failed.has(b.id) ? 'failed' : r.rewritten.includes(b.id) ? 'rewritten' : 'kept';
                    return (
                      <tr key={b.id}>
                        <td>
                          <code>{b.id}</code>
                          {b.problem && (
                            <span className="muted small" dir="auto">
                              {' '}
                              · {b.problem}
                            </span>
                          )}
                        </td>
                        <td className="num">{num(b.score)}</td>
                        <td className="num">{after.has(b.id) ? num(after.get(b.id)!) : '–'}</td>
                        <td className={state === 'failed' ? 'bad' : state === 'rewritten' ? 'good' : 'muted'}>
                          {t(`improve.status.${state}` as MsgKey)}
                          {failed.get(b.id) && (
                            <span className="small" dir="auto">
                              {' '}
                              · {failed.get(b.id)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {!!rewritten.length && (
        <Notice
          tone="warn"
          action={
            <Button busy={live.has('translate') || live.has('narrate')} onClick={() => void again()}>
              {t('improve.redoRun')}
            </Button>
          }
        >
          {t('improve.redo')}
          {p.book.langs.length > 1 && (
            <span className="muted small"> ({p.book.langs.map((l) => langName(l)).join(', ')})</span>
          )}
        </Notice>
      )}
    </section>
  );
}

/* ---------- teacher review kit ---------- */

function PanelBox({ p, status, run, live }: Omit<StepProps, 'reload'>) {
  const { t, ago } = useI18n();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const can = !status?.capabilities?.jobsUnavailable.includes('panel');
  const ids = chosen ?? p.lessons.map((l) => l.id);
  return (
    <section className="quality-box" aria-labelledby="panel-title">
      <h3 id="panel-title">{t('panel.title')}</h3>
      <p className="hint">{can ? t('panel.intro') : t('cap.panel')}</p>
      {can && p.lessons.length > 1 && (
        <fieldset className="field">
          <legend>{t('panel.chapters')}</legend>
          <div className="checks">
            {p.lessons.map((l) => (
              <label key={l.id} className="check">
                <input
                  type="checkbox"
                  checked={ids.includes(l.id)}
                  onChange={(e) => setChosen(e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id))}
                />
                <span dir="auto">
                  {l.id} · {l.title[l.lang] ?? l.id}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {can && (
        <div className="actions">
          <Button
            busy={live.has('panel')}
            disabled={!ids.length || !can}
            onClick={() => run('panel', { chapters: ids })}
          >
            {t('panel.run')}
          </Button>
          {can && p.panelKit && (
            <>
              <a
                className="btn btn-default"
                href={withBase(`/api/projects/${encodeURIComponent(p.id)}/panel/kit.zip`)}
                download
              >
                <Icon name="download" />
                <span>{t('panel.zip')}</span>
              </a>
              <a
                className="btn btn-quiet"
                href={withBase(`/api/projects/${encodeURIComponent(p.id)}/panel/key.json`)}
                download
              >
                <Icon name="key" />
                <span>{t('panel.key')}</span>
              </a>
            </>
          )}
        </div>
      )}
      {can && p.panelKit && (
        <p className="hint">
          {t('panel.last', { when: ago(p.panelKit.at) })} · {t('panel.keyHint')}
        </p>
      )}
    </section>
  );
}

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
  const [jobId, setJobId] = useState<string | null>(null);
  const [step, setStep] = useState<StepId | null>((query.get('step') as StepId) || null);

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
      setJobId(
        (cur) =>
          cur ?? d.jobs.find((j) => j.status === 'running' || j.status === 'queued')?.id ?? d.jobs[0]?.id ?? null,
      );
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
        setJobId(r.jobId);
        setP((cur) => (cur ? { ...cur, jobs: [r.job, ...cur.jobs] } : cur));
      } catch (e) {
        setActionError(errorText(e, tRef.current));
      }
    },
    [id],
  );

  const onEnd = useCallback(
    (job: JobInfo) => {
      setP((cur) => (cur ? { ...cur, jobs: cur.jobs.map((j) => (j.id === job.id ? job : j)) } : cur));
      void load();
      if (job.type !== 'estimate') loadEstimate();
    },
    [load, loadEstimate],
  );

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
  const select = (s: StepId) => {
    setStep(s);
    navigate(`/project/${encodeURIComponent(id)}?step=${s}`, { replace: true });
  };
  const title = bookTitle(p.title, lang, p.defaultLang);
  // stay on the step whose work was just started, so its results show when it finishes
  const runHere: Run = (type, args) => {
    setStep(current);
    return run(type, args);
  };
  const props: StepProps = { p, status, run: runHere, live, reload: load };
  const Panel = { read: ReadStep, plan: PlanStep, make: MakeStep, voice: VoiceStep, export: ExportStep }[current];

  return (
    <div className="page page-project">
      <nav className="crumbs" aria-label="breadcrumb">
        <Link to="/">{t('project.books')}</Link>
      </nav>
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
            <Icon name="gear" />
            <span>{t('common.settings')}</span>
          </Link>
          {projectActions?.(id)}
        </div>
      </header>
      <p className="visually-hidden">{t('project.cached')}</p>
      <div className="project-grid">
        <Stepper p={p} current={current} onSelect={select} />
        <section className="step-panel sheet" aria-labelledby="step-title">
          <h2 id="step-title" className="step-title">
            <span className="step-num" aria-hidden="true">
              {num(STEPS.indexOf(current) + 1)}
            </span>
            {t(`step.${current}` as MsgKey)}
          </h2>
          {actionError && <Notice tone="error">{actionError}</Notice>}
          <Panel {...props} />
        </section>
        <JobBoard jobId={jobId} jobs={p.jobs} onSelect={setJobId} onEnd={onEnd} />
      </div>
    </div>
  );
}
