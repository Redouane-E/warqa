# Models

Warqa works with any model through the [AI SDK](https://ai-sdk.dev). A model is named `provider:model`:

| provider | key / setting | notes |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | e.g. `anthropic:claude-sonnet-5-5`, `anthropic:claude-opus-5-5`, `anthropic:claude-haiku-4-5` |
| `openai` | `OPENAI_API_KEY` | e.g. `openai:gpt-6.1-sol`, `openai:gpt-6-luna` |
| `google` | `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` | e.g. `google:gemini-3.8-flash` (strong Arabic OCR) |
| `mistral` | `MISTRAL_API_KEY` | `mistral:mistral-medium-latest` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek:deepseek-v4-flash` |
| `groq` | `GROQ_API_KEY` | `groq:qwen/qwen3.8-27b` |
| `xai` | `XAI_API_KEY` | `xai:grok-4.7` |
| `openrouter` | `OPENROUTER_API_KEY` | any of hundreds of models: `openrouter:anthropic/claude-sonnet-5.5` |
| `ollama` | `OLLAMA_BASE_URL` (default `http://localhost:11434/api`) | `ollama:qwen3:14b` — local |
| `lmstudio` | `LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`) | local |
| `llamacpp` | `LLAMACPP_BASE_URL` (default `http://localhost:8080/v1`) | local |
| `vllm` | `VLLM_BASE_URL`, `VLLM_API_KEY` | self-hosted |
| `compat` | `WARQA_COMPAT_BASE_URL`, `WARQA_COMPAT_API_KEY`, `WARQA_COMPAT_STRUCTURED=1` | any OpenAI-compatible endpoint |

## Roles

| role | does |
| --- | --- |
| `planner` | reads the outline and samples; plans chapters, audience, glossary |
| `storyboard` | turns a chapter into beats with teaching moves and visuals |
| `writer` | writes each beat (narration with marks, components, cues, questions) |
| `translator` | translates strings, keeping marks, answer boxes and math |
| `vision` | reads page images (OCR for scanned or garbled pages) |
| `judge` | optional checks |

Use a preset (`warqa models set preset=google`) and override roles (`warqa models set writer=anthropic:claude-sonnet-5-5`). Without settings, Warqa picks the first preset your keys allow.

## How Warqa gets valid lessons from any model

1. **Constrained output** when the provider supports JSON Schema (OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama's `format`, llama.cpp grammars, vLLM, LM Studio); otherwise the schema goes into the prompt.
2. **jsonrepair** fixes broken JSON (missing commas, quotes, code fences).
3. **Zod** checks the structure, then **validators** check meaning against the real scene: marks exist, cue targets exist on stage, answers parse, translations keep marks, pacing.
4. Problems are **sent back** to the model, which fixes them (up to three rounds).
5. **Tiers**: tier A/B models write whole beats; tier C (small local models) fill a smaller format — sentences and nodes — and code places the cues. `warqa models probe <id>` runs five small tasks and suggests a tier.

Every call is cached by content hash (reruns are free), metered in `.ledger.jsonl`, and stopped by `pipeline.budget.usd`. Prices and capabilities come from a built-in snapshot; `warqa models update` refreshes them from [models.dev](https://models.dev).

## Running fully local

```bash
ollama pull qwen3:14b qwen2.5vl:7b
warqa models set preset=local
```

Qwen3 14B writes at tier B; 7–8B models work at tier C. Nothing leaves your machine (use the worker or Edge voices — the latter need the network — or a local voice for narration).
