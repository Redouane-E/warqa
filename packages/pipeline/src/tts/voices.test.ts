// The voice catalog (a voice and a sample sentence for every book language) and the model sets' chapter prices.
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../models/presets.js';
import { estimateSetChapter, setPricing } from '../stages/build.js';
import { TTS_IDS, ttsProvider } from './providers.js';
import { SAMPLE_TEXT, sampleCost, sampleText, VOICES, voicesFor } from './voices.js';

describe('voices', () => {
  it('has a default voice and a sample sentence for every book language', () => {
    for (const lang of ['ar', 'ary', 'fr', 'en']) {
      expect(SAMPLE_TEXT[lang]).toBeTruthy();
      for (const id of TTS_IDS) {
        if (id === 'none') continue;
        expect(ttsProvider(id, { worker: 'http://localhost:8790' }).defaultVoice(lang), `${id} ${lang}`).toBeTruthy();
      }
    }
    expect(sampleText('ar-MA')).toBe(SAMPLE_TEXT.ar);
    expect(sampleText('xx')).toBeUndefined();
  });

  it('lists the voices of an engine for a language, Darija with the Moroccan ones', () => {
    expect(voicesFor('edge', 'ary').map((v) => v.id)).toContain('ar-MA-MounaNeural');
    expect(voicesFor('edge', 'fr').every((v) => v.id.startsWith('fr-'))).toBe(true);
    expect(voicesFor('gemini', 'ar').length).toBe(VOICES.gemini!.length);
    // each engine's default voice is one of its listed voices, when it lists any
    for (const [engine, list] of Object.entries(VOICES))
      if (list.length)
        for (const lang of ['ar', 'fr', 'en'])
          expect(
            list.map((v) => v.id),
            `${engine} ${lang}`,
          ).toContain(ttsProvider(engine).defaultVoice(lang));
  });

  it('says what a sample costs: nothing with the free engines', () => {
    expect(sampleCost('edge', 'ar')).toBe(0);
    expect(sampleCost('worker', 'ar')).toBe(0);
    expect(sampleCost('gemini', 'en')).toBeGreaterThan(0);
    expect(sampleCost('gemini', 'en')).toBeLessThan(0.001);
  });
});

describe('model set prices', () => {
  it('prices one chapter per set with the book estimate’s formula', () => {
    const usd = Object.fromEntries(PRESETS.map((p) => [p.id, estimateSetChapter({ preset: p.id })]));
    expect(usd.best).toBeGreaterThan(usd.budget!);
    expect(usd.budget).toBeGreaterThan(0);
    expect(usd.local).toBe(0);
    // a role changed by hand changes the price
    expect(estimateSetChapter({ preset: 'best', models: { writer: 'deepseek:deepseek-v4-flash' } })).toBeLessThan(
      usd.best!,
    );
    // a one-language book needs no translator
    expect(estimateSetChapter({ preset: 'best' }, { langs: 1 })).toBeLessThan(usd.best!);
    expect(setPricing('google')).toBe('free-tier');
    expect(setPricing('local')).toBe('free');
    expect(setPricing('openrouter')).toBe('prepaid');
    expect(setPricing('best')).toBe('paid');
  });
});
