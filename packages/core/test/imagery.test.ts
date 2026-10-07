import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { blankShare, FLAT_THRESHOLD, flatness, KNOWN_PLACEHOLDERS, noDataReason } from '../src/imagery/nodata.js';
import { sha256Hex } from '../src/imagery/sha256.js';
import { buildTileWindow, neighbourTile, windowFromBitmap } from '../src/imagery/window.js';
import { metersPerPixelOfBitmap } from '../src/geo/mercator.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/imagery/${name}`, import.meta.url)));

function decode(buf: Buffer) {
  const d = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { pixels: d.data, width: d.width, height: d.height };
}

describe('sha256', () => {
  it('matches node:crypto across block boundaries', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 2521, 70_000]) {
      const data = randomBytes(n);
      expect(sha256Hex(data), `length ${n}`).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });

  it('gives the known digest of "abc"', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('tiles with no imagery', () => {
  it('reads a 404 as no coverage (IGN outside France)', () => {
    expect(noDataReason({ status: 404 })).toBe('not-found');
  });

  const esriPlaceholder = 'C:/dev/mp-research/imagery/cors/esri_z20.bin';
  it.skipIf(!existsSync(esriPlaceholder))('recognises the real Esri placeholder by its hash', () => {
    const bytes = readFileSync(esriPlaceholder);
    expect(bytes.length).toBe(2521);
    expect(createHash('sha256').update(bytes).digest('hex') in KNOWN_PLACEHOLDERS).toBe(true);
    // The placeholder has text on it, so only the hash catches it.
    const img = decode(bytes);
    expect(noDataReason({ ...img })).toBeNull();
    expect(noDataReason({ status: 200, bytes, ...img })).toBe('placeholder');
  });

  it('checks the body hash against the placeholder list', () => {
    const bytes = new TextEncoder().encode('stand-in tile');
    expect(noDataReason({ status: 200, bytes })).toBeNull();
    expect(noDataReason({ status: 200, bytes }, { [sha256Hex(bytes)]: 'test' })).toBe('placeholder');
  });

  it('reads the flat PNOA fill outside Spain as flat', () => {
    const img = decode(fixture('pnoa-outside-spain.jpg'));
    expect(img.width).toBe(256);
    expect(flatness(img.pixels, img.width, img.height)).toBeLessThan(FLAT_THRESHOLD);
    expect(noDataReason(img)).toBe('flat');
  });

  it('reads the white DGT answer outside Portugal as blank', () => {
    const img = decode(fixture('dgt-outside-portugal-512.jpg'));
    expect(img.width).toBe(512);
    expect(blankShare(img.pixels)).toBe(1);
    expect(noDataReason(img)).toBe('blank');
  });

  it('reads a transparent tile as blank', () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    expect(noDataReason({ pixels, width: 64, height: 64 })).toBe('blank');
  });

  it('keeps calm open water with sensor noise as imagery', () => {
    // Dark water with one grey level of noise: the smoothest real tiles sit near 0.1.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      const n = rnd() < 0.1 ? 1 : 0;
      pixels[i] = 10 + n;
      pixels[i + 1] = 40 + n;
      pixels[i + 2] = 30 + n;
      pixels[i + 3] = 255;
    }
    expect(flatness(pixels, 256, 256)).toBeGreaterThan(FLAT_THRESHOLD);
    expect(noDataReason({ status: 200, pixels, width: 256, height: 256 })).toBeNull();
  });

  it('does not call a half-white border tile blank', () => {
    const pixels = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      const x = (i / 4) % 100;
      const v = x < 50 ? 255 : 60 + ((i / 4) % 7) * 10;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
    expect(noDataReason({ pixels, width: 100, height: 100 })).toBeNull();
  });
});

describe('detector windows', () => {
  const TILE = { z: 19, x: 250405, y: 201562 };

  /** A tile filled with one value per neighbour, so we can see where each lands. */
  function solid(tilePx: number, v: number): Uint8ClampedArray {
    const a = new Uint8ClampedArray(tilePx * tilePx * 4);
    for (let i = 0; i < a.length; i += 4) {
      a[i] = v;
      a[i + 1] = v;
      a[i + 2] = v;
      a[i + 3] = 255;
    }
    return a;
  }

  const code = (dx: number, dy: number) => 10 + (dy + 1) * 3 + (dx + 1);

  it('puts each neighbour in its place around the central tile', () => {
    const tilePx = 16;
    const halo = 4;
    const w = buildTileWindow(TILE, tilePx, halo, (dx, dy) => solid(tilePx, code(dx, dy)));
    expect(w.width).toBe(24);
    expect(w.height).toBe(24);
    const at = (x: number, y: number) => w.pixels[(y * w.width + x) * 4];
    expect(at(0, 0)).toBe(code(-1, -1));
    expect(at(3, 3)).toBe(code(-1, -1));
    expect(at(4, 0)).toBe(code(0, -1));
    expect(at(19, 3)).toBe(code(0, -1));
    expect(at(20, 0)).toBe(code(1, -1));
    expect(at(0, 4)).toBe(code(-1, 0));
    expect(at(4, 4)).toBe(code(0, 0));
    expect(at(19, 19)).toBe(code(0, 0));
    expect(at(20, 19)).toBe(code(1, 0));
    expect(at(23, 23)).toBe(code(1, 1));
    expect(at(4, 20)).toBe(code(0, 1));
    expect(at(3, 23)).toBe(code(-1, 1));
  });

  it('takes the edge rows of each neighbour that touch the centre', () => {
    const tilePx = 8;
    const halo = 2;
    // Each pixel's red channel holds its column, green its row.
    const grid = () => {
      const a = new Uint8ClampedArray(tilePx * tilePx * 4);
      for (let y = 0; y < tilePx; y++) for (let x = 0; x < tilePx; x++) {
        const o = (y * tilePx + x) * 4;
        a[o] = x;
        a[o + 1] = y;
        a[o + 3] = 255;
      }
      return a;
    };
    const w = buildTileWindow(TILE, tilePx, halo, () => grid());
    const px = (x: number, y: number) => [w.pixels[(y * w.width + x) * 4], w.pixels[(y * w.width + x) * 4 + 1]];
    // Window (0,0) is the west neighbour's column 6, the north neighbour's row 6.
    expect(px(0, 0)).toEqual([6, 6]);
    expect(px(1, 1)).toEqual([7, 7]);
    expect(px(2, 2)).toEqual([0, 0]);
    expect(px(10, 10)).toEqual([0, 0]);
    expect(px(11, 2)).toEqual([1, 0]);
  });

  it('leaves missing neighbours transparent', () => {
    const w = buildTileWindow(TILE, 8, 2, (dx, dy) => (dx === 1 ? null : solid(8, 50)));
    const alpha = (x: number, y: number) => w.pixels[(y * w.width + x) * 4 + 3];
    expect(alpha(11, 5)).toBe(0);
    expect(alpha(5, 5)).toBe(255);
    expect(alpha(0, 5)).toBe(255);
  });

  it('needs the central tile and checks sizes', () => {
    expect(() => buildTileWindow(TILE, 8, 2, (dx, dy) => (dx === 0 && dy === 0 ? null : solid(8, 1)))).toThrow(/central/);
    expect(() => buildTileWindow(TILE, 8, 2, () => solid(4, 1))).toThrow(/expected 8x8/);
    expect(() => buildTileWindow(TILE, 8, 9, () => solid(8, 1))).toThrow(RangeError);
  });

  it('with no halo is the tile itself', () => {
    const src = solid(16, 99);
    const w = buildTileWindow(TILE, 16, 0, () => src);
    expect(w.width).toBe(16);
    expect(Array.from(w.pixels)).toEqual(Array.from(src));
  });

  it('scales m/px by the real bitmap width', () => {
    const t18 = { z: 18, x: 125202, y: 100781 };
    const w = windowFromBitmap(t18, new Uint8ClampedArray(576 * 576 * 4), 576, 576, 32);
    expect(w.tilePx).toBe(512);
    expect(w.mPerPx).toBeCloseTo(metersPerPixelOfBitmap(t18, 256) / 2, 9);
  });

  it('wraps neighbours across the antimeridian and stops at the poles', () => {
    expect(neighbourTile({ z: 2, x: 3, y: 1 }, 1, 0)).toEqual({ z: 2, x: 0, y: 1 });
    expect(neighbourTile({ z: 2, x: 0, y: 0 }, 0, -1)).toBeNull();
  });
});
