import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoLayerInfo, GeoResult, ModelSummary, ProjectDetail, StatusInfo } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, waitForJob } from '../api';
import { KeysForm } from '../components/KeysForm';
import { Button, Field, Loading, Notice, Toast } from '../components/ui';
import { BOOK_LANGS, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link } from '../router';
import { bookTitle } from './Home';

interface Form {
  title: Record<string, string>;
  subtitle: Record<string, string>;
  langs: string[];
  other: string;
  defaultLang: string;
  audience: string;
  tone: string;
  digits: 'latn' | 'arab';
  preset: string;
  models: Record<string, string>;
  engine: string;
  voices: Record<string, string>;
  rate: string;
  tashkeel: boolean;
  budget: string;
  worker: string;
}

const MAIN = BOOK_LANGS;

const asMap = (v: string | Record<string, string> | undefined, lang: string): Record<string, string> =>
  v === undefined ? {} : typeof v === 'string' ? { [lang]: v } : { ...v };

function formOf(p: ProjectDetail): Form {
  const def = p.book.defaultLang ?? p.book.langs[0]!;
  return {
    title: asMap(p.book.title, def),
    subtitle: asMap(p.book.subtitle, def),
    langs: p.book.langs.filter((l) => MAIN.includes(l)),
    other: p.book.langs.filter((l) => !MAIN.includes(l)).join(', '),
    defaultLang: def,
    audience: p.book.audience ?? p.config.audience ?? '',
    tone: p.config.tone ?? '',
    digits: p.book.digits,
    preset: p.config.preset ?? '',
    models: { ...p.config.models },
    engine: p.config.tts.provider,
    voices: { ...p.config.tts.voices },
    rate: p.config.tts.rate ?? '',
    tashkeel: p.config.tts.tashkeel,
    budget: p.config.budget.usd !== undefined ? String(p.config.budget.usd) : '',
    worker: p.config.worker ?? '',
  };
}

const allLangs = (f: Form) => [
  ...f.langs,
  ...f.other
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(s) && !MAIN.includes(s)),
];

/** The model a role would use: explicit override, the chosen set, or the first set the keys allow. */
function effectiveModel(
  f: Form,
  role: string,
  status: StatusInfo | null,
): { model?: string; from: 'override' | 'preset' | 'auto' | 'none' } {
  if (f.models[role]?.trim()) return { model: f.models[role]!.trim(), from: 'override' };
  const preset = f.preset
    ? status?.presets.find((p) => p.id === f.preset)
    : status?.presets.find((p) => p.available && p.id !== 'local');
  if (preset) return { model: preset.roles[role], from: f.preset ? 'preset' : 'auto' };
  return { from: 'none' };
}

function ModelBadges({ id, models }: { id: string; models: ModelSummary[] }) {
  const { t, usd } = useI18n();
  const m = models.find((x) => x.id === id);
  if (!m) return <span className="badge badge-muted">{t('settings.unknownModel')}</span>;
  const local = m.input === 0 && m.output === 0;
  return (
    <span className="model-badges">
      <span className={`badge tier tier-${m.tier}`} title={t('settings.tierHint')}>
        {t('settings.tier', { tier: m.tier })}
      </span>
      {m.vision && <span className="badge">{t('settings.vision')}</span>}
      <span className="badge badge-muted">
        {local ? t('settings.free') : t('settings.price', { input: usd(m.input), output: usd(m.output) })}
      </span>
    </span>
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
  return (
    <section id="maps" className="sheet" aria-labelledby="h-maps">
      <h2 id="h-maps">{t('settings.maps')}</h2>
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
      <form
        className="form-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[A-Z]{3}$/.test(code) && !busy) void add();
        }}
      >
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
          <Button type="submit" busy={busy} disabled={!can || !/^[A-Z]{3}$/.test(code)}>
            {busy ? t('geo.adding') : t('geo.add')}
          </Button>
        </div>
      </form>
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
    </section>
  );
}

export function SettingsPage({ id }: { id: string }) {
  const { t, langName, lang } = useI18n();
  const { status } = useStatus();
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .project(id)
      .then((d) => {
        setP(d);
        setF(formOf(d));
      })
      .catch((e) => setError(errorText(e, tRef.current)));
  }, [id]);

  // once the form is there, honour a #section link (e.g. #speech from the project page)
  const loaded = f !== null;
  useEffect(() => {
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [loaded]);

  const models = status?.models ?? [];
  const engines = status?.tts ?? [];
  const engine = engines.find((e) => e.id === f?.engine);
  const caps = status?.capabilities;
  const engineOff = (id: string) => !!caps?.ttsUnavailable.includes(id);
  const langs = useMemo(() => (f ? allLangs(f) : []), [f]);

  if (error)
    return (
      <div className="page">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  if (!p || !f)
    return (
      <div className="page">
        <Loading />
      </div>
    );

  const set = (patch: Partial<Form>) => {
    setF({ ...f, ...patch });
    setDirty(true);
    setToast('');
  };
  const mainLang = langs.includes(f.defaultLang) ? f.defaultLang : (langs[0] ?? '');

  const save = async () => {
    setBusy(true);
    setSaveError('');
    try {
      const budget = f.budget.trim() ? Number(f.budget) : null;
      const d = await api.saveSettings(id, {
        langs,
        defaultLang: mainLang,
        audience: f.audience,
        tone: f.tone,
        digits: f.digits,
        preset: f.preset || null,
        models: f.models,
        tts: {
          provider: f.engine,
          voices: Object.fromEntries(Object.entries(f.voices).filter(([l]) => langs.includes(l))),
          rate: f.rate.trim() || null,
          tashkeel: f.tashkeel,
        },
        budget: { usd: budget && budget > 0 ? budget : null },
        worker: f.worker.trim() || null,
        title: Object.fromEntries(langs.map((l) => [l, f.title[l] ?? ''])),
        subtitle: Object.fromEntries(langs.map((l) => [l, f.subtitle[l] ?? ''])),
      });
      setP(d);
      setF(formOf(d));
      setDirty(false);
      setToast(t('settings.saved'));
    } catch (e) {
      setSaveError(errorText(e, t));
    }
    setBusy(false);
  };

  const sections: [string, MsgKey][] = [
    ['book', 'settings.book'],
    ['models', 'settings.models'],
    ['keys', 'settings.keys'],
    ['speech', 'settings.speech'],
    ['maps', 'settings.maps'],
    ['budget', 'settings.budget'],
  ];
  const title = bookTitle(p.title, lang, p.defaultLang);

  return (
    <div className="page page-settings">
      <nav className="crumbs" aria-label="breadcrumb">
        <Link to="/">{t('project.books')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/project/${encodeURIComponent(id)}`} dir="auto">
          {title}
        </Link>
      </nav>
      <header className="page-head">
        <h1 className="display">{t('settings.title')}</h1>
      </header>
      <div className="settings-grid">
        <nav className="section-index" aria-label={t('settings.title')}>
          <ol>
            {sections.map(([sid, key]) => (
              <li key={sid}>
                <a href={`#${sid}`}>{t(key)}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="settings-body">
          <section id="book" className="sheet" aria-labelledby="h-book">
            <h2 id="h-book">{t('settings.book')}</h2>
            <fieldset className="field">
              <legend>{t('settings.langs')}</legend>
              <div className="checks">
                {MAIN.map((l) => (
                  <label key={l} className="check">
                    <input
                      type="checkbox"
                      checked={f.langs.includes(l)}
                      onChange={(e) =>
                        set({ langs: e.target.checked ? [...f.langs, l] : f.langs.filter((x) => x !== l) })
                      }
                    />
                    <span lang={l}>{langName(l)}</span>
                  </label>
                ))}
              </div>
              <Field label={t('new.otherLang')} hint={t('new.otherLangHint')} className="field-inline">
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
            </fieldset>
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
            <div className="lang-grid">
              {langs.map((l) => (
                <div key={l} className="lang-pair">
                  <Field label={t('settings.bookTitle', { lang: langName(l) })}>
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
                  <Field label={t('settings.subtitle', { lang: langName(l) })}>
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
                </div>
              ))}
            </div>
            <div className="form-row">
              <Field label={t('settings.audience')} className="grow">
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
              <Field label={t('settings.tone')} className="grow">
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
            </div>
            <fieldset className="field">
              <legend>{t('settings.digits')}</legend>
              <div className="checks">
                {(['latn', 'arab'] as const).map((d) => (
                  <label key={d} className="check">
                    <input type="radio" name="digits" checked={f.digits === d} onChange={() => set({ digits: d })} />
                    <span>{t(`settings.digits.${d}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <section id="models" className="sheet" aria-labelledby="h-models">
            <h2 id="h-models">{t('settings.models')}</h2>
            <p className="hint">{t('settings.modelsIntro')}</p>
            <Field label={t('settings.preset')}>
              {(fid) => (
                <select id={fid} value={f.preset} onChange={(e) => set({ preset: e.target.value })}>
                  <option value="">{t('settings.preset.auto')}</option>
                  {[...(status?.presets ?? [])]
                    .sort((a, b) => Number(b.available) - Number(a.available))
                    .map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.label}
                        {pr.available ? '' : ` — ${t('settings.preset.needs', { keys: pr.missing.join(', ') })}`}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            {f.preset && <p className="hint">{status?.presets.find((x) => x.id === f.preset)?.description}</p>}
            <datalist id="model-ids">
              {models.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
            <ul className="roles">
              {(status?.roles ?? []).map((r) => {
                const eff = effectiveModel(f, r.id, status);
                return (
                  <li key={r.id} className="role">
                    <div className="role-head">
                      <span className="role-name">{t(`role.${r.id}` as MsgKey)}</span>
                      <span className="hint">{t(`roleInfo.${r.id}` as MsgKey)}</span>
                    </div>
                    <div className="role-model">
                      {eff.model ? (
                        <>
                          <code dir="ltr">{eff.model}</code>
                          <ModelBadges id={eff.model} models={models} />
                        </>
                      ) : (
                        <span className="warn small">{t('settings.noModel')}</span>
                      )}
                    </div>
                    <Field
                      label={t('settings.override', { role: t(`role.${r.id}` as MsgKey) })}
                      className="role-override"
                    >
                      {(fid) => (
                        <input
                          id={fid}
                          list="model-ids"
                          dir="ltr"
                          spellCheck={false}
                          value={f.models[r.id] ?? ''}
                          placeholder={
                            eff.from === 'override'
                              ? t('settings.overridePlaceholder')
                              : eff.model
                                ? t('settings.fromPreset', {
                                    model: effectiveModel({ ...f, models: {} }, r.id, status).model ?? '',
                                  })
                                : t('settings.overridePlaceholder')
                          }
                          onChange={(e) => set({ models: { ...f.models, [r.id]: e.target.value } })}
                        />
                      )}
                    </Field>
                  </li>
                );
              })}
            </ul>
          </section>

          <section id="keys" className="sheet" aria-labelledby="h-keys">
            <h2 id="h-keys">{t('settings.keys')}</h2>
            <KeysForm />
          </section>

          <section id="speech" className="sheet" aria-labelledby="h-speech">
            <h2 id="h-speech">{t('settings.speech')}</h2>
            <Field label={t('settings.engine')}>
              {(fid) => (
                <select id={fid} value={f.engine} onChange={(e) => set({ engine: e.target.value })}>
                  {engines.map((e) => (
                    <option key={e.id} value={e.id} disabled={engineOff(e.id) && e.id !== f.engine}>
                      {e.id === 'none' ? t('settings.engine.none') : e.id}
                      {e.costPerMChars ? ` · ~$${e.costPerMChars}/M` : ''}
                      {engineOff(e.id) ? ` — ${t('cap.desktopOnly')}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {engineOff(f.engine) ? (
              <Notice tone="warn">{t('cap.engine', { engine: f.engine })}</Notice>
            ) : (
              f.engine === 'edge' && <Notice tone="warn">{t('settings.edgeNote')}</Notice>
            )}
            {engine?.note && f.engine !== 'edge' && (
              <p className="hint" lang="en" dir="ltr">
                {engine.note}
              </p>
            )}
            {f.engine !== 'none' && (
              <>
                <div className="lang-grid">
                  {langs.map((l) => (
                    <Field
                      key={l}
                      label={t('settings.voice', { lang: langName(l) })}
                      hint={
                        engine?.voices[l.split('-')[0]!]
                          ? t('settings.voiceDefault', { voice: engine.voices[l.split('-')[0]!]! })
                          : undefined
                      }
                    >
                      {(fid, d) => (
                        <input
                          id={fid}
                          dir="ltr"
                          spellCheck={false}
                          aria-describedby={d}
                          value={f.voices[l] ?? ''}
                          placeholder={engine?.voices[l.split('-')[0]!] ?? ''}
                          onChange={(e) => set({ voices: { ...f.voices, [l]: e.target.value } })}
                        />
                      )}
                    </Field>
                  ))}
                </div>
                <div className="form-row">
                  <Field label={t('settings.rate')} hint={t('settings.rateHint')}>
                    {(fid, d) => (
                      <input
                        id={fid}
                        dir="ltr"
                        size={8}
                        value={f.rate}
                        placeholder="+0%"
                        aria-describedby={d}
                        onChange={(e) => set({ rate: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
                {langs.some((l) => l.startsWith('ar')) && (
                  <label className="check">
                    <input type="checkbox" checked={f.tashkeel} onChange={(e) => set({ tashkeel: e.target.checked })} />
                    <span>{t('settings.tashkeel')}</span>
                  </label>
                )}
              </>
            )}
          </section>

          <MapsSection id={id} />

          <section id="budget" className="sheet" aria-labelledby="h-budget">
            <h2 id="h-budget">{t('settings.budget')}</h2>
            <div className="form-row">
              <Field label={t('settings.budgetUsd')} hint={t('settings.budgetHint')}>
                {(fid, d) => (
                  <input
                    id={fid}
                    type="number"
                    min={0}
                    step="0.5"
                    dir="ltr"
                    size={8}
                    value={f.budget}
                    aria-describedby={d}
                    onChange={(e) => set({ budget: e.target.value })}
                  />
                )}
              </Field>
              {caps?.worker !== false && (
                <Field label={t('settings.worker')} hint={t('settings.workerHint')} className="grow">
                  {(fid, d) => (
                    <input
                      id={fid}
                      type="url"
                      dir="ltr"
                      value={f.worker}
                      placeholder="http://localhost:8790"
                      aria-describedby={d}
                      onChange={(e) => set({ worker: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          </section>

          <section className="save-bar" aria-label={t('settings.save')}>
            {saveError && <Notice tone="error">{saveError}</Notice>}
            {dirty && <span className="dirty">{t('common.unsaved')}</span>}
            {toast && !dirty && <Toast>{toast}</Toast>}
            <Button variant="primary" busy={busy} disabled={!dirty || !langs.length} onClick={() => void save()}>
              {t('settings.save')}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
