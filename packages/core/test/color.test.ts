import { describe, expect, it } from 'vitest';
import { buildWaterMask, DEFAULT_THRESHOLDS, rgbToHsv } from '../src/detect/color.js';
import { GRASS_RGB, GREY_RGB, makeTile, POOL_RGB, ROOF_BLUE_RGB } from './helpers.js';

describe('colour analysis', () => {
  it('converts rgb to hsv', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 255).h).toBe(180);
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    const grey = rgbToHsv(128, 128, 128);
    expect(grey.s).toBe(0);
  });

  it('pool colour lands in both broad and strict bands', () => {
    const { h, s, v } = rgbToHsv(...POOL_RGB);
    expect(h).toBeGreaterThan(DEFAULT_THRESHOLDS.strictHueMin);
    expect(h).toBeLessThan(DEFAULT_THRESHOLDS.strictHueMax);
    expect(s).toBeGreaterThan(DEFAULT_THRESHOLDS.strictSatMin);
    expect(v).toBeGreaterThan(DEFAULT_THRESHOLDS.valMin);
  });

  it('masks pool pixels and rejects grass, grey and blue roofs', () => {
    const w = 32;
    const tile = makeTile(w, w, GREY_RGB, [
      { x: 2, y: 2, w: 6, h: 6, rgb: POOL_RGB },
      { x: 12, y: 2, w: 6, h: 6, rgb: GRASS_RGB },
      { x: 22, y: 2, w: 6, h: 6, rgb: ROOF_BLUE_RGB },
    ]);
    const { mask } = buildWaterMask(tile, w, w);
    let count = 0;
    for (const m of mask) count += m;
    expect(count).toBe(36); // only the pool square
    expect(mask[3 * w + 3]).toBe(1);
    expect(mask[3 * w + 13]).toBe(0);
    expect(mask[3 * w + 23]).toBe(0);
  });
});
