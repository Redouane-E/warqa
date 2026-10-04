// @napi-rs/canvas for the browser build: an OffscreenCanvas with the two encoders the pipeline calls,
// toBuffer('image/png') (synchronous: the book icons of an export) and encode('png').
import { Buffer } from 'buffer';
import { zlibSync } from 'fflate';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA pixels → PNG, synchronously. */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function createCanvas(width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  return Object.assign(c, {
    toBuffer(mime = 'image/png'): Buffer {
      if (mime !== 'image/png') throw new Error(`toBuffer("${mime}") is not available in the browser`);
      const ctx = c.getContext('2d')!;
      return Buffer.from(encodePng(c.width, c.height, ctx.getImageData(0, 0, c.width, c.height).data));
    },
    async encode(format = 'png'): Promise<Buffer> {
      const blob = await c.convertToBlob({ type: `image/${format}` });
      return Buffer.from(await blob.arrayBuffer());
    },
  });
}

export default { createCanvas };
