export interface WordTime {
  /** Seconds from the start of the clip. */
  t: number;
  text: string;
}

export interface SynthResult {
  audio: Uint8Array;
  ext: 'mp3' | 'wav';
  /** Word start times, when the engine reports them. */
  words?: WordTime[];
  /** Exact sentence start/end times, when known (e.g. per-sentence synthesis). */
  sentences?: { start: number; end: number }[];
  /** Clip length in seconds, when known. */
  dur?: number;
}

export interface SynthOptions {
  voice: string;
  lang: string;
  /** Speaking rate, e.g. "-4%" or "+10%". */
  rate?: string;
}

export interface TtsProvider {
  id: string;
  /** Does it report word times by itself? (Otherwise sentence-level synthesis or alignment is used.) */
  wordTimes: boolean;
  /** Default voice for a language. */
  defaultVoice(lang: string): string | undefined;
  synth(text: string, opts: SynthOptions): Promise<SynthResult>;
  /** Approximate cost in USD per million characters (for estimates). */
  costPerMChars?: number;
  /** Licence / terms note shown in the studio. */
  note?: string;
}
