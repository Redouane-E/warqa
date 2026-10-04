// The translation table: key | original | each language, editable, with mark, answer-box and $ checks.
import { dirOf } from '@warqa/i18n';
import { useMemo, useState } from 'react';
import type { LessonDetail, StringEntry } from '../../shared/types';
import { api, errorText } from '../api';
import { Button, Notice, Toast } from '../components/ui';
import { useI18n } from '../i18n';

type Value = string | { text: string; speak?: string };
const textOf = (v: Value | undefined) => (v === undefined ? '' : typeof v === 'string' ? v : v.text);
const sortedMarks = (s: string) =>
  [...s.matchAll(/\[\[(\w+)\]\]/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const dollars = (s: string) => (s.replace(/\\\$/g, '').match(/\$/g) ?? []).length;

/** Quick checks while typing (the server runs the full checkStrings on save). */
function liveProblems(e: StringEntry, text: string, t: ReturnType<typeof useI18n>['t']): string[] {
  if (!text.trim()) return [];
  const out: string[] = [];
  const want = sortedMarks(e.text) || '–';
  const got = sortedMarks(text) || '–';
  if (e.kind === 'narration' && want !== got) out.push(t('tr.marks', { want, got }));
  if (e.kind === 'math-template' && want !== got) out.push(t('tr.boxes', { want, got }));
  if (dollars(text) % 2) out.push(t('tr.dollars'));
  return out;
}

export function Translations({
  id,
  lid,
  detail,
  onSaved,
  onPreview,
}: {
  id: string;
  lid: string;
  detail: LessonDetail;
  onSaved: (d: LessonDetail) => void;
  onPreview: () => void;
}) {
  const { t, langName } = useI18n();
  const author = detail.lesson.lang;
  const langs = detail.bookLangs.filter((l) => l !== author);
  const [drafts, setDrafts] = useState<Record<string, Record<string, Value>>>(
    () => structuredClone(detail.strings) as Record<string, Record<string, Value>>,
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [serverIssues, setServerIssues] = useState(detail.stringIssues);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const problems = (lang: string, e: StringEntry): string[] => {
    const text = textOf(drafts[lang]?.[e.key]);
    if (!text.trim()) return [t('tr.missing')];
    return dirty.has(lang) ? liveProblems(e, text, t) : (serverIssues[lang]?.[e.key] ?? liveProblems(e, text, t));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: problems() reads drafts, serverIssues and dirty
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return detail.entries.filter((e) => {
      if (
        needle &&
        ![e.key, e.text, e.where, ...langs.map((l) => textOf(drafts[l]?.[e.key]))].some((s) =>
          s.toLowerCase().includes(needle),
        )
      )
        return false;
      if (only && !langs.some((l) => problems(l, e).length)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.entries, q, only, drafts, serverIssues, dirty]);

  const total = langs.reduce((a, l) => a + detail.entries.filter((e) => problems(l, e).length).length, 0);

  const set = (lang: string, key: string, text: string) => {
    setDrafts((cur) => {
      const next = { ...cur, [lang]: { ...(cur[lang] ?? {}) } };
      const old = next[lang]![key];
      next[lang]![key] = typeof old === 'object' ? { ...old, text } : text;
      return next;
    });
    setDirty((d) => new Set(d).add(lang));
    setToast('');
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const issues = { ...serverIssues };
      for (const lang of dirty) {
        const r = await api.saveStrings(id, lid, lang, drafts[lang] ?? {});
        issues[lang] = r.stringIssues[lang] ?? {};
      }
      setServerIssues(issues);
      setDirty(new Set());
      setToast(t('common.saved'));
      onSaved(await api.lesson(id, lid));
      onPreview();
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  if (!langs.length) return <Notice>{t('tr.noLangs')}</Notice>;

  return (
    <section className="translations" aria-label={t('editor.translations')}>
      <div className="tr-bar">
        <input
          type="search"
          className="tr-search"
          placeholder={t('tr.search')}
          aria-label={t('tr.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          dir="auto"
        />
        <label className="check">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
          <span>{t('tr.onlyProblems')}</span>
        </label>
        <span className="muted small">
          {t('tr.rows', { n: rows.length })}
          {total ? <span className="warn"> · {t('tr.problems', { n: total })}</span> : null}
        </span>
        <span className="tr-save">
          {!!dirty.size && <span className="dirty">{t('common.unsaved')}</span>}
          {toast && !dirty.size && <Toast>{toast}</Toast>}
          <Button variant="primary" busy={busy} disabled={!dirty.size} onClick={() => void save()}>
            {t('tr.save')}
          </Button>
        </span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!rows.length ? (
        <p className="muted">{t('tr.empty')}</p>
      ) : (
        <div className="tr-table" style={{ ['--cols' as string]: String(langs.length + 1) }}>
          <div className="tr-row tr-head" aria-hidden="true">
            <span>
              {langName(author)} <span className="muted small">({t('tr.original')})</span>
            </span>
            {langs.map((l) => (
              <span key={l} lang={l}>
                {langName(l)}
              </span>
            ))}
          </div>
          {rows.map((e) => (
            <div key={e.key} className="tr-row">
              <div className="tr-source">
                <span className="tr-where" dir="ltr">
                  {e.where}
                </span>
                <p lang={author} dir={dirOf(author)}>
                  {e.text}
                </p>
              </div>
              {langs.map((l) => {
                const text = textOf(drafts[l]?.[e.key]);
                const probs = problems(l, e);
                const missing = !text.trim();
                return (
                  <div key={l} className={`tr-cell ${probs.length ? (missing ? 'is-missing' : 'is-bad') : ''}`}>
                    <span className="tr-cell-lang" aria-hidden="true">
                      {langName(l)}
                    </span>
                    <textarea
                      lang={l}
                      dir={dirOf(l)}
                      aria-label={`${langName(l)} — ${e.where}`}
                      aria-invalid={probs.length && !missing ? true : undefined}
                      rows={Math.min(8, Math.max(2, Math.ceil(Math.max(text.length, e.text.length) / 44)))}
                      value={text}
                      onChange={(ev) => set(l, e.key, ev.target.value)}
                    />
                    {probs.map((p, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: messages have no id
                      <p key={k} className="tr-problem">
                        <bdi>{p}</bdi>
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
