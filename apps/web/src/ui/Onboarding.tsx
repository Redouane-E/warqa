// The start guide for first-time users: language, an AI provider and its key (checked, kept in this browser),
// the PDF, the book's languages and a spending limit; then the book is created and its PDF is read.
import { type DragEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { api, errorText } from '../../../studio/src/client/api';
import { Button, Field, Icon, Notice, Sheet } from '../../../studio/src/client/components/ui';
import { BOOK_LANGS, setLang, UI_LANGS, type UiLang, useI18n } from '../../../studio/src/client/i18n';
import { navigate } from '../../../studio/src/client/router';
import { FAKE_PROVIDER, type KeyCheck, PROVIDERS, type WebProvider } from '../providers';
import { FAKE_MODEL } from '../worker/fake';
import { useW } from './i18n';
import type { WebKey } from './messages';
import { setOnboarded } from './prefs';
import { webApi } from './webApi';

const STEPS = ['lang', 'provider', 'pdf', 'langs', 'budget'] as const;
type Step = (typeof STEPS)[number];

const NAMES: Record<UiLang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };
const ROLES = ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'];

function ProviderCard({ p, checked, onPick }: { p: WebProvider; checked: boolean; onPick: () => void }) {
  const w = useW();
  return (
    <label className={`provider-card ${checked ? 'is-on' : ''}`}>
      <input type="radio" name="provider" checked={checked} onChange={onPick} />
      <span className="provider-name">{p.name}</span>
      <span className="provider-note">{w(`ob.p.${p.id}` as WebKey)}</span>
    </label>
  );
}

function KeyStep({
  fake,
  provider,
  setProvider,
  ready,
  setReady,
}: {
  fake: boolean;
  provider: WebProvider | null;
  setProvider: (p: WebProvider) => void;
  ready: boolean;
  setReady: (v: boolean) => void;
}) {
  const w = useW();
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .keys()
      .then((r) => setSaved(r.keys.filter((k) => k.set).map((k) => k.name)))
      .catch(() => setSaved([]));
  }, []);
  useEffect(() => {
    setKey('');
    setResult(null);
    setError('');
    setReady(!!provider && (provider.id === 'fake' || saved.includes(provider.env)));
  }, [provider, saved, setReady]);

  const check = async () => {
    if (!provider) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await webApi.checkKey(provider.id, key.trim());
      setResult(r);
      if (r.ok) {
        if (provider.id !== 'fake' && (key.trim() || provider.local))
          await api.saveKeys({ [provider.env]: key.trim() || 'http://localhost:11434/api' });
        setReady(true);
      }
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  const recommended = PROVIDERS.filter((p) => p.recommended);
  const others = PROVIDERS.filter((p) => !p.recommended);
  const message = (r: KeyCheck) =>
    r.ok
      ? w(r.warning === 'rate' ? 'ob.check.rate' : 'ob.check.ok')
      : w(`ob.check.${r.reason}`, { provider: provider?.name ?? '', status: r.status ?? '' });
  const site = provider?.keyUrl ? new URL(provider.keyUrl).host : '';

  return (
    <>
      <p className="lede">{w('ob.provider.lede')}</p>
      <fieldset className="providers">
        <legend>{w('ob.provider.recommended')}</legend>
        <div className="provider-grid">
          {fake && (
            <ProviderCard
              p={FAKE_PROVIDER}
              checked={provider?.id === 'fake'}
              onPick={() => setProvider(FAKE_PROVIDER)}
            />
          )}
          {recommended.map((p) => (
            <ProviderCard key={p.id} p={p} checked={provider?.id === p.id} onPick={() => setProvider(p)} />
          ))}
        </div>
        <details className="provider-more" open={!!provider && !provider.recommended && provider.id !== 'fake'}>
          <summary>{w('ob.provider.more')}</summary>
          <div className="provider-grid">
            {others.map((p) => (
              <ProviderCard key={p.id} p={p} checked={provider?.id === p.id} onPick={() => setProvider(p)} />
            ))}
          </div>
        </details>
      </fieldset>

      {provider && provider.id !== 'fake' && (
        <div className="key-box sheet">
          {saved.includes(provider.env) && (
            <Notice tone="good">{w('ob.keyExisting', { provider: provider.name })}</Notice>
          )}
          {provider.keyUrl && !provider.local && (
            <div className="howto">
              <h3>{w('ob.howto')}</h3>
              <ol>
                <li>
                  {w('ob.howto.1', { site: '\u0000' }).split('\u0000')[0]}
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer" dir="ltr">
                    {site} <Icon name="external" size={13} />
                  </a>
                  {w('ob.howto.1', { site: '\u0000' }).split('\u0000')[1]}
                </li>
                <li>{w('ob.howto.2')}</li>
                <li>{w('ob.howto.3')}</li>
              </ol>
            </div>
          )}
          <form
            className="key-check"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && (key.trim() || provider.local)) void check();
            }}
          >
            <Field
              label={provider.local ? w('ob.address') : w('ob.key', { provider: provider.name })}
              hint={w('ob.keyPrivacy', { provider: provider.name })}
            >
              {(id, d) => (
                <input
                  id={id}
                  type={provider.local ? 'url' : 'password'}
                  autoComplete={provider.local ? 'off' : 'new-password'}
                  spellCheck={false}
                  dir="ltr"
                  value={key}
                  placeholder={provider.local ? 'http://localhost:11434/api' : ''}
                  aria-describedby={d}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setResult(null);
                  }}
                />
              )}
            </Field>
            <Button type="submit" busy={busy} disabled={!key.trim() && !provider.local}>
              {busy ? w('ob.checking') : w('ob.check')}
            </Button>
          </form>
          {result && (
            <Notice tone={result.ok ? 'good' : 'error'}>
              {message(result)}
              {!result.ok && result.message && result.reason !== 'network' && (
                <span className="muted small check-detail" dir="ltr">
                  {' '}
                  {result.message.slice(0, 160)}
                </span>
              )}
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      {!ready && provider && <p className="hint">{w('ob.keyNeeded')}</p>}
    </>
  );
}

function PdfStep({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const w = useW();
  const { t, bytes } = useI18n();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('new.notPdf'));
      return;
    }
    setError('');
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };
  return (
    <>
      <p className="lede">{w('ob.pdf.lede')}</p>
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
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          data-testid="pdf-input"
          onChange={(e) => pick(e.target.files?.[0])}
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
      {error && <p className="field-error">{error}</p>}
      {file && file.size > 80e6 && <Notice tone="warn">{w('ob.pdf.big', { size: bytes(file.size) })}</Notice>}
      <p className="hint">{w('ob.pdf.privacy')}</p>
    </>
  );
}

function LangsStep({
  langs,
  setLangs,
  written,
  setWritten,
}: {
  langs: string[];
  setLangs: (l: string[]) => void;
  written: string;
  setWritten: (l: string) => void;
}) {
  const w = useW();
  const { t, langName } = useI18n();
  const id = useId();
  return (
    <>
      <p className="lede">{w('ob.langs.lede')}</p>
      <fieldset className="field">
        <legend>{t('new.langs')}</legend>
        <div className="checks">
          {BOOK_LANGS.map((l) => (
            <label key={l} className="check">
              <input
                type="checkbox"
                checked={langs.includes(l)}
                onChange={(e) => setLangs(e.target.checked ? [...langs, l] : langs.filter((x) => x !== l))}
              />
              <span lang={l}>{langName(l)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={id}>{t('new.writtenIn')}</label>
        <select id={id} value={written} onChange={(e) => setWritten(e.target.value)} disabled={!langs.length}>
          {langs.map((l) => (
            <option key={l} value={l}>
              {langName(l)}
            </option>
          ))}
        </select>
        <p className="hint">{t('new.writtenInHint')}</p>
      </div>
      {!langs.length && <p className="field-error">{t('new.needLang')}</p>}
    </>
  );
}

export function Onboarding({ fake, onDone }: { fake: boolean; onDone: () => void }) {
  const w = useW();
  const i18n = useI18n();
  const { t, lang, usd, langName } = i18n;
  const [step, setStep] = useState<Step>('lang');
  const [provider, setProvider] = useState<WebProvider | null>(fake ? FAKE_PROVIDER : null);
  const [keyReady, setKeyReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [langs, setLangs] = useState<string[]>(['ar', 'fr', 'en']);
  const [written, setWritten] = useState<string>(lang);
  const [budget, setBudget] = useState('1');
  const [busy, setBusy] = useState<'' | 'create' | 'demo'>('');
  const [error, setError] = useState('');
  const writtenIn = langs.includes(written) ? written : (langs[0] ?? '');
  const n = STEPS.indexOf(step);

  const finish = (to: string) => {
    setOnboarded(true);
    onDone();
    navigate(to);
  };

  const example = async () => {
    setBusy('demo');
    setError('');
    try {
      const r = await webApi.demo();
      finish(`/project/${encodeURIComponent(r.id)}/lesson/ch05`);
    } catch (e) {
      setError(errorText(e, t));
      setBusy('');
    }
  };

  const create = async () => {
    if (!file || !provider || !langs.length) return;
    setBusy('create');
    setError('');
    try {
      const form = new FormData();
      form.set('pdf', file);
      form.set(
        'title',
        file.name
          .replace(/\.pdf$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim(),
      );
      form.set('langs', langs.join(','));
      form.set('defaultLang', writtenIn);
      const p = await api.createProject(form);
      const usdLimit = Number(budget);
      await api.saveSettings(p.id, {
        ...(provider.id === 'fake'
          ? { models: Object.fromEntries(ROLES.map((r) => [r, FAKE_MODEL])) }
          : provider.preset
            ? { preset: provider.preset }
            : {}),
        budget: { usd: usdLimit > 0 ? usdLimit : null },
      });
      await api.startJob(p.id, 'ingest', { ocr: 'auto' });
      finish(`/project/${encodeURIComponent(p.id)}?step=read`);
    } catch (e) {
      setError(errorText(e, t));
      setBusy('');
    }
  };

  const canNext =
    step === 'lang' ||
    (step === 'provider' && keyReady) ||
    (step === 'pdf' && !!file) ||
    (step === 'langs' && !!langs.length);

  const body: Record<Step, ReactNode> = {
    lang: (
      <>
        <p className="lede">{w('ob.lede')}</p>
        <h2 className="welcome-sub">{w('ob.lang.title')}</h2>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented choice of large buttons */}
        <div className="lang-choice" role="group" aria-label={t('ui.language')}>
          {UI_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              lang={l}
              aria-pressed={lang === l}
              className={`lang-btn ${lang === l ? 'is-on' : ''}`}
              onClick={() => {
                setLang(l);
                setWritten(l);
              }}
            >
              {NAMES[l]}
            </button>
          ))}
        </div>
        <p className="hint">{w('ob.lang.hint')}</p>
      </>
    ),
    provider: (
      <KeyStep fake={fake} provider={provider} setProvider={setProvider} ready={keyReady} setReady={setKeyReady} />
    ),
    pdf: <PdfStep file={file} setFile={setFile} />,
    langs: <LangsStep langs={langs} setLangs={setLangs} written={writtenIn} setWritten={setWritten} />,
    budget: (
      <>
        <p className="lede">{w('ob.budget.lede')}</p>
        <Field label={w('ob.budget.label')} hint={w('ob.budget.hint')}>
          {(id, d) => (
            <input
              id={id}
              type="number"
              min={0.1}
              step={0.5}
              dir="ltr"
              className="num-input budget-input"
              value={budget}
              aria-describedby={d}
              onChange={(e) => setBudget(e.target.value)}
            />
          )}
        </Field>
        {file && (
          <p className="summary">
            {w('ob.summary', {
              file: file.name,
              langs: langs.map((l) => langName(l)).join(', '),
              budget: usd(Number(budget) || 0),
            })}
          </p>
        )}
      </>
    ),
  };

  const titles: Record<Step, WebKey> = {
    lang: 'ob.lang.title',
    provider: 'ob.provider.title',
    pdf: 'ob.pdf.title',
    langs: 'ob.langs.title',
    budget: 'ob.budget.title',
  };

  return (
    <div className="welcome">
      <header className="welcome-head">
        <span className="brand">
          <Sheet />
          <span className="brand-ar" lang="ar">
            ورقة
          </span>
        </span>
        <button type="button" className="link-btn" onClick={() => finish('/')}>
          {w('ob.skip')}
        </button>
      </header>
      <main id="main" className="welcome-main">
        <section className="welcome-card sheet" aria-labelledby="ob-title">
          <p className="welcome-step">
            {w('ob.step', { n: n + 1, total: STEPS.length })}
            <span className="welcome-dots" aria-hidden="true">
              {STEPS.map((s, i) => (
                <i key={s} className={i <= n ? 'on' : ''} />
              ))}
            </span>
          </p>
          <h1 id="ob-title" className="display">
            {step === 'lang' ? w('ob.title') : w(titles[step])}
          </h1>
          {body[step]}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="welcome-actions">
            {n > 0 && (
              <Button variant="quiet" icon="back" onClick={() => setStep(STEPS[n - 1]!)} disabled={!!busy}>
                {w('ob.back')}
              </Button>
            )}
            {step === 'budget' ? (
              <Button
                variant="primary"
                busy={busy === 'create'}
                disabled={!file || !keyReady || !langs.length || !!busy}
                onClick={() => void create()}
              >
                {busy === 'create' ? w('ob.creating') : w('ob.create')}
              </Button>
            ) : (
              <Button variant="primary" disabled={!canNext} onClick={() => setStep(STEPS[n + 1]!)}>
                {w('ob.next')}
              </Button>
            )}
          </div>
        </section>
        <aside className="welcome-example">
          <Button variant="default" icon="play" busy={busy === 'demo'} disabled={!!busy} onClick={() => void example()}>
            {w('ob.example')}
          </Button>
          <span className="muted small">{w('ob.exampleHint')}</span>
        </aside>
      </main>
    </div>
  );
}
