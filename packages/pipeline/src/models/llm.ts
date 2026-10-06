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
import { classifyModelError, ProviderError, serviceOf } from './errors.js';
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
  /** The call's name ("beat:ch01:b03", "storyboard:ch01", "translate:ch01:fr:0"): costs per chapter. */
  name?: string;
}

/** What a fake model answers: the text, or the text and why it ended ("length": cut off). It may also throw. */
export type FakeReply = string | { text: string; finishReason?: 'length' | 'stop' };

/** Test hook: a fake model that answers prompts without any provider. */
export type FakeModel = (call: {
  system: string;
  prompt: string;
  messages: ModelMessage[];
  name: string;
  model: string;
  attempt: number;
}) => FakeReply | Promise<FakeReply>;

/** The book's spending limit is reached (the numbers say by how much). */
export class BudgetError extends Error {
  constructor(
    readonly spent: number,
    readonly limit: number,
  ) {
    super(`budget reached: $${spent.toFixed(2)} of $${limit.toFixed(2)} (raise pipeline.budget.usd to continue)`);
    this.name = 'BudgetError';
  }
}

/** Waits when a service asks to slow down (429): up to four, three minutes in all, per call. */
const RATE_WAITS = 4;
const RATE_TOTAL_MS = 180_000;
/** Without a hint from the service. */
const RATE_BACKOFF = [5_000, 15_000, 30_000, 60_000];
/** A network error or a 5xx: two quiet retries. */
const NETWORK_BACKOFF = [2_000, 4_000];
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

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
    type: 'call' | 'repair' | 'cached' | 'fallback' | 'wait';
    stage: string;
    model: string;
    detail?: string;
    /** wait: how long (ms). */
    ms?: number;
  }) => void;
  /**
   * How a wait is spent (a job makes it stoppable and ends it early on "Try now"; tests make it instant). Default:
   * a timer.
   */
  wait?: (ms: number, info: { provider: string; reason: 'rate' | 'network' }) => Promise<void>;
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

  /** Stop before a paid call once the book's spending limit is reached (cached answers stay free). */
  private checkBudget(): void {
    if (this.opts.budgetUsd !== undefined && this.spent >= this.opts.budgetUsd)
      throw new BudgetError(this.spent, this.opts.budgetUsd);
  }

  /**
   * One model call with Warqa's own retries (the SDK's are off): a "slow down" waits as long as the service asks
   * (or 5 s, 15 s, 30 s, 60 s), at most four times or three minutes, said through `onEvent('wait')`; a network
   * error or a 5xx is tried again twice, quietly. A refused key, no credit, a daily quota or no network stop at
   * once, as a `ProviderError`.
   */
  private async attempt<T>(model: string, stage: string, fn: () => Promise<T>): Promise<T> {
    const wait = this.opts.wait ?? ((ms: number) => sleep(ms));
    let waits = 0;
    let waited = 0;
    let quiet = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) throw e;
        const f = classifyModelError(e, model);
        if (!f) throw e;
        if (f.kind === 'rate') {
          const ms = f.info.retryAfterMs ?? RATE_BACKOFF[waits] ?? 60_000;
          if (waits >= RATE_WAITS || waited + ms > RATE_TOTAL_MS) throw f;
          waits++;
          waited += ms;
          this.opts.onEvent?.({ type: 'wait', stage, model, ms, detail: f.info.provider });
          await wait(ms, { provider: f.info.provider, reason: 'rate' });
          continue;
        }
        if (f.kind === 'network' && quiet < NETWORK_BACKOFF.length) {
          await wait(NETWORK_BACKOFF[quiet]!, { provider: f.info.provider, reason: 'network' });
          quiet++;
          continue;
        }
        throw f;
      }
    }
  }

  /** The reply was cut off (the model ran out of room): repairing would resend the same request and be cut again. */
  private cut(model: string, name: string): ProviderError {
    return new ProviderError('cut', `${name}: the model's answer was cut off`, { provider: serviceOf(model), model });
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
      this.checkBudget();
      const t0 = Date.now();
      let raw = '';
      let value: unknown;
      let inTok = 0;
      let outTok = 0;
      try {
        if (this.opts.fake) {
          const fake = this.opts.fake;
          const out = await this.attempt(call.model, call.stage, async () =>
            fake({
              system: call.system,
              prompt: call.prompt,
              messages,
              name: call.name,
              model: call.model,
              attempt,
            }),
          );
          raw = typeof out === 'string' ? out : out.text;
          if (typeof out !== 'string' && out.finishReason === 'length') throw this.cut(call.model, call.name);
          value = extractJson(raw);
        } else if (mode === 'native') {
          try {
            const r = await this.attempt(call.model, call.stage, () =>
              generateText({
                model: this.model(call.model),
                system: call.system,
                messages,
                output: Output.object({ schema: call.schema as z.ZodType }),
                ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
                maxRetries: 0,
              }),
            );
            inTok = r.usage.inputTokens ?? 0;
            outTok = r.usage.outputTokens ?? 0;
            // an answer that ended at the length limit but parsed whole is kept; one that did not parse comes as
            // a NoObjectGeneratedError, below
            value = r.output;
            raw = JSON.stringify(value);
          } catch (e) {
            if (NoObjectGeneratedError.isInstance(e)) {
              raw = e.text ?? '';
              inTok = e.usage?.inputTokens ?? 0;
              outTok = e.usage?.outputTokens ?? 0;
              if (e.finishReason === 'length') throw this.cut(call.model, call.name);
              value = extractJson(raw);
            } else if (e instanceof ProviderError) throw e;
            else if (
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
          const r = await this.attempt(call.model, call.stage, () =>
            generateText({
              model: this.model(call.model),
              system: call.system,
              messages: msgs,
              maxRetries: 0,
              ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
            }),
          );
          inTok = r.usage.inputTokens ?? 0;
          outTok = r.usage.outputTokens ?? 0;
          if (r.finishReason === 'length') throw this.cut(call.model, call.name);
          raw = r.text;
          value = extractJson(raw);
        }
      } catch (e) {
        if (!(e instanceof ProviderError) && (e instanceof SyntaxError || /JSON/i.test(String((e as Error).message)))) {
          problems = [`the reply was not valid JSON (${(e as Error).message.slice(0, 120)})`];
        } else {
          this.log({
            ts: new Date().toISOString(),
            stage: call.stage,
            name: call.name,
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
              name: call.name,
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
        name: call.name,
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
    this.checkBudget();
    const t0 = Date.now();
    let text: string;
    let inTok = 0;
    let outTok = 0;
    if (this.opts.fake) {
      const fake = this.opts.fake;
      const out = await this.attempt(call.model, call.stage, async () =>
        fake({
          system: call.system,
          prompt: call.prompt,
          messages: [],
          name: 'text',
          model: call.model,
          attempt: 0,
        }),
      );
      text = typeof out === 'string' ? out : out.text;
      if (typeof out !== 'string' && out.finishReason === 'length') throw this.cut(call.model, 'text');
    } else {
      const content = call.images?.length
        ? [
            { type: 'text' as const, text: call.prompt },
            ...call.images.map((im) => ({ type: 'image' as const, image: im.data, mediaType: im.mediaType })),
          ]
        : call.prompt;
      const r = await this.attempt(call.model, call.stage, () =>
        generateText({
          model: this.model(call.model),
          system: call.system,
          messages: [{ role: 'user', content } as ModelMessage],
          maxRetries: 0,
        }),
      );
      text = r.text;
      inTok = r.usage.inputTokens ?? 0;
      outTok = r.usage.outputTokens ?? 0;
      if (r.finishReason === 'length') {
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
        throw this.cut(call.model, 'text');
      }
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
  /** What making each chapter cost (storyboard, beats, translation), from the calls' names. */
  byChapter: Record<string, number>;
  calls: number;
} {
  const out = {
    total: 0,
    byStage: {} as Record<string, number>,
    byModel: {} as Record<string, number>,
    byChapter: {} as Record<string, number>,
    calls: 0,
  };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LedgerEntry;
      out.total += e.usd;
      out.calls++;
      out.byStage[e.stage] = (out.byStage[e.stage] ?? 0) + e.usd;
      out.byModel[e.model] = (out.byModel[e.model] ?? 0) + e.usd;
      const ch = /^(?:storyboard|beat|beat-lite|translate):([^:]+)/.exec(e.name ?? '')?.[1];
      if (ch) out.byChapter[ch] = (out.byChapter[ch] ?? 0) + e.usd;
    } catch {
      /* skip */
    }
  }
  return out;
}
