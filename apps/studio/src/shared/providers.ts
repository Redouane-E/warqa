// Model providers as the start guide presents them (desktop and web app): the key they need, the ready-made
// model set (preset) to use, and how to check a key without spending anything (listing models is free).
//
// CORS (can a web page call the API directly?) was checked for each provider: a preflight from another origin
// is answered with Access-Control-Allow-Origin, and a request with a wrong key comes back readable (401) rather
// than blocked. Anthropic needs the "anthropic-dangerous-direct-browser-access" header (the pipeline adds it in
// browsers). Local servers (Ollama, LM Studio…) work only if they allow the page's origin (OLLAMA_ORIGINS).

export type ProviderId =
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'mistral'
  | 'groq'
  | 'xai'
  | 'ollama'
  | 'compat'
  | 'fake';

export interface GuideProvider {
  id: ProviderId;
  name: string;
  /** Environment variable the key goes into (the pipeline reads it). */
  env: string;
  /** Ready-made model set (models/presets.ts). */
  preset?: string;
  /** Where to get a key. */
  keyUrl?: string;
  /** Shown first, for people new to this. */
  recommended?: boolean;
  /** A local server instead of a key (the "key" field is its address). */
  local?: boolean;
  /** Free check of a key: list the models (or the key's own info). `secret`: a local server's own key. */
  check?: (key: string, secret?: string) => { url: string; headers: Record<string, string> };
  /** A local server that may ask for a key of its own (in this variable). */
  secretEnv?: string;
  /** The company, as a failure names it ("Google refused this key"). */
  maker?: string;
  /** Where its keys are made ("Open Google AI Studio"). */
  keySite?: string;
  /** Its models' family, as a daily free tier names it ("Gemini's free tier is used up"). */
  family?: string;
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

export const PROVIDERS: GuideProvider[] = [
  {
    id: 'google',
    maker: 'Google',
    keySite: 'Google AI Studio',
    family: 'Gemini',
    name: 'Google Gemini',
    env: 'GEMINI_API_KEY',
    preset: 'google',
    keyUrl: 'https://aistudio.google.com/apikey',
    recommended: true,
    check: (key) => ({
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      headers: { 'x-goog-api-key': key },
    }),
  },
  {
    id: 'openrouter',
    maker: 'OpenRouter',
    keySite: 'OpenRouter',
    family: 'OpenRouter',
    name: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    preset: 'openrouter',
    keyUrl: 'https://openrouter.ai/keys',
    recommended: true,
    check: (key) => ({ url: 'https://openrouter.ai/api/v1/key', headers: bearer(key) }),
  },
  {
    id: 'deepseek',
    maker: 'DeepSeek',
    keySite: 'DeepSeek Platform',
    family: 'DeepSeek',
    name: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    preset: 'deepseek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    recommended: true,
    check: (key) => ({ url: 'https://api.deepseek.com/models', headers: bearer(key) }),
  },
  {
    id: 'anthropic',
    maker: 'Anthropic',
    keySite: 'Anthropic Console',
    family: 'Claude',
    name: 'Anthropic (Claude)',
    env: 'ANTHROPIC_API_KEY',
    preset: 'anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    check: (key) => ({
      url: 'https://api.anthropic.com/v1/models?limit=1',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }),
  },
  {
    id: 'openai',
    maker: 'OpenAI',
    keySite: 'OpenAI Platform',
    family: 'GPT',
    name: 'OpenAI',
    env: 'OPENAI_API_KEY',
    preset: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
    check: (key) => ({ url: 'https://api.openai.com/v1/models', headers: bearer(key) }),
  },
  {
    id: 'mistral',
    maker: 'Mistral',
    keySite: 'Mistral Console',
    family: 'Mistral',
    name: 'Mistral',
    env: 'MISTRAL_API_KEY',
    preset: 'mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    check: (key) => ({ url: 'https://api.mistral.ai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'groq',
    maker: 'Groq',
    keySite: 'GroqCloud',
    family: 'Groq',
    name: 'Groq',
    env: 'GROQ_API_KEY',
    preset: 'groq',
    keyUrl: 'https://console.groq.com/keys',
    check: (key) => ({ url: 'https://api.groq.com/openai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'xai',
    maker: 'xAI',
    keySite: 'xAI Console',
    family: 'Grok',
    name: 'xAI (Grok)',
    env: 'XAI_API_KEY',
    preset: 'xai',
    keyUrl: 'https://console.x.ai',
    check: (key) => ({ url: 'https://api.x.ai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'ollama',
    maker: 'Ollama',
    family: 'Ollama',
    name: 'Ollama',
    env: 'OLLAMA_BASE_URL',
    preset: 'local',
    keyUrl: 'https://ollama.com',
    local: true,
    check: (base) => ({ url: `${(base || 'http://localhost:11434/api').replace(/\/+$/, '')}/tags`, headers: {} }),
  },
  {
    // any OpenAI-compatible server (LM Studio, llama.cpp, vLLM…): its address, and a key if it asks for one
    id: 'compat',
    name: 'OpenAI-compatible',
    env: 'WARQA_COMPAT_BASE_URL',
    secretEnv: 'WARQA_COMPAT_API_KEY',
    local: true,
    check: (base, secret) => ({
      url: `${base.replace(/\/+$/, '')}/models`,
      headers: secret ? bearer(secret) : {},
    }),
  },
];

/** Test-only scripted model (no network), shown only in test mode. */
export const FAKE_PROVIDER: GuideProvider = { id: 'fake', name: 'Test model (no network)', env: 'WARQA_FAKE_KEY' };

export const providerById = (id: string, fake = false): GuideProvider | undefined =>
  id === 'fake' ? (fake ? FAKE_PROVIDER : undefined) : PROVIDERS.find((p) => p.id === id);

export type KeyCheck =
  | { ok: true; warning?: 'rate' /** a local server's models */; models?: string[] }
  | { ok: false; reason: 'key' | 'credits' | 'network' | 'http'; status?: number; message?: string };
