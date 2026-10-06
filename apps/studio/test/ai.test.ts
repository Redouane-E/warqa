// AI and voices (redesign 4g): the defaults new books start with, the prices and voices the page shows, voice
// samples (a scripted engine: no network, no cost) and the local model server probe (a stubbed fetch).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as P from '@warqa/pipeline';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { AiDefaults, ProjectDetail, StatusInfo, VoiceSample } from '../src/shared/types.js';

let root: string;
let home: string;
let app: ReturnType<typeof createApp>['app'];
let synths = 0;

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
/** A speech engine that reads anything as a few bytes of "audio", counting its calls. */
const scripted = (id: string): P.TtsProvider => ({
  id,
  wordTimes: false,
  costPerMChars: id === 'gemini' ? 10 : 0,
  defaultVoice: () => (id === 'gemini' ? 'Kore' : 'ar-MA-MounaNeural'),
  synth: async () => {
    synths++;
    return { audio: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]), ext: 'wav' };
  },
});

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'warqa-ai-test-'));
  home = mkdtempSync(join(tmpdir(), 'warqa-ai-home-'));
  process.env.WARQA_HOME = home;
  ({ app } = createApp({ root, tts: scripted, capabilities: { ttsUnavailable: ['edge'] }, defaultTts: 'none' }));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const get = async <T>(path: string): Promise<T> => (await (await app.request(path)).json()) as T;

describe('defaults for new books', () => {
  it('keeps the model set, models and voices, refusing what is wrong, and never a key', async () => {
    expect(await get<AiDefaults>('/api/defaults')).toMatchObject({ models: {}, tts: { voices: {} } });
    const put = await app.request(
      '/api/defaults',
      json('PUT', {
        preset: 'budget',
        models: { writer: 'deepseek:deepseek-v4-pro' },
        tts: { provider: 'gemini', voices: { ar: 'Charon' }, rate: '-4%' },
      }),
    );
    expect(put.status).toBe(200);
    const d = await get<AiDefaults>('/api/defaults');
    expect(d).toMatchObject({ preset: 'budget', models: { writer: 'deepseek:deepseek-v4-pro' } });
    expect(d.tts).toMatchObject({ provider: 'gemini', voices: { ar: 'Charon' }, rate: '-4%' });
    expect(existsSync(join(home, 'defaults.json'))).toBe(true);
    expect(readFileSync(join(home, 'defaults.json'), 'utf8')).not.toMatch(/API_KEY/);
    for (const bad of [
      { preset: 'nope' },
      { models: { painter: 'openai:x' } },
      { models: { writer: 'no-colon' } },
      { tts: { provider: 'nope' } },
      { tts: { rate: 'fast' } },
      { tts: { voices: { ar: 'Mouna"/><break' } } },
      { worker: 'ftp://x' },
    ])
      expect((await app.request('/api/defaults', json('PUT', bad))).status, JSON.stringify(bad)).toBe(400);
    // another site's page cannot change them
    expect((await app.request('/api/defaults', json('PUT', { preset: 'best' }, { origin: 'https://evil.example' }))).status).toBe(403);
    // null clears
    expect((await app.request('/api/defaults', json('PUT', { preset: null }))).status).toBe(200);
    expect((await get<AiDefaults>('/api/defaults')).preset).toBeUndefined();
    await app.request('/api/defaults', json('PUT', { preset: 'budget' }));
  });

  it('gives them to a new book; an engine this host cannot run falls back to its own', async () => {
    const make = async (title: string) => {
      const form = new FormData();
      form.set('title', title);
      form.set('langs', 'ar,fr');
      form.set('defaultLang', 'ar');
      const res = await app.request('/api/projects', { method: 'POST', body: form });
      expect(res.status).toBe(201);
      return get<ProjectDetail>(`/api/projects/${((await res.json()) as { id: string }).id}`);
    };
    const a = await make('First');
    expect(a.config).toMatchObject({ preset: 'budget', models: { writer: 'deepseek:deepseek-v4-pro' } });
    expect(a.config.tts).toMatchObject({ provider: 'gemini', voices: { ar: 'Charon' }, rate: '-4%' });
    await app.request('/api/defaults', json('PUT', { tts: { provider: 'edge', voices: { ar: 'ar-MA-JamalNeural' } } }));
    const b = await make('Second');
    expect(b.config.tts.provider).toBe('none');
    expect(b.config.tts.voices).toEqual({});
  });

  it('gives a new book the voices chosen for the host’s engine when no engine was chosen', async () => {
    const { app: host } = createApp({ root, tts: scripted, defaultTts: 'gemini' });
    const home2 = mkdtempSync(join(tmpdir(), 'warqa-ai-home2-'));
    const before = process.env.WARQA_HOME;
    process.env.WARQA_HOME = home2;
    try {
      await host.request('/api/defaults', json('PUT', { tts: { voices: { ar: 'Charon' }, rate: '-6%' } }));
      const form = new FormData();
      form.set('title', 'Host engine');
      form.set('langs', 'ar');
      form.set('defaultLang', 'ar');
      const res = await host.request('/api/projects', { method: 'POST', body: form });
      const id = ((await res.json()) as { id: string }).id;
      const p = (await (await host.request(`/api/projects/${id}`)).json()) as ProjectDetail;
      expect(p.config.tts).toMatchObject({ provider: 'gemini', voices: { ar: 'Charon' }, rate: '-6%' });
    } finally {
      process.env.WARQA_HOME = before;
      rmSync(home2, { recursive: true, force: true });
    }
  });
});

describe('status', () => {
  it('prices each model set for one chapter and lists each engine’s voices', async () => {
    const s = await get<StatusInfo>('/api/status');
    const best = s.presets.find((p) => p.id === 'best')!;
    const budget = s.presets.find((p) => p.id === 'budget')!;
    expect(best.chapterUsd).toBeGreaterThan(budget.chapterUsd!);
    expect(s.presets.find((p) => p.id === 'local')).toMatchObject({ chapterUsd: 0, pricing: 'free' });
    expect(s.presets.find((p) => p.id === 'google')?.pricing).toBe('free-tier');
    const edge = s.tts.find((t) => t.id === 'edge')!;
    expect(edge).toMatchObject({ free: true, keyReady: true });
    expect(edge.voices.ary).toBe('ar-MA-JamalNeural');
    expect(edge.catalog?.some((v) => v.id === 'ar-MA-MounaNeural')).toBe(true);
    expect(s.tts.find((t) => t.id === 'gemini')?.sampleUsd).toBeGreaterThan(0);
    expect(Object.keys(s.sampleText ?? {})).toEqual(['ar', 'ary', 'fr', 'en']);
  });
});

describe('voice samples', () => {
  it('reads the fixed sentence once, then plays it again for free', async () => {
    synths = 0;
    const body = { engine: 'gemini', voice: 'Kore', lang: 'ar', rate: '-4%', text: 'Say something else' };
    const first = (await (await app.request('/api/voices/sample', json('POST', body))).json()) as VoiceSample;
    expect(first.cached).toBe(false);
    expect(first.usd).toBeGreaterThan(0);
    expect(first.url).toMatch(/^\/api\/voices\/samples\/[0-9a-f]{40}\.wav$/);
    const again = (await (await app.request('/api/voices/sample', json('POST', body))).json()) as VoiceSample;
    expect(again).toMatchObject({ cached: true, usd: 0, url: first.url });
    expect(synths).toBe(1);
    const audio = await app.request(first.url);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toMatch(/audio\/(wav|x-wav|wave)/);
    // another voice is another sample
    await app.request('/api/voices/sample', json('POST', { ...body, voice: 'Puck' }));
    expect(synths).toBe(2);
  });

  it('refuses what it cannot or should not read', async () => {
    const post = (b: unknown, headers: Record<string, string> = {}) =>
      app.request('/api/voices/sample', json('POST', b, headers));
    expect((await post({ engine: 'edge', lang: 'ar' })).status).toBe(409);
    expect((await post({ engine: 'none', lang: 'ar' })).status).toBe(400);
    expect((await post({ engine: 'nope', lang: 'ar' })).status).toBe(400);
    expect((await post({ engine: 'gemini', lang: 'xx' })).status).toBe(400);
    expect((await post({ engine: 'gemini', lang: 'ar', voice: 'Kore"/>' })).status).toBe(400);
    expect((await post({ engine: 'gemini', lang: 'ar' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await app.request('/api/voices/samples/..%2Fdefaults.json')).status).toBe(404);
  });

  it('says when an engine’s key is missing', async () => {
    const { app: real } = createApp({ root, capabilities: { ttsUnavailable: [] } });
    const saved = { g: process.env.GEMINI_API_KEY, gg: process.env.GOOGLE_GENERATIVE_AI_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    try {
      const res = await real.request('/api/voices/sample', json('POST', { engine: 'gemini', voice: 'Charon', lang: 'fr' }));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'key' });
    } finally {
      if (saved.g) process.env.GEMINI_API_KEY = saved.g;
      if (saved.gg) process.env.GOOGLE_GENERATIVE_AI_API_KEY = saved.gg;
    }
  });
});

describe('keys', () => {
  it('puts back a key removed with Undo, but not after Forget all, and never over a newer key', async () => {
    const put = (body: unknown, undo = false) =>
      app.request(undo ? '/api/keys?undo=1' : '/api/keys', json('PUT', body));
    const masked = async () =>
      ((await get<{ keys: { name: string; masked?: string }[] }>('/api/keys')).keys.find(
        (k) => k.name === 'WARQA_PROBE_KEY',
      )?.masked ?? '');
    const restore = async () =>
      ((await (await app.request('/api/keys/restore', json('POST', { names: ['WARQA_PROBE_KEY'] }))).json()) as {
        restored: string[];
      }).restored;
    await put({ WARQA_PROBE_KEY: 'probe-value-00000000aaaa' });
    await put({ WARQA_PROBE_KEY: null }, true);
    expect(await masked()).toBe('');
    expect(await restore()).toEqual(['WARQA_PROBE_KEY']);
    expect(await masked()).toBe('••••aaaa');
    // Forget all: gone for good
    await put({ WARQA_PROBE_KEY: null });
    expect(await restore()).toEqual([]);
    // removed, then a new key: the old Undo does not bring the old value back
    await put({ WARQA_PROBE_KEY: 'probe-value-00000000bbbb' });
    await put({ WARQA_PROBE_KEY: null }, true);
    await put({ WARQA_PROBE_KEY: 'probe-value-00000000cccc' });
    expect(await restore()).toEqual([]);
    expect(await masked()).toBe('••••cccc');
    await put({ WARQA_PROBE_KEY: null });
  });
});

describe('local model server', () => {
  it('lists the models Ollama has (free), or says it is not there', async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).endsWith('/tags')
        ? new Response(JSON.stringify({ models: [{ name: 'qwen3:14b' }, { name: 'qwen2.5vl:7b' }] }))
        : new Response('no', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const r = await get<{ ok: boolean; base: string; models: string[] }>('/api/keys/local?provider=ollama');
      expect(r).toMatchObject({ ok: true, models: ['qwen3:14b', 'qwen2.5vl:7b'] });
      const check = await app.request(
        '/api/keys/check',
        json('POST', { provider: 'ollama', key: 'http://localhost:11434/api' }),
      );
      expect(await check.json()).toMatchObject({ ok: true, models: ['qwen3:14b', 'qwen2.5vl:7b'] });
      // a server of your own: its address and its key
      const own = await app.request(
        '/api/keys/check',
        json('POST', { provider: 'compat', key: 'http://localhost:1234/v1', secret: 'sk-local' }),
      );
      expect((await own.json()) as { ok: boolean }).toMatchObject({ ok: false, reason: 'http', status: 404 });
      expect(fetchMock).toHaveBeenLastCalledWith(
        'http://localhost:1234/v1/models',
        expect.objectContaining({ headers: { authorization: 'Bearer sk-local' } }),
      );
      vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('connection refused'))));
      expect(await get('/api/keys/local?provider=ollama')).toMatchObject({ ok: false, models: [] });
      expect((await app.request('/api/keys/local?provider=openai')).status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
