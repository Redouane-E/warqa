// Speech engines. Engines without word times are driven sentence by sentence (exact sentence starts, marks
// estimated inside sentences); the optional worker can add forced alignment.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseLang, isArabic, splitSentences } from '@warqa/i18n';
import { concatMp3, mp3Duration, pcmToWav, wavDuration } from './mp3.js';
import type { SynthOptions, SynthResult, TtsProvider, WordTime } from './types.js';

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined);

/** "-4%" → 0.96 */
const rateFactor = (rate?: string) => {
  const m = rate && /^([+-]?\d+(?:\.\d+)?)%$/.exec(rate.trim());
  return m ? Math.max(0.5, Math.min(2, 1 + Number(m[1]) / 100)) : 1;
};

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** Synthesize sentence by sentence and join: exact sentence times for engines without word times. */
export async function bySentence(text: string, one: (s: string) => Promise<SynthResult>): Promise<SynthResult> {
  const sentences = splitSentences(text).map((s) => s.text);
  const parts: SynthResult[] = [];
  for (const s of sentences.length ? sentences : [text]) parts.push(await one(s));
  if (parts.every((p) => p.ext === 'mp3')) {
    const { audio, starts, durs } = concatMp3(parts.map((p) => p.audio));
    return {
      audio,
      ext: 'mp3',
      sentences: starts.map((s, i) => ({ start: s, end: s + durs[i]! })),
      dur: +(starts.at(-1)! + durs.at(-1)!).toFixed(3),
    };
  }
  // WAV: join the PCM data
  const pcms = parts.map((p) => p.audio.subarray(44));
  const total = pcms.reduce((a, p) => a + p.length, 0);
  const pcm = new Uint8Array(total);
  let o = 0;
  const starts: { start: number; end: number }[] = [];
  let t = 0;
  for (const p of pcms) {
    pcm.set(p, o);
    o += p.length;
    const d = p.length / (24000 * 2);
    starts.push({ start: t, end: t + d });
    t += d;
  }
  return { audio: pcmToWav(pcm), ext: 'wav', sentences: starts, dur: +t.toFixed(3) };
}

/* ---------- Microsoft Edge "Read aloud" voices (unofficial, via the edge-tts Python package) ---------- */

const EDGE_SCRIPT = `
import asyncio, json, sys
import edge_tts
req = json.loads(sys.stdin.read())
async def main():
    c = edge_tts.Communicate(req["text"], req["voice"], rate=req.get("rate") or "+0%", boundary="WordBoundary")
    words = []
    with open(req["out"], "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append([ch["offset"] / 1e7, ch["text"]])
    print(json.dumps({"words": words}))
asyncio.run(main())
`;

function run(cmd: string, args: string[], input: string): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
    p.stdin.end(input);
  });
}

export const EDGE_VOICES: Record<string, string> = {
  ar: 'ar-MA-MounaNeural',
  // no Microsoft voice speaks Darija; the Moroccan Arabic voices read Arabic-script Darija acceptably
  ary: 'ar-MA-JamalNeural',
  fr: 'fr-FR-DeniseNeural',
  en: 'en-US-AndrewMultilingualNeural',
};

/** Voice lookup key: the language, or "ar" for Arabic varieties without voices of their own. */
const voiceKey = (lang: string, have: Record<string, unknown>): string => {
  const b = baseLang(lang);
  return b in have ? b : isArabic(b) ? 'ar' : b;
};

export const edgeTts: TtsProvider = {
  id: 'edge',
  wordTimes: true,
  costPerMChars: 0,
  note: 'Unofficial use of Microsoft Edge read-aloud voices through the edge-tts Python package (needs uv or pip install edge-tts and network access). Fine for trying things out; prefer Azure Speech (same voices, official) for published books.',
  defaultVoice: (lang) => EDGE_VOICES[voiceKey(lang, EDGE_VOICES)],
  async synth(text, opts) {
    const dir = mkdtempSync(join(tmpdir(), 'warqa-edge-'));
    const out = join(dir, 'a.mp3');
    const req = JSON.stringify({ text, voice: opts.voice, rate: opts.rate ?? '+0%', out });
    try {
      let stdout: string;
      try {
        stdout = await run('uv', ['run', '--quiet', '--with', 'edge-tts', 'python', '-c', EDGE_SCRIPT], req);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        stdout = await run('python3', ['-c', EDGE_SCRIPT], req);
      }
      const words = (JSON.parse(stdout.trim().split('\n').pop()!).words as [number, string][]).map(([t, w]) => ({
        t,
        text: w,
      }));
      const audio = new Uint8Array(readFileSync(out));
      return { audio, ext: 'mp3', words, dur: mp3Duration(audio) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

/* ---------- Azure Speech (official; same neural voices, incl. ar-MA) ---------- */

export const azureTts: TtsProvider = {
  id: 'azure',
  wordTimes: false,
  costPerMChars: 16,
  note: 'Azure AI Speech. Needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION. Has a monthly free tier.',
  defaultVoice: (lang) => EDGE_VOICES[voiceKey(lang, EDGE_VOICES)]?.replace('AndrewMultilingual', 'Andrew'),
  async synth(text, opts) {
    const key = env('AZURE_SPEECH_KEY');
    const region = env('AZURE_SPEECH_REGION');
    if (!key || !region) throw new Error('Azure Speech needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION');
    const one = async (s: string): Promise<SynthResult> => {
      const esc = s.replace(
        /[<>&'"]/g,
        (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
      );
      const ssml = `<speak version="1.0" xml:lang="${opts.lang}"><voice name="${opts.voice}"><prosody rate="${opts.rate ?? '+0%'}">${esc}</prosody></voice></speak>`;
      const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'warqa',
        },
        body: ssml,
      });
      if (!res.ok) throw new Error(`Azure Speech: HTTP ${res.status} ${await res.text()}`);
      const audio = new Uint8Array(await res.arrayBuffer());
      return { audio, ext: 'mp3', dur: mp3Duration(audio) };
    };
    return bySentence(text, one);
  },
};

/* ---------- OpenAI ---------- */

export const openaiTts: TtsProvider = {
  id: 'openai',
  wordTimes: false,
  costPerMChars: 15,
  note: 'OpenAI speech (gpt-4o-mini-tts). Needs OPENAI_API_KEY. Multilingual voices; no word times (sentence-level timing).',
  defaultVoice: () => 'alloy',
  async synth(text, opts) {
    const key = env('OPENAI_API_KEY');
    if (!key) throw new Error('OpenAI speech needs OPENAI_API_KEY');
    const model = env('WARQA_OPENAI_TTS_MODEL') ?? 'gpt-4o-mini-tts';
    return bySentence(text, async (s) => {
      const res = await postJson(
        'https://api.openai.com/v1/audio/speech',
        {
          model,
          voice: opts.voice,
          input: s,
          response_format: 'mp3',
          speed: rateFactor(opts.rate),
          instructions: `Speak clearly, like a warm teacher, in ${opts.lang}.`,
        },
        { authorization: `Bearer ${key}` },
      );
      const audio = new Uint8Array(await res.arrayBuffer());
      return { audio, ext: 'mp3', dur: mp3Duration(audio) };
    });
  },
};

/* ---------- ElevenLabs (character timestamps) ---------- */

export const elevenlabsTts: TtsProvider = {
  id: 'elevenlabs',
  wordTimes: true,
  costPerMChars: 180,
  note: 'ElevenLabs multilingual voices with character timestamps. Needs ELEVENLABS_API_KEY; the voice is a voice id.',
  defaultVoice: () => env('ELEVENLABS_VOICE_ID') ?? 'JBFqnCBsd6RMkjVDRZzb',
  async synth(text, opts) {
    const key = env('ELEVENLABS_API_KEY');
    if (!key) throw new Error('ElevenLabs needs ELEVENLABS_API_KEY');
    const model = env('WARQA_ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2';
    const res = await postJson(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voice)}/with-timestamps?output_format=mp3_44100_128`,
      { text, model_id: model, voice_settings: { speed: rateFactor(opts.rate) } },
      { 'xi-api-key': key },
    );
    const j = (await res.json()) as {
      audio_base64: string;
      alignment?: { characters: string[]; character_start_times_seconds: number[] };
    };
    const audio = b64(j.audio_base64);
    const words: WordTime[] = [];
    const al = j.alignment;
    if (al) {
      let cur = '';
      let t0 = 0;
      al.characters.forEach((c, i) => {
        if (/\s/.test(c)) {
          if (cur) words.push({ t: t0, text: cur });
          cur = '';
        } else {
          if (!cur) t0 = al.character_start_times_seconds[i]!;
          cur += c;
        }
      });
      if (cur) words.push({ t: t0, text: cur });
    }
    return { audio, ext: 'mp3', words, dur: mp3Duration(audio) };
  },
};

/* ---------- Google Cloud Text-to-Speech ---------- */

export const googleTts: TtsProvider = {
  id: 'google',
  wordTimes: false,
  costPerMChars: 16,
  note: 'Google Cloud Text-to-Speech. Needs GOOGLE_TTS_API_KEY (an API key with the Text-to-Speech API enabled).',
  defaultVoice: (lang) => {
    const v: Record<string, string> = { ar: 'ar-XA-Wavenet-B', fr: 'fr-FR-Wavenet-C', en: 'en-US-Wavenet-D' };
    return v[voiceKey(lang, v)];
  },
  async synth(text, opts) {
    const key = env('GOOGLE_TTS_API_KEY');
    if (!key) throw new Error('Google Cloud TTS needs GOOGLE_TTS_API_KEY');
    const languageCode = opts.voice.split('-').slice(0, 2).join('-');
    return bySentence(text, async (s) => {
      const res = await postJson(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
        {
          input: { text: s },
          voice: { languageCode, name: opts.voice },
          audioConfig: { audioEncoding: 'MP3', speakingRate: rateFactor(opts.rate) },
        },
        {},
      );
      const audio = b64(((await res.json()) as { audioContent: string }).audioContent);
      return { audio, ext: 'mp3', dur: mp3Duration(audio) };
    });
  },
};

/* ---------- Gemini speech generation ---------- */

export const geminiTts: TtsProvider = {
  id: 'gemini',
  wordTimes: false,
  costPerMChars: 10,
  note: 'Gemini speech generation (prebuilt voices, many languages incl. Arabic). Needs GEMINI_API_KEY. Output is WAV.',
  defaultVoice: () => 'Kore',
  async synth(text, opts) {
    const key = env('GEMINI_API_KEY') ?? env('GOOGLE_GENERATIVE_AI_API_KEY');
    if (!key) throw new Error('Gemini speech needs GEMINI_API_KEY');
    const model = env('WARQA_GEMINI_TTS_MODEL') ?? 'gemini-2.5-flash-preview-tts';
    return bySentence(text, async (s) => {
      const res = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: [{ parts: [{ text: s }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } } },
          },
        },
        { 'x-goog-api-key': key },
      );
      const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data: string } }[] } }[] };
      const data = j.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!data) throw new Error('Gemini speech returned no audio');
      const audio = pcmToWav(b64(data));
      return { audio, ext: 'wav', dur: wavDuration(audio) };
    });
  },
};

/* ---------- the optional Python worker (local voices such as Habibi-TTS / Piper) ---------- */

export function workerTts(base: string): TtsProvider {
  return {
    id: 'worker',
    wordTimes: false,
    costPerMChars: 0,
    note: `Local voices served by the Warqa worker at ${base}.`,
    defaultVoice: (lang) => baseLang(lang),
    async synth(text, opts) {
      const res = await postJson(
        `${base.replace(/\/$/, '')}/tts`,
        { text, voice: opts.voice, lang: opts.lang, rate: opts.rate },
        {},
      );
      const j = (await res.json()) as { audio_base64: string; ext: 'mp3' | 'wav'; words?: [number, string][] };
      const audio = b64(j.audio_base64);
      return {
        audio,
        ext: j.ext,
        ...(j.words ? { words: j.words.map(([t, w]) => ({ t, text: w })) } : {}),
        dur: j.ext === 'wav' ? wavDuration(audio) : mp3Duration(audio),
      };
    },
  };
}

/** Ask the worker for word times of any audio (forced alignment). */
export async function workerAlign(base: string, audio: Uint8Array, text: string, lang: string): Promise<WordTime[]> {
  const res = await postJson(
    `${base.replace(/\/$/, '')}/align`,
    { audio_base64: Buffer.from(audio).toString('base64'), text, lang },
    {},
  );
  const j = (await res.json()) as { words: [number, string][] };
  return j.words.map(([t, w]) => ({ t, text: w }));
}

/** A silent "engine": no audio, synthetic timings (reading mode). */
export const noneTts: TtsProvider = {
  id: 'none',
  wordTimes: false,
  defaultVoice: () => '',
  async synth() {
    throw new Error('no speech engine configured');
  },
};

export function ttsProvider(id: string, opts: { worker?: string } = {}): TtsProvider {
  switch (id) {
    case 'edge':
      return edgeTts;
    case 'azure':
      return azureTts;
    case 'openai':
      return openaiTts;
    case 'elevenlabs':
      return elevenlabsTts;
    case 'google':
      return googleTts;
    case 'gemini':
      return geminiTts;
    case 'worker':
      if (!opts.worker) throw new Error('the worker speech engine needs pipeline.worker (e.g. http://localhost:8790)');
      return workerTts(opts.worker);
    case 'none':
      return noneTts;
    default:
      throw new Error(`unknown speech engine "${id}" (edge, azure, openai, elevenlabs, google, gemini, worker, none)`);
  }
}

export const TTS_IDS = ['edge', 'azure', 'openai', 'elevenlabs', 'google', 'gemini', 'worker', 'none'] as const;
export type { SynthOptions };
