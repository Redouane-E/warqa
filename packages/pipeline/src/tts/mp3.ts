// MP3 duration and concatenation without ffmpeg: walk the frame headers.

const BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps by index; MPEG1 L3 and MPEG2/2.5 L3 are what speech engines produce
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

function skipId3(b: Uint8Array): number {
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
    return 10 + size;
  }
  return 0;
}

/** Duration in seconds of an MP3 buffer (sums frame durations; robust to VBR). */
export function mp3Duration(b: Uint8Array): number {
  let i = skipId3(b);
  let secs = 0;
  let frames = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const verBits = (b[i + 1]! >> 3) & 3;
    const layerBits = (b[i + 1]! >> 1) & 3;
    const brIdx = (b[i + 2]! >> 4) & 15;
    const srIdx = (b[i + 2]! >> 2) & 3;
    const pad = (b[i + 2]! >> 1) & 1;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
      i++;
      continue;
    }
    const ver = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
    const layer = layerBits === 1 ? 3 : layerBits === 2 ? 2 : 1;
    const kbps = BITRATES[`${ver === 1 ? 1 : 2}-${layer === 1 ? 2 : layer}`]?.[brIdx] ?? 0;
    const sr = RATES[ver]![srIdx]!;
    const samples = layer === 1 ? 384 : layer === 3 && ver !== 1 ? 576 : 1152;
    const len =
      layer === 1
        ? Math.floor(((12 * kbps * 1000) / sr + pad) * 4)
        : Math.floor((samples / 8) * ((kbps * 1000) / sr)) + pad;
    if (len < 4) {
      i++;
      continue;
    }
    secs += samples / sr;
    frames++;
    i += len;
  }
  return frames ? +secs.toFixed(3) : 0;
}

/** Concatenate MP3 clips (same encoding) into one; returns the start time of each part. */
export function concatMp3(parts: Uint8Array[]): { audio: Uint8Array; starts: number[]; durs: number[] } {
  const starts: number[] = [];
  const durs: number[] = [];
  let t = 0;
  const bodies = parts.map((p) => p.subarray(skipId3(p)));
  for (const p of bodies) {
    starts.push(+t.toFixed(3));
    const d = mp3Duration(p);
    durs.push(d);
    t += d;
  }
  const total = bodies.reduce((a, p) => a + p.length, 0);
  const audio = new Uint8Array(total);
  let o = 0;
  for (const p of bodies) {
    audio.set(p, o);
    o += p.length;
  }
  return { audio, starts, durs };
}

/** Duration of a PCM WAV buffer. */
export function wavDuration(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rate = dv.getUint32(24, true);
  const channels = dv.getUint16(22, true);
  const bits = dv.getUint16(34, true);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    const size = dv.getUint32(i + 4, true);
    if (id === 'data') return +(size / (rate * channels * (bits / 8))).toFixed(3);
    i += 8 + size;
  }
  return 0;
}

/** Wrap raw 16-bit PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, rate = 24000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, k) => (out[o + k] = c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
