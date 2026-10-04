// Model providers as the web app presents them: which work from a browser tab, the key they need, the ready-made
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
  | 'fake';

export interface WebProvider {
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
  /** Free check of a key: list the models (or the key's own info). */
  check?: (key: string) => { url: string; headers: Record<string, string> };
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

export const PROVIDERS: WebProvider[] = [
  {
    id: 'google',
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
    name: 'OpenRouter',
    env: 'OPENROUTER_API_KEY',
    preset: 'openrouter',
    keyUrl: 'https://openrouter.ai/keys',
    recommended: true,
    check: (key) => ({ url: 'https://openrouter.ai/api/v1/key', headers: bearer(key) }),
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    preset: 'deepseek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    recommended: true,
    check: (key) => ({ url: 'https://api.deepseek.com/models', headers: bearer(key) }),
  },
  {
    id: 'anthropic',
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
    name: 'OpenAI',
    env: 'OPENAI_API_KEY',
    preset: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
    check: (key) => ({ url: 'https://api.openai.com/v1/models', headers: bearer(key) }),
  },
  {
    id: 'mistral',
    name: 'Mistral',
    env: 'MISTRAL_API_KEY',
    preset: 'mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    check: (key) => ({ url: 'https://api.mistral.ai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'groq',
    name: 'Groq',
    env: 'GROQ_API_KEY',
    preset: 'groq',
    keyUrl: 'https://console.groq.com/keys',
    check: (key) => ({ url: 'https://api.groq.com/openai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    env: 'XAI_API_KEY',
    preset: 'xai',
    keyUrl: 'https://console.x.ai',
    check: (key) => ({ url: 'https://api.x.ai/v1/models', headers: bearer(key) }),
  },
  {
    id: 'ollama',
    name: 'Ollama',
    env: 'OLLAMA_BASE_URL',
    preset: 'local',
    keyUrl: 'https://ollama.com',
    local: true,
    check: (base) => ({ url: `${(base || 'http://localhost:11434/api').replace(/\/+$/, '')}/tags`, headers: {} }),
  },
];

/** Test-only scripted model (no network), shown only in test mode. */
export const FAKE_PROVIDER: WebProvider = { id: 'fake', name: 'Test model (no network)', env: 'WARQA_FAKE_KEY' };

export const providerById = (id: string, fake = false): WebProvider | undefined =>
  id === 'fake' ? (fake ? FAKE_PROVIDER : undefined) : PROVIDERS.find((p) => p.id === id);

export type KeyCheck =
  | { ok: true; warning?: 'rate' }
  | { ok: false; reason: 'key' | 'credits' | 'network' | 'http'; status?: number; message?: string };
