// One language's review queue (the Languages board): every text of the book, or of one chapter, beside its
// translation, with the marks and formulas locked, the glossary term it should use, what blocks approving, the texts
// whose original changed since, and the spreadsheet round trip. Rows needing a person come first; a row changed here
// stays in place until the filter, the chapter or the language changes.
import { dirOf, langInfo } from '@warqa/i18n';
import { type ChangeEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobType, ReviewImportResult, ReviewInfo, ReviewItem, ReviewState } from '../../../shared/types';
import { api, errorText } from '../../api';
import { useJobs } from '../../components/JobBoard';
import { useToast } from '../../components/overlays';
import { SideSheet } from '../../components/SideSheet';
import { useOfflineBook, useOnline } from '../../components/states';
import { Button, Icon, Loading, Notice } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { MsgKey } from '../../messages';
import { needsNet } from '../../net';
import { SourceText, TranslationBox, type TranslationBoxHandle } from './Editor';
import { changeOf, liveProblems, putBack, staleRanges, termRanges } from './tokens';

type Filter = 'all' | 'machine' | 'flagged' | 'stale' | 'missing' | 'checked';
const FILTERS: Filter[] = ['all', 'machine', 'flagged', 'stale', 'missing', 'checked'];
const FIRST = 20;
const MORE = 100;

const rowKey = (i: Pick<ReviewItem, 'lesson' | 'key'>) => `${i.lesson}|${i.key}`;
const isChecked = (s: ReviewState) => s === 'approved' || s === 'edited';
const matches = (i: ReviewItem, f: Filter): boolean =>
  f === 'all' ? true : f === 'flagged' ? i.problems.length > 0 : f === 'checked' ? isChecked(i.state) : i.state === f;
/** Rows needing a person first: problems, then the rest unchecked, the checked ones last. */
const rank = (i: ReviewItem) => (i.problems.length ? 0 : isChecked(i.state) ? 2 : 1);

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

/** "Chapter 5 · Beat 3, The rule · narration". */
function useWhere() {
  const { t } = useI18n();
  return (i: ReviewItem) => {
    const field =
      i.field === 'part' && i.part ? `${i.part.type} › ${i.part.path}` : t(`review.field.${i.field}` as MsgKey);
    // its number among the chapters to make, or its id in a book without a plan
    const n = i.chapter ?? i.lesson;
    return i.beat
      ? { text: t('review.where', { n, b: i.beat.n, title: i.beat.title }), field }
      : { text: t('review.whereLesson', { n }), field };
  };
}

function Row({
  item,
  srcLang,
  lang,
  draft,
  busy,
  error,
  editing,
  again,
  perString,
  boxRef,
  onDraft,
  onSave,
  onApprove,
  onKeep,
  onAgain,
  onEdit,
}: {
  item: ReviewItem;
  srcLang: string;
  lang: string;
  draft: string | undefined;
  busy: boolean;
  error: string | undefined;
  editing: boolean;
  again: boolean;
  perString: number | undefined;
  boxRef: (h: TranslationBoxHandle | null) => void;
  onDraft: (text: string) => void;
  onSave: () => void;
  onApprove: () => void;
  onKeep: () => void;
  onAgain: () => void;
  onEdit: () => void;
}) {
  const { t, langName, usd, locale, dir: uiDir } = useI18n();
  const where = useWhere()(item);
  const box = useRef<TranslationBoxHandle | null>(null);
  const text = draft ?? item.text;
  const dirty = draft !== undefined && draft !== item.text;
  const live = liveProblems(item.source, text, item.kind);
  const blocking = live.length > 0;
  const lost = live.flatMap((p) => (p.code === 'dollars' ? [] : p.lost));
  const glossMiss = item.problems.filter((p) => p.code === 'glossary');
  const nProblems = live.reduce((a, p) => a + Math.max(1, p.lost.length + p.extra.length), 0) + glossMiss.length;
  const checked = isChecked(item.state) && !editing;
  const change = item.state === 'stale' && item.before !== undefined ? changeOf(item.before, item.source) : null;
  const firstLost = lost[0];
  const hole = firstLost ? putBack(item.source, text, firstLost, item.kind) : undefined;
  const base = `rv-${item.lesson}-${item.key}`.replace(/[^\w-]+/g, '-');
  const date = (at: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(at));
    } catch {
      return at.slice(0, 10);
    }
  };
  const chip = nProblems ? (
    <span className="rv-chip is-problem">{t('tr.problems', { n: nProblems })}</span>
  ) : item.state === 'machine' ? (
    <span className="rv-chip is-machine">{t('review.state.machine')}</span>
  ) : item.state === 'stale' ? (
    <span className="rv-chip is-stale">
      <span className="chip-dot" aria-hidden="true" />
      {t('review.state.stale')}
    </span>
  ) : item.state === 'missing' ? (
    <span className="rv-chip is-machine">{t('review.state.missing')}</span>
  ) : (
    <span className="rv-chip is-checked">
      <Icon name="check" size={14} />
      {t('review.state.checked', {
        who: t(item.reviewed?.by === 'sheet' ? 'review.by.sheet' : 'review.by.you'),
        date: item.reviewed ? date(item.reviewed.at) : '',
      })}
    </span>
  );
  const terms = item.glossary.filter((g) => g.used).flatMap((g) => termRanges(text, g.expected));
  return (
    <li
      className={`rv-row is-${nProblems ? 'problem' : checked ? 'checked' : item.state}`}
      aria-labelledby={`${base}-where`}
    >
      <div className="rv-head">
        <span id={`${base}-where`} className="rv-where">
          <bdi>{where.text}</bdi> · <span className="mono">{where.field}</span>
        </span>
        {chip}
      </div>
      <div className={`rv-pair${checked ? ' is-read' : ''}`}>
        <div className="rv-col">
          <span className="rv-col-label">{t('review.colSource', { lang: langInfo(srcLang).name })}</span>
          <SourceText
            text={item.source}
            kind={item.kind}
            lang={srcLang}
            lost={lost}
            changed={change?.ranges ?? []}
            terms={item.glossary.flatMap((g) => termRanges(item.source, g.term))}
          />
          {change && (
            <p className="rv-changed">
              {change.from && change.to && change.from.length < 40 && change.to.length < 40
                ? // the numbers keep their own direction inside an Arabic sentence
                  t('review.changedFrom', { before: `\u2066${change.from}\u2069`, after: `\u2066${change.to}\u2069` })
                : t('review.changed')}
            </p>
          )}
        </div>
        <div className="rv-col">
          <span className="rv-col-label">{t('review.colTranslation', { lang: langInfo(lang).name })}</span>
          {checked ? (
            <p className="rv-read" lang={lang} dir={dirOf(lang)}>
              {item.text}
            </p>
          ) : (
            <TranslationBox
              ref={(h) => {
                box.current = h;
                boxRef(h);
              }}
              value={text}
              kind={item.kind}
              lang={lang}
              label={t('review.trLabel', { lang: langName(lang) })}
              describedBy={`${base}-where${blocking ? ` ${base}-alert` : ''}`}
              hole={hole ? hole.caret - `[[${firstLost}]]`.length : undefined}
              stale={change?.from ? staleRanges(text, change.from) : []}
              terms={terms}
              invalid={blocking}
              onChange={onDraft}
              onKeyDown={(e) => {
                // Ctrl/⌘ Enter approves (saving the wording when it changed) and moves on
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !blocking && text.trim()) {
                  e.preventDefault();
                  onApprove();
                }
              }}
            />
          )}
        </div>
      </div>
      {!checked && blocking && (
        <div className="rv-alert" id={`${base}-alert`}>
          {live.map((p) => (
            <Fragment key={p.code}>
              {p.lost.map((name) => {
                const word = putBack(item.source, text, name, item.kind).word;
                return (
                  <div key={`l-${name}`} className="rv-alert-line">
                    <p>
                      <Icon name="warn" size={18} />
                      <span>
                        {word
                          ? t(p.code === 'boxes' ? 'review.boxMissing' : 'review.markMissing', { name, word })
                          : t(p.code === 'boxes' ? 'review.boxMissing' : 'review.markMissingAt', { name, word: '' })}
                      </span>
                    </p>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        const r = putBack(item.source, text, name, item.kind);
                        onDraft(r.text);
                        requestAnimationFrame(() => box.current?.focus(r.caret));
                      }}
                    >
                      {t('review.putBack', { name })}
                    </Button>
                  </div>
                );
              })}
              {p.extra.map((name) => (
                <p key={`x-${name}`}>
                  <Icon name="warn" size={18} />
                  <span>{t(p.code === 'boxes' ? 'review.boxExtra' : 'review.markExtra', { name })}</span>
                </p>
              ))}
              {p.code === 'dollars' && (
                <p>
                  <Icon name="warn" size={18} />
                  <span>{t('tr.dollars')}</span>
                </p>
              )}
            </Fragment>
          ))}
        </div>
      )}
      {!checked &&
        glossMiss.map((g) => (
          <p key={`g-${g.term}`} className="rv-gloss-miss">
            {t('review.glossaryMiss', { expected: g.expected ?? '', term: g.term ?? '' })}
          </p>
        ))}
      {error && <p className="field-error">{error}</p>}
      <div className="rv-foot">
        <div className="rv-gloss">
          {item.glossary.map((g) => (
            <span key={g.term} className="rv-gloss-chip">
              <Icon name="book" size={14} />
              <bdi lang={srcLang}>{g.term}</bdi>
              <span aria-hidden="true">{uiDir === 'rtl' ? '←' : '→'}</span>
              <bdi lang={lang}>{g.expected}</bdi>
              <span className="muted"> · {t('review.glossaryWord')}</span>
            </span>
          ))}
        </div>
        <div className="rv-actions">
          {checked ? (
            <Button variant="quiet" icon="edit" onClick={onEdit}>
              {t('make.edit')}
            </Button>
          ) : item.state === 'stale' && !dirty ? (
            <>
              <Button variant="quiet" busy={busy} disabled={busy || again} onClick={onKeep}>
                {t('review.keepMine')}
              </Button>
              <Button icon="regenerate" busy={again} disabled={busy || again} onClick={onAgain}>
                {t('review.translateAgain')}
              </Button>
              {perString !== undefined && (
                // one string costs less than a tenth of a cent: said as "about $0.001"
                <span className="mono muted small">
                  {t('learn.est.cost', { cost: usd(Math.max(perString, 0.001)) })}
                </span>
              )}
            </>
          ) : (
            <>
              <Button variant="quiet" disabled={!dirty || busy || blocking || !text.trim()} onClick={onSave}>
                {t('review.saveEdit')}
              </Button>
              <Button
                icon="check"
                busy={busy && !dirty}
                disabled={busy || blocking || !text.trim()}
                title={blocking ? t('review.fixFirst') : undefined}
                onClick={onApprove}
              >
                {t('review.approve')}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function ReviewQueue({
  id,
  lang,
  chapter,
  onChapter,
  run,
  onChanged,
}: {
  id: string;
  lang: string;
  /** One lesson's rows ("" for the whole book). */
  chapter: string;
  onChapter: (lesson: string) => void;
  run: Run;
  /** Counts changed (the cards above follow). */
  onChanged: () => void;
}) {
  const { t, num, langName } = useI18n();
  const toast = useToast();
  const jobs = useJobs();
  // offline: translating a line again waits for a cloud translator (said in a toast: the rows stay quiet)
  const online = useOnline();
  const book = useOfflineBook(id);
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(FIRST);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [again, setAgain] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'' | 'approve' | 'import'>('');
  const [preview, setPreview] = useState<{ csv: string; result: ReviewImportResult } | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const importBtn = useRef<HTMLButtonElement>(null);
  const boxes = useRef(new Map<string, TranslationBoxHandle | null>());
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    try {
      setInfo(await api.review(id, lang));
      setError('');
    } catch (e) {
      setError(errorText(e, tRef.current));
    }
  }, [id, lang]);

  useEffect(() => {
    setInfo(null);
    setDrafts({});
    setRowErrors({});
    setEditing(new Set());
    setLimit(FIRST);
    void load();
  }, [load]);

  // a translation ends (a row translated again, or the whole language): the queue comes back
  useEffect(
    () =>
      jobs.onEnd(id, (job) => {
        if (job.type !== 'translate') return;
        setAgain(new Set());
        // a row translated again that could not be: it says why
        const keys = Array.isArray(job.args.keys) ? (job.args.keys as string[]) : [];
        const lesson = Array.isArray(job.args.chapters) ? String((job.args.chapters as unknown[])[0] ?? '') : '';
        if (job.status === 'error' && keys.length && lesson)
          setRowErrors((cur) => ({
            ...cur,
            ...Object.fromEntries(keys.map((k) => [`${lesson}|${k}`, job.error ?? ''])),
          }));
        void load().then(onChanged);
      }),
    [jobs, id, load, onChanged],
  );

  const items = info?.items ?? [];
  const byKey = useMemo(() => new Map(items.map((i) => [rowKey(i), i])), [items]);
  const inChapter = (i: ReviewItem) => !chapter || i.lesson === chapter;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, machine: 0, flagged: 0, stale: 0, missing: 0, checked: 0 };
    for (const i of items) if (!chapter || i.lesson === chapter) for (const f of FILTERS) if (matches(i, f)) c[f]++;
    return c;
  }, [items, chapter]);
  // which rows show, and in what order: fixed while a person works through them (no jumping list)
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when the list loads or the choice changes
  useEffect(() => {
    if (!info) return;
    setOrder(
      info.items
        .map((i, k) => ({ i, k }))
        .filter(({ i }) => inChapter(i) && matches(i, filter))
        .sort((a, b) => rank(a.i) - rank(b.i) || a.k - b.k)
        .map(({ i }) => rowKey(i)),
    );
  }, [info === null, filter, chapter, lang, info?.counts.total]);
  const shown = order.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const visible = shown.slice(0, limit);
  const done = counts.checked;
  const total = counts.all;
  // "Approve the {n} strings shown": the model's, read on screen, unchanged and without problems
  const approvable = visible.filter(
    (i) => i.state === 'machine' && drafts[rowKey(i)] === undefined && !liveProblems(i.source, i.text, i.kind).length,
  );

  const replace = (item: ReviewItem) =>
    setInfo((cur) => (cur ? { ...cur, items: cur.items.map((i) => (rowKey(i) === rowKey(item) ? item : i)) } : cur));
  const flag = (set: typeof setBusy, k: string, on: boolean) =>
    set((cur) => {
      const next = new Set(cur);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const act = async (item: ReviewItem, body: { text?: string; keep?: boolean }, then?: () => void) => {
    const k = rowKey(item);
    flag(setBusy, k, true);
    setRowErrors((cur) => ({ ...cur, [k]: '' }));
    try {
      const r = await api.reviewString(id, lang, { lesson: item.lesson, key: item.key, ...body });
      if (r.item) replace({ ...r.item, ...(item.chapter ? { chapter: item.chapter } : {}) });
      setDrafts((cur) => {
        const { [k]: _, ...rest } = cur;
        return rest;
      });
      flag(setEditing, k, false);
      onChanged();
      then?.();
    } catch (e) {
      setRowErrors((cur) => ({ ...cur, [k]: errorText(e, t) }));
    }
    flag(setBusy, k, false);
  };
  // after approving a row, its next one takes the focus
  const next = (item: ReviewItem) => () => {
    const at = visible.findIndex((i) => rowKey(i) === rowKey(item));
    for (const i of visible.slice(at + 1)) {
      const b = boxes.current.get(rowKey(i));
      if (b) {
        b.focus();
        return;
      }
    }
  };

  const approveShown = async () => {
    const list = approvable.map((i) => ({ lesson: i.lesson, key: i.key }));
    if (!list.length) return;
    setBulk('approve');
    try {
      const r = await api.reviewApprove(id, lang, list);
      await load();
      onChanged();
      // no dialog: the toast takes it back
      toast({
        text: t('review.approved', { n: r.approved }),
        tone: 'good',
        ms: 12000,
        action: {
          label: t('common.undo'),
          run: () =>
            void api.reviewApprove(id, lang, list, false).then(async () => {
              await load();
              onChanged();
              toast({ text: t('review.unapproved') });
            }),
        },
      });
    } catch (e) {
      setError(errorText(e, t));
    }
    setBulk('');
  };

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBulk('import');
    try {
      const csv = await f.text();
      setPreview({ csv, result: await api.reviewImport(id, lang, csv, true) });
    } catch (err) {
      setError(errorText(err, t));
    }
    setBulk('');
  };
  const apply = async () => {
    if (!preview) return;
    setBulk('import');
    try {
      const r = await api.reviewImport(id, lang, preview.csv);
      setPreview(null);
      setDrafts({});
      await load();
      onChanged();
      toast({ text: t('review.imported', { edited: r.edited, approved: r.approved }), tone: 'good' });
    } catch (err) {
      setError(errorText(err, t));
    }
    setBulk('');
  };

  const srcOf = (lid: string) => info?.sourceLangs[lid] ?? 'en';
  const firstSrc = srcOf(info?.lessons[0]?.id ?? '');
  const where = useWhere();
  const changes = preview?.result.changes ?? [];

  return (
    <section className="rv-queue sheet" aria-labelledby="rv-title">
      <div className="rv-queue-head">
        <div className="rv-queue-start">
          <h2 id="rv-title" className="rv-title" tabIndex={-1}>
            {t('review.titleLang', { lang: langName(lang) })}
          </h2>
          {info && info.lessons.length > 1 && (
            <label className="rv-field">
              <span>{t('review.lesson')}</span>
              <select
                value={chapter}
                onChange={(e) => {
                  onChapter(e.target.value);
                  setLimit(FIRST);
                }}
              >
                <option value="">{t('review.lessonAll')}</option>
                {info.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {t('review.chapterOption', { n: l.n ?? l.id, title: l.title })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="rv-queue-end">
          <a className="btn btn-default" href={api.reviewCsvUrl(id, lang, chapter || undefined)} download>
            <Icon name="download" />
            <span>{t('review.csv')}</span>
          </a>
          <Button
            ref={importBtn}
            icon="up"
            busy={bulk === 'import'}
            disabled={!!bulk}
            onClick={() => file.current?.click()}
          >
            {t('review.import')}
          </Button>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            hidden
            data-testid="review-import"
            onChange={(e) => void pickFile(e)}
          />
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!info ? (
        <Loading />
      ) : !items.length ? (
        <Notice>{t('review.none')}</Notice>
      ) : (
        <>
          <div className="rv-counts">
            <p>{t('review.progress', { done: num(done), total: num(total) })}</p>
            {/* biome-ignore lint/a11y/useSemanticElements: toggle pills, not a form group */}
            <div className="rv-pills" role="group" aria-label={t('review.filter')}>
              {FILTERS.filter((f) => f !== 'missing' || counts.missing > 0).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="rv-pill"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setLimit(FIRST);
                  }}
                >
                  {f === 'flagged' && <span className="rv-dot is-pen" aria-hidden="true" />}
                  {f === 'stale' && <span className="rv-dot is-fluo" aria-hidden="true" />}
                  {f === 'checked' && <Icon name="check" size={14} />}
                  {t(`review.f.${f}` as MsgKey)} <span className="rv-pill-n mono">{num(counts[f])}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="rv-cols" aria-hidden="true">
            <span>{t('review.colSource', { lang: langInfo(firstSrc).name })}</span>
            <span>{t('review.colTranslation', { lang: langInfo(lang).name })}</span>
          </div>
          {!shown.length ? (
            <p className="empty">{t('review.empty')}</p>
          ) : (
            <ul className="rv-list">
              {visible.map((i) => {
                const k = rowKey(i);
                return (
                  <Row
                    key={k}
                    item={i}
                    srcLang={srcOf(i.lesson)}
                    lang={lang}
                    draft={drafts[k]}
                    busy={busy.has(k)}
                    error={rowErrors[k]}
                    editing={editing.has(k)}
                    again={again.has(k)}
                    perString={info.perString}
                    boxRef={(h) => boxes.current.set(k, h)}
                    onDraft={(text) => setDrafts((cur) => ({ ...cur, [k]: text }))}
                    onSave={() => void act(i, { text: drafts[k] }, next(i))}
                    onApprove={() =>
                      void act(i, drafts[k] !== undefined && drafts[k] !== i.text ? { text: drafts[k] } : {}, next(i))
                    }
                    onKeep={() => void act(i, { keep: true }, next(i))}
                    onAgain={() => {
                      if (!online && (!book || needsNet(book, 'translate'))) {
                        toast({ text: t('net.offline'), tone: 'error' });
                        return;
                      }
                      flag(setAgain, k, true);
                      void run('translate', { lang, chapters: [i.lesson], keys: [i.key] }).catch(() =>
                        flag(setAgain, k, false),
                      );
                    }}
                    onEdit={() => {
                      flag(setEditing, k, true);
                      requestAnimationFrame(() => boxes.current.get(k)?.focus());
                    }}
                  />
                );
              })}
            </ul>
          )}
          <div className="rv-foot-bar">
            <span className="muted">{t('review.showing', { n: num(visible.length), total: num(shown.length) })}</span>
            <span className="rv-foot-actions">
              {!!approvable.length && (
                <Button icon="check" busy={bulk === 'approve'} disabled={!!bulk} onClick={() => void approveShown()}>
                  {t('review.approveShown', { n: approvable.length })}
                </Button>
              )}
              {shown.length > limit && (
                <Button onClick={() => setLimit((n) => n + MORE)}>
                  {t('review.more', { n: num(Math.min(MORE, shown.length - limit)) })}
                </Button>
              )}
            </span>
          </div>
        </>
      )}
      <SideSheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={t('review.importTitle')}
        className="rv-import"
        returnFocus={() => importBtn.current}
      >
        {preview && (
          <div className="rv-import-body">
            {!changes.length ? (
              <p>{t('review.importNone')}</p>
            ) : (
              <ul className="rv-import-list">
                {changes.map((c) => {
                  const item = byKey.get(`${c.lesson}|${c.key}`);
                  const w = item ? where(item) : null;
                  return (
                    <li key={`${c.lesson}|${c.key}`}>
                      <span className="rv-where">
                        {w ? (
                          <>
                            <bdi>{w.text}</bdi> · <span className="mono">{w.field}</span>
                          </>
                        ) : (
                          <code dir="ltr">{c.key}</code>
                        )}
                      </span>
                      {c.kind === 'edited' ? (
                        <>
                          <span className="rv-chip is-machine">{t('review.importNew')}</span>
                          <del lang={lang} dir={dirOf(lang)}>
                            {c.before}
                          </del>
                          <ins lang={lang} dir={dirOf(lang)}>
                            {c.after}
                          </ins>
                        </>
                      ) : (
                        <>
                          <span className="rv-chip is-checked">{t('review.importOk')}</span>
                          <p lang={lang} dir={dirOf(lang)}>
                            {c.after}
                          </p>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!!preview.result.errors.length && (
              <Notice tone="warn">
                {t('review.importErrors', { n: preview.result.errors.length })}
                <ul className="review-import-errors">
                  {preview.result.errors.slice(0, 20).map((e) => (
                    <li key={`${e.key}|${e.error}`}>
                      <code dir="ltr">{e.key}</code> <bdi>{e.error}</bdi>
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <div className="actions">
              <Button
                variant="primary"
                busy={bulk === 'import'}
                disabled={!changes.length || !!bulk}
                onClick={() => void apply()}
              >
                {t('review.importApply', { n: changes.length })}
              </Button>
              <Button variant="quiet" onClick={() => setPreview(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </SideSheet>
    </section>
  );
}
