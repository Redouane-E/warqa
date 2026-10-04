// Every provider the user can choose, behind one "provider:model" id (AI SDK 7 provider registry).
// Keys come from the environment (or the studio's settings, passed in); nothing is ever written into books.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';

export type Role = 'vision' | 'planner' | 'storyboard' | 'writer' | 'translator' | 'judge';
export const ROLES: Role[] = ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'];

export const ROLE_INFO: Record<Role, string> = {
  planner: 'Reads the outline and samples; plans chapters, audience, glossary.',
  storyboard: 'Turns a chapter into a beat list with teaching moves and visuals.',
  writer: 'Writes each beat: narration with marks, components, cues and questions.',
  translator: 'Translates lesson strings into other languages, keeping marks and math.',
  vision: 'Reads page images: OCR for scanned or garbled pages, figures.',
  judge: 'Checks grounding and rendered frames (optional).',
};

export interface ProviderInfo {
  id: string;
  name: string;
  kind: 'cloud' | 'gateway' | 'local';
  /** Environment variables: the first is the key (or base URL for local servers). */
  env: string[];
  /** Does the API support JSON-schema constrained output? */
  structured: 'native' | 'json' | 'grammar';
  docs: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'cloud',
    env: ['ANTHROPIC_API_KEY'],
    structured: 'native',
    docs: 'https://console.anthropic.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'cloud',
    env: ['OPENAI_API_KEY'],
    structured: 'native',
    docs: 'https://platform.openai.com',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'cloud',
    env: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
    structured: 'native',
    docs: 'https://aistudio.google.com',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'cloud',
    env: ['MISTRAL_API_KEY'],
    structured: 'native',
    docs: 'https://console.mistral.ai',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'cloud',
    env: ['DEEPSEEK_API_KEY'],
    structured: 'json',
    docs: 'https://platform.deepseek.com',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'cloud',
    env: ['GROQ_API_KEY'],
    structured: 'native',
    docs: 'https://console.groq.com',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    kind: 'cloud',
    env: ['XAI_API_KEY'],
    structured: 'native',
    docs: 'https://console.x.ai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (one key, hundreds of models)',
    kind: 'gateway',
    env: ['OPENROUTER_API_KEY'],
    structured: 'native',
    docs: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'local',
    env: ['OLLAMA_BASE_URL'],
    structured: 'grammar',
    docs: 'https://ollama.com',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'local',
    env: ['LMSTUDIO_BASE_URL'],
    structured: 'grammar',
    docs: 'https://lmstudio.ai',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server (local)',
    kind: 'local',
    env: ['LLAMACPP_BASE_URL'],
    structured: 'grammar',
    docs: 'https://github.com/ggml-org/llama.cpp',
  },
  {
    id: 'vllm',
    name: 'vLLM (self-hosted)',
    kind: 'local',
    env: ['VLLM_BASE_URL', 'VLLM_API_KEY'],
    structured: 'grammar',
    docs: 'https://docs.vllm.ai',
  },
  {
    id: 'compat',
    name: 'Any OpenAI-compatible endpoint',
    kind: 'gateway',
    env: ['WARQA_COMPAT_BASE_URL', 'WARQA_COMPAT_API_KEY'],
    structured: 'json',
    docs: 'https://ai-sdk.dev/providers/openai-compatible-providers',
  },
];

export type Keys = Record<string, string | undefined>;

const pick = (keys: Keys, ...names: string[]) => names.map((n) => keys[n]).find((v) => v?.trim());

/** Running in a web page or a Web Worker (the web app) rather than Node. */
const inBrowser = (): boolean =>
  typeof (globalThis as { document?: unknown }).document !== 'undefined' ||
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';

/** Which providers are usable with the given keys (local servers count as usable; they are checked on use). */
export function providerStatus(
  keys: Keys = process.env,
): { id: string; name: string; kind: string; configured: boolean; missing: string[] }[] {
  return PROVIDERS.map((p) => {
    const configured = p.kind === 'local' ? true : !!pick(keys, ...p.env.slice(0, p.id === 'google' ? 2 : 1));
    return { id: p.id, name: p.name, kind: p.kind, configured, missing: configured ? [] : [p.env[0]!] };
  });
}

/** Build a language model for "provider:model" (the model id may itself contain ":" or "/"). */
export function languageModel(ref: string, keys: Keys = process.env): LanguageModel {
  const i = ref.indexOf(':');
  if (i < 0) throw new Error(`model ids look like "provider:model" (e.g. "anthropic:claude-sonnet-5-5"), got "${ref}"`);
  const provider = ref.slice(0, i);
  const model = ref.slice(i + 1);
  const need = (name: string, ...envs: string[]) => {
    const v = pick(keys, ...envs);
    if (!v) throw new Error(`${name} needs ${envs[0]} (set it in your environment or .env, or in the studio settings)`);
    return v;
  };
  switch (provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey: need('Anthropic', 'ANTHROPIC_API_KEY'),
        // The API refuses browser calls (CORS) unless they opt in; the key is the user's own, kept in their browser.
        ...(inBrowser() ? { headers: { 'anthropic-dangerous-direct-browser-access': 'true' } } : {}),
      })(model);
    case 'openai':
      return createOpenAI({ apiKey: need('OpenAI', 'OPENAI_API_KEY') })(model);
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: need('Google Gemini', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'),
      })(model);
    case 'mistral':
      return createMistral({ apiKey: need('Mistral', 'MISTRAL_API_KEY') })(model);
    case 'deepseek':
      return createDeepSeek({ apiKey: need('DeepSeek', 'DEEPSEEK_API_KEY') })(model);
    case 'groq':
      return createGroq({ apiKey: need('Groq', 'GROQ_API_KEY') })(model);
    case 'xai':
      return createXai({ apiKey: need('xAI', 'XAI_API_KEY') })(model);
    case 'openrouter':
      return createOpenRouter({
        apiKey: need('OpenRouter', 'OPENROUTER_API_KEY'),
        headers: { 'HTTP-Referer': 'https://github.com/warqa', 'X-Title': 'Warqa' },
      })(model) as unknown as LanguageModel;
    case 'ollama':
      return createOllama({ baseURL: pick(keys, 'OLLAMA_BASE_URL') ?? 'http://localhost:11434/api' })(
        model,
      ) as unknown as LanguageModel;
    case 'lmstudio':
      return createOpenAICompatible({
        name: 'lmstudio',
        baseURL: pick(keys, 'LMSTUDIO_BASE_URL') ?? 'http://localhost:1234/v1',
        supportsStructuredOutputs: true,
      })(model);
    case 'llamacpp':
      return createOpenAICompatible({
        name: 'llamacpp',
        baseURL: pick(keys, 'LLAMACPP_BASE_URL') ?? 'http://localhost:8080/v1',
        supportsStructuredOutputs: true,
      })(model);
    case 'vllm': {
      const apiKey = pick(keys, 'VLLM_API_KEY');
      return createOpenAICompatible({
        name: 'vllm',
        baseURL: pick(keys, 'VLLM_BASE_URL') ?? 'http://localhost:8000/v1',
        supportsStructuredOutputs: true,
        ...(apiKey ? { apiKey } : {}),
      })(model);
    }
    case 'compat': {
      const apiKey = pick(keys, 'WARQA_COMPAT_API_KEY');
      return createOpenAICompatible({
        name: 'compat',
        baseURL: need('OpenAI-compatible endpoint', 'WARQA_COMPAT_BASE_URL'),
        supportsStructuredOutputs: pick(keys, 'WARQA_COMPAT_STRUCTURED') === '1',
        ...(apiKey ? { apiKey } : {}),
      })(model);
    }
    default:
      throw new Error(`unknown provider "${provider}" (${PROVIDERS.map((p) => p.id).join(', ')})`);
  }
}

export const providerOf = (ref: string): ProviderInfo | undefined =>
  PROVIDERS.find((p) => p.id === ref.slice(0, ref.indexOf(':')));
