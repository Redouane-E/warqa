// Model failures a person can act on, and Warqa's own waits (no network: a scripted model that throws the AI SDK's
// errors as a provider would answer).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyModelError, nextMidnightIn, ProviderError, retryAfterMs } from './errors.js';
import { BudgetError, type FakeModel, Llm } from './llm.js';

const answer = (status: number, body = '', headers: Record<string, string> = {}) =>
  new APICallError({
    message: `HTTP ${status}`,
    url: 'https://example.invalid/v1',
    requestBodyValues: {},
    statusCode: status,
    responseHeaders: headers,
    responseBody: body,
  });
const kind = (e: unknown, model = 'google:gemini-3.8-flash') => classifyModelError(e, model)?.kind;

describe('what a failed call means', () => {
  it('tells a refused key, no credit, a slow-down, a daily quota and no network apart', () => {
    expect(kind(answer(401))).toBe('key');
    expect(kind(answer(403))).toBe('key');
    expect(kind(answer(400, '{"error":{"message":"API key not valid"}}'))).toBe('key');
    expect(kind(answer(402))).toBe('credits');
    expect(kind(answer(429, '{"error":{"code":"insufficient_quota"}}'), 'openai:gpt-6-luna')).toBe('credits');
    expect(kind(answer(429))).toBe('rate');
    expect(kind(answer(503))).toBe('network');
    expect(kind(answer(400, 'bad request'))).toBeUndefined();
    expect(kind(new TypeError('fetch failed'))).toBe('network');
    expect(kind(new Error('a bug'))).toBeUndefined();
    // real answers of other services
    const anthropic = 'anthropic:claude-sonnet-5-5';
    expect(
      kind(
        answer(400, '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'),
        anthropic,
      ),
    ).toBe('credits');
    expect(kind(answer(403, "Your team doesn't have any credits yet."), 'xai:grok-4.7')).toBe('credits');
    expect(
      kind(answer(403, '{"error":{"message":"Input was flagged by moderation"}}'), 'openrouter:x'),
    ).toBeUndefined();
    expect(kind(answer(403, 'unsupported_country_region_territory'), 'openai:gpt-6-luna')).toBeUndefined();
    expect(kind(answer(529, '{"type":"overloaded_error"}'), anthropic)).toBe('rate');
    expect(kind(new TypeError('Load failed'))).toBe('network');
    // a rolling daily limit that says when to try again is a slow-down
    const rpd = classifyModelError(
      answer(429, 'Rate limit reached for requests per day (RPD). Please try again in 8.6s.'),
      'openai:gpt-6-luna',
    );
    expect(rpd).toMatchObject({ kind: 'rate', info: { retryAfterMs: 8600 } });
    const quota = classifyModelError(
      answer(
        429,
        '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
      ),
      'google:gemini-3.8-flash',
      Date.UTC(2026, 9, 6, 12, 0, 0),
    );
    expect(quota?.kind).toBe('quota');
    // Pacific midnight after noon UTC on 6 October 2026 (PDT, UTC−7) is 07:00 UTC on 7 October
    expect(quota?.info.resetAt).toBe(Date.UTC(2026, 9, 7, 7, 0, 0));
  });

  it('reads how long to wait from the answer', () => {
    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    expect(retryAfterMs({ 'Retry-After': '3' }, '', now)).toBe(3000);
    expect(retryAfterMs({ 'retry-after-ms': '1500' }, '', now)).toBe(1500);
    expect(retryAfterMs({ 'retry-after': new Date(now + 9000).toUTCString() }, '', now)).toBe(9000);
    expect(retryAfterMs({}, '{"details":[{"@type":"RetryInfo","retryDelay":"23s"}]}', now)).toBe(23000);
    expect(retryAfterMs({}, '', now)).toBeUndefined();
    expect(classifyModelError(answer(429, '', { 'retry-after': '3' }), 'groq:x')?.info).toMatchObject({
      provider: 'groq',
      retryAfterMs: 3000,
    });
    expect(nextMidnightIn('UTC', Date.UTC(2026, 0, 31, 23, 59))).toBe(Date.UTC(2026, 1, 1));
  });
});

describe('waits and stops', () => {
  const schema = z.object({ ok: z.boolean() });
  const ask = (llm: Llm) =>
    llm.structured({
      stage: 'plan',
      role: 'planner',
      model: 'google:gemini-3.8-flash',
      name: 'plan',
      system: '',
      prompt: 'x',
      schema,
    });

  it('waits as long as the service asks, then goes on', async () => {
    const waits: number[] = [];
    const events: string[] = [];
    let calls = 0;
    const fake: FakeModel = () => {
      calls++;
      if (calls === 1) throw answer(429, '', { 'retry-after': '3' });
      return '{"ok":true}';
    };
    const llm = new Llm({
      fake,
      wait: async (ms) => {
        waits.push(ms);
      },
      onEvent: (e) => events.push(`${e.type}:${e.ms ?? ''}`),
    });
    expect((await ask(llm)).value).toEqual({ ok: true });
    expect(waits).toEqual([3000]);
    expect(events).toContain('wait:3000');
  });

  it('stops after four waits, and at once on a refused key, a daily quota or a cut-off answer', async () => {
    const waits: number[] = [];
    const busy = new Llm({ fake: () => Promise.reject(answer(429)), wait: async (ms) => void waits.push(ms) });
    await expect(ask(busy)).rejects.toMatchObject({ kind: 'rate' });
    expect(waits).toEqual([5000, 15000, 30000, 60000]);
    const refused = new Llm({ fake: () => Promise.reject(answer(401)), wait: async () => void waits.push(-1) });
    await expect(ask(refused)).rejects.toBeInstanceOf(ProviderError);
    await expect(ask(refused)).rejects.toMatchObject({ kind: 'key', info: { provider: 'google', status: 401 } });
    const quota = new Llm({ fake: () => Promise.reject(answer(429, 'PerDay')), wait: async () => void waits.push(-1) });
    await expect(ask(quota)).rejects.toMatchObject({ kind: 'quota' });
    let calls = 0;
    const cut = new Llm({
      fake: () => {
        calls++;
        return { text: '{"ok":tr', finishReason: 'length' };
      },
    });
    await expect(ask(cut)).rejects.toMatchObject({ kind: 'cut' });
    // a cut-off answer is not repaired (it would be cut again)
    expect(calls).toBe(1);
    // the cut answer is logged once (it was paid for)
    const dir = mkdtempSync(join(tmpdir(), 'warqa-cut-'));
    const ledger = join(dir, 'ledger.jsonl');
    const once = new Llm({ fake: () => ({ text: '{"ok":', finishReason: 'length' }), ledger });
    await expect(ask(once)).rejects.toMatchObject({ kind: 'cut' });
    expect(readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(waits.filter((w) => w === -1)).toEqual([]);
  });

  it('says how much was spent when the limit is reached', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'warqa-budget-'));
    const ledger = join(dir, 'ledger.jsonl');
    writeFileSync(ledger, `${JSON.stringify({ usd: 1 })}\n`);
    const llm = new Llm({ fake: () => '{"ok":true}', ledger, budgetUsd: 1 });
    const e = await ask(llm).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BudgetError);
    expect(e).toMatchObject({ spent: 1, limit: 1 });
  });
});
