// Ready-made role → model maps. A user with one key picks the matching preset; anyone can override a role.
import type { Keys, Role } from './providers.js';

export interface Preset {
  id: string;
  label: string;
  description: string;
  roles: Record<Role, string>;
  /** Environment keys the preset needs (any one of each group). */
  needs: string[][];
}

const all = (m: string, over: Partial<Record<Role, string>> = {}): Record<Role, string> => ({
  planner: m,
  storyboard: m,
  writer: m,
  translator: m,
  vision: m,
  judge: m,
  ...over,
});

export const PRESETS: Preset[] = [
  {
    id: 'best',
    label: 'Best quality',
    description:
      'Claude for planning and writing, Gemini Flash for reading page images (strong Arabic OCR). Needs Anthropic and Google keys.',
    roles: all('anthropic:claude-sonnet-5-5', {
      planner: 'anthropic:claude-opus-5-5',
      storyboard: 'anthropic:claude-opus-5-5',
      vision: 'google:gemini-3.8-flash',
      judge: 'google:gemini-3.8-flash',
    }),
    needs: [['ANTHROPIC_API_KEY'], ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY']],
  },
  {
    id: 'anthropic',
    label: 'Claude only',
    description: 'Everything with Claude Sonnet 5.5 (Haiku for checks).',
    roles: all('anthropic:claude-sonnet-5-5', { judge: 'anthropic:claude-haiku-4-5' }),
    needs: [['ANTHROPIC_API_KEY']],
  },
  {
    id: 'openai',
    label: 'OpenAI only',
    description: 'GPT-6.1 Sol for planning and writing, GPT-6 Luna for translation, vision and checks.',
    roles: all('openai:gpt-6.1-sol', {
      translator: 'openai:gpt-6-luna',
      vision: 'openai:gpt-6-luna',
      judge: 'openai:gpt-6-luna',
    }),
    needs: [['OPENAI_API_KEY']],
  },
  {
    id: 'google',
    label: 'Gemini only',
    description: 'Gemini 3.8 Flash for everything; good Arabic, cheap, reads page images.',
    roles: all('google:gemini-3.8-flash', { judge: 'google:gemini-flash-lite-latest' }),
    needs: [['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY']],
  },
  {
    id: 'budget',
    label: 'Budget',
    description: 'DeepSeek V4 Flash for writing, Gemini Flash-Lite for vision and checks: a few cents per chapter.',
    roles: all('deepseek:deepseek-v4-flash', {
      vision: 'google:gemini-flash-lite-latest',
      judge: 'google:gemini-flash-lite-latest',
    }),
    needs: [['DEEPSEEK_API_KEY'], ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY']],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek only',
    description: 'DeepSeek V4 Pro plans and writes, V4 Flash translates and reads page images. Very cheap.',
    roles: all('deepseek:deepseek-v4-pro', {
      translator: 'deepseek:deepseek-v4-flash',
      vision: 'deepseek:deepseek-v4-flash',
      judge: 'deepseek:deepseek-v4-flash',
    }),
    needs: [['DEEPSEEK_API_KEY']],
  },
  {
    id: 'mistral',
    label: 'Mistral only',
    description: 'Mistral Medium for everything, Mistral Small for checks (European provider, strong French).',
    roles: all('mistral:mistral-medium-latest', { judge: 'mistral:mistral-small-latest' }),
    needs: [['MISTRAL_API_KEY']],
  },
  {
    id: 'xai',
    label: 'Grok only',
    description: 'Grok 4.7 for every role.',
    roles: all('xai:grok-4.7'),
    needs: [['XAI_API_KEY']],
  },
  {
    id: 'groq',
    label: 'Groq only',
    description: 'Qwen 3.8 27B on Groq (open weights, very fast) for every role.',
    roles: all('groq:qwen/qwen3.8-27b'),
    needs: [['GROQ_API_KEY']],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (one key)',
    description:
      'One OpenRouter key for every role: Claude Sonnet 5.5 writes, Gemini Flash reads pages, Qwen Flash translates.',
    roles: all('openrouter:anthropic/claude-sonnet-5.5', {
      vision: 'openrouter:google/gemini-3.8-flash',
      translator: 'openrouter:qwen/qwen3.8-flash',
      judge: 'openrouter:google/gemini-3.8-flash',
    }),
    needs: [['OPENROUTER_API_KEY']],
  },
  {
    id: 'local',
    label: 'Fully local (Ollama)',
    description:
      'Runs on your computer with Ollama: Qwen3 14B writes (tier B), Qwen2.5-VL 7B reads page images. No data leaves your machine. Pull the models first: `ollama pull qwen3:14b qwen2.5vl:7b`.',
    roles: all('ollama:qwen3:14b', { vision: 'ollama:qwen2.5vl:7b', judge: 'ollama:qwen3:8b' }),
    needs: [],
  },
];

export const preset = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** Presets usable with the available keys, best first. */
export function availablePresets(keys: Keys = process.env): Preset[] {
  return PRESETS.filter((p) => p.needs.every((group) => group.some((k) => keys[k]?.trim())));
}

/** Resolve the model for a role: explicit per-role setting, then the preset, then the first usable preset. */
export function resolveRole(
  role: Role,
  cfg: { preset?: string | undefined; models?: Record<string, string> },
  keys: Keys = process.env,
): string {
  const explicit = cfg.models?.[role];
  if (explicit) return explicit;
  const p = cfg.preset ? preset(cfg.preset) : availablePresets(keys).find((x) => x.id !== 'local');
  if (!p)
    throw new Error(
      'no model configured: set an API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY) or use the "local" preset with Ollama',
    );
  return p.roles[role];
}
