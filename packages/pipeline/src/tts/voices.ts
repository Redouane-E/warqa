// The voices each speech engine offers, for choosing one in the studio, and the one sentence a sample reads in each
// language (a fixed sentence: the sample endpoint is not a general speech proxy). Curated and offline: no engine is
// asked for its list. Engines without a list here (ElevenLabs, the local helper) take their default or a typed name.
import { ttsProvider } from './providers.js';

export interface VoiceInfo {
  /** The engine's own id for the voice ("ar-MA-MounaNeural", "Kore", "alloy"). */
  id: string;
  /** Languages it speaks (base codes), or every language. */
  langs: string[] | 'all';
  /** A one-word style, for engines that describe their voices that way (a key the studio translates). */
  style?: string;
}

/** Microsoft's neural voices: the same names in Edge's read-aloud (free, desktop) and Azure Speech. */
const MICROSOFT: VoiceInfo[] = [
  { id: 'ar-MA-MounaNeural', langs: ['ar', 'ary'] },
  { id: 'ar-MA-JamalNeural', langs: ['ar', 'ary'] },
  { id: 'ar-SA-HamedNeural', langs: ['ar'] },
  { id: 'ar-SA-ZariyahNeural', langs: ['ar'] },
  { id: 'ar-EG-SalmaNeural', langs: ['ar'] },
  { id: 'ar-EG-ShakirNeural', langs: ['ar'] },
  { id: 'fr-FR-DeniseNeural', langs: ['fr'] },
  { id: 'fr-FR-HenriNeural', langs: ['fr'] },
  { id: 'fr-FR-VivienneMultilingualNeural', langs: ['fr'] },
  { id: 'fr-FR-RemyMultilingualNeural', langs: ['fr'] },
  { id: 'en-US-AriaNeural', langs: ['en'] },
  { id: 'en-US-AndrewMultilingualNeural', langs: ['en'] },
  { id: 'en-US-AvaMultilingualNeural', langs: ['en'] },
  { id: 'en-GB-SoniaNeural', langs: ['en'] },
  { id: 'en-GB-RyanNeural', langs: ['en'] },
];

export const VOICES: Record<string, VoiceInfo[]> = {
  edge: MICROSOFT,
  // Azure's Andrew is the plain neural voice (its multilingual one has another name there)
  azure: MICROSOFT.map((v) => (v.id === 'en-US-AndrewMultilingualNeural' ? { ...v, id: 'en-US-AndrewNeural' } : v)),
  // Gemini's prebuilt voices speak every language; Google describes each with one word
  gemini: [
    { id: 'Kore', langs: 'all', style: 'firm' },
    { id: 'Charon', langs: 'all', style: 'informative' },
    { id: 'Puck', langs: 'all', style: 'upbeat' },
    { id: 'Aoede', langs: 'all', style: 'breezy' },
    { id: 'Leda', langs: 'all', style: 'youthful' },
    { id: 'Zephyr', langs: 'all', style: 'bright' },
    { id: 'Sulafat', langs: 'all', style: 'warm' },
    { id: 'Achernar', langs: 'all', style: 'soft' },
    { id: 'Iapetus', langs: 'all', style: 'clear' },
    { id: 'Vindemiatrix', langs: 'all', style: 'gentle' },
  ],
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map(
    (id) => ({ id, langs: 'all' as const }),
  ),
  google: [
    { id: 'ar-XA-Wavenet-A', langs: ['ar', 'ary'] },
    { id: 'ar-XA-Wavenet-B', langs: ['ar', 'ary'] },
    { id: 'ar-XA-Wavenet-C', langs: ['ar', 'ary'] },
    { id: 'fr-FR-Wavenet-C', langs: ['fr'] },
    { id: 'fr-FR-Wavenet-D', langs: ['fr'] },
    { id: 'en-US-Wavenet-D', langs: ['en'] },
    { id: 'en-US-Wavenet-F', langs: ['en'] },
  ],
  elevenlabs: [],
  worker: [],
  none: [],
};

/** The sentence a sample reads, per language (the Models board's; Darija in its own words). */
export const SAMPLE_TEXT: Record<string, string> = {
  ar: 'طرح عدد يعني إضافة مقابله.',
  ary: 'الطرح هو نزيدو المقابل ديال العدد.',
  fr: 'Soustraire, c’est ajouter l’opposé.',
  en: 'Subtracting is adding the opposite.',
};

/** The sentence for a language ("ar-MA" reads the Arabic one), if there is one. */
export const sampleText = (lang: string): string | undefined => SAMPLE_TEXT[lang] ?? SAMPLE_TEXT[lang.split('-')[0]!];

/** The voices of an engine that speak a language (its base code; Darija also takes the Arabic ones). */
export function voicesFor(engine: string, lang: string): VoiceInfo[] {
  const base = lang.split('-')[0]!;
  return (VOICES[engine] ?? []).filter((v) => v.langs === 'all' || v.langs.includes(base));
}

/** What one sample costs with an engine (USD; 0 for the free ones). */
export function sampleCost(engine: string, lang: string): number {
  let per = 0;
  try {
    per = ttsProvider(engine, { worker: 'http://localhost' }).costPerMChars ?? 0;
  } catch {
    per = 0;
  }
  return ((sampleText(lang) ?? SAMPLE_TEXT.en!).length * per) / 1e6;
}
