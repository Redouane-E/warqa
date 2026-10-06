// The first visit: a welcome page (what Warqa does, drop a PDF, see a finished book), then the start guide. Its
// first question is "How will you use Warqa?": a teacher goes on to an AI model and its key (checked for free),
// the PDF, the book's languages and a spending limit; someone learning on their own goes to the learner's setup.
import { type DragEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { FAKE_PROVIDER, type GuideProvider, type KeyCheck, PROVIDERS } from '../../shared/providers';
import { useStatus } from '../App';
import { api, errorText } from '../api';
import { withBase } from '../base';
import { Button, Field, Icon, Mark, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { passPdf, takePdf } from '../handoff';
import { BOOK_LANGS, setLang, UI_LANGS, type UiLang, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { LOCAL_SERVICES } from '../net';
import { setMode, setOnboarded } from '../prefs';
import { navigate, useLocation } from '../router';

const STEPS = ['use', 'provider', 'pdf', 'langs', 'budget'] as const;
type Step = (typeof STEPS)[number];

const NAMES: Record<UiLang, string> = { ar: 'العربية', fr: 'Français', en: 'English' };
const ROLES = ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'];

function ProviderCard({ p, checked, onPick }: { p: GuideProvider; checked: boolean; onPick: () => void }) {
  const { t } = useI18n();
  return (
    <label className={`provider-card ${checked ? 'is-on' : ''}`}>
      <input type="radio" name="provider" checked={checked} onChange={onPick} />
      <span className="provider-name">{p.name}</span>
      <span className="provider-note">{t(`ob.p.${p.id}` as MsgKey)}</span>
    </label>
  );
}

export function KeyStep({
  fake,
  provider,
  setProvider,
  ready,
  setReady,
}: {
  fake: boolean;
  provider: GuideProvider | null;
  setProvider: (p: GuideProvider) => void;
  ready: boolean;
  setReady: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const { status } = useStatus();
  const desktop = status?.capabilities?.keyStore !== 'browser';
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
      const r = await api.checkKey(provider.id, key.trim());
      setResult(r);
      if (r.ok) {
        if (provider.id !== 'fake' && (key.trim() || provider.local))
          await api.saveKeys({ [provider.env]: key.trim() || 'http://localhost:11434/api' });
        // the first key also chooses the model set new books start with (AI and voices can change it)
        if (provider.preset) {
          const d = await api.defaults().catch(() => null);
          if (d && !d.preset) await api.saveDefaults({ preset: provider.preset }).catch(() => {});
        }
        setReady(true);
      }
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  const recommended = PROVIDERS.filter((p) => p.recommended);
  // a server of your own needs its address and maybe a key: AI and voices has the form for it
  const others = PROVIDERS.filter((p) => !p.recommended && p.id !== 'compat');
  const message = (r: KeyCheck) =>
    r.ok
      ? t(r.warning === 'rate' ? 'ob.check.rate' : 'ob.check.ok')
      : t(`ob.check.${r.reason}`, { provider: provider?.name ?? '', status: r.status ?? '' });
  const site = provider?.keyUrl ? new URL(provider.keyUrl).host : '';

  return (
    <>
      <p className="lede">{t('ob.provider.lede')}</p>
      <fieldset className="providers">
        <legend>{t('ob.provider.recommended')}</legend>
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
          <summary>{t('ob.provider.more')}</summary>
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
            <Notice tone="good">
              {t(desktop ? 'ob.keyExistingDesktop' : 'ob.keyExisting', { provider: provider.name })}
            </Notice>
          )}
          {provider.keyUrl && !provider.local && (
            <div className="howto">
              <h3>{t('ob.howto')}</h3>
              <ol>
                <li>
                  {t('ob.howto.1', { site: '\u0000' }).split('\u0000')[0]}
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer" dir="ltr">
                    {site} <Icon name="open" size={13} />
                  </a>
                  {t('ob.howto.1', { site: '\u0000' }).split('\u0000')[1]}
                </li>
                <li>{t('ob.howto.2')}</li>
                <li>{t('ob.howto.3')}</li>
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
              label={provider.local ? t('ob.address') : t('ob.key', { provider: provider.name })}
              hint={t(desktop ? 'ob.keyPrivacyDesktop' : 'ob.keyPrivacy', { provider: provider.name })}
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
              {busy ? t('ob.checking') : t('ob.check')}
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
      {!ready && provider && <p className="hint">{t('ob.keyNeeded')}</p>}
    </>
  );
}

export function PdfStep({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const { t, bytes } = useI18n();
  const desktop = useStatus().status?.capabilities?.platform !== 'browser';
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
      <p className="lede">{t('ob.pdf.lede')}</p>
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
      {file && file.size > 80e6 && <Notice tone="warn">{t('ob.pdf.big', { size: bytes(file.size) })}</Notice>}
      <p className="hint">{t(desktop ? 'ob.pdf.privacyDesktop' : 'ob.pdf.privacy')}</p>
      <p className="hint copyright">{t('pdf.copyright')}</p>
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
  const { t, langName } = useI18n();
  const id = useId();
  return (
    <>
      <p className="lede">{t('ob.langs.lede')}</p>
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

/** The welcome page and the guide share a header: the mark, the interface language, and a way out. */
function GuideHeader({ onSkip }: { onSkip: () => void }) {
  const { t, lang } = useI18n();
  return (
    <header className="welcome-head">
      <a className="brand" href={withBase('/')} aria-label={t('nav.homeName')}>
        <Mark />
        <span className="brand-latin" lang="en">
          Warqa
        </span>
        <span className="brand-ar" lang="ar">
          ورقة
        </span>
      </a>
      <div className="welcome-tools">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented choice */}
        <div className="seg seg-lang" role="group" aria-label={t('ui.language')}>
          {UI_LANGS.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {NAMES[l]}
            </button>
          ))}
        </div>
        <button type="button" className="link-btn welcome-skip" onClick={onSkip}>
          {t('ob.skip')}
        </button>
      </div>
    </header>
  );
}

/** A drop zone that hands its PDF on (the welcome page, the learner's home). */
export function PdfDrop({
  onFile,
  title,
  hint,
  className = '',
}: {
  onFile: (f: File) => void;
  title: string;
  hint: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('new.notPdf'));
      return;
    }
    setError('');
    onFile(f);
  };
  return (
    <>
      <label
        className={`wq-drop ${className} ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          data-testid="drop-input"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <span className="wq-drop-icon" aria-hidden="true">
          <Icon name="add-pdf" size={26} />
        </span>
        <span className="wq-drop-title">{title}</span>
        <span className="wq-drop-hint">{hint}</span>
      </label>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

/** The welcome page's picture: a textbook rule, and the beat it becomes (Arabic, like most of Warqa's books). */
function WelcomeFigure() {
  const { t } = useI18n();
  return (
    <figure className="welcome-figure" aria-label={t('welcome.figure')}>
      <div className="wf-page" lang="ar" dir="rtl" aria-hidden="true">
        <span className="wf-meta">الوحدة 2 · الدرس 5</span>
        <p className="wf-rule">
          طرح عدد = <mark>إضافة مقابله</mark>
        </p>
        <p className="wf-math" dir="ltr">
          7 − 3 = 7 + (−3)
        </p>
        <span className="wf-num">37</span>
      </div>
      <div className="wf-lesson" aria-hidden="true">
        <div className="wf-stage" lang="ar" dir="rtl">
          <p className="wf-title">طرح عدد = إضافة مقابله</p>
          <p className="wf-math" dir="ltr">
            <span className="wf-ink">7</span> + <span className="wf-coral">(−3)</span> = 4
          </p>
          <svg viewBox="0 0 320 70" className="wf-line" role="presentation">
            <line x1="10" y1="52" x2="310" y2="52" />
            {Array.from({ length: 11 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed ticks
              <line key={i} x1={20 + i * 28} y1="46" x2={20 + i * 28} y2="58" />
            ))}
            <path className="wf-arc-ink" d="M20 46 Q 118 -6 216 46" />
            <path className="wf-arc-coral" d="M216 46 Q 174 16 132 46" />
            <circle cx="132" cy="52" r="6" />
          </svg>
          <p className="wf-caption">
            نحتفظ بالسبعة، ثم <mark>نضيف</mark> مقابل الثلاثة.
          </p>
        </div>
        <div className="wf-bar">
          <span className="wf-play">
            <Icon name="pause" size={16} />
          </span>
          <span className="wf-segs">
            {[3, 2, 4, 2, 3].map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed segments
              <i key={i} style={{ flexGrow: w }} className={i < 2 ? 'on' : i === 2 ? 'now' : ''} />
            ))}
          </span>
          <span className="wf-count" dir="ltr">
            4 / 15
          </span>
        </div>
      </div>
      <figcaption>{t('welcome.caption')}</figcaption>
    </figure>
  );
}

export function WelcomePage() {
  const { t } = useI18n();
  const { path } = useLocation();
  const { guide } = useExtras();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const skip = () => {
    setOnboarded(true);
    navigate('/');
  };
  const example = async () => {
    if (!guide?.example) return;
    setBusy(true);
    setError('');
    try {
      const to = await guide.example();
      setOnboarded(true);
      navigate(to);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };
  if (path === '/welcome/start') return <Guide onSkip={skip} onExample={guide?.example ? example : undefined} />;
  const four: [MsgKey, MsgKey][] = [
    ['step.read', 'welcome.read'],
    ['step.plan', 'welcome.plan'],
    ['step.make', 'welcome.make'],
    ['step.share', 'welcome.share'],
  ];
  return (
    <div className="welcome">
      <GuideHeader onSkip={skip} />
      <main id="main" className="welcome-landing">
        <section className="welcome-hero">
          <div className="welcome-copy">
            <h1 className="welcome-h1">
              {t('welcome.h1a')} <span className="hl-band">{t('welcome.h1hl')}</span>
              {t('welcome.h1b')}
            </h1>
            <p className="welcome-lede">{t('welcome.sub')}</p>
            <PdfDrop
              title={t('welcome.drop')}
              hint={t('welcome.dropHint')}
              onFile={(f) => {
                passPdf(f);
                navigate('/welcome/start');
              }}
            />
            <div className="welcome-cta">
              <Button variant="primary" onClick={() => navigate('/welcome/start')}>
                {t('welcome.start')}
                <Icon name="next" className="flip-rtl" />
              </Button>
              {guide?.example && (
                <button
                  type="button"
                  className="link-btn welcome-example"
                  disabled={busy}
                  onClick={() => void example()}
                >
                  <Icon name="book" size={18} /> {t('welcome.example')}
                  <span className="muted"> · {t('welcome.exampleNote')}</span>
                </button>
              )}
            </div>
            {error && <Notice tone="error">{error}</Notice>}
          </div>
          <WelcomeFigure />
        </section>
        <section className="welcome-band" aria-labelledby="welcome-steps">
          <h2 id="welcome-steps">{t('welcome.steps')}</h2>
          <ol className="welcome-steps">
            {four.map(([name, body], i) => (
              <li key={name}>
                <span className="welcome-n">{i + 1}</span>
                <h3>{t(name)}</h3>
                <p>{t(body)}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="welcome-good" aria-label={t('welcome.good')}>
          <p>
            <span className="welcome-tile" aria-hidden="true">
              <Icon name="key" />
            </span>
            {t('welcome.goodKey')}
          </p>
          <p>
            <span className="welcome-tile welcome-tile-mono" aria-hidden="true">
              $0
            </span>
            {t('welcome.goodCost')}
          </p>
          <p>
            <span className="welcome-tile" aria-hidden="true">
              <Icon name="download" />
            </span>
            {t('welcome.goodOffline')}
          </p>
        </section>
        <section className="welcome-langs" aria-labelledby="welcome-langs">
          <h2 id="welcome-langs">{t('welcome.langs')}</h2>
          <ul>
            <li lang="ar">العربية</li>
            <li lang="ary">الدارجة المغربية</li>
            <li lang="fr">Français</li>
            <li lang="en">English</li>
          </ul>
        </section>
      </main>
      <footer className="welcome-foot">
        <span>
          <Mark size={18} /> Warqa · <span lang="ar">ورقة</span> · {t('welcome.meaning')}
        </span>
        <span>Apache-2.0</span>
      </footer>
    </div>
  );
}

/** The start guide: "How will you use Warqa?", then the teacher's four steps (or the learner's setup). */
function Guide({ onSkip, onExample }: { onSkip: () => void; onExample?: () => void }) {
  const i18n = useI18n();
  const { t, usd, langName, lang } = i18n;
  const { guide } = useExtras();
  const fake = !!guide?.fakeModel;
  const [step, setStep] = useState<Step>('use');
  const [use, setUse] = useState<'teach' | 'learn' | null>(null);
  const [provider, setProvider] = useState<GuideProvider | null>(fake ? FAKE_PROVIDER : null);
  const [keyReady, setKeyReady] = useState(false);
  const [file, setFile] = useState<File | null>(() => takePdf());
  const [langs, setLangs] = useState<string[]>(['ar', 'fr', 'en']);
  const [written, setWritten] = useState<string>(lang);
  const [budget, setBudget] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writtenIn = langs.includes(written) ? written : (langs[0] ?? '');
  const n = STEPS.indexOf(step);

  const next = () => {
    if (step === 'use' && use === 'learn') {
      // the learner's own setup (PDF, language, level, Teach me); a PDF dropped on the welcome page goes along
      setOnboarded(true);
      setMode('learn');
      passPdf(file);
      navigate('/learn/new');
      return;
    }
    if (step === 'use') setMode('teach');
    setStep(STEPS[n + 1]!);
  };

  const create = async () => {
    if (!file || !provider || !langs.length) return;
    setBusy(true);
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
        ...(provider.id === 'fake' && guide?.fakeModel
          ? { models: Object.fromEntries(ROLES.map((r) => [r, guide.fakeModel])) }
          : provider.preset
            ? { preset: provider.preset }
            : {}),
        budget: { usd: usdLimit > 0 ? usdLimit : null },
      });
      // offline with a cloud model: the text layer only (the Read step counts the photo pages left to read)
      const ocr = navigator.onLine || LOCAL_SERVICES.has(provider.id) ? 'auto' : 'never';
      await api.startJob(p.id, 'ingest', { ocr });
      setOnboarded(true);
      navigate(`/project/${encodeURIComponent(p.id)}?step=read`);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  const canNext =
    (step === 'use' && !!use) ||
    (step === 'provider' && keyReady) ||
    (step === 'pdf' && !!file) ||
    (step === 'langs' && !!langs.length);

  const name = t('learn.use.title', { name: '\u0000' }).split('\u0000');
  const body: Record<Step, ReactNode> = {
    use: (
      <>
        <div className="guide-title">
          <h1 id="guide-title" className="display">
            {name[0]}
            <span className="hl">{lang === 'ar' ? 'ورقة' : 'Warqa'}</span>
            {name[1]}
          </h1>
          <p className="lede">{t('learn.use.sub')}</p>
        </div>
        <fieldset className="use-choice">
          <legend className="visually-hidden">{t('learn.use.title', { name: 'Warqa' })}</legend>
          <label className={`use-card ${use === 'teach' ? 'is-on' : ''}`}>
            <span className="use-pic use-pic-teach" aria-hidden="true">
              <Icon name="edit" size={28} />
            </span>
            <span className="use-head">
              <input type="radio" name="use" checked={use === 'teach'} onChange={() => setUse('teach')} />
              <span className="use-title">{t('learn.use.teach')}</span>
            </span>
            <span className="use-body">{t('learn.use.teachBody')}</span>
            <span className="use-chips">
              {(['read', 'plan', 'make', 'voice', 'check', 'share'] as const).map((k) => (
                <span key={k}>{t(`step.${k}`)}</span>
              ))}
            </span>
          </label>
          <label className={`use-card ${use === 'learn' ? 'is-on' : ''}`}>
            {use === 'learn' && (
              <span className="use-check" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            )}
            <span className="use-pic use-pic-learn" aria-hidden="true">
              <Mark size={26} />
            </span>
            <span className="use-head">
              <input type="radio" name="use" checked={use === 'learn'} onChange={() => setUse('learn')} />
              <span className="use-title">{t('learn.use.self')}</span>
            </span>
            <span className="use-body">{t('learn.use.selfBody')}</span>
            <span className="use-chips use-chips-ink">
              {(['learn.chip.pdf', 'learn.chip.lang', 'learn.chip.level', 'learn.chip.start'] as const).map((k) => (
                <span key={k}>{t(k)}</span>
              ))}
            </span>
          </label>
        </fieldset>
      </>
    ),
    provider: (
      <>
        <h1 id="guide-title" className="display">
          {t('ob.provider.title')}
        </h1>
        <KeyStep fake={fake} provider={provider} setProvider={setProvider} ready={keyReady} setReady={setKeyReady} />
      </>
    ),
    pdf: (
      <>
        <h1 id="guide-title" className="display">
          {t('ob.pdf.title')}
        </h1>
        <PdfStep file={file} setFile={setFile} />
      </>
    ),
    langs: (
      <>
        <h1 id="guide-title" className="display">
          {t('ob.langs.title')}
        </h1>
        <LangsStep langs={langs} setLangs={setLangs} written={writtenIn} setWritten={setWritten} />
      </>
    ),
    budget: (
      <>
        <h1 id="guide-title" className="display">
          {t('ob.budget.title')}
        </h1>
        <p className="lede">{t('ob.budget.lede')}</p>
        <Field label={t('ob.budget.label')} hint={t('ob.budget.hint')}>
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
            {t('ob.summary', {
              file: file.name,
              langs: langs.map((l) => langName(l)).join(', '),
              budget: usd(Number(budget) || 0),
            })}
          </p>
        )}
      </>
    ),
  };

  return (
    <div className="welcome">
      <GuideHeader onSkip={onSkip} />
      <main id="main" className="welcome-main">
        <section className="welcome-card sheet" aria-labelledby="guide-title">
          <div className="guide-top">
            <p className="welcome-step">
              {step === 'use' ? t('learn.use.kicker') : t('ob.step', { n: n + 1, total: STEPS.length })}
              <span className="welcome-dots" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <i key={s} className={i < n ? 'on' : i === n ? 'now' : ''} />
                ))}
              </span>
            </p>
            {onExample && step === 'use' && (
              <button type="button" className="link-btn" onClick={onExample}>
                {t('welcome.example')}
              </button>
            )}
          </div>
          {body[step]}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="welcome-actions">
            {step === 'use' && use === 'learn' && <p className="hint welcome-foot-note">{t('learn.use.footnote')}</p>}
            <Button
              variant="quiet"
              icon="back"
              onClick={() => (n > 0 ? setStep(STEPS[n - 1]!) : navigate('/welcome'))}
              disabled={busy}
            >
              {t('ob.back')}
            </Button>
            {step === 'budget' ? (
              <Button
                variant="primary"
                busy={busy}
                disabled={!file || !keyReady || !langs.length || busy}
                onClick={() => void create()}
              >
                {busy ? t('ob.creating') : t('ob.create')}
              </Button>
            ) : (
              <Button variant="primary" disabled={!canNext} onClick={next}>
                {step === 'use' ? t('learn.use.continue') : t('ob.next')}
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
