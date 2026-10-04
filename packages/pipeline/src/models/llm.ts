// Structured generation that works across providers and model sizes:
//   schema-constrained output (when the provider supports it) → jsonrepair → Zod → semantic validators
//   → problems fed back to the model (up to N repairs). Every call is cached by content hash (reruns are
//   free), metered in a cost ledger, and checked against the project's budget.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateText, type LanguageModel, type ModelMessage, NoObjectGeneratedError, Output } from 'ai';
import { jsonrepair } from 'jsonrepair';
import * as z from 'zod';
import { costOf, modelInfo } from './catalog.js';
import { type Keys, languageModel, type Role } from './providers.js';

export interface ImagePart {
  data: Uint8Array;
  mediaType: string;
}

export interface StructuredCall<T> {
  stage: string;
  role: Role;
  model: string;
  system: string;
  prompt: string;
  images?: ImagePart[];
  schema: z.ZodType<T>;
  /** Short name used in cache keys and logs. */
  name: string;
  /** Semantic checks after the schema passes: return problems to send back to the model. */
  validate?: (value: T) => string[];
  maxRepairs?: number;
  temperature?: number;
  /** Bypass the cache. */
  fresh?: boolean;
}

export interface CallResult<T> {
  value: T;
  model: string;
  usage: { input: number; output: number };
  usd: number;
  repairs: number;
  cached: boolean;
}

export interface LedgerEntry {
  ts: string;
  stage: string;
  role: string;
  model: string;
  input: number;
  output: number;
  usd: number;
  ms: number;
  ok: boolean;
  cached?: boolean;
}

/** Test hook: a fake model that answers prompts without any provider. */
export type FakeModel = (call: {
  system: string;
  prompt: string;
  messages: ModelMessage[];
  name: string;
  model: string;
  attempt: number;
}) => string | Promise<string>;

export class BudgetError extends Error {}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
    readonly raw?: string,
  ) {
    super(message);
  }
}

export interface LlmOptions {
  keys?: Keys;
  /** Folder for the call cache (e.g. <project>/cache/llm). */
  cacheDir?: string;
  /** JSONL cost ledger (e.g. <project>/.ledger.jsonl). */
  ledger?: string;
  budgetUsd?: number;
  fake?: FakeModel;
  onEvent?: (e: {
    type: 'call' | 'repair' | 'cached' | 'fallback';
    stage: string;
    model: string;
    detail?: string;
  }) => void;
}

const sha1 = (s: string | Uint8Array) => createHash('sha1').update(s).digest('hex');

/** Pull a JSON value out of a model reply (code fences, prose around it) and repair it. */
export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1]!.trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (last > 0) s = s.slice(0, last + 1);
  return JSON.parse(jsonrepair(s));
}

const zodProblems = (e: z.ZodError) =>
  e.issues.slice(0, 25).map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);

export class Llm {
  private spent = 0;
  constructor(readonly opts: LlmOptions = {}) {
    if (opts.ledger && existsSync(opts.ledger)) {
      for (const line of readFileSync(opts.ledger, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          this.spent += (JSON.parse(line) as LedgerEntry).usd || 0;
        } catch {
          /* skip */
        }
      }
    }
  }

  /** Total spent so far (from the ledger). */
  get totalUsd(): number {
    return this.spent;
  }

  private log(e: LedgerEntry) {
    this.spent += e.usd;
    if (this.opts.ledger) {
      mkdirSync(dirname(this.opts.ledger), { recursive: true });
      appendFileSync(this.opts.ledger, `${JSON.stringify(e)}\n`);
    }
  }

  private model(ref: string): LanguageModel {
    return languageModel(ref, this.opts.keys ?? process.env);
  }

  /** Generate a value matching a schema, repairing until it validates. */
  async structured<T>(call: StructuredCall<T>): Promise<CallResult<T>> {
    const jsonSchema = z.toJSONSchema(call.schema as z.ZodType, { unrepresentable: 'any', io: 'input' });
    const key = sha1(
      JSON.stringify([
        call.model,
        call.name,
        call.system,
        call.prompt,
        jsonSchema,
        (call.images ?? []).map((i) => sha1(i.data)),
      ]),
    );
    const cachePath = this.opts.cacheDir ? join(this.opts.cacheDir, `${key}.json`) : undefined;
    if (cachePath && !call.fresh && existsSync(cachePath)) {
      const v = call.schema.safeParse(JSON.parse(readFileSync(cachePath, 'utf8')).value);
      if (v.success && !call.validate?.(v.data).length) {
        this.opts.onEvent?.({ type: 'cached', stage: call.stage, model: call.model });
        return { value: v.data, model: call.model, usage: { input: 0, output: 0 }, usd: 0, repairs: 0, cached: true };
      }
    }
    const info = modelInfo(call.model);
    let mode: 'native' | 'json' = info.structured ? 'native' : 'json';
    const userContent = (text: string): ModelMessage['content'] =>
      call.images?.length
        ? [
            { type: 'text', text },
            ...call.images.map((im) => ({ type: 'image' as const, image: im.data, mediaType: im.mediaType })),
          ]
        : text;
    const jsonInstruction = `\n\nReply with ONE JSON value only (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    const messages: ModelMessage[] = [{ role: 'user', content: userContent(call.prompt) } as ModelMessage];
    const maxRepairs = call.maxRepairs ?? 3;
    let problems: string[] = [];
    let lastRaw = '';
    let usage = { input: 0, output: 0 };
    let usd = 0;
    for (let attempt = 0; attempt <= maxRepairs; attempt++) {
      if (this.opts.budgetUsd !== undefined && this.spent >= this.opts.budgetUsd) {
        throw new BudgetError(
          `budget reached: $${this.spent.toFixed(2)} of $${this.opts.budgetUsd.toFixed(2)} (raise pipeline.budget.usd to continue)`,
        );
      }
      const t0 = Date.now();
      let raw = '';
      let value: unknown;
      let inTok = 0;
      let outTok = 0;
      try {
        if (this.opts.fake) {
          raw = await this.opts.fake({
            system: call.system,
            prompt: call.prompt,
            messages,
            name: call.name,
            model: call.model,
            attempt,
          });
          value = extractJson(raw);
        } else if (mode === 'native') {
          try {
            const r = await generateText({
              model: this.model(call.model),
              system: call.system,
              messages,
              output: Output.object({ schema: call.schema as z.ZodType }),
              ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
              maxRetries: 2,
            });
            inTok = r.usage.inputTokens ?? 0;
            outTok = r.usage.outputTokens ?? 0;
            value = r.output;
            raw = JSON.stringify(value);
          } catch (e) {
            if (NoObjectGeneratedError.isInstance(e)) {
              raw = e.text ?? '';
              inTok = e.usage?.inputTokens ?? 0;
              outTok = e.usage?.outputTokens ?? 0;
              value = extractJson(raw);
            } else if (
              /schema|response_format|json_schema|structured|unsupported|not support/i.test(
                String((e as Error).message),
              )
            ) {
              // the provider rejected the schema: fall back to JSON-in-prompt mode
              mode = 'json';
              this.opts.onEvent?.({
                type: 'fallback',
                stage: call.stage,
                model: call.model,
                detail: (e as Error).message.slice(0, 200),
              });
              attempt--;
              continue;
            } else throw e;
          }
        } else {
          const msgs = messages.map((m, i) =>
            i === 0 ? ({ role: 'user', content: userContent(call.prompt + jsonInstruction) } as ModelMessage) : m,
          );
          const r = await generateText({
            model: this.model(call.model),
            system: call.system,
            messages: msgs,
            maxRetries: 2,
            ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
          });
          inTok = r.usage.inputTokens ?? 0;
          outTok = r.usage.outputTokens ?? 0;
          raw = r.text;
          value = extractJson(raw);
        }
      } catch (e) {
        if (e instanceof SyntaxError || /JSON/i.test(String((e as Error).message))) {
          problems = [`the reply was not valid JSON (${(e as Error).message.slice(0, 120)})`];
        } else {
          this.log({
            ts: new Date().toISOString(),
            stage: call.stage,
            role: call.role,
            model: call.model,
            input: inTok,
            output: outTok,
            usd: costOf(call.model, inTok, outTok),
            ms: Date.now() - t0,
            ok: false,
          });
          throw e;
        }
      }
      const callUsd = costOf(call.model, inTok, outTok);
      usage = { input: usage.input + inTok, output: usage.output + outTok };
      usd += callUsd;
      lastRaw = raw;
      if (value !== undefined) {
        const parsed = call.schema.safeParse(value);
        if (parsed.success) {
          problems = call.validate?.(parsed.data) ?? [];
          if (!problems.length) {
            this.log({
              ts: new Date().toISOString(),
              stage: call.stage,
              role: call.role,
              model: call.model,
              input: inTok,
              output: outTok,
              usd: callUsd,
              ms: Date.now() - t0,
              ok: true,
            });
            if (cachePath) {
              mkdirSync(dirname(cachePath), { recursive: true });
              writeFileSync(cachePath, JSON.stringify({ name: call.name, model: call.model, value: parsed.data }));
            }
            return { value: parsed.data, model: call.model, usage, usd, repairs: attempt, cached: false };
          }
        } else problems = zodProblems(parsed.error);
      }
      this.log({
        ts: new Date().toISOString(),
        stage: call.stage,
        role: call.role,
        model: call.model,
        input: inTok,
        output: outTok,
        usd: callUsd,
        ms: Date.now() - t0,
        ok: false,
      });
      this.opts.onEvent?.({
        type: 'repair',
        stage: call.stage,
        model: call.model,
        detail: problems.slice(0, 3).join('; '),
      });
      messages.push({ role: 'assistant', content: raw.slice(0, 60_000) || '(empty)' } as ModelMessage);
      messages.push({
        role: 'user',
        content: `Your JSON has problems. Fix ALL of them and reply with the complete corrected JSON only:\n- ${problems.join('\n- ')}`,
      } as ModelMessage);
    }
    throw new GenerationError(`${call.name}: still invalid after ${maxRepairs} repairs`, problems, lastRaw);
  }

  /** Plain text (e.g. OCR of a page image). */
  async text(call: {
    stage: string;
    role: Role;
    model: string;
    system: string;
    prompt: string;
    images?: ImagePart[];
    fresh?: boolean;
  }): Promise<string> {
    const key = sha1(
      JSON.stringify([call.model, call.system, call.prompt, (call.images ?? []).map((i) => sha1(i.data))]),
    );
    const cachePath = this.opts.cacheDir ? join(this.opts.cacheDir, `${key}.txt`) : undefined;
    if (cachePath && !call.fresh && existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
    const t0 = Date.now();
    let text: string;
    let inTok = 0;
    let outTok = 0;
    if (this.opts.fake)
      text = await this.opts.fake({
        system: call.system,
        prompt: call.prompt,
        messages: [],
        name: 'text',
        model: call.model,
        attempt: 0,
      });
    else {
      const content = call.images?.length
        ? [
            { type: 'text' as const, text: call.prompt },
            ...call.images.map((im) => ({ type: 'image' as const, image: im.data, mediaType: im.mediaType })),
          ]
        : call.prompt;
      const r = await generateText({
        model: this.model(call.model),
        system: call.system,
        messages: [{ role: 'user', content } as ModelMessage],
        maxRetries: 2,
      });
      text = r.text;
      inTok = r.usage.inputTokens ?? 0;
      outTok = r.usage.outputTokens ?? 0;
    }
    this.log({
      ts: new Date().toISOString(),
      stage: call.stage,
      role: call.role,
      model: call.model,
      input: inTok,
      output: outTok,
      usd: costOf(call.model, inTok, outTok),
      ms: Date.now() - t0,
      ok: true,
    });
    if (cachePath) {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, text);
    }
    return text;
  }
}

/** Ledger totals by stage and model. */
export function ledgerSummary(file: string): {
  total: number;
  byStage: Record<string, number>;
  byModel: Record<string, number>;
  calls: number;
} {
  const out = { total: 0, byStage: {} as Record<string, number>, byModel: {} as Record<string, number>, calls: 0 };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      out.total += e.usd;
      out.calls++;
      out.byStage[e.stage] = (out.byStage[e.stage] ?? 0) + e.usd;
      out.byModel[e.model] = (out.byModel[e.model] ?? 0) + e.usd;
    } catch {
      /* skip */
    }
  }
  return out;
}
