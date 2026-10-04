import { dirOf } from '@warqa/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, JobInfo, LessonDetail } from '../../shared/types';
import { api, errorText } from '../api';
import { stageLabel, useJobStream } from '../components/JobBoard';
import { Button, Field, Icon, IssueList, Loading, Notice, Toast } from '../components/ui';
import { useI18n } from '../i18n';
import { loadPacks, loadPlayer, type WarqaPlayer } from '../player';
import { Link, navigate, useLocation } from '../router';
import { Translations } from './Translations';

type Beat = Record<string, unknown> & {
  id: string;
  title: string;
  move?: string;
  narration: string;
  scene?: Record<string, unknown>;
  cues?: Cue[];
  questions?: unknown[];
};
type Cue = {
  at: string | number | { mark: string; offset?: number };
  do: string;
  target: string;
  args?: Record<string, unknown>;
  dur?: number;
};
type LessonObj = { id: string; title: string; lang: string; beats: Beat[]; [k: string]: unknown };

const MARK = /\[\[(\w+)\]\]/g;
export const marksOf = (s: string): string[] => [...s.matchAll(MARK)].map((m) => m[1]!);

/* ---------- preview ---------- */

function Preview({
  id,
  lid,
  bookId,
  langs,
  lang,
  onLang,
  onReload,
  beatId,
  reloadKey,
  stale,
}: {
  id: string;
  lid: string;
  /** The rating mode files ratings under the book (the kit) and the lesson (its code). */
  bookId: string;
  langs: string[];
  lang: string;
  onLang: (l: string) => void;
  onReload: () => void;
  beatId: string | undefined;
  reloadKey: number;
  stale: boolean;
}) {
  const { t, langName } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<WarqaPlayer | null>(null);
  const ids = useRef<string[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [rating, setRating] = useState(false);
  const beatRef = useRef(beatId);
  beatRef.current = beatId;
  const langRef = useRef(lang);
  langRef.current = lang;
  const tRef = useRef(t);
  tRef.current = t;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey remounts the preview after a save
  useEffect(() => {
    let cancelled = false;
    let mounted: WarqaPlayer | null = null;
    setError('');
    setReady(false);
    (async () => {
      try {
        const W = await loadPlayer();
        const data = (await api.playerData(id, lid, langRef.current)) as {
          lesson: { beats: { id: string }[] };
          packs?: string[];
          panel?: { kit: string; code: string };
        };
        // the book's own components (packs) must be registered before the player draws them
        if (data.packs?.length) await loadPacks(W, data.packs);
        if (rating) data.panel = { kit: bookId, code: lid };
        if (cancelled || !host.current) return;
        host.current.replaceChildren();
        mounted = await W.mount(host.current, data, { storage: false, keyboard: 'local' });
        if (cancelled) {
          mounted.destroy();
          return;
        }
        player.current = mounted;
        ids.current = data.lesson.beats.map((b) => b.id);
        const i = beatRef.current ? ids.current.indexOf(beatRef.current) : -1;
        if (i > 0) mounted.seek(i);
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(errorText(e, tRef.current));
      }
    })();
    return () => {
      cancelled = true;
      mounted?.destroy();
      player.current = null;
    };
  }, [id, lid, reloadKey, rating]);

  useEffect(() => {
    const i = beatId ? ids.current.indexOf(beatId) : -1;
    if (ready && i >= 0 && player.current && player.current.i !== i) player.current.seek(i, false);
  }, [beatId, ready]);

  useEffect(() => {
    if (ready) player.current?.setLang(lang);
  }, [lang, ready]);

  return (
    <section className="preview" aria-labelledby="preview-title">
      <div className="preview-bar">
        <h2 id="preview-title" className="small-title">
          {t('editor.preview')}
        </h2>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
        <div className="seg" role="group" aria-label={t('editor.previewLang')}>
          {langs.map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={lang === l}
              onClick={() => onLang(l)}
              title={langName(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="check preview-rating" title={t('editor.ratingHint')}>
          <input type="checkbox" checked={rating} onChange={(e) => setRating(e.target.checked)} />
          <span>{t('editor.rating')}</span>
        </label>
        <Button
          variant="quiet"
          icon="refresh"
          aria-label={t('editor.reload')}
          title={t('editor.reload')}
          onClick={onReload}
        />
      </div>
      {stale && <p className="preview-stale">{t('editor.previewStale')}</p>}
      {error && <Notice tone="error">{t('editor.previewFailed', { error })}</Notice>}
      <div className="preview-host" ref={host} />
    </section>
  );
}

/* ---------- validated JSON field ---------- */

function JsonField({
  label,
  value,
  shape,
  onValid,
  resetKey,
}: {
  label: string;
  value: unknown;
  shape: 'object' | 'array';
  onValid: (v: unknown) => void;
  resetKey: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(() => JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2));
  const [error, setError] = useState('');
  const own = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey re-reads the value when another beat is selected
  useEffect(() => {
    if (own.current) {
      own.current = false;
      return;
    }
    setText(JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2));
    setError('');
    // reset when the beat changes or the value changes from outside this field
  }, [resetKey, value, shape]);
  const change = (s: string) => {
    setText(s);
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch (e) {
      setError(t('editor.jsonError', { error: (e as Error).message }));
      return;
    }
    if (shape === 'array' && !Array.isArray(v)) return setError(t('editor.jsonArray'));
    if (shape === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v)))
      return setError(t('editor.jsonObject'));
    setError('');
    own.current = true;
    onValid(v);
  };
  const rows = Math.min(22, Math.max(4, text.split('\n').length));
  return (
    <Field label={label} error={error}>
      {(id, d) => (
        <textarea
          id={id}
          className="code"
          dir="ltr"
          spellCheck={false}
          rows={rows}
          value={text}
          onChange={(e) => change(e.target.value)}
          aria-describedby={d}
          aria-invalid={!!error}
        />
      )}
    </Field>
  );
}

/* ---------- narration with mark chips and the cues waiting on each mark ---------- */

const atText = (at: Cue['at']): string =>
  typeof at === 'object'
    ? `${at.mark}${at.offset ? ` ${at.offset > 0 ? '+' : ''}${at.offset}s` : ''}`
    : typeof at === 'number'
      ? `${at}s`
      : at;
const markOfCue = (c: Cue): string | null =>
  typeof c.at === 'string' && c.at !== 'start' && c.at !== 'end' ? c.at : typeof c.at === 'object' ? c.at.mark : null;

function MarkedNarration({ text, lang }: { text: string; lang: string }) {
  const parts = text.split(/(\[\[\w+\]\])/g);
  return (
    <p className="marked" lang={lang} dir={dirOf(lang)}>
      {parts.map((s, i) => {
        const m = /^\[\[(\w+)\]\]$/.exec(s);
        return m ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: text runs have no id
          <span key={i} className="mark-chip" dir="ltr">
            {m[1]}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: text runs have no id
          <span key={i}>{s}</span>
        );
      })}
    </p>
  );
}

function CuesByMark({ beat }: { beat: Beat }) {
  const { t } = useI18n();
  const marks = marksOf(beat.narration);
  const cues = beat.cues ?? [];
  const other = cues.filter((c) => {
    const m = markOfCue(c);
    return !m || !marks.includes(m);
  });
  if (!marks.length && !cues.length) return <p className="muted">{t('editor.noMarks')}</p>;
  const cueLine = (c: Cue, i: number) => (
    <li key={i}>
      <code dir="ltr">
        {c.do} <b>{c.target}</b>
        {c.args ? ` ${JSON.stringify(c.args)}` : ''}
      </code>
      {typeof c.at === 'object' && c.at.offset ? (
        <span className="muted small"> {t('editor.at', { at: atText(c.at) })}</span>
      ) : null}
    </li>
  );
  return (
    <ul className="cue-map">
      {marks.map((m) => {
        const mine = cues.filter((c) => markOfCue(c) === m);
        return (
          <li key={m}>
            <span className="mark-chip" dir="ltr">
              {m}
            </span>
            {mine.length ? <ul>{mine.map(cueLine)}</ul> : <span className="warn small">{t('editor.noCues')}</span>}
          </li>
        );
      })}
      {!!other.length && (
        <li>
          <span className="small muted">{t('editor.otherCues')}</span>
          <ul>
            {other.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cues have no id
              <li key={i}>
                <span className="muted small" dir="ltr">
                  {atText(c.at)}
                </span>{' '}
                <code dir="ltr">
                  {c.do} <b>{c.target}</b>
                </code>
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  );
}

/* ---------- regenerate a beat (rewrite job) ---------- */

function Regenerate({
  id,
  lid,
  beat,
  disabled,
  onDone,
}: {
  id: string;
  lid: string;
  beat: Beat;
  disabled: boolean;
  onDone: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [instruction, setInstruction] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const end = useCallback(
    (job: JobInfo) => {
      if (job.status === 'done') {
        setDone(true);
        onDone();
      } else if (job.error) setError(job.error);
      setJobId(null);
    },
    [onDone],
  );
  const { events, info } = useJobStream(jobId, end);
  const last = [...events].reverse().find((e) => e.kind === 'progress');
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another beat is selected
  useEffect(() => {
    setDone(false);
    setError('');
  }, [beat.id]);
  return (
    <details className="regen">
      <summary>{t('editor.regen')}</summary>
      <p className="hint">{t('editor.regenHint')}</p>
      <Field label={t('editor.regenInstruction')}>
        {(fid) => (
          <textarea
            id={fid}
            rows={2}
            value={instruction}
            placeholder={t('editor.regenPlaceholder')}
            dir="auto"
            onChange={(e) => setInstruction(e.target.value)}
          />
        )}
      </Field>
      <div className="actions">
        <Button
          icon="refresh"
          busy={!!jobId}
          disabled={disabled}
          onClick={async () => {
            setError('');
            setDone(false);
            try {
              const r = await api.startJob(id, 'rewrite', { lesson: lid, beat: beat.id, instruction });
              setJobId(r.jobId);
            } catch (e) {
              setError(errorText(e, t));
            }
          }}
        >
          {t('editor.regen')}
        </Button>
        {disabled && <span className="muted small">{t('editor.regenSaveFirst')}</span>}
        {jobId && info && (
          <span className="muted small">
            {last?.stage ? stageLabel(last.stage, i18n) : t(`job.status.${info.status}`)}
          </span>
        )}
      </div>
      {done && <Toast>{t('editor.regenDone')}</Toast>}
      {error && <Notice tone="error">{error}</Notice>}
    </details>
  );
}

/* ---------- the editor ---------- */

export function LessonPage({ id, lid }: { id: string; lid: string }) {
  const i18n = useI18n();
  const { t, lang: ui } = i18n;
  const { query } = useLocation();
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [lesson, setLesson] = useState<LessonObj | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sel, setSel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [previewLang, setPreviewLang] = useState<string>('');
  const tab = query.get('tab') === 'translations' ? 'translations' : 'beats';
  const uiRef = useRef({ t, ui });
  uiRef.current = { t, ui };

  const load = useCallback(async () => {
    const { t, ui } = uiRef.current;
    try {
      const d = await api.lesson(id, lid);
      setDetail(d);
      setLesson(structuredClone(d.lesson) as unknown as LessonObj);
      setIssues(d.issues);
      setDirty(false);
      setPreviewLang(
        (cur) =>
          cur || (d.langs.includes(ui) ? ui : d.langs.includes(d.lesson.lang) ? d.lesson.lang : (d.langs[0] ?? '')),
      );
    } catch (e) {
      setError(errorText(e, t));
    }
  }, [id, lid]);
  useEffect(() => {
    void load();
  }, [load]);

  // live validation of unsaved edits (nothing is written)
  useEffect(() => {
    if (!dirty || !lesson) return;
    const h = setTimeout(() => {
      api
        .saveLesson(id, lid, lesson, { dry: true })
        .then((r) => setIssues(r.issues))
        .catch(() => {});
    }, 700);
    return () => clearTimeout(h);
  }, [lesson, dirty, id, lid]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(
    async (force = false) => {
      if (!lesson) return;
      setSaving(true);
      setSaveError('');
      setToast('');
      try {
        const r = await api.saveLesson(id, lid, lesson, { force });
        setIssues(r.issues);
        if (r.saved) {
          setDirty(false);
          setBlocked(0);
          setToast(t('common.saved'));
          setReloadKey((k) => k + 1);
          const d = await api.lesson(id, lid);
          setDetail(d);
        } else {
          const n = r.issues.filter((i) => i.level === 'error' && !i.lang).length;
          setBlocked(n || 1);
          if (!n && r.error) setSaveError(r.error);
        }
      } catch (e) {
        setSaveError(errorText(e, t));
      }
      setSaving(false);
    },
    [id, lid, lesson, t],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && tab === 'beats') {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [dirty, save, tab]);

  const byBeat = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues) if (i.beat) m.set(i.beat, [...(m.get(i.beat) ?? []), i]);
    return m;
  }, [issues]);

  if (error)
    return (
      <div className="page">
        <Notice tone="error">{error.startsWith('no lesson') ? t('editor.notFound') : error}</Notice>
        <Link to={`/project/${encodeURIComponent(id)}`}>{t('editor.back')}</Link>
      </div>
    );
  if (!detail || !lesson)
    return (
      <div className="page">
        <Loading />
      </div>
    );

  const beats = lesson.beats;
  const i = Math.min(sel, beats.length - 1);
  const beat = beats[i]!;
  const lessonLang = lesson.lang;
  const update = (fn: (l: LessonObj) => void) => {
    setLesson((cur) => {
      const next = structuredClone(cur!) as LessonObj;
      fn(next);
      return next;
    });
    setDirty(true);
    setBlocked(0);
    setToast('');
  };
  const updateBeat = (fn: (b: Beat) => void) => update((l) => fn(l.beats[i]!));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= beats.length) return;
    update((l) => {
      const [b] = l.beats.splice(from, 1);
      l.beats.splice(to, 0, b!);
    });
    setSel(to);
  };
  const general = issues.filter((x) => !x.beat);
  const setTab = (tb: 'beats' | 'translations') =>
    navigate(
      `/project/${encodeURIComponent(id)}/lesson/${encodeURIComponent(lid)}${tb === 'translations' ? '?tab=translations' : ''}`,
      { replace: true },
    );

  return (
    <div className="page page-lesson">
      <nav className="crumbs" aria-label="breadcrumb">
        <Link to="/">{t('project.books')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/project/${encodeURIComponent(id)}?step=make`}>{t('editor.back')}</Link>
      </nav>
      <header className="lesson-head">
        <h1 className="display" lang={lessonLang}>
          <bdi>{lesson.title}</bdi>
        </h1>
        <div className="lesson-tabs" role="tablist" aria-label={lesson.title}>
          <button role="tab" type="button" aria-selected={tab === 'beats'} onClick={() => setTab('beats')}>
            {t('editor.beats')}
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'translations'}
            onClick={() => setTab('translations')}
          >
            {t('editor.translations')}
          </button>
        </div>
        {tab === 'beats' && (
          <div className="save-box">
            {dirty && <span className="dirty">{t('common.unsaved')}</span>}
            {toast && !dirty && <Toast>{toast}</Toast>}
            {blocked > 0 && (
              <Button variant="danger" onClick={() => void save(true)}>
                {t('editor.saveAnyway')}
              </Button>
            )}
            <Button
              variant="primary"
              busy={saving}
              disabled={!dirty}
              onClick={() => void save()}
              aria-keyshortcuts="Control+S"
            >
              {t('editor.save')}
            </Button>
          </div>
        )}
      </header>
      {blocked > 0 && <Notice tone="warn">{t('editor.blocked', { n: blocked })}</Notice>}
      {saveError && <Notice tone="error">{saveError}</Notice>}

      {tab === 'translations' ? (
        <Translations
          id={id}
          lid={lid}
          detail={detail}
          onSaved={(d) => setDetail(d)}
          onPreview={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <div className="editor-grid">
          <nav className="beat-list" aria-label={t('editor.beatList')}>
            <ol>
              {beats.map((b, k) => {
                const iss = byBeat.get(b.id) ?? [];
                const errs = iss.filter((x) => x.level === 'error').length;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: beat ids can repeat while the author edits
                  <li key={`${b.id}-${k}`} className={k === i ? 'is-sel' : ''}>
                    <button
                      type="button"
                      className="beat-btn"
                      aria-current={k === i ? 'true' : undefined}
                      onClick={() => setSel(k)}
                    >
                      <span className="beat-n">{i18n.num(k + 1)}</span>
                      <span className="beat-text" lang={lessonLang} dir={dirOf(lessonLang)}>
                        <span className="beat-title">{b.title}</span>
                        <span className="beat-move">{b.move ?? 'example'}</span>
                      </span>
                      {iss.length > 0 && (
                        <span
                          className={`badge ${errs ? 'badge-error' : 'badge-warn'}`}
                          title={t('editor.issueBadge', { n: iss.length })}
                        >
                          <span className="visually-hidden">{t('editor.issueBadge', { n: iss.length })}</span>
                          <span aria-hidden="true">{i18n.num(iss.length)}</span>
                        </span>
                      )}
                    </button>
                    <span className="beat-order">
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={k === 0}
                        aria-label={t('editor.moveUp', { title: b.title })}
                        onClick={() => move(k, k - 1)}
                      >
                        <Icon name="up" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={k === beats.length - 1}
                        aria-label={t('editor.moveDown', { title: b.title })}
                        onClick={() => move(k, k + 1)}
                      >
                        <Icon name="down" size={14} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
          <label className="beat-select">
            <span className="visually-hidden">{t('editor.beatList')}</span>
            <select value={i} onChange={(e) => setSel(Number(e.target.value))}>
              {beats.map((b, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: beat ids can repeat while the author edits
                <option key={`${b.id}-${k}`} value={k}>
                  {k + 1}. {b.title}
                  {byBeat.get(b.id)?.length ? ` (${byBeat.get(b.id)!.length})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="editor-main">
            <Preview
              id={id}
              lid={lid}
              bookId={detail.bookId}
              langs={detail.langs}
              lang={previewLang || lessonLang}
              onLang={setPreviewLang}
              onReload={() => setReloadKey((k) => k + 1)}
              beatId={beat.id}
              reloadKey={reloadKey}
              stale={dirty}
            />

            <section className="inspector sheet" aria-labelledby="inspector-title">
              <h2 id="inspector-title" className="small-title">
                <span className="beat-n">{i18n.num(i + 1)}</span>
                <span lang={lessonLang} dir="auto">
                  {beat.title}
                </span>
                <code className="muted">{beat.id}</code>
              </h2>
              <div className="form-row">
                <Field label={t('editor.title')} className="grow">
                  {(fid) => (
                    <input
                      id={fid}
                      lang={lessonLang}
                      dir="auto"
                      value={beat.title}
                      onChange={(e) => updateBeat((b) => void (b.title = e.target.value))}
                    />
                  )}
                </Field>
                <Field label={t('editor.move')}>
                  {(fid) => (
                    <select
                      id={fid}
                      value={beat.move ?? 'example'}
                      onChange={(e) => updateBeat((b) => void (b.move = e.target.value))}
                    >
                      {detail.moves.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <Field label={t('editor.narration')} hint={t('editor.narrationHint')}>
                {(fid, d) => (
                  <textarea
                    id={fid}
                    lang={lessonLang}
                    dir={dirOf(lessonLang)}
                    rows={5}
                    value={beat.narration}
                    aria-describedby={d}
                    onChange={(e) => updateBeat((b) => void (b.narration = e.target.value))}
                  />
                )}
              </Field>
              <MarkedNarration text={beat.narration} lang={lessonLang} />
              <h3 className="small-title">{t('editor.marks')}</h3>
              <CuesByMark beat={beat} />

              <div className="issues-box">
                <h3 className="small-title">{t('editor.issues')}</h3>
                <IssueList issues={byBeat.get(beat.id) ?? []} empty={t('editor.noIssues')} />
              </div>

              <details className="advanced">
                <summary>{t('editor.advanced')}</summary>
                <JsonField
                  label={t('editor.scene')}
                  shape="object"
                  value={beat.scene}
                  resetKey={`${beat.id}-${i}-scene`}
                  onValid={(v) => updateBeat((b) => void (b.scene = v as Record<string, unknown>))}
                />
                <JsonField
                  label={t('editor.cues')}
                  shape="array"
                  value={beat.cues}
                  resetKey={`${beat.id}-${i}-cues`}
                  onValid={(v) => updateBeat((b) => void (b.cues = v as Cue[]))}
                />
                <JsonField
                  label={t('editor.questions')}
                  shape="array"
                  value={beat.questions ?? []}
                  resetKey={`${beat.id}-${i}-questions`}
                  onValid={(v) =>
                    updateBeat((b) => {
                      if ((v as unknown[]).length) b.questions = v as unknown[];
                      else delete b.questions;
                    })
                  }
                />
              </details>

              <Regenerate
                id={id}
                lid={lid}
                beat={beat}
                disabled={dirty}
                onDone={() => void load().then(() => setReloadKey((k) => k + 1))}
              />
            </section>

            {!!general.length && (
              <section className="sheet lesson-issues" aria-labelledby="lesson-issues">
                <h2 id="lesson-issues" className="small-title">
                  {t('editor.lessonIssues')}
                </h2>
                <IssueList issues={general} />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
