import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { decodeImage, encodePng } from '../src/tiles.js';

function gradient(w: number, h: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = x;
      rgba[i + 1] = y;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

describe('tile decoding', () => {
  it('round-trips PNG losslessly', () => {
    const rgba = gradient(64, 32);
    const out = decodeImage(encodePng(rgba, 64, 32));
    expect(out.width).toBe(64);
    expect(out.height).toBe(32);
    expect(Array.from(out.rgba)).toEqual(Array.from(rgba));
  });

  it('decodes JPEG by its magic bytes to RGBA of the right size', () => {
    const rgba = gradient(48, 40);
    const buf = jpeg.encode({ data: Buffer.from(rgba.buffer), width: 48, height: 40 }, 95).data;
    const out = decodeImage(Buffer.from(buf));
    expect([out.width, out.height]).toEqual([48, 40]);
    expect(out.rgba.length).toBe(48 * 40 * 4);
    let maxDiff = 0;
    for (let i = 0; i < rgba.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out.rgba[i] - rgba[i]));
    expect(maxDiff).toBeLessThan(16);
  });

  it('rejects anything that is not JPEG or PNG', () => {
    expect(() => decodeImage(Buffer.from('<html>no tile</html>'))).toThrow(/Unrecognised/);
  });
});
