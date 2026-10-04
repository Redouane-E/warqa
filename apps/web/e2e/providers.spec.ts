// Can a web page call each model provider directly (CORS)? Opt-in, because it uses the network:
//   WARQA_CORS_CHECK=1 pnpm --filter @warqa/web e2e providers
// With a dummy key (never a real one), a provider that allows browser calls answers with a readable "invalid key"
// error; one that does not is blocked by the browser ("Failed to fetch"). Both paths are checked: the free key
// check of the start guide, and a real model call through the AI SDK (a translation job).
import { expect, test } from '@playwright/test';
import { openStudio } from './helpers';

const DUMMY = 'warqa-dummy-key-not-real-0000';
const NETWORK = /Failed to fetch|NetworkError|Load failed|Cannot connect|fetch failed/i;

const PROVIDERS: { id: string; env: string; model: string }[] = [
  { id: 'google', env: 'GEMINI_API_KEY', model: 'google:gemini-flash-lite-latest' },
  { id: 'openrouter', env: 'OPENROUTER_API_KEY', model: 'openrouter:qwen/qwen3.8-flash' },
  { id: 'deepseek', env: 'DEEPSEEK_API_KEY', model: 'deepseek:deepseek-v4-flash' },
  { id: 'anthropic', env: 'ANTHROPIC_API_KEY', model: 'anthropic:claude-haiku-4-5' },
  { id: 'openai', env: 'OPENAI_API_KEY', model: 'openai:gpt-6-luna' },
  { id: 'mistral', env: 'MISTRAL_API_KEY', model: 'mistral:mistral-small-latest' },
  { id: 'groq', env: 'GROQ_API_KEY', model: 'groq:qwen/qwen3.8-27b' },
  { id: 'xai', env: 'XAI_API_KEY', model: 'xai:grok-4.7' },
];

test.skip(!process.env.WARQA_CORS_CHECK, 'network check: set WARQA_CORS_CHECK=1');
test.describe.configure({ mode: 'serial' });

test('every listed provider accepts calls from a web page', async ({ page }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await page.evaluate(() => fetch('/warqa/api/web/demo', { method: 'POST' }));
  const report: Record<string, { check: unknown; call: string }> = {};
  for (const p of PROVIDERS) {
    const r = await page.evaluate(
      async ({ p, key }) => {
        const json = (method: string, url: string, body?: unknown) =>
          fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }).then((x) => x.json());
        const check = await json('POST', '/warqa/api/web/check-key', { provider: p.id, key });
        await json('PUT', '/warqa/api/keys', { [p.env]: key });
        await json('PUT', '/warqa/api/projects/integers/settings', { models: { translator: p.model } });
        const { jobId } = await json('POST', '/warqa/api/projects/integers/jobs', {
          type: 'translate',
          args: { lang: 'es', force: true },
        });
        for (let i = 0; i < 120; i++) {
          const { job } = await json('GET', `/warqa/api/jobs/${jobId}`);
          if (['done', 'error', 'cancelled'].includes(job.status)) {
            await json('PUT', '/warqa/api/keys', { [p.env]: null });
            return { check, call: String(job.error ?? job.status) };
          }
          await new Promise((ok) => setTimeout(ok, 500));
        }
        return { check, call: 'timeout' };
      },
      { p, key: DUMMY },
    );
    report[p.id] = r;
  }
  console.log(JSON.stringify(report, null, 2));
  for (const [id, r] of Object.entries(report)) {
    expect.soft(r.check, `${id}: key check`).toMatchObject({ ok: false, reason: 'key' });
    expect.soft(r.call, `${id}: model call`).not.toMatch(NETWORK);
    expect.soft(r.call, `${id}: model call`).toMatch(/unauthori[sz]ed|invalid|api key|authentication|incorrect|APICallError/i);
  }
});

const VOICES: { id: string; keys: Record<string, string> }[] = [
  { id: 'openai', keys: { OPENAI_API_KEY: DUMMY } },
  { id: 'elevenlabs', keys: { ELEVENLABS_API_KEY: DUMMY } },
  { id: 'google', keys: { GOOGLE_TTS_API_KEY: DUMMY } },
  { id: 'gemini', keys: { GEMINI_API_KEY: DUMMY } },
  { id: 'azure', keys: { AZURE_SPEECH_KEY: DUMMY, AZURE_SPEECH_REGION: 'westeurope' } },
];

test('every online voice accepts calls from a web page', async ({ page }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await page.evaluate(() => fetch('/warqa/api/web/demo', { method: 'POST' }));
  const report: Record<string, string> = {};
  for (const v of VOICES) {
    report[v.id] = await page.evaluate(async (v) => {
      const json = (method: string, url: string, body?: unknown) =>
        fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }).then((x) => x.json());
      await json('PUT', '/warqa/api/keys', v.keys);
      await json('PUT', '/warqa/api/projects/integers/settings', { tts: { provider: v.id, voices: {} } });
      const { jobId } = await json('POST', '/warqa/api/projects/integers/jobs', {
        type: 'narrate',
        args: { lang: 'en', chapters: ['ch05'], force: true },
      });
      for (let i = 0; i < 120; i++) {
        const { job, events } = await json('GET', `/warqa/api/jobs/${jobId}`);
        if (['done', 'error', 'cancelled'].includes(job.status)) {
          await json('PUT', '/warqa/api/keys', Object.fromEntries(Object.keys(v.keys).map((k) => [k, null])));
          const err = (events as { kind: string; level?: string; message?: string; error?: string }[]).find(
            (e) => e.level === 'error' || e.kind === 'error',
          );
          return String(err?.message ?? err?.error ?? job.error ?? job.status);
        }
        await new Promise((ok) => setTimeout(ok, 500));
      }
      return 'timeout';
    }, v);
  }
  console.log(JSON.stringify(report, null, 2));
  for (const [id, call] of Object.entries(report)) {
    expect.soft(call, `${id}: speech call`).not.toMatch(NETWORK);
    expect.soft(call, `${id}: speech call`).toMatch(/HTTP 40[0-3]/);
  }
});

test('map regions download from geoBoundaries in the browser', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await page.evaluate(() => fetch('/warqa/api/web/demo', { method: 'POST' }));
  await page.goto('project/integers/settings#maps');
  await page.getByLabel('Country code (3 letters)').fill('mar');
  await page.getByRole('button', { name: 'Add the regions of a country' }).click();
  await expect(page.getByText(/Added MAR-ADM1: 12 regions/)).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.layer-list')).toContainText('MAR-ADM1');
  await expect(page.locator('.layer-list')).toContainText('OpenStreetMap');
});
