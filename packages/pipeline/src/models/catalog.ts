// Model capabilities and prices. A curated snapshot ships with Warqa (works offline); `warqa models update`
// refreshes it from models.dev. Tiers say how much of the lesson a model can write in one call:
//   A — a whole beat with self-critique; B — one beat with a restricted component set;
//   C — small slots only (code picks the recipe, cues are placed automatically).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Role } from './providers.js';

export type Tier = 'A' | 'B' | 'C';

export interface ModelInfo {
  id: string; // provider:model
  name?: string;
  vision: boolean;
  structured: boolean;
  context: number;
  /** USD per million tokens. */
  input: number;
  output: number;
  openWeights?: boolean;
  /** Licence of open weights (for local models). */
  license?: string;
  tier: Tier;
  /** Measured by `warqa models probe` / evals; overrides the default tier per role. */
  roleTier?: Partial<Record<Role, Tier>>;
  notes?: string;
}

/** Curated snapshot (October 2026, prices from models.dev). */
export const SNAPSHOT: ModelInfo[] = [
  {
    id: 'anthropic:claude-opus-5-5',
    vision: true,
    structured: true,
    context: 1_000_000,
    input: 4,
    output: 20,
    tier: 'A',
  },
  {
    id: 'anthropic:claude-sonnet-5-5',
    vision: true,
    structured: true,
    context: 1_000_000,
    input: 2,
    output: 10,
    tier: 'A',
  },
  {
    id: 'anthropic:claude-haiku-4-5',
    vision: true,
    structured: true,
    context: 200_000,
    input: 1,
    output: 5,
    tier: 'B',
  },
  { id: 'openai:gpt-6.1-sol', vision: true, structured: true, context: 1_050_000, input: 2, output: 10, tier: 'A' },
  { id: 'openai:gpt-6-luna', vision: true, structured: true, context: 1_050_000, input: 0.1, output: 0.5, tier: 'B' },
  {
    id: 'google:gemini-3.8-flash',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 0.75,
    output: 3.75,
    tier: 'A',
    notes: 'Strong Arabic OCR in benchmarks (Gemini family).',
  },
  {
    id: 'google:gemini-flash-latest',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 0.75,
    output: 3.75,
    tier: 'A',
  },
  {
    id: 'google:gemini-flash-lite-latest',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 0.3,
    output: 2.5,
    tier: 'B',
  },
  {
    id: 'google:gemini-3.1-pro-preview',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 2,
    output: 12,
    tier: 'A',
  },
  {
    id: 'mistral:mistral-medium-latest',
    vision: true,
    structured: true,
    context: 262_144,
    input: 1.5,
    output: 7.5,
    tier: 'B',
  },
  {
    id: 'mistral:mistral-small-latest',
    vision: true,
    structured: true,
    context: 256_000,
    input: 0.15,
    output: 0.6,
    tier: 'B',
  },
  {
    id: 'deepseek:deepseek-v4-flash',
    vision: true,
    structured: true,
    context: 1_000_000,
    input: 0.15,
    output: 0.6,
    tier: 'B',
  },
  {
    id: 'deepseek:deepseek-v4-pro',
    vision: false,
    structured: true,
    context: 1_000_000,
    input: 0.66,
    output: 1.98,
    tier: 'A',
  },
  {
    id: 'groq:qwen/qwen3.8-27b',
    vision: true,
    structured: true,
    context: 131_042,
    input: 0.8,
    output: 4,
    tier: 'B',
    openWeights: true,
  },
  { id: 'xai:grok-4.7', vision: true, structured: true, context: 500_000, input: 2, output: 6, tier: 'A' },
  {
    id: 'openrouter:anthropic/claude-sonnet-5.5',
    vision: true,
    structured: true,
    context: 1_000_000,
    input: 2,
    output: 10,
    tier: 'A',
  },
  {
    id: 'openrouter:google/gemini-3.8-flash',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 0.75,
    output: 3.75,
    tier: 'A',
  },
  {
    id: 'openrouter:qwen/qwen3.8-flash',
    vision: true,
    structured: true,
    context: 1_000_000,
    input: 0.15,
    output: 0.47,
    tier: 'B',
  },
  {
    id: 'openrouter:deepseek/deepseek-v4.1-flash',
    vision: true,
    structured: true,
    context: 1_048_576,
    input: 0.003,
    output: 2.4,
    tier: 'B',
    openWeights: true,
  },
  {
    id: 'ollama:qwen3:14b',
    vision: false,
    structured: true,
    context: 40_000,
    input: 0,
    output: 0,
    tier: 'B',
    openWeights: true,
    license: 'Apache-2.0',
  },
  {
    id: 'ollama:qwen3:8b',
    vision: false,
    structured: true,
    context: 40_000,
    input: 0,
    output: 0,
    tier: 'C',
    openWeights: true,
    license: 'Apache-2.0',
  },
  {
    id: 'ollama:qwen2.5vl:7b',
    vision: true,
    structured: true,
    context: 125_000,
    input: 0,
    output: 0,
    tier: 'C',
    openWeights: true,
    license: 'Apache-2.0',
  },
  {
    id: 'ollama:gemma3:12b',
    vision: true,
    structured: true,
    context: 128_000,
    input: 0,
    output: 0,
    tier: 'C',
    openWeights: true,
    license: 'Gemma Terms of Use',
  },
];

const cacheFile = () => join(process.env.WARQA_HOME ?? join(homedir(), '.warqa'), 'models.json');

let merged: Map<string, ModelInfo> | null = null;

function load(): Map<string, ModelInfo> {
  if (merged) return merged;
  merged = new Map(SNAPSHOT.map((m) => [m.id, m]));
  const f = cacheFile();
  if (existsSync(f)) {
    try {
      for (const m of JSON.parse(readFileSync(f, 'utf8')) as ModelInfo[]) if (!merged.has(m.id)) merged.set(m.id, m);
    } catch {
      /* ignore a broken cache */
    }
  }
  return merged;
}

/** Capabilities of a model; unknown models get conservative defaults (tier C until probed). */
export function modelInfo(id: string): ModelInfo {
  const known = load().get(id);
  if (known) return known;
  const local = /^(ollama|lmstudio|llamacpp|vllm|compat):/.test(id);
  return {
    id,
    vision: false,
    structured: !id.startsWith('compat:'),
    context: local ? 32_000 : 128_000,
    input: local ? 0 : 1,
    output: local ? 0 : 4,
    tier: local ? 'C' : 'B',
  };
}

export const tierFor = (id: string, role: Role): Tier => {
  const m = modelInfo(id);
  return m.roleTier?.[role] ?? m.tier;
};

export function listModels(): ModelInfo[] {
  return [...load().values()];
}

/** Refresh the catalog from models.dev (prices, context, vision, structured output). */
export async function updateCatalog(
  providers = ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'groq', 'xai', 'openrouter'],
): Promise<number> {
  const res = await fetch('https://models.dev/api.json');
  if (!res.ok) throw new Error(`models.dev: HTTP ${res.status}`);
  const data = (await res.json()) as Record<
    string,
    {
      models?: Record<
        string,
        {
          id: string;
          name?: string;
          attachment?: boolean;
          structured_output?: boolean;
          tool_call?: boolean;
          limit?: { context?: number };
          cost?: { input?: number; output?: number };
          open_weights?: boolean;
          modalities?: { output?: string[] };
        }
      >;
    }
  >;
  const out: ModelInfo[] = [];
  for (const p of providers) {
    for (const m of Object.values(data[p]?.models ?? {})) {
      if (m.modalities?.output && !m.modalities.output.includes('text')) continue;
      const ctx = m.limit?.context ?? 0;
      out.push({
        id: `${p}:${m.id}`,
        ...(m.name ? { name: m.name } : {}),
        vision: !!m.attachment,
        structured: m.structured_output ?? !!m.tool_call,
        context: ctx,
        input: m.cost?.input ?? 0,
        output: m.cost?.output ?? 0,
        ...(m.open_weights ? { openWeights: true } : {}),
        tier: ctx >= 200_000 && (m.cost?.output ?? 0) >= 2 ? 'A' : 'B',
      });
    }
  }
  mkdirSync(join(cacheFile(), '..'), { recursive: true });
  writeFileSync(cacheFile(), JSON.stringify(out));
  merged = null;
  return out.length;
}

/** USD cost of a call. */
export const costOf = (id: string, inTok: number, outTok: number): number => {
  const m = modelInfo(id);
  return (inTok * m.input + outTok * m.output) / 1e6;
};
