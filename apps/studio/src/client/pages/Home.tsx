import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { StepId } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, type ProjectListItem } from '../api';
import { SideSheet } from '../components/SideSheet';
import { Button, Field, Icon, LangTag, Loading, Mark, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { BOOK_LANGS, useI18n } from '../i18n';
import { onboarded } from '../prefs';
import { Link, navigate } from '../router';

const STEP_KEYS: Record<StepId, 'step.read' | 'step.plan' | 'step.make' | 'step.voice' | 'step.check' | 'step.share'> =
  {
    read: 'step.read',
    plan: 'step.plan',
    make: 'step.make',
    voice: 'step.voice',
    check: 'step.check',
    share: 'step.share',
  };

export const bookTitle = (title: Record<string, string> | string, ui: string, fallback: string): string =>
  typeof title === 'string' ? title : (title[ui] ?? title[fallback] ?? Object.values(title)[0] ?? '');

function nextOf(p: ProjectListItem): StepId | null {
  const order: StepId[] = ['read', 'plan', 'make', 'voice', 'share'];
  return order.find((k) => p.steps[k] && p.steps[k] !== 'done' && p.steps[k] !== 'skipped') ?? null;
}

function BookCard({ p }: { p: ProjectListItem }) {
  const { t, lang, ago, usd } = useI18n();
  const title = bookTitle(p.title, lang, p.defaultLang);
  const next = nextOf(p);
  const ticks = Math.max(p.chapters, p.built);
  return (
    <li className="book-card">
      <Link to={`/project/${encodeURIComponent(p.id)}`} className="book-link">
        <span className="book-title" lang={p.title[lang] ? lang : p.defaultLang} dir="auto">
          {title}
        </span>
      </Link>
      {p.learn && <span className="book-course">{t('home.course')}</span>}
      {p.error ? (
        <p className="field-error">{t('home.broken', { error: p.error })}</p>
      ) : (
        <>
          <div className="book-langs">
            {p.langs.map((l) => (
              <LangTag key={l} code={l} active={l === p.defaultLang} />
            ))}
          </div>
          <div className="book-progress">
            {ticks > 0 ? (
              <>
                <span className="ticks" aria-hidden="true">
                  {Array.from({ length: Math.min(ticks, 40) }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: identical progress marks
                    <i key={i} className={i < p.built ? 'on' : ''} />
                  ))}
                </span>
                <span>{t('home.progress', { done: p.built, total: ticks })}</span>
              </>
            ) : (
              <span className="muted">{t('home.noChapters')}</span>
            )}
          </div>
          <p className="book-next">
            {next ? t('home.next', { step: t(STEP_KEYS[next]) }) : <span className="good">{t('home.ready')}</span>}
          </p>
          <p className="book-updated muted">
            {p.spent ? <span className="book-spent">{t('home.spent', { usd: usd(p.spent) })} · </span> : null}
            {t('common.updated', { when: ago(p.updated) })}
          </p>
        </>
      )}
    </li>
  );
}

const CONTENT_LANGS = BOOK_LANGS;

function NewBook({ initial }: { initial?: File | null }) {
  const { t, langName, bytes, lang: ui } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [langs, setLangs] = useState<string[]>(['ar', 'fr', 'en']);
  const [other, setOther] = useState('');
  const [written, setWritten] = useState<string>(ui);
  const [audience, setAudience] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const extra = other
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(s) && !CONTENT_LANGS.includes(s));
  const all = [...langs, ...extra];
  const writtenIn = all.includes(written) ? written : (all[0] ?? '');

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setFileError(t('new.notPdf'));
      return;
    }
    setFileError('');
    setFile(f);
    if (!title)
      setTitle(
        f.name
          .replace(/\.pdf$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
      );
  };
  // a PDF dropped on the new-book tile arrives with the sheet
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per dropped file
  useEffect(() => {
    if (initial) pick(initial);
  }, [initial]);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!all.length) {
      setError(t('new.needLang'));
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData();
    if (file) form.set('pdf', file);
    form.set('title', title);
    form.set('langs', all.join(','));
    form.set('defaultLang', writtenIn);
    if (audience.trim()) form.set('audience', audience.trim());
    try {
      const p = await api.createProject(form);
      navigate(`/project/${encodeURIComponent(p.id)}`);
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  };

  return (
    <form className="new-book" onSubmit={submit}>
      <label
        className={`drop ${drag ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          onChange={(e) => pick(e.target.files?.[0])}
          aria-describedby="pdf-hint"
        />
        <Icon name="file" size={28} />
        {file ? (
          <>
            <span className="drop-main">{t('new.selected', { name: file.name, size: bytes(file.size) })}</span>
            <span className="drop-sub">{t('new.change')}</span>
          </>
        ) : (
          <>
            <span className="drop-main">{t('new.drop')}</span>
            <span className="drop-sub">{t('new.choose')}</span>
          </>
        )}
      </label>
      <p className="hint" id="pdf-hint">
        {file ? t('new.pdfHint') : t('new.noPdf')}
      </p>
      <p className="hint copyright">{t('pdf.copyright')}</p>
      {fileError && <p className="field-error">{fileError}</p>}

      <Field label={t('new.bookTitle')}>
        {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" maxLength={200} />}
      </Field>

      <fieldset className="field">
        <legend>{t('new.langs')}</legend>
        <div className="checks">
          {CONTENT_LANGS.map((l) => (
            <label key={l} className="check">
              <input
                type="checkbox"
                checked={langs.includes(l)}
                onChange={(e) => setLangs((cur) => (e.target.checked ? [...cur, l] : cur.filter((x) => x !== l)))}
              />
              <span lang={l}>{langName(l)}</span>
            </label>
          ))}
        </div>
        <Field label={t('new.otherLang')} hint={t('new.otherLangHint')} className="field-inline">
          {(id, d) => (
            <input
              id={id}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              aria-describedby={d}
              dir="ltr"
              placeholder="es"
              size={10}
              autoComplete="off"
            />
          )}
        </Field>
      </fieldset>

      <Field label={t('new.writtenIn')} hint={t('new.writtenInHint')}>
        {(id, d) => (
          <select
            id={id}
            value={writtenIn}
            onChange={(e) => setWritten(e.target.value)}
            aria-describedby={d}
            disabled={!all.length}
          >
            {all.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label={t('new.audience')}>
        {(id) => (
          <input
            id={id}
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder={t('new.audiencePlaceholder')}
            dir="auto"
          />
        )}
      </Field>

      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? t('new.creating') : t('new.create')}
        </Button>
      </div>
    </form>
  );
}

type Sort = 'recent' | 'title' | 'spent';
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '').toLowerCase();

export function HomePage() {
  const { t, lang, num } = useI18n();
  const { status } = useStatus();
  const { homeActions } = useExtras();
  const inBrowser = status?.capabilities?.platform === 'browser';
  const [data, setData] = useState<{ projects: ProjectListItem[]; root: string } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .projects()
      .then((d) => {
        // a first visit with no books starts with the guide
        if (!d.projects.length && !onboarded()) navigate('/welcome', { replace: true });
        else setData(d);
      })
      .catch((e) => setError(errorText(e, tRef.current)));
  }, []);

  const all = data?.projects ?? [];
  const courses = all.filter((p) => p.learn && !p.error).length;
  const books = useMemo(() => {
    const f = fold(q.trim());
    const title = (p: ProjectListItem) => bookTitle(p.title, lang, p.defaultLang);
    const list = (data?.projects ?? []).filter((p) => !f || fold(title(p)).includes(f));
    return [...list].sort((a, b) =>
      sort === 'title'
        ? title(a).localeCompare(title(b), lang)
        : sort === 'spent'
          ? (b.spent ?? 0) - (a.spent ?? 0)
          : b.updated - a.updated,
    );
  }, [data, q, sort, lang]);
  const empty = data && !all.length;
  const open = (f: File | null) => {
    setDropped(f);
    setCreating(true);
  };

  return (
    <div className="page page-home">
      <header className="page-head">
        <div>
          <h1 className="display">
            {t('home.title')}{' '}
            {data && !empty && <span className="home-count">{t('home.count', { n: all.length })}</span>}
          </h1>
          <p className="lede">{t('home.lede')}</p>
        </div>
        <div className="page-head-actions">
          {homeActions}
          <Button variant="primary" icon="plus" onClick={() => open(null)}>
            {t('home.new')}
          </Button>
        </div>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {!!courses && (
        <Link className="home-learning" to="/learn">
          <Icon name="book" />
          <span>{t('home.learning')}</span>
          <span className="muted">{num(courses)}</span>
        </Link>
      )}
      {data && (
        <section aria-label={t('home.list')}>
          {all.length > 3 && (
            <div className="home-tools">
              <input
                type="search"
                className="home-search"
                value={q}
                placeholder={t('home.search')}
                aria-label={t('home.search')}
                onChange={(e) => setQ(e.target.value)}
              />
              <label className="home-sort">
                <span>{t('home.sort')}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recent">{t('home.sortRecent')}</option>
                  <option value="title">{t('home.sortTitle')}</option>
                  <option value="spent">{t('home.sortSpent')}</option>
                </select>
              </label>
            </div>
          )}
          {empty ? (
            <NoBooks onFile={open} />
          ) : (
            <ul className="books">
              {books.map((p) => (
                <BookCard key={p.id} p={p} />
              ))}
              {!q.trim() && (
                <li className="book-new">
                  <NewTile onFile={open} />
                </li>
              )}
            </ul>
          )}
          {!!q.trim() && !books.length && <p className="empty">{t('home.noMatch')}</p>}
          {inBrowser && <p className="root-note muted">{t('cap.books')}</p>}
          {!inBrowser && (
            <p className="root-note muted">
              {t('home.root', { path: '\u0000' }).split('\u0000')[0]}
              <code dir="ltr">{data.root}</code>
              {t('home.root', { path: '\u0000' }).split('\u0000')[1]}
            </p>
          )}
        </section>
      )}
      <SideSheet open={creating} onClose={() => setCreating(false)} title={t('new.title')}>
        <NewBook initial={dropped} />
      </SideSheet>
    </div>
  );
}

/**
 * No books yet: a ruled card that takes a dropped PDF, with Choose a PDF and, where the host has one, the
 * finished example book (redesign 4h).
 */
function NoBooks({ onFile }: { onFile: (f: File | null) => void }) {
  const { t } = useI18n();
  const { guide } = useExtras();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pdf = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('new.notPdf'));
      return;
    }
    setError('');
    onFile(f);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone; its button and link do the same by keyboard
    <div
      className={`no-books${over ? ' is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pdf(e.dataTransfer.files[0]);
      }}
    >
      <Mark size={44} />
      <h2 className="no-books-title">{t('home.noBooks')}</h2>
      <p className="no-books-body">{t('home.noBooksBody')}</p>
      <div className="no-books-actions">
        <label className="btn btn-primary">
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            data-testid="empty-pdf-input"
            onChange={(e) => {
              pdf(e.target.files?.[0]);
              // the same file chosen again (after closing the sheet) still counts
              e.target.value = '';
            }}
          />
          <span>{t('learn.setup.choose')}</span>
        </label>
        {guide?.example && (
          <Button
            variant="quiet"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                navigate(await guide.example!());
              } catch (e) {
                setError(errorText(e, t));
                setBusy(false);
              }
            }}
          >
            {t('welcome.example')}
          </Button>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The last tile of the grid: drop a PDF on it, or click it, to start a new book in the side sheet. */
function NewTile({ onFile }: { onFile: (f: File | null) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      className={`new-tile${over ? ' is-over' : ''}`}
      onClick={() => onFile(null)}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files[0] ?? null);
      }}
    >
      <span className="new-tile-mark" aria-hidden="true">
        <Icon name="plus" size={28} />
      </span>
      <span className="new-tile-title">{t('home.new')}</span>
      <span className="new-tile-hint">{t('home.newTile')}</span>
    </button>
  );
}
