// Book settings (redesign 4g): a side sheet over the book, from the foot of its rail, Go to or its address
// (/project/:id/settings). Only what belongs to this book: its title, languages, audience and tone, digits, spending
// limit, and its map layers. Its models and voices are changed in AI and voices (one line here leads there).

import { langInfo } from '@warqa/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoLayerInfo, GeoResult, ProjectDetail } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, waitForJob } from '../api';
import { BOOK_LANGS, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link } from '../router';
import { useConfirm, useToast, useUnsavedGuard } from './overlays';
import { SideSheet } from './SideSheet';
import { Button, Field, Loading, Notice } from './ui';

interface Form {
  title: Record<string, string>;
  subtitle: Record<string, string>;
  langs: string[];
  other: string;
  defaultLang: string;
  audience: string;
  tone: string;
  digits: 'latn' | 'arab';
  budget: string;
}

const asMap = (v: string | Record<string, string> | undefined, lang: string): Record<string, string> =>
  v === undefined ? {} : typeof v === 'string' ? { [lang]: v } : { ...v };

function formOf(p: ProjectDetail): Form {
  const def = p.book.defaultLang ?? p.book.langs[0]!;
  return {
    title: asMap(p.book.title, def),
    subtitle: asMap(p.book.subtitle, def),
    langs: p.book.langs.filter((l) => BOOK_LANGS.includes(l)),
    other: p.book.langs.filter((l) => !BOOK_LANGS.includes(l)).join(', '),
    defaultLang: def,
    audience: p.book.audience ?? p.config.audience ?? '',
    tone: p.config.tone ?? '',
    digits: p.book.digits,
    budget: p.config.budget.usd !== undefined ? p.config.budget.usd.toFixed(2) : '',
  };
}

const allLangs = (f: Form) => [
  ...f.langs,
  ...f.other
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(s) && !BOOK_LANGS.includes(s)),
];

/** A decimal typed with a comma, Arabic digits or the Arabic decimal sign, as a number (or NaN). */
const parseAmount = (s: string): number =>
  Number(
    s
      .trim()
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
      .replace(/[٫,]/, '.'),
  );

export function BookSettings({
  p,
  open,
  onClose,
  onSaved,
  focus,
}: {
  p: ProjectDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (d: ProjectDetail) => void;
  /** What the address asked for: the limit field, or Maps unfolded. */
  focus?: 'budget' | 'maps';
}) {
  const i18n = useI18n();
  const { t, langName, usd } = i18n;
  const { status } = useStatus();
  const confirm = useConfirm();
  const toast = useToast();
  const [f, setF] = useState<Form>(() => formOf(p));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const limitRef = useRef<HTMLInputElement>(null);
  useUnsavedGuard(open && dirty);
  // a fresh form each time it opens (the book may have changed meanwhile)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it opens
  useEffect(() => {
    if (open) {
      setF(formOf(p));
      setDirty(false);
      setError('');
    }
  }, [open]);
  useEffect(() => {
    if (open && focus === 'budget') requestAnimationFrame(() => limitRef.current?.focus());
  }, [open, focus]);

  const langs = allLangs(f);
  const mainLang = langs.includes(f.defaultLang) ? f.defaultLang : (langs[0] ?? '');
  const amount = f.budget.trim() ? parseAmount(f.budget) : null;
  const badAmount = amount !== null && (!Number.isFinite(amount) || amount <= 0);
  const set = (patch: Partial<Form>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setDirty(true);
  };

  const close = useCallback(async () => {
    if (
      dirty &&
      !(await confirm({ title: t('leave.title'), confirm: t('leave.discard'), cancel: t('leave.stay'), danger: true }))
    )
      return;
    setDirty(false);
    onClose();
  }, [dirty, confirm, t, onClose]);

  const save = useCallback(async () => {
    if (!dirty || busy || !langs.length || badAmount) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.saveSettings(p.id, {
        langs,
        defaultLang: mainLang,
        audience: f.audience,
        tone: f.tone,
        digits: f.digits,
        budget: { usd: amount && amount > 0 ? amount : null },
        title: Object.fromEntries(langs.map((l) => [l, f.title[l] ?? ''])),
        subtitle: Object.fromEntries(langs.map((l) => [l, f.subtitle[l] ?? ''])),
      });
      setDirty(false);
      onSaved(d);
      toast({ text: t('settings.saved'), tone: 'good' });
      onClose();
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  }, [dirty, busy, langs, badAmount, p.id, mainLang, f, amount, onSaved, toast, t, onClose]);

  // Ctrl or ⌘ S saves the sheet (the physical key: an Arabic layout works too)
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      // (not under the leave dialog: its answer comes first)
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyS') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, save]);

  // a book without a set of its own uses the first set its keys allow
  const set_ = p.config.preset
    ? status?.presets.find((x) => x.id === p.config.preset)
    : status?.presets.find((x) => x.available && x.id !== 'local');
  const custom = Object.keys(p.config.models).length > 0;
  const setLabel = custom
    ? t('preset.custom')
    : set_
      ? ((k) => (t(k) === k ? set_.label : t(k)))(`preset.${set_.id}` as MsgKey)
      : t('ai.fromSet');
  const engineLabel = t(`ai.engine.${p.config.tts.provider}` as MsgKey).split(' · ')[0]!;

  return (
    <SideSheet open={open} onClose={() => void close()} title={t('book.settings')} className="book-sheet">
      <form
        className="book-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="book-form-body">
          <section className="bs-group" aria-label={t('book.titles')}>
            {langs.map((l) => (
              <Field key={l} label={t('settings.bookTitle', { lang: langName(l) })}>
                {(fid) => (
                  <input
                    id={fid}
                    lang={l}
                    dir="auto"
                    value={f.title[l] ?? ''}
                    onChange={(e) => set({ title: { ...f.title, [l]: e.target.value } })}
                  />
                )}
              </Field>
            ))}
            <details className="bs-more">
              <summary>{t('book.subtitles')}</summary>
              {langs.map((l) => (
                <Field key={l} label={t('settings.subtitle', { lang: langName(l) })}>
                  {(fid) => (
                    <input
                      id={fid}
                      lang={l}
                      dir="auto"
                      value={f.subtitle[l] ?? ''}
                      onChange={(e) => set({ subtitle: { ...f.subtitle, [l]: e.target.value } })}
                    />
                  )}
                </Field>
              ))}
            </details>
          </section>

          <fieldset className="bs-group" aria-describedby={langs.length ? undefined : 'bs-nolangs'}>
            <legend>{t('new.langs')}</legend>
            <div className="bs-langs">
              {BOOK_LANGS.map((l) => (
                <label key={l} className={`bs-lang${f.langs.includes(l) ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={f.langs.includes(l)}
                    onChange={(e) =>
                      set({ langs: e.target.checked ? [...f.langs, l] : f.langs.filter((x) => x !== l) })
                    }
                  />
                  {/* each language in its own name and direction (the Kit's chips) */}
                  <span lang={l} dir={langInfo(l).dir}>
                    {langInfo(l).name}
                  </span>
                </label>
              ))}
            </div>
            {!langs.length && (
              <p id="bs-nolangs" className="field-error">
                {t('book.noLangs')}
              </p>
            )}
            <Field label={t('new.otherLang')} hint={t('new.otherLangHint')}>
              {(fid, d) => (
                <input
                  id={fid}
                  value={f.other}
                  dir="ltr"
                  size={12}
                  aria-describedby={d}
                  onChange={(e) => set({ other: e.target.value })}
                />
              )}
            </Field>
            {langs.length > 1 && (
              <Field label={t('settings.mainLang')}>
                {(fid) => (
                  <select id={fid} value={mainLang} onChange={(e) => set({ defaultLang: e.target.value })}>
                    {langs.map((l) => (
                      <option key={l} value={l}>
                        {langName(l)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </fieldset>

          <section className="bs-group" aria-label={t('new.audience')}>
            <Field label={t('new.audience')}>
              {(fid) => (
                <input
                  id={fid}
                  dir="auto"
                  value={f.audience}
                  placeholder={t('new.audiencePlaceholder')}
                  onChange={(e) => set({ audience: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('settings.tone')}>
              {(fid) => (
                <input
                  id={fid}
                  dir="auto"
                  value={f.tone}
                  placeholder={t('settings.tonePlaceholder')}
                  onChange={(e) => set({ tone: e.target.value })}
                />
              )}
            </Field>
          </section>

          <fieldset className="bs-group">
            <legend>{t('settings.digits')}</legend>
            <div className="bs-radios">
              {(['latn', 'arab'] as const).map((d) => (
                <label key={d} className="check">
                  <input type="radio" name="bs-digits" checked={f.digits === d} onChange={() => set({ digits: d })} />
                  <span>{t(`settings.digits.${d}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="bs-group" id="budget">
            <div className="field">
              <label id="bs-limit-l" htmlFor="bs-limit">
                {t('ob.budget.title')}
              </label>
              <div className={`money-field${badAmount ? ' is-bad' : ''}`}>
                <span className="money-unit mono" id="bs-limit-unit">
                  <span aria-hidden="true">USD</span>
                  <span className="visually-hidden">{t('book.limitUnit')}</span>
                </span>
                <input
                  ref={limitRef}
                  id="bs-limit"
                  className="mono"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="1.00"
                  aria-describedby={`bs-limit-unit bs-limit-help${badAmount ? ' bs-limit-bad' : ''}`}
                  aria-invalid={badAmount || undefined}
                  value={f.budget}
                  onChange={(e) => set({ budget: e.target.value })}
                />
              </div>
              {badAmount && (
                <p id="bs-limit-bad" className="field-error">
                  {t('book.limitBad')}
                </p>
              )}
              <p id="bs-limit-help" className="hint">
                {t('book.limitHelp')}
              </p>
              <p className="mono muted small">{t('book.spentSoFar', { spent: usd(p.ledger.total) })}</p>
            </div>
          </div>

          <section className="bs-group bs-ai" aria-labelledby="bs-ai-t">
            <p id="bs-ai-t" className="bs-label">
              {t('book.models')}
            </p>
            <p className="bs-ai-line">
              <bdi>{t('book.modelsLine', { set: setLabel, engine: engineLabel })}</bdi>
            </p>
            <Link to={`/ai?book=${encodeURIComponent(p.id)}#set`}>{t('book.aiChange')}</Link>
          </section>

          <details className="bs-more bs-maps" id="maps" open={focus === 'maps' || undefined}>
            <summary>{t('settings.maps')}</summary>
            <MapsSection id={p.id} />
          </details>
        </div>
        <div className="book-form-foot">
          {error && <Notice tone="error">{error}</Notice>}
          <div className="book-form-actions">
            {dirty && <span className="dirty">{t('common.unsaved')}</span>}
            <Button type="submit" variant="primary" busy={busy} disabled={!dirty || !langs.length || badAmount}>
              {t('settings.save')}
            </Button>
          </div>
        </div>
      </form>
    </SideSheet>
  );
}

/** Region layers for maps: list them, add a country's regions (a "geo" job: geoBoundaries). */
function MapsSection({ id }: { id: string }) {
  const { t } = useI18n();
  const { status } = useStatus();
  const [layers, setLayers] = useState<GeoLayerInfo[] | null>(null);
  const [country, setCountry] = useState('');
  const [level, setLevel] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<GeoResult | null>(null);
  const can = !status?.capabilities?.jobsUnavailable.includes('geo');
  const load = useCallback(() => {
    api
      .geo(id)
      .then((r) => setLayers(r.layers))
      .catch(() => setLayers([]));
  }, [id]);
  useEffect(load, [load]);
  const code = country.trim().toUpperCase();
  const add = async () => {
    setBusy(true);
    setError('');
    setAdded(null);
    try {
      const { jobId } = await api.startJob(id, 'geo', { country: code, level });
      const job = await waitForJob(jobId);
      if (job.status === 'done') {
        setAdded(job.result as GeoResult);
        setCountry('');
        load();
      } else setError(job.error ?? job.status);
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };
  // a form of its own would sit inside the sheet's form: its fields submit with their own button instead
  return (
    <div className="maps">
      <p className="hint">{t('geo.intro')}</p>
      {layers === null ? (
        <Loading />
      ) : layers.length ? (
        <ul className="layer-list">
          {layers.map((l) => (
            <li key={l.id}>
              <code>{l.id}</code>
              <span>{t('geo.regions', { n: l.regions.length })}</span>
              <span className="muted small" dir="auto">
                {l.regions
                  .slice(0, 6)
                  .map((r) => r.name)
                  .join(', ')}
                {l.regions.length > 6 ? '…' : ''}
              </span>
              <span className="muted small" dir="ltr">
                {l.attribution}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('geo.none')}</p>
      )}
      <div className="form-row">
        <Field label={t('geo.country')} hint={t('geo.countryHint')}>
          {(fid, d) => (
            <input
              id={fid}
              dir="ltr"
              size={6}
              maxLength={3}
              autoComplete="off"
              spellCheck={false}
              placeholder="MAR"
              aria-describedby={d}
              value={country}
              disabled={!can}
              onChange={(e) => setCountry(e.target.value.replace(/[^a-z]/gi, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (/^[A-Z]{3}$/.test(code) && !busy) void add();
                }
              }}
            />
          )}
        </Field>
        <Field label={t('geo.level')}>
          {(fid) => (
            <select id={fid} value={level} disabled={!can} onChange={(e) => setLevel(e.target.value === '2' ? 2 : 1)}>
              <option value={1}>{t('geo.level1')}</option>
              <option value={2}>{t('geo.level2')}</option>
            </select>
          )}
        </Field>
        <div className="field">
          <Button busy={busy} disabled={!can || !/^[A-Z]{3}$/.test(code)} onClick={() => void add()}>
            {busy ? t('geo.adding') : t('geo.add')}
          </Button>
        </div>
      </div>
      {!can && <Notice>{t('cap.desktopOnly')}</Notice>}
      {added && (
        <Notice tone="good">
          {t('geo.added', {
            id: added.id,
            n: added.regions,
            license: added.license,
            credit: added.attribution || '—',
          })}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="hint">{t('geo.source')}</p>
    </div>
  );
}
