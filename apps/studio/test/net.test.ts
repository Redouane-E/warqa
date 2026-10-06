// Which work waits for the internet while offline: cloud models and online voices do, a book whose models run on
// this computer does not (redesign 4h).
import { describe, expect, it } from 'vitest';
import { needsNet } from '../src/client/net.js';

const book = (models: Record<string, string | undefined>, tts = 'none', langs = ['en', 'fr']) => ({
  roles: Object.fromEntries(Object.entries(models).map(([r, m]) => [r, m ? { model: m } : { error: 'no key' }])),
  config: { tts: { provider: tts } },
  book: { langs },
}) as unknown as Parameters<typeof needsNet>[0];

describe('needs the internet', () => {
  it('cloud models do, models on this computer do not', () => {
    const cloud = book({ planner: 'google:gemini-3.8-flash', storyboard: 'google:x', writer: 'google:x', translator: 'google:x' });
    const local = book({ planner: 'ollama:qwen3:14b', storyboard: 'ollama:qwen3:14b', writer: 'ollama:qwen3:14b', translator: 'ollama:qwen3:14b' });
    for (const type of ['plan', 'build', 'translate', 'rewrite'] as const) {
      expect(needsNet(cloud, type), type).toBe(true);
      expect(needsNet(local, type), type).toBe(false);
    }
    // the test model counts as cloud (the tests see the gate)
    expect(needsNet(book({ writer: 'fake:scripted' }), 'rewrite')).toBe(true);
    // map regions come from their site
    expect(needsNet(local, 'geo')).toBe(true);
  });

  it('counts only the roles the work uses, and the voice when it narrates', () => {
    // one language: no translator; a role with no model stops on its key instead
    const oneLang = book({ storyboard: 'ollama:q', writer: 'ollama:q', translator: 'google:x' }, 'none', ['en']);
    expect(needsNet(oneLang, 'build')).toBe(false);
    expect(needsNet(book({ planner: 'ollama:q', storyboard: 'ollama:q', writer: 'ollama:q', vision: undefined }), 'learn')).toBe(false);
    // narrating with Edge needs Microsoft's service; the local helper or no voice does not
    expect(needsNet(book({}, 'edge'), 'narrate')).toBe(true);
    expect(needsNet(book({}, 'worker'), 'narrate')).toBe(false);
    const localEdge = book({ storyboard: 'ollama:q', writer: 'ollama:q', translator: 'ollama:q' }, 'edge');
    expect(needsNet(localEdge, 'build')).toBe(false);
    expect(needsNet(localEdge, 'build', { narrate: true })).toBe(true);
    // checks without the judge stay on this computer
    expect(needsNet(book({}), 'qa')).toBe(false);
    expect(needsNet(book({ judge: 'google:x' }), 'qa')).toBe(true);
    expect(needsNet(book({}), 'export')).toBe(false);
  });
});
