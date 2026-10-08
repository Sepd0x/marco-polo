import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { decodeJpeg, JpegUnsupported } from '../src/jpeg.js';
import { decodeImage } from '../src/tiles.js';

const root = new URL('../../../', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('./jpeg-browser-sha256.json', import.meta.url), 'utf8')) as { files: Record<string, string> };

describe('decodeJpeg', () => {
  it('returns the same RGBA as Chromium for every fixture tile', () => {
    const files = Object.entries(expected.files);
    expect(files.length).toBeGreaterThanOrEqual(60);
    for (const [file, sha] of files) {
      const img = decodeJpeg(readFileSync(new URL(file, root)));
      expect(createHash('sha256').update(img.rgba).digest('hex'), file).toBe(sha);
    }
  });

  it('covers a WMS window whose size is not a multiple of 16', () => {
    const file = Object.keys(expected.files).find((f) => f.includes('halo43'));
    expect(file).toBeDefined();
    const img = decodeJpeg(readFileSync(new URL(file!, root)));
    expect([img.width, img.height]).toEqual([598, 598]);
  });

  it('decodes 4:4:4 at odd sizes close to the source pixels', () => {
    const w = 37, h = 29;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = (i * 7) & 255;
      rgba[i * 4 + 1] = 90;
      rgba[i * 4 + 2] = 200;
      rgba[i * 4 + 3] = 255;
    }
    const buf = jpeg.encode({ data: Buffer.from(rgba), width: w, height: h }, 100).data;
    const img = decodeJpeg(buf);
    expect([img.width, img.height]).toEqual([w, h]);
    const ref = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    let worst = 0;
    for (let i = 0; i < img.rgba.length; i++) worst = Math.max(worst, Math.abs(img.rgba[i] - ref.data[i]));
    expect(worst).toBeLessThanOrEqual(3);
  });

  it('refuses progressive files, and decodeImage falls back for them', () => {
    // SOI, then a progressive frame header: 8-bit, 1x1 px, one component.
    const sof2 = Uint8Array.from([0xff, 0xd8, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
    expect(() => decodeJpeg(sof2)).toThrow(JpegUnsupported);
    expect(() => decodeImage(sof2)).not.toThrow(JpegUnsupported);
  });
});
