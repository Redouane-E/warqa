// Review translations, book-wide: every string of one language with its state (made by the model, approved or
// edited by a person, original changed since, missing) and its problems (glossary misses, broken marks). A person
// approves a string or saves their own wording; the book's translation memory keeps it for later chapters and the
// model never overwrites it. The same queue goes out as a spreadsheet and comes back in.
import { dirOf } from '@warqa/i18n';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectDetail, ReviewImportResult, ReviewInfo, ReviewItem, ReviewState } from '../../shared/types';
import { api, errorText } from '../api';
import { Button, Icon, Loading, Notice } from '../components/ui';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link, navigate, useLocation } from '../router';
import { bookTitle } from './Home';

type Filter = 'all' | 'machine' | 'flagged' | 'stale' | 'missing' | 'checked';
const FILTERS: Filter[] = ['all', 'machine', 'flagged', 'stale', 'missing', 'checked'];
const PAGE = 100;

const rowKey = (i: Pick<ReviewItem, 'lesson' | 'key'>) => `${i.lesson}|${i.key}`;
const checked = (s: ReviewState) => s === 'approved' || s === 'edited';

const matches = (i: ReviewItem, f: Filter): boolean =>
  f === 'all' ? true : f === 'flagged' ? i.flags.length > 0 : f === 'checked' ? checked(i.state) : i.state === f;

/** Languages a book can be reviewed in: those some lesson is translated into (not written in). */
function targetLangs(p: ProjectDetail): string[] {
  const authors = new Set(p.lessons.map((l) => l.lang));
  return p.book.langs.filter((l) => !(authors.size === 1 && authors.has(l)));
}

function Row({
  item,
  srcLang,
  lang,
  draft,
  busy,
  error,
  onDraft,
  onApprove,
  onSave,
}: {
  item: ReviewItem;
  srcLang: string;
  lang: string;
  draft: string | undefined;
  busy: boolean;
  error: string | undefined;
  onDraft: (text: string) => void;
  onApprove: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const text = draft ?? item.text;
  const dirty = draft !== undefined && draft !== item.text;
  const id = `tr-${item.lesson}-${item.key}`.replace(/[^\w-]+/g, '-');
  return (
    <li className={`review-row is-${item.state} ${item.flags.length ? 'has-flags' : ''}`}>
      <div className="review-meta">
        <code className="muted small">{item.lesson}</code>
        <span className="muted small review-where">
          <bdi>{item.where}</bdi>
        </span>
        <span className={`badge review-state state-${item.state}`}>{t(`review.state.${item.state}` as MsgKey)}</span>
      </div>
      <div className="review-pair">
        <div className="review-source">
          <span className="visually-hidden">{t('review.source')}</span>
          <p className="review-source-text" lang={srcLang} dir="auto">
            {item.source}
          </p>
        </div>
        <label htmlFor={id} className="visually-hidden">
          {t('review.translation')} ({item.lesson} · {item.where})
        </label>
        <textarea
          id={id}
          className="review-text"
          lang={lang}
          dir="auto"
          rows={Math.min(8, Math.max(2, Math.ceil(Math.max(text.length, item.source.length) / 70)))}
          value={text}
          onChange={(e) => onDraft(e.target.value)}
        />
      </div>
      {!!item.flags.length && (
        <ul className="review-flags">
          {item.flags.map((f) => (
            <li key={f}>
              <Icon name="warn" size={15} />
              <bdi dir="auto">{f}</bdi>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="review-actions">
        <Button variant={dirty ? 'primary' : 'default'} disabled={!dirty || busy || !text.trim()} onClick={onSave}>
          {t('review.saveEdit')}
        </Button>
        <Button
          variant="quiet"
          icon="check"
          busy={busy && !dirty}
          disabled={busy || dirty || item.state === 'missing' || checked(item.state)}
          onClick={onApprove}
        >
          {t('review.approve')}
        </Button>
      </div>
    </li>
  );
}

export function ReviewPage({ id }: { id: string }) {
  const { t, lang: ui, num } = useI18n();
  const langName = useI18n().langName;
  const { query } = useLocation();
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [lang, setLang] = useState(query.get('lang') ?? '');
  const [info, setInfo] = useState<ReviewInfo | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [lesson, setLesson] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; errors?: ReviewImportResult['errors'] } | null>(null);
  const [bulk, setBulk] = useState<'' | 'approve' | 'import'>('');
  const file = useRef<HTMLInputElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .project(id)
      .then((d) => {
        setP(d);
        const targets = targetLangs(d);
        setLang((cur) => (targets.includes(cur) ? cur : (targets[0] ?? '')));
      })
      .catch((e) => setError(errorText(e, tRef.current)));
  }, [id]);

  const load = useCallback(async () => {
    if (!lang) return;
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
    setNotice(null);
    setLimit(PAGE);
    void load();
  }, [load]);

  const items = info?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, machine: 0, flagged: 0, stale: 0, missing: 0, checked: 0 };
    for (const i of items) {
      if (lesson && i.lesson !== lesson) continue;
      for (const f of FILTERS) if (matches(i, f)) c[f]++;
    }
    return c;
  }, [items, lesson]);
  const shown = useMemo(
    () => items.filter((i) => (!lesson || i.lesson === lesson) && matches(i, filter)),
    [items, lesson, filter],
  );
  const visible = shown.slice(0, limit);
  // "approve all shown": what a person can see on screen and has not changed
  const approvable = visible.filter(
    (i) => (i.state === 'machine' || i.state === 'stale') && drafts[rowKey(i)] === undefined,
  );

  const replace = (item: ReviewItem) =>
    setInfo((cur) => (cur ? { ...cur, items: cur.items.map((i) => (rowKey(i) === rowKey(item) ? item : i)) } : cur));
  const mark = (k: string, on: boolean) =>
    setBusy((cur) => {
      const next = new Set(cur);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const act = async (item: ReviewItem, text?: string) => {
    const k = rowKey(item);
    mark(k, true);
    setRowErrors((cur) => ({ ...cur, [k]: '' }));
    try {
      const r = await api.reviewString(id, lang, {
        lesson: item.lesson,
        key: item.key,
        ...(text !== undefined ? { text } : {}),
      });
      if (r.item) replace(r.item);
      setDrafts((cur) => {
        const { [k]: _, ...rest } = cur;
        return rest;
      });
    } catch (e) {
      setRowErrors((cur) => ({ ...cur, [k]: errorText(e, t) }));
    }
    mark(k, false);
  };

  const approveShown = async () => {
    if (!approvable.length || !window.confirm(t('review.approveShownConfirm', { n: approvable.length }))) return;
    setBulk('approve');
    setNotice(null);
    try {
      const r = await api.reviewApprove(
        id,
        lang,
        approvable.map((i) => ({ lesson: i.lesson, key: i.key })),
      );
      setNotice({ text: t('review.approved', { n: r.approved }), errors: r.errors });
      await load();
    } catch (e) {
      setError(errorText(e, t));
    }
    setBulk('');
  };

  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBulk('import');
    setNotice(null);
    try {
      const r = await api.reviewImport(id, lang, await f.text());
      setNotice({ text: t('review.imported', { edited: r.edited, approved: r.approved }), errors: r.errors });
      setDrafts({});
      await load();
    } catch (err) {
      setError(errorText(err, t));
    }
    setBulk('');
  };

  if (error && !p)
    return (
      <div className="page">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  if (!p)
    return (
      <div className="page">
        <Loading />
      </div>
    );

  const targets = targetLangs(p);
  const title = bookTitle(p.title, ui, p.defaultLang);
  const srcOf = (lid: string) => info?.sourceLangs[lid] ?? p.book.defaultLang ?? 'en';
  const done = items.filter((i) => checked(i.state)).length;

  return (
    <div className="page page-review">
      <nav className="crumbs" aria-label="breadcrumb">
        <Link to="/">{t('project.books')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/project/${encodeURIComponent(id)}?step=voice`} dir="auto">
          {title}
        </Link>
      </nav>
      <header className="page-head">
        <div>
          <h1 className="display">{t('review.title')}</h1>
          <p className="lede">{t('review.lede')}</p>
        </div>
      </header>

      {!targets.length ? (
        <Notice>{t('review.noLangs')}</Notice>
      ) : (
        <>
          <div className="review-bar sheet">
            <div className="review-pickers">
              {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
              <div className="seg" role="group" aria-label={t('review.lang')}>
                {targets.map((l) => (
                  <button
                    key={l}
                    type="button"
                    lang={l}
                    aria-pressed={lang === l}
                    onClick={() => {
                      setLang(l);
                      navigate(`/project/${encodeURIComponent(id)}/review?lang=${encodeURIComponent(l)}`, {
                        replace: true,
                      });
                    }}
                  >
                    {langName(l)}
                  </button>
                ))}
              </div>
              {info && info.lessons.length > 1 && (
                <label className="review-lesson">
                  <span className="small">{t('review.lesson')}</span>
                  <select value={lesson} onChange={(e) => setLesson(e.target.value)}>
                    <option value="">{t('review.lessonAll')}</option>
                    {info.lessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.id} · {l.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {info && !!items.length && (
                <span className="muted small review-progress">
                  {t('review.progress', { done: num(done), total: num(items.length) })}
                </span>
              )}
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: filter chips, not a form group */}
            <div className="chips" role="group" aria-label={t('review.filter')}>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip"
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setLimit(PAGE);
                  }}
                >
                  {t(`review.f.${f}` as MsgKey)} <span className="chip-n">{num(counts[f])}</span>
                </button>
              ))}
            </div>
            <div className="actions review-tools">
              <Button
                variant="primary"
                icon="check"
                busy={bulk === 'approve'}
                disabled={!approvable.length || !!bulk}
                onClick={() => void approveShown()}
              >
                {t('review.approveShown', { n: approvable.length })}
              </Button>
              {lang && (
                <a className="btn btn-default" href={api.reviewCsvUrl(id, lang)} download>
                  <Icon name="download" />
                  <span>{t('review.csv')}</span>
                </a>
              )}
              <Button icon="up" busy={bulk === 'import'} disabled={!!bulk} onClick={() => file.current?.click()}>
                {bulk === 'import' ? t('review.importing') : t('review.import')}
              </Button>
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                hidden
                data-testid="review-import"
                onChange={(e) => void importCsv(e)}
              />
            </div>
            <p className="hint">{t('review.csvHint')}</p>
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          {notice && (
            <Notice tone={notice.errors?.length ? 'warn' : 'good'}>
              {notice.text}
              {!!notice.errors?.length && (
                <>
                  {' '}
                  {t('review.importErrors', { n: notice.errors.length })}
                  <ul className="review-import-errors">
                    {notice.errors.slice(0, 20).map((e) => (
                      <li key={`${e.key}|${e.error}`}>
                        <code dir="ltr">{e.key}</code> <bdi>{e.error}</bdi>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Notice>
          )}

          {!info ? (
            <Loading />
          ) : !items.length ? (
            <Notice>{t('review.none')}</Notice>
          ) : !shown.length ? (
            <p className="empty">{t('review.empty')}</p>
          ) : (
            <ol className="review-list" dir={dirOf(ui)}>
              {visible.map((i) => (
                <Row
                  key={rowKey(i)}
                  item={i}
                  srcLang={srcOf(i.lesson)}
                  lang={lang}
                  draft={drafts[rowKey(i)]}
                  busy={busy.has(rowKey(i))}
                  error={rowErrors[rowKey(i)]}
                  onDraft={(text) => setDrafts((cur) => ({ ...cur, [rowKey(i)]: text }))}
                  onApprove={() => void act(i)}
                  onSave={() => void act(i, drafts[rowKey(i)])}
                />
              ))}
            </ol>
          )}
          {shown.length > limit && (
            <div className="actions">
              <Button onClick={() => setLimit((n) => n + PAGE)}>
                {t('review.more', { n: num(Math.min(PAGE, shown.length - limit)) })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
