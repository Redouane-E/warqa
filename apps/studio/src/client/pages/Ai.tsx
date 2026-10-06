// AI and voices (redesign 4g): one place, reached from the top bar anywhere, for the keys (which services Warqa may
// use, on whose account), the model set and the model of each role with its price, and the voices that narrate.
// Keys are the same for every book. The model set and the voices are the defaults for new books, or, opened for a
// book (`?book=<id>`: Make's Change, Book settings), that book's own: a switch says which. Everything saves when it
// changes; a choice that wipes others (a set over hand-picked models, Remove) offers Undo.
import { langInfo } from '@warqa/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GuideProvider, type KeyCheck, PROVIDERS } from '../../shared/providers';
import type { AiDefaults, KeyInfo, PresetInfo, ProjectDetail, StatusInfo, TtsInfo } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText } from '../api';
import { useConfirm, useToast } from '../components/overlays';
import { cameFrom } from '../components/TopBar';
import { Button, Icon, Loading, Notice } from '../components/ui';
import { type I18n, useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { Link, useHash, useLocation } from '../router';
import { bookTitle } from './Home';

/** Where the docs explain running models on your own computer. */
const LOCAL_DOCS = 'https://github.com/Redouane-E/warqa/blob/master/docs/en/models.md#running-fully-local';
/** The four languages the voices are shown for when no book is chosen. */
const VOICE_LANGS = ['ar', 'ary', 'fr', 'en'];
/** The sets always shown (the others when their keys are ready, or under More sets). */
const FEATURED = ['best', 'budget', 'google', 'local', 'openrouter'];
/** Recommended services listed even without a key (the start guide's three). */
const RECOMMENDED = ['google', 'openrouter', 'deepseek'];
const ENGINE_ORDER = ['gemini', 'azure', 'openai', 'elevenlabs', 'google', 'edge', 'worker', 'none'];

/** Short names of the services, as the rows show them. */
const SHORT: Record<string, string> = {
  google: 'Google Gemini',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  mistral: 'Mistral',
  groq: 'Groq',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};
/** The service behind each key (a model set's "Needs a … key"). */
const KEY_OWNER: Record<string, string> = {
  GEMINI_API_KEY: 'Google',
  GOOGLE_GENERATIVE_AI_API_KEY: 'Google',
  ANTHROPIC_API_KEY: 'Anthropic',
  OPENAI_API_KEY: 'OpenAI',
  MISTRAL_API_KEY: 'Mistral',
  GROQ_API_KEY: 'Groq',
  XAI_API_KEY: 'xAI',
  DEEPSEEK_API_KEY: 'DeepSeek',
  OPENROUTER_API_KEY: 'OpenRouter',
};

/** A row of the Keys card: a model service, a speech service, or a server of your own. */
interface RowDef {
  id: string;
  name: string;
  desc: MsgKey;
  /** The values it asks for, the key (or address) first. */
  fields: { env: string; label: string; secret: boolean; placeholder?: string; optional?: boolean }[];
  /** The service a free check asks (`/api/keys/check`), when there is one. */
  check?: string;
  keyUrl?: string;
}

/** The speech services that are only voices (their keys are not model keys). */
const SPEECH_ROWS = (t: I18n['t']): (RowDef & { engine: string })[] => [
  {
    id: 'azure',
    engine: 'azure',
    name: 'Azure Speech',
    desc: 'ai.p.speech',
    keyUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
    fields: [
      { env: 'AZURE_SPEECH_KEY', label: t('ai.keyLabel', { provider: 'Azure Speech' }), secret: true },
      { env: 'AZURE_SPEECH_REGION', label: t('ai.region'), secret: false, placeholder: 'westeurope' },
    ],
  },
  {
    id: 'elevenlabs',
    engine: 'elevenlabs',
    name: 'ElevenLabs',
    desc: 'ai.p.speech',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    fields: [{ env: 'ELEVENLABS_API_KEY', label: t('ai.keyLabel', { provider: 'ElevenLabs' }), secret: true }],
  },
  {
    id: 'google-tts',
    engine: 'google',
    name: 'Google Cloud Text-to-Speech',
    desc: 'ai.p.speech',
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    fields: [{ env: 'GOOGLE_TTS_API_KEY', label: t('ai.keyLabel', { provider: 'Google Cloud' }), secret: true }],
  },
];

function modelRow(p: GuideProvider, t: I18n['t']): RowDef {
  const name = p.id === 'compat' ? t('ai.own') : (SHORT[p.id] ?? p.name);
  if (p.id === 'compat')
    return {
      id: p.id,
      name,
      desc: 'ai.p.compat',
      check: p.id,
      fields: [
        { env: p.env, label: t('ai.ownAddress'), secret: false, placeholder: 'http://localhost:1234/v1' },
        { env: p.secretEnv!, label: t('ai.ownKey'), secret: true, optional: true },
      ],
    };
  return {
    id: p.id,
    name,
    desc: `ai.p.${p.id}` as MsgKey,
    check: p.id,
    ...(p.keyUrl ? { keyUrl: p.keyUrl } : {}),
    fields: [
      {
        env: p.env,
        label: t('ai.keyLabel', { provider: name }),
        secret: true,
        placeholder: p.id === 'google' ? 'AIza…' : p.id === 'anthropic' ? 'sk-ant-…' : 'sk-…',
      },
    ],
  };
}

/** The AI settings being edited: a book's, or the defaults for new books. */
interface AiView {
  preset?: string;
  models: Record<string, string>;
  tts: { provider: string; voices: Record<string, string>; rate?: string; tashkeel: boolean };
  worker?: string;
}

const viewOfBook = (p: ProjectDetail): AiView => ({
  ...(p.config.preset ? { preset: p.config.preset } : {}),
  models: { ...p.config.models },
  tts: {
    provider: p.config.tts.provider,
    voices: { ...p.config.tts.voices },
    ...(p.config.tts.rate ? { rate: p.config.tts.rate } : {}),
    tashkeel: p.config.tts.tashkeel,
  },
  ...(p.config.worker ? { worker: p.config.worker } : {}),
});

const viewOfDefaults = (d: AiDefaults, status: StatusInfo | null): AiView => ({
  ...(d.preset ? { preset: d.preset } : {}),
  models: { ...d.models },
  tts: {
    // a new book's engine when none is chosen: the host's (Edge on the desktop, none in the browser)
    provider: d.tts.provider ?? (status?.capabilities?.platform === 'browser' ? 'none' : 'edge'),
    voices: { ...d.tts.voices },
    ...(d.tts.rate ? { rate: d.tts.rate } : {}),
    tashkeel: d.tts.tashkeel,
  },
  ...(d.worker ? { worker: d.worker } : {}),
});

/** What the page saves: the AI fields of a book's settings or of the defaults (null clears). */
type AiPatch = {
  preset?: string | null;
  models?: Record<string, string>;
  tts?: { provider?: string; voices?: Record<string, string>; rate?: string | null; tashkeel?: boolean };
  worker?: string | null;
};

/** The page as it will be once a patch is saved. */
function applyPatch(v: AiView, p: AiPatch): AiView {
  const out: AiView = { ...v, models: p.models ? { ...p.models } : v.models, tts: { ...v.tts } };
  if (p.preset !== undefined) {
    if (p.preset) out.preset = p.preset;
    else delete out.preset;
  }
  if (p.tts?.provider) out.tts.provider = p.tts.provider;
  if (p.tts?.voices) out.tts.voices = { ...p.tts.voices };
  if (p.tts?.rate !== undefined) {
    if (p.tts.rate) out.tts.rate = p.tts.rate;
    else delete out.tts.rate;
  }
  if (p.tts?.tashkeel !== undefined) out.tts.tashkeel = p.tts.tashkeel;
  if (p.worker !== undefined) {
    if (p.worker) out.worker = p.worker;
    else delete out.worker;
  }
  return out;
}

/** The set a book without a chosen set uses: the first whose keys are ready (not the local one). */
const autoSet = (status: StatusInfo | null): PresetInfo | undefined =>
  status?.presets.find((p) => p.available && p.id !== 'local');

/** "ar-MA-MounaNeural" → "Mouna · Morocco"; "Kore" → "Kore · firm"; anything else as it is. */
function voiceLabel(id: string, engine: TtsInfo | undefined, i18n: I18n): string {
  const ms = /^[a-z]{2,3}-([A-Z]{2})-(.+?)(?:Multilingual)?Neural$/.exec(id);
  if (ms) return `${ms[2]} · ${i18n.region(ms[1]!)}`;
  const style = engine?.catalog?.find((v) => v.id === id)?.style;
  return style ? `${id} · ${i18n.t(`ai.voiceStyle.${style}` as MsgKey)}` : id;
}

/** Focus a control of a key row (after the one that had the focus went away), else the row's first button. */
function focusIn(row: string, selector: string) {
  const el = document.getElementById(`key-${row}`);
  (el?.querySelector<HTMLElement>(selector) ?? el?.querySelector<HTMLElement>('button, a'))?.focus();
}

/** "−4%" with a real minus sign, "+6%", "0%". */
const rateText = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n)}%`;

export function AiPage() {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { status, reload } = useStatus();
  const { query } = useLocation();
  const toast = useToast();
  const bookId = query.get('book');
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [keysFile, setKeysFile] = useState('');
  const [defaults, setDefaults] = useState<AiDefaults | null>(null);
  const [book, setBook] = useState<ProjectDetail | null>(null);
  const [scope, setScope] = useState<'book' | 'new'>(bookId ? 'book' : 'new');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'' | 'set' | 'roles' | 'voices'>('');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .keys()
      .then((r) => {
        setKeys(r.keys);
        setKeysFile(r.file);
      })
      .catch((e) => setError(errorText(e, tRef.current)));
    api
      .defaults()
      .then(setDefaults)
      .catch((e) => setError(errorText(e, tRef.current)));
  }, []);
  // the page waits for the book it was opened for (nothing is saved to the defaults meanwhile)
  const [bookLoading, setBookLoading] = useState(!!bookId);
  useEffect(() => {
    setScope(bookId ? 'book' : 'new');
    if (!bookId) {
      setBook(null);
      setBookLoading(false);
      return;
    }
    setBookLoading(true);
    api
      .project(bookId)
      .then(setBook)
      .catch(() => {
        setBook(null);
        setScope('new');
      })
      .finally(() => setBookLoading(false));
  }, [bookId]);

  // the book you came from (without ?book): its own set, with a way to change it there
  const stack = bookId ? undefined : cameFrom.current?.book;
  const [stackSet, setStackSet] = useState('');
  const stackId = stack?.id;
  useEffect(() => {
    if (!stackId) return;
    api
      .project(stackId)
      .then((p) => {
        const custom = Object.keys(p.config.models).length > 0;
        setStackSet(custom ? 'custom' : (p.config.preset ?? ''));
      })
      .catch(() => setStackSet(''));
  }, [stackId]);

  const inBook = scope === 'book' && !!book;
  const saved_: AiView | null = inBook ? viewOfBook(book!) : defaults ? viewOfDefaults(defaults, status) : null;
  // a change shows at once, while it is saved (two quick changes build on each other); a failed save goes back
  const [pending, setPending] = useState<AiView | null>(null);
  const view = pending ?? saved_;
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Save AI fields to the book or to the defaults; says "Saved" beside the card that changed. */
  const save = useCallback(
    async (patch: AiPatch, card: 'set' | 'roles' | 'voices'): Promise<boolean> => {
      setSaved('');
      if (viewRef.current) setPending(applyPatch(viewRef.current, patch));
      try {
        if (scope === 'book' && book) setBook(await api.saveSettings(book.id, patch));
        else setDefaults(await api.saveDefaults(patch));
        setPending(null);
        setSaved(card);
        return true;
      } catch (e) {
        setPending(null);
        toast({ text: errorText(e, tRef.current), tone: 'error' });
        return false;
      }
    },
    [scope, book, toast],
  );

  const keysChanged = useCallback(
    async (r: { keys: KeyInfo[] }) => {
      setKeys(r.keys);
      await reload();
    },
    [reload],
  );

  // a #section link (Go to, other screens) scrolls to it once the page is there; #key-<service> opens its row
  const ready = !!keys && !!view && !!status && !bookLoading;
  const hash = useHash();
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the page is there, and when the #section changes
  useEffect(() => {
    if (!ready || !location.hash) return;
    const id = location.hash.slice(1);
    const el = document.getElementById(id.startsWith('key-') ? 'keys' : id);
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLElement>('h2, legend')?.focus({ preventScroll: true });
  }, [ready, hash]);

  const desktop = status?.capabilities?.platform !== 'browser';
  const nReady = useMemo(
    () =>
      PROVIDERS.filter(
        (p) => !p.local && (keys ?? []).some((k) => k.set && (k.name === p.env || k.usedBy.includes(p.id))),
      ).length,
    [keys],
  );
  const setName = (id: string | undefined) =>
    id === 'custom' ? t('preset.custom') : id ? presetName(id, status, t) : '';
  const custom = !!view && Object.keys(view.models).length > 0;
  const chosenSet = view?.preset ?? autoSet(status)?.id;

  if (error)
    return (
      <div className="page">
        <Notice tone="error">{error}</Notice>
      </div>
    );

  return (
    <div className="page page-ai">
      <header className="page-head">
        <h1 className="display">{t('nav.ai')}</h1>
        <p className="lede">{desktop ? t('ai.ledeDesktop') : t('ai.lede')}</p>
      </header>
      {!ready ? (
        <Loading />
      ) : (
        <div className="ai-layout">
          <PageNav
            items={[
              { id: 'keys', label: t('settings.keys'), meta: t('ai.keysReady', { n: nReady }), mono: true },
              { id: 'set', label: t('settings.preset'), meta: custom ? t('preset.custom') : setName(chosenSet) },
              { id: 'roles', label: t('ai.roles') },
              { id: 'voices', label: t('ai.voices') },
            ]}
          />
          <div className="ai-main">
            <KeysCard
              keys={keys!}
              file={keysFile}
              status={status!}
              engine={view!.tts.provider}
              onChange={keysChanged}
            />
            {bookId && book && (
              <fieldset className="ai-scope">
                <legend className="visually-hidden">{t('ai.scope')}</legend>
                <span className="ai-scope-label" aria-hidden="true">
                  {t('ai.scope')}
                </span>
                {(['book', 'new'] as const).map((s) => (
                  <label key={s} className={`ai-scope-pill${scope === s ? ' is-on' : ''}`}>
                    <input type="radio" name="ai-scope" checked={scope === s} onChange={() => setScope(s)} />
                    {s === 'book' ? (
                      <bdi>{t('ai.scopeBook', { title: bookTitle(book.title, lang, book.defaultLang) })}</bdi>
                    ) : (
                      <span>{t('ai.scopeNew')}</span>
                    )}
                  </label>
                ))}
              </fieldset>
            )}
            <SetCard
              view={view!}
              status={status!}
              saved={saved === 'set'}
              onSave={save}
              book={stack && stackSet ? { id: stack.id, title: stack.title, set: setName(stackSet) } : null}
            />
            <RolesCard view={view!} status={status!} saved={saved === 'roles'} onSave={save} />
            <VoicesCard
              view={view!}
              status={status!}
              langs={inBook ? book!.book.langs : VOICE_LANGS}
              saved={saved === 'voices'}
              onSave={save}
              {...(inBook ? { bookId: book!.id } : {})}
            />
            <ForgetAll keys={keys!} status={status!} onChange={keysChanged} />
          </div>
        </div>
      )}
      <span className="visually-hidden" aria-live="polite">
        {saved ? t('common.saved') : ''}
      </span>
    </div>
  );
}

/** A model set's name in the interface language (an unknown set keeps the pipeline's English label). */
function presetName(id: string, status: StatusInfo | null, t: I18n['t']): string {
  const key = `preset.${id}` as MsgKey;
  const v = t(key);
  return v === key ? (status?.presets.find((p) => p.id === id)?.label ?? id) : v;
}

/* ---------- "On this page" ---------- */

function PageNav({ items }: { items: { id: string; label: string; meta?: string; mono?: boolean }[] }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(items[0]!.id);
  // the card nearest the top of the window is the current one
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (typeof IntersectionObserver !== 'function' || !els.length) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = items.find((i) => seen.get(i.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: '-80px 0px -55% 0px' },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className="ai-nav" aria-label={t('ai.onPage')}>
      <ol>
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              aria-current={current === i.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(i.id);
                el?.scrollIntoView({
                  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                  block: 'start',
                });
                el?.querySelector<HTMLElement>('h2, legend')?.focus({ preventScroll: true });
                history.replaceState(history.state, '', `#${i.id}`);
                setCurrent(i.id);
              }}
            >
              <span className="ai-nav-dot" aria-hidden="true" />
              <span className="ai-nav-label">{i.label}</span>
              {i.meta && <span className={`ai-nav-meta${i.mono ? ' mono' : ''}`}>{i.meta}</span>}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ---------- Keys ---------- */

function KeysCard({
  keys,
  file,
  status,
  engine,
  onChange,
}: {
  keys: KeyInfo[];
  file: string;
  status: StatusInfo;
  engine: string;
  onChange: (r: { keys: KeyInfo[] }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(() =>
    location.hash.startsWith('#key-') ? location.hash.slice(5) : null,
  );
  const [added, setAdded] = useState<string[]>([]);
  // a row shown once stays where it is (a key removed leaves its row, with "No key yet" and Undo)
  const [kept, setKept] = useState<string[]>([]);
  const isSet = (env: string) => keys.some((k) => k.name === env && k.set);
  const models = PROVIDERS.filter((p) => p.id !== 'fake').map((p) => modelRow(p, t));
  const speech = SPEECH_ROWS(t);
  const ready = (r: RowDef) =>
    r.id === 'google' ? isSet('GEMINI_API_KEY') || isSet('GOOGLE_GENERATIVE_AI_API_KEY') : isSet(r.fields[0]!.env);
  const all: RowDef[] = [...models.filter((r) => r.id !== 'ollama'), ...speech];
  const shown = new Set<string>();
  const rows: RowDef[] = [];
  const take = (r: RowDef | undefined) => {
    if (r && !shown.has(r.id)) {
      shown.add(r.id);
      rows.push(r);
    }
  };
  for (const r of all) if (ready(r) || kept.includes(r.id)) take(r);
  for (const id of RECOMMENDED) take(models.find((r) => r.id === id));
  // the speech service of the engine chosen, when its key is missing
  for (const r of speech) if (r.engine === engine) take(r);
  for (const id of added) take(all.find((r) => r.id === id));
  const others = all.filter((r) => !shown.has(r.id));
  const readyIds = all
    .filter(ready)
    .map((r) => r.id)
    .join(' ');
  useEffect(() => {
    if (readyIds) setKept((k) => [...new Set([...k, ...readyIds.split(' ')])]);
  }, [readyIds]);
  const ollama = models.find((r) => r.id === 'ollama')!;
  const desktop = status.capabilities?.platform !== 'browser';

  return (
    <section id="keys" className="sheet ai-card" aria-labelledby="ai-keys-t">
      <div className="ai-card-head">
        <h2 id="ai-keys-t" tabIndex={-1}>
          {t('settings.keys')}
        </h2>
        <p className="ai-card-note">{t('ai.keysIntro')}</p>
      </div>
      <ul className="key-list">
        {rows.map((r) => (
          <KeyRow
            key={r.id}
            def={r}
            keys={keys}
            ready={ready(r)}
            open={open === r.id}
            onOpen={() => setOpen(r.id)}
            onClose={() => setOpen(null)}
            onChange={onChange}
          />
        ))}
        <LocalRow def={ollama} status={status} />
        {!!others.length && (
          <li className="key-others">
            <p className="key-others-title">{t('ai.other')}</p>
            <div className="key-others-list">
              {others.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="btn btn-default"
                  onClick={() => {
                    setAdded((a) => [...a, r.id]);
                    setOpen(r.id);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          </li>
        )}
      </ul>
      {desktop && file && (
        <p className="hint">
          {t('ai.keysFile', { file: '\u0000' }).split('\u0000')[0]}
          <code dir="ltr">{file}</code>
          {t('ai.keysFile', { file: '\u0000' }).split('\u0000')[1]}
        </p>
      )}
    </section>
  );
}

function KeyRow({
  def,
  keys,
  ready,
  open,
  onOpen,
  onClose,
  onChange,
}: {
  def: RowDef;
  keys: KeyInfo[];
  ready: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (r: { keys: KeyInfo[] }) => Promise<void>;
}) {
  const { t } = useI18n();
  const { status } = useStatus();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; network?: boolean } | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const desktop = status?.capabilities?.platform !== 'browser';
  const info = (env: string) => keys.find((k) => k.name === env);
  const main =
    def.id === 'google' && !info(def.fields[0]!.env)?.set
      ? info('GOOGLE_GENERATIVE_AI_API_KEY')
      : info(def.fields[0]!.env);
  const fromEnv = main?.source === 'env';
  const stored = def.fields.map((f) => info(f.env)).filter((k): k is KeyInfo => !!k?.set && k.source === 'studio');
  const formId = `key-form-${def.id}`;
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  const save = async () => {
    const patch: Record<string, string> = {};
    for (const f of def.fields) if (values[f.env]?.trim()) patch[f.env] = values[f.env]!.trim();
    const r = await api.saveKeys(patch);
    setValues({});
    onClose();
    await onChange(r);
    // the button that had the focus is gone: the row's Remove takes it
    requestAnimationFrame(() => focusIn(def.id, '.key-remove'));
  };
  const submit = async (checked: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      let r: KeyCheck | undefined;
      if (checked && def.check) {
        r = await api.checkKey(def.check, values[def.fields[0]!.env] ?? '', values[def.fields[1]?.env ?? ''] ?? '');
        if (!r.ok) {
          const site = def.keyUrl ? (def.id === 'google' ? 'Google AI Studio' : new URL(def.keyUrl).host) : def.name;
          setMsg({
            text:
              r.reason === 'key'
                ? r.status
                  ? t('ai.keyRefused', { provider: def.name, status: String(r.status), site })
                  : t('ob.check.key', { provider: def.name })
                : r.reason === 'credits'
                  ? t('ob.check.credits')
                  : r.reason === 'network'
                    ? t('ob.check.network')
                    : t('ob.check.http', { provider: def.name, status: String(r.status ?? '') }),
            network: r.reason === 'network',
          });
          setBusy(false);
          return;
        }
      }
      await save();
      toast({
        text: !checked
          ? t('ai.keySavedUnchecked', { provider: def.name })
          : r?.ok && r.warning === 'rate'
            ? t('ai.keyRate', { provider: def.name })
            : r?.ok && r.models
              ? t('ai.localSaved', { provider: def.name })
              : t('ai.keySaved', { provider: def.name }),
        tone: 'good',
      });
    } catch (e) {
      setMsg({ text: errorText(e, t) });
    }
    setBusy(false);
  };
  const remove = async () => {
    const names = stored.map((k) => k.name);
    try {
      const r = await api.saveKeys(Object.fromEntries(names.map((n) => [n, null])), { undo: true });
      await onChange(r);
      requestAnimationFrame(() => focusIn(def.id, 'button[aria-controls]'));
      toast({
        text: t('ai.keyRemoved', { provider: def.name }),
        tone: 'info',
        action: {
          label: t('common.undo'),
          run: () => {
            void api.restoreKeys(names).then(onChange);
          },
        },
      });
    } catch (e) {
      toast({ text: errorText(e, t), tone: 'error' });
    }
  };

  const head = (
    <>
      <div className="key-name">
        <span className="key-provider">{def.name}</span>
        <span className="key-desc">{t(def.desc)}</span>
      </div>
      {ready ? (
        <>
          <span className="ai-chip ai-chip-ready">
            <Icon name="check" size={16} />
            {fromEnv ? t('ai.keyReadyEnv') : desktop ? t('ai.keyReadyDesktop') : t('ai.keyReady')}
          </span>
          <bdi className="key-masked mono" dir="ltr">
            {main?.masked?.replace(/^••••/, '•••• ') ?? ''}
          </bdi>
          {!!stored.length && (
            <Button
              variant="quiet"
              className="key-remove"
              aria-label={t('ai.keyRemove', { provider: def.name })}
              onClick={() => void remove()}
            >
              {t('common.remove')}
            </Button>
          )}
        </>
      ) : (
        <>
          <span className="ai-chip">{t('ai.keyNone')}</span>
          {def.keyUrl && (
            <a className="key-get" href={def.keyUrl} target="_blank" rel="noreferrer">
              <span>{t('settings.getKey')}</span>
              <Icon name="open" size={16} />
              <span className="visually-hidden"> ({t('common.newTab')})</span>
            </a>
          )}
          {!open && (
            <Button ref={addRef} aria-expanded={false} aria-controls={formId} onClick={onOpen}>
              {t('ai.keyAdd')}
            </Button>
          )}
        </>
      )}
    </>
  );

  if (!open)
    return (
      <li className="key-row" id={`key-${def.id}`}>
        {head}
      </li>
    );
  // every value the service needs (Azure: its key and its region)
  const complete = def.fields.every((f) => f.optional || !!values[f.env]?.trim());
  const helpId = `${formId}-help`;
  const msgId = `${formId}-msg`;
  return (
    <li className="key-row is-open" id={`key-${def.id}`}>
      <div className="key-row-line">{head}</div>
      <form
        id={formId}
        className="key-form"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && complete) void submit(!!def.check);
        }}
      >
        {def.fields.map((f, i) => {
          const id = `${formId}-${f.env}`;
          return (
            <div key={f.env} className="field key-field">
              <label htmlFor={id}>{f.label}</label>
              <input
                ref={i === 0 ? first : undefined}
                id={id}
                className="mono"
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                spellCheck={false}
                dir="ltr"
                placeholder={f.placeholder}
                aria-describedby={`${def.check ? helpId : ''} ${msg ? msgId : ''}`.trim() || undefined}
                aria-invalid={i === 0 && msg && !msg.network ? true : undefined}
                value={values[f.env] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.env]: e.target.value }));
                  setMsg(null);
                }}
              />
            </div>
          );
        })}
        <div className="key-form-actions">
          <Button type="submit" busy={busy} disabled={!complete}>
            {busy ? t('ob.checking') : def.check ? t('ai.checkSave') : t('ai.saveAnyway')}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setValues({});
              setMsg(null);
              onClose();
              requestAnimationFrame(() =>
                document.querySelector<HTMLElement>(`#key-${def.id} button[aria-controls]`)?.focus(),
              );
            }}
          >
            {t('common.cancel')}
          </Button>
        </div>
        {def.check && (
          <p id={helpId} className="key-help">
            {t('ai.checkHelp', { provider: def.name })}
          </p>
        )}
        {msg && (
          <p id={msgId} className="key-msg" role="alert">
            <Icon name="error" size={18} />
            <span>{msg.text}</span>
            {msg.network && (
              <Button variant="quiet" disabled={busy} onClick={() => void submit(false)}>
                {t('ai.saveAnyway')}
              </Button>
            )}
          </p>
        )}
      </form>
    </li>
  );
}

/** Ollama on this computer: asked on load on the desktop; in a browser, when you ask (it may not let a page in). */
function LocalRow({ def, status }: { def: RowDef; status: StatusInfo }) {
  const { t } = useI18n();
  const browser = status.capabilities?.platform === 'browser';
  const [found, setFound] = useState<{ ok: boolean; models: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const find = useCallback(async () => {
    setBusy(true);
    try {
      setFound(await api.localModels('ollama'));
    } catch {
      setFound({ ok: false, models: [] });
    }
    setBusy(false);
  }, []);
  useEffect(() => {
    if (!browser) void find();
  }, [browser, find]);
  return (
    <li className="key-row" id="key-ollama">
      <div className="key-name">
        <span className="key-provider">{def.name}</span>
        <span className="key-desc">{t(def.desc)}</span>
      </div>
      {found?.ok ? (
        <>
          <span className="ai-chip ai-chip-ready">
            <Icon name="check" size={16} />
            {t('ai.localFound', { n: found.models.length })}
          </span>
          <span className="key-models mono" dir="ltr">
            {found.models.slice(0, 4).join(' · ')}
          </span>
        </>
      ) : found ? (
        <span className="ai-chip">{browser ? t('ai.localNoneWeb') : t('ai.localNone')}</span>
      ) : null}
      {browser && !found?.ok && (
        <Button busy={busy} onClick={() => void find()}>
          {t('ai.localFind')}
        </Button>
      )}
      <a className="key-get" href={LOCAL_DOCS} target="_blank" rel="noreferrer">
        <span>{t('ai.localHow')}</span>
        <span className="visually-hidden"> ({t('common.newTab')})</span>
      </a>
    </li>
  );
}

function ForgetAll({
  keys,
  status,
  onChange,
}: {
  keys: KeyInfo[];
  status: StatusInfo;
  onChange: (r: { keys: KeyInfo[] }) => Promise<void>;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const browser = status.capabilities?.platform === 'browser';
  const stored = keys.filter((k) => k.set && k.source === 'studio');
  const forget = async () => {
    const ok = await confirm({
      title: browser ? t('cap.forgetConfirm') : t('ai.forgetConfirmDesktop'),
      confirm: t('dlg.forget'),
      cancel: t('dlg.keepKeys'),
      danger: true,
    });
    if (!ok) return;
    try {
      await onChange(await api.saveKeys(Object.fromEntries(stored.map((k) => [k.name, null]))));
      toast({ text: browser ? t('cap.forgotten') : t('ai.forgottenDesktop'), tone: 'good' });
    } catch (e) {
      toast({ text: errorText(e, t), tone: 'error' });
    }
  };
  return (
    <div className="ai-foot">
      <p id="ai-forget-note">{browser ? t('ai.forgetNote') : t('ai.forgetNoteDesktop')}</p>
      <Button
        variant="quiet"
        className="ai-forget"
        aria-describedby="ai-forget-note"
        disabled={!stored.length}
        onClick={() => void forget()}
      >
        {t('cap.forget')}
      </Button>
    </div>
  );
}

/* ---------- Model set ---------- */

function SetCard({
  view,
  status,
  saved,
  onSave,
  book,
}: {
  view: AiView;
  status: StatusInfo;
  saved: boolean;
  onSave: (patch: AiPatch, card: 'set') => Promise<boolean>;
  book: { id: string; title: string; set: string } | null;
}) {
  const i18n = useI18n();
  const { t, price } = i18n;
  const toast = useToast();
  const custom = Object.keys(view.models).length > 0;
  const saved_ = custom ? 'custom' : (view.preset ?? autoSet(status)?.id ?? '');
  // the choice shows at once while it is saved (and goes back if saving fails)
  const [picked, setPicked] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the saved choice changing ends the pending one
  useEffect(() => setPicked(null), [saved_]);
  const chosen = picked ?? saved_;
  const shown = status.presets.filter((p) => FEATURED.includes(p.id) || p.available || p.id === chosen);
  const more = status.presets.filter((p) => !shown.includes(p));
  const keyName = (env: string) => KEY_OWNER[env] ?? env;
  const choose = async (id: string) => {
    // Custom changes nothing by itself: the roles below say which model does what
    if (id === 'custom') {
      setPicked('custom');
      return;
    }
    const before = { preset: view.preset ?? null, models: view.models };
    const n = Object.keys(view.models).length;
    setPicked(id);
    const ok = await onSave({ preset: id, models: {} }, 'set');
    if (!ok) setPicked(null);
    if (ok)
      if (n)
        toast({
          text: t('ai.setCleared', { n }),
          tone: 'info',
          action: { label: t('common.undo'), run: () => void onSave(before, 'set') },
        });
  };
  const card = (p: PresetInfo) => {
    const on = chosen === p.id;
    const chipsId = `set-${p.id}-chips`;
    return (
      <label key={p.id} className={`set-card${on ? ' is-on' : ''}${p.available ? '' : ' is-off'}`}>
        <span className="set-line">
          <input
            type="radio"
            name="ai-set"
            value={p.id}
            checked={on}
            disabled={!p.available}
            aria-describedby={chipsId}
            onChange={() => void choose(p.id)}
          />
          <span className="set-name">{presetName(p.id, status, t)}</span>
          <span className="set-price mono">
            {p.pricing === 'free-tier'
              ? t('ai.setFreeTier')
              : p.pricing === 'free'
                ? t('ai.setFreeSlow')
                : p.pricing === 'prepaid'
                  ? t('ai.setPrepaid')
                  : p.chapterUsd !== undefined
                    ? t('ai.setAbout', { cost: price(Math.max(p.chapterUsd, 0.01)) })
                    : ''}
          </span>
        </span>
        <span className="set-desc">{presetDesc(p, t)}</span>
        <span className="set-chips" id={chipsId}>
          {p.available
            ? on &&
              p.needs.map((g) => (
                <span key={g[0]} className="ai-chip ai-chip-key">
                  {t('ai.setKey', { provider: keyName(g[0]!) })}
                  <Icon name="check" size={14} />
                  <span className="visually-hidden">{t('ai.ready')}</span>
                </span>
              ))
            : p.missing.map((env) => {
                const name = keyName(env);
                return (
                  <span key={env} className="ai-chip ai-chip-needs">
                    {t(/^[AEIOU]|^xAI/.test(name) ? 'ai.setNeedsAn' : 'ai.setNeeds', { provider: name })}
                  </span>
                );
              })}
        </span>
      </label>
    );
  };
  return (
    <section id="set" className="sheet ai-card" aria-labelledby="ai-set-t">
      <fieldset className="set-fieldset">
        <legend id="ai-set-t" tabIndex={-1}>
          {t('settings.preset')}
          <span className={`ai-saved${saved ? ' is-on' : ''}`} aria-hidden="true">
            {t('common.saved')}
          </span>
        </legend>
        <p className="ai-card-note">{t('ai.setIntro')}</p>
        {book && (
          <p className="ai-book-line">
            <bdi>{t('ai.bookUses', { title: book.title, set: book.set })}</bdi>{' '}
            <Link to={`/ai?book=${encodeURIComponent(book.id)}#set`}>{t('ai.bookChange')}</Link>
          </p>
        )}
        <div className="set-grid">
          {shown.map(card)}
          <label className={`set-card${chosen === 'custom' ? ' is-on' : ''}`}>
            <span className="set-line">
              <input
                type="radio"
                name="ai-set"
                value="custom"
                checked={chosen === 'custom'}
                onChange={() => void choose('custom')}
              />
              <span className="set-name">{t('preset.custom')}</span>
            </span>
            <span className="set-desc">{t('preset.custom.desc')}</span>
          </label>
        </div>
        {!!more.length && (
          <details className="set-more">
            <summary>{t('ai.setMore')}</summary>
            <div className="set-grid">{more.map(card)}</div>
          </details>
        )}
      </fieldset>
    </section>
  );
}

function presetDesc(p: PresetInfo, t: I18n['t']): string {
  const key = `preset.${p.id}.desc` as MsgKey;
  const v = t(key);
  return v === key ? p.description : v;
}

/* ---------- Who does what ---------- */

function RolesCard({
  view,
  status,
  saved,
  onSave,
}: {
  view: AiView;
  status: StatusInfo;
  saved: boolean;
  onSave: (patch: AiPatch, card: 'roles') => Promise<boolean>;
}) {
  const { t, price, lang } = useI18n();
  const [other, setOther] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const set = view.preset ? status.presets.find((p) => p.id === view.preset) : autoSet(status);
  const byProvider = useMemo(() => {
    const m = new Map<string, typeof status.models>();
    for (const x of status.models) {
      const prov = x.id.split(':')[0]!;
      m.set(prov, [...(m.get(prov) ?? []), x]);
    }
    return m;
  }, [status.models]);
  const change = async (role: string, model: string) => {
    const models = { ...view.models };
    if (model) models[role] = model;
    else delete models[role];
    await onSave({ models }, 'roles');
  };
  return (
    <section id="roles" className="sheet ai-card" aria-labelledby="ai-roles-t">
      <div className="ai-card-head">
        <h2 id="ai-roles-t" tabIndex={-1}>
          {t('ai.roles')}
          <span className={`ai-saved${saved ? ' is-on' : ''}`} aria-hidden="true">
            {t('common.saved')}
          </span>
        </h2>
        <p className="ai-card-note">{t('ai.rolesPrice')}</p>
      </div>
      <datalist id="ai-model-ids">
        {status.models.map((m) => (
          <option key={m.id} value={m.id} />
        ))}
      </datalist>
      <div className="roles-box">
        <table className="roles-table">
          <thead>
            <tr>
              <th scope="col">{t('settings.role')}</th>
              <th scope="col">{t('ai.colModel')}</th>
              <th scope="col" className="num">
                {t('ai.colPrice')}
              </th>
              <th scope="col">{t('ai.colChange')}</th>
            </tr>
          </thead>
          <tbody>
            {status.roles.map((r) => {
              const own = view.models[r.id];
              const model = own ?? set?.roles[r.id];
              const info = status.models.find((m) => m.id === model);
              const images = r.id === 'vision' || r.id === 'judge';
              const roleName = t(`role.${r.id}` as MsgKey);
              const inCatalog = !own || status.models.some((m) => m.id === own);
              const value = other === r.id || !inCatalog ? '__other' : (own ?? '');
              return (
                <tr key={r.id}>
                  <th scope="row">
                    <span className="role-name">{roleName}</span>
                    <span className="role-does">{t(`roleInfo.${r.id}` as MsgKey)}</span>
                  </th>
                  <td data-label={t('ai.colModel')}>
                    {model ? (
                      <code dir="ltr" className="role-model">
                        {model}
                      </code>
                    ) : (
                      '—'
                    )}
                    {images && info?.vision && <span className="ai-chip ai-chip-soft">{t('settings.vision')}</span>}
                  </td>
                  <td className="num" data-label={t('ai.colPrice')}>
                    <bdi dir="ltr" className="mono">
                      {!info
                        ? '—'
                        : info.input === 0 && info.output === 0
                          ? t('ai.priceFree')
                          : `${price(info.input)} / ${price(info.output)}`}
                    </bdi>
                  </td>
                  <td data-label={t('ai.colChange')}>
                    <select
                      aria-label={t('ai.roleModel', { role: lang === 'en' ? roleName.toLowerCase() : roleName })}
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__other') {
                          setOther(r.id);
                          setTyped(own ?? '');
                        } else {
                          setOther(null);
                          void change(r.id, v);
                        }
                      }}
                    >
                      <option value="">{t('ai.fromSet')}</option>
                      {[...byProvider.entries()].map(([prov, list]) => {
                        const ok = list.filter((m) => !images || m.vision);
                        return ok.length ? (
                          <optgroup key={prov} label={prov}>
                            {ok.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.id} ·{' '}
                                {m.input === 0 && m.output === 0
                                  ? t('ai.priceFree')
                                  : `${price(m.input)} / ${price(m.output)}`}
                              </option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                      <option value="__other">{t('ai.chooseOther')}</option>
                    </select>
                    {value === '__other' && (
                      <form
                        className="role-other"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (/^[a-z][a-z0-9-]*:.+$/.test(typed.trim())) {
                            setOther(null);
                            void change(r.id, typed.trim());
                          }
                        }}
                      >
                        <input
                          className="mono"
                          dir="ltr"
                          list="ai-model-ids"
                          spellCheck={false}
                          aria-label={t('ai.modelId')}
                          placeholder={t('settings.overridePlaceholder')}
                          value={other === r.id ? typed : (own ?? '')}
                          onChange={(e) => {
                            setOther(r.id);
                            setTyped(e.target.value);
                          }}
                        />
                        <Button
                          type="submit"
                          disabled={!/^[a-z][a-z0-9-]*:.+$/.test((other === r.id ? typed : (own ?? '')).trim())}
                        >
                          {t('common.save')}
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- Voices ---------- */

/** One sample plays at a time: starting one stops the other. */
let playing: { audio: HTMLAudioElement; stop: () => void } | null = null;

function VoicesCard({
  view,
  status,
  langs,
  saved,
  onSave,
  bookId,
}: {
  view: AiView;
  status: StatusInfo;
  langs: string[];
  saved: boolean;
  onSave: (patch: AiPatch, card: 'voices') => Promise<boolean>;
  /** The book being set (its local helper reads the samples), when not the defaults. */
  bookId?: string;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const caps = status.capabilities;
  // voices, rate and tashkeel belong to an engine: it goes with them (the defaults may have none chosen yet)
  const saveTts = (tts: NonNullable<AiPatch['tts']>) =>
    void onSave({ tts: { provider: view.tts.provider, ...tts } }, 'voices');
  const engines = [...status.tts].sort((a, b) => ENGINE_ORDER.indexOf(a.id) - ENGINE_ORDER.indexOf(b.id));
  const engine = engines.find((e) => e.id === view.tts.provider);
  const off = (id: string) => !!caps?.ttsUnavailable.includes(id);
  const engineName = (id: string) => t(`ai.engine.${id}` as MsgKey).split(' · ')[0]!;
  const rate = Number.parseInt(view.tts.rate ?? '0', 10) || 0;
  const [rateNow, setRateNow] = useState(rate);
  useEffect(() => setRateNow(rate), [rate]);
  // saved on the slider's own "change" (mouse, keys, touch and screen readers alike), not on every step
  const rateRef = useRef<HTMLInputElement>(null);
  const commitRate = useRef<(v: number) => void>(() => {});
  commitRate.current = (v) => {
    if (v !== rate) saveTts({ rate: v ? `${v > 0 ? '+' : ''}${v}%` : null });
  };
  useEffect(() => {
    const el = rateRef.current;
    if (!el) return;
    const changed = () => commitRate.current(Number(el.value));
    el.addEventListener('change', changed);
    return () => el.removeEventListener('change', changed);
  });
  const [worker, setWorker] = useState(view.worker ?? '');
  useEffect(() => setWorker(view.worker ?? ''), [view.worker]);
  const noteId = 'ai-engine-note';
  const edgeOff = off('edge');
  const canTashkeel = caps?.worker !== false && !!view.worker;
  const arabic = langs.some((l) => l === 'ar' || l.startsWith('ar-') || l === 'ary');
  const tashkeelHelp = t('ai.tashkeelHelp', { word: '\u0000' }).split('\u0000');

  return (
    <section id="voices" className="sheet ai-card ai-voices" aria-labelledby="ai-voices-t">
      <div className="ai-card-head">
        <h2 id="ai-voices-t" tabIndex={-1}>
          {t('ai.voices')}
          <span className={`ai-saved${saved ? ' is-on' : ''}`} aria-hidden="true">
            {t('common.saved')}
          </span>
        </h2>
        <p className="ai-card-note">{t('ai.voicesIntro')}</p>
      </div>
      <div className="engine-line">
        <div className="field engine-field">
          <label htmlFor="ai-engine">{t('settings.engine')}</label>
          <select
            id="ai-engine"
            value={view.tts.provider}
            aria-describedby={edgeOff ? noteId : undefined}
            onChange={(e) => void onSave({ tts: { provider: e.target.value, voices: {} } }, 'voices')}
          >
            {engines.map((e) => (
              <option key={e.id} value={e.id} disabled={off(e.id) && e.id !== view.tts.provider}>
                {off(e.id)
                  ? `${t(`ai.engine.${e.id}` as MsgKey)} · ${t('cap.desktopOnly')}`
                  : t(`ai.engine.${e.id}` as MsgKey)}
              </option>
            ))}
          </select>
        </div>
        {edgeOff && (
          <p className="engine-note" id={noteId}>
            <span className="chip-desk">{t('cap.desktopChip')}</span>
            <span>{t('ai.edgeDesktop')}</span>
          </p>
        )}
      </div>
      {engine && engine.id !== 'none' && !engine.keyReady && (
        <Notice tone="warn">
          {t('ai.engineNeedsKey', { engine: engineName(engine.id) })} <a href="#keys">{t('settings.keys')}</a>
        </Notice>
      )}
      {view.tts.provider !== 'none' && engine && (
        <>
          <ul className="voice-list">
            {langs.map((l) => (
              <VoiceRow
                key={l}
                lang={l}
                engine={engine}
                voice={view.tts.voices[l] ?? ''}
                rate={view.tts.rate}
                unavailable={off(engine.id)}
                {...(bookId ? { bookId } : {})}
                onPick={(v) => saveTts({ voices: { ...view.tts.voices, [l]: v } })}
              />
            ))}
          </ul>
          <div className="voice-more">
            <div className="rate-box">
              <div className="rate-head">
                <label htmlFor="ai-rate">{t('settings.rate')}</label>
                <output htmlFor="ai-rate" className="mono" dir="ltr">
                  {rateText(rateNow)}
                </output>
              </div>
              <input
                id="ai-rate"
                type="range"
                min={-20}
                max={20}
                step={1}
                value={rateNow}
                aria-valuetext={rateText(rateNow)}
                ref={rateRef}
                onChange={(e) => setRateNow(Number(e.target.value))}
              />
              <div className="rate-ends">
                <span>{t('ai.rateSlower')}</span>
                <span>{t('ai.rateFaster')}</span>
              </div>
            </div>
            {arabic && (
              <label className="tashkeel-box">
                <input
                  type="checkbox"
                  checked={view.tts.tashkeel}
                  disabled={!canTashkeel && !view.tts.tashkeel}
                  aria-describedby="ai-tashkeel-help"
                  onChange={(e) => saveTts({ tashkeel: e.target.checked })}
                />
                <span className="tashkeel-text">
                  <span>{t('settings.tashkeel')}</span>
                  <span id="ai-tashkeel-help" className="hint">
                    {tashkeelHelp[0]}
                    <span lang="ar" dir="rtl">
                      مُقابِل
                    </span>
                    {tashkeelHelp[1]}
                    {!canTashkeel && <> {t('ai.tashkeelNeeds')}</>}
                  </span>
                </span>
              </label>
            )}
          </div>
        </>
      )}
      {caps?.worker !== false && (
        <details className="ai-helper" open={!!view.worker || undefined}>
          <summary>{t('ai.helper')}</summary>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              if (worker.trim() !== (view.worker ?? '')) void onSave({ worker: worker.trim() || null }, 'voices');
            }}
          >
            <label htmlFor="ai-worker">{t('settings.worker')}</label>
            <div className="helper-line">
              <input
                id="ai-worker"
                type="url"
                dir="ltr"
                className="mono"
                placeholder="http://localhost:8790"
                aria-describedby="ai-worker-hint"
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
              />
              <Button type="submit" disabled={worker.trim() === (view.worker ?? '')}>
                {t('common.save')}
              </Button>
            </div>
            <p id="ai-worker-hint" className="hint">
              {t('settings.workerHint')}
            </p>
          </form>
        </details>
      )}
    </section>
  );
}

function VoiceRow({
  lang,
  engine,
  voice,
  rate,
  unavailable,
  onPick,
  bookId,
}: {
  lang: string;
  engine: TtsInfo;
  voice: string;
  rate: string | undefined;
  unavailable: boolean;
  onPick: (voice: string) => void;
  bookId?: string;
}) {
  const i18n = useI18n();
  const { t, langName } = i18n;
  const { status } = useStatus();
  const base = lang.split('-')[0]!;
  const def = engine.voices[base] ?? engine.voices[base === 'ary' ? 'ar' : base] ?? '';
  const current = voice || def;
  const list = (engine.catalog ?? []).filter((v) => v.langs === 'all' || v.langs.includes(base));
  const listed = list.some((v) => v.id === current);
  const [other, setOther] = useState(!!current && !listed && !!list.length && current !== def);
  const [typed, setTyped] = useState(listed ? '' : current);
  const [state, setState] = useState<'idle' | 'making' | 'playing'>('idle');
  const [error, setError] = useState('');
  const info = langInfo(lang);
  const sentence = status?.sampleText?.[lang] ?? status?.sampleText?.[base];
  const free = engine.free;
  const chip = free ? t('ai.free') : engine.freeTier ? t('ai.freeTier') : t('ai.paid');
  const selectId = `ai-voice-${lang}`;

  // a sample still playing stops when its row goes (not when the row is drawn again)
  const mine = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      if (playing && playing.audio === mine.current) playing.stop();
    },
    [],
  );

  const play = async () => {
    if (state === 'playing') {
      playing?.stop();
      return;
    }
    playing?.stop();
    setError('');
    setState('making');
    try {
      const r = await api.voiceSample({
        engine: engine.id,
        voice: current,
        lang,
        ...(rate ? { rate } : {}),
        ...(bookId ? { book: bookId } : {}),
      });
      const audio = new Audio(r.url);
      mine.current = audio;
      const stop = () => {
        audio.pause();
        setState('idle');
        if (playing?.audio === audio) playing = null;
      };
      playing = { audio, stop };
      audio.onended = stop;
      audio.onerror = () => {
        stop();
        setError(t('ai.sampleCantPlay'));
      };
      await audio.play();
      setState('playing');
    } catch (e) {
      setState('idle');
      setError(t('ai.sampleError', { error: errorText(e, t) }));
    }
  };

  return (
    <li className="voice-row">
      <span className="voice-lang">
        <bdi lang={lang} dir={info.dir}>
          {info.name}
        </bdi>
      </span>
      <label className="visually-hidden" htmlFor={selectId}>
        {t('settings.voice', { lang: langName(lang) })}
      </label>
      <select
        id={selectId}
        value={other ? '__other' : current}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '__other') {
            setOther(true);
            setTyped('');
          } else {
            setOther(false);
            onPick(v === def && !list.length ? '' : v);
          }
        }}
      >
        {!list.length && def && <option value={def}>{t('ai.voiceDefault', { voice: def })}</option>}
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {voiceLabel(v.id, engine, i18n)}
          </option>
        ))}
        {!listed && current && current !== def && <option value={current}>{current}</option>}
        <option value="__other">{t('ai.voiceOther')}</option>
      </select>
      {other && (
        <form
          className="voice-other"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[\w.:-]{1,80}$/.test(typed.trim())) {
              setOther(false);
              onPick(typed.trim());
            }
          }}
        >
          <input
            className="mono"
            dir="ltr"
            spellCheck={false}
            aria-label={t('ai.voiceName')}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button type="submit" disabled={!/^[\w.:-]{1,80}$/.test(typed.trim())}>
            {t('common.save')}
          </Button>
        </form>
      )}
      {sentence && (
        <button
          type="button"
          className="btn btn-default sample-btn"
          // aria-disabled keeps the focus on the button while the sample is made
          aria-disabled={unavailable || state === 'making' || undefined}
          aria-busy={state === 'making' || undefined}
          onClick={() => {
            if (!unavailable && state !== 'making') void play();
          }}
        >
          {state === 'making' ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Icon name={state === 'playing' ? 'stop' : 'play'} size={18} />
          )}
          {state === 'playing' ? (
            <span>{t('ai.sampleStop')}</span>
          ) : state === 'making' ? (
            <span>{t('ai.sampleMaking')}</span>
          ) : (
            <span>
              <span className="visually-hidden">{t('ai.sample', { lang: langName(lang) })}: </span>
              <span lang={lang} dir={info.dir}>
                {sentence}
              </span>
            </span>
          )}
        </button>
      )}
      <span className={`ai-chip ${free ? 'ai-chip-ready' : 'ai-chip-paid'}`}>{chip}</span>
      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
