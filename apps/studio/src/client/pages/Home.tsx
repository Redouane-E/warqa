import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { StepId } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, type ProjectListItem } from '../api';
import { Button, Field, Icon, LangTag, Loading, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { BOOK_LANGS, useI18n } from '../i18n';
import { Link, navigate } from '../router';

const STEP_KEYS: Record<StepId, 'step.read' | 'step.plan' | 'step.make' | 'step.voice' | 'step.export'> = {
  read: 'step.read',
  plan: 'step.plan',
  make: 'step.make',
  voice: 'step.voice',
  export: 'step.export',
};

export const bookTitle = (title: Record<string, string> | string, ui: string, fallback: string): string =>
  typeof title === 'string' ? title : (title[ui] ?? title[fallback] ?? Object.values(title)[0] ?? '');

function nextOf(p: ProjectListItem): StepId | null {
  const order: StepId[] = ['read', 'plan', 'make', 'voice', 'export'];
  return order.find((k) => p.steps[k] && p.steps[k] !== 'done' && p.steps[k] !== 'skipped') ?? null;
}

function BookCard({ p }: { p: ProjectListItem }) {
  const { t, lang, ago } = useI18n();
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
          <p className="book-updated muted">{t('common.updated', { when: ago(p.updated) })}</p>
        </>
      )}
    </li>
  );
}

const CONTENT_LANGS = BOOK_LANGS;

function NewBook({ onCancel }: { onCancel?: () => void }) {
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
    <form className="sheet new-book" onSubmit={submit} aria-labelledby="new-book-title">
      <div className="sheet-head">
        <h2 id="new-book-title">{t('new.title')}</h2>
        {onCancel && <Button variant="quiet" icon="x" aria-label={t('common.close')} onClick={onCancel} />}
      </div>
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

export function HomePage() {
  const { t } = useI18n();
  const { status } = useStatus();
  const { homeActions } = useExtras();
  const inBrowser = status?.capabilities?.platform === 'browser';
  const [data, setData] = useState<{ projects: ProjectListItem[]; root: string } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .projects()
      .then(setData)
      .catch((e) => setError(errorText(e, tRef.current)));
  }, []);

  const empty = data && !data.projects.length;
  const showForm = creating || !!empty;
  const sorted = useMemo(() => data?.projects ?? [], [data]);

  return (
    <div className="page page-home">
      <header className="page-head">
        <div>
          <h1 className="display">{t('home.title')}</h1>
          <p className="lede">{t('home.lede')}</p>
        </div>
        <div className="page-head-actions">
          {homeActions}
          {!showForm && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              {t('home.new')}
            </Button>
          )}
        </div>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={`home-grid ${showForm ? 'with-form' : ''}`}>
        <section aria-label={t('home.list')}>
          {!data && !error && <Loading />}
          {empty && <p className="empty">{t('home.empty')}</p>}
          {!!sorted.length && (
            <ul className="books">
              {sorted.map((p) => (
                <BookCard key={p.id} p={p} />
              ))}
            </ul>
          )}
          {data && inBrowser && <p className="root-note muted">{t('cap.books')}</p>}
          {data && !inBrowser && (
            <p className="root-note muted">
              {t('home.root', { path: '\u0000' }).split('\u0000')[0]}
              <code dir="ltr">{data.root}</code>
              {t('home.root', { path: '\u0000' }).split('\u0000')[1]}
            </p>
          )}
        </section>
        {showForm && <NewBook {...(empty ? {} : { onCancel: () => setCreating(false) })} />}
      </div>
    </div>
  );
}
