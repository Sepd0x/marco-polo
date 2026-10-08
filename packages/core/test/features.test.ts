import { describe, expect, it } from 'vitest';
import { analyseWindow, CANDIDATE_LEVELS, colourGate } from '../src/detect/candidates.js';
import { buildWaterMask, DEFAULT_THRESHOLDS, rgbToHsv } from '../src/detect/color.js';
import { FEATURE_COUNT, FEATURE_NAMES } from '../src/detect/features.js';
import { GREY_RGB, makeTile, POOL_RGB } from './helpers.js';

const at = (f: Float64Array, name: (typeof FEATURE_NAMES)[number]) => f[FEATURE_NAMES.indexOf(name)];
const MPP = 0.25;
const all = { x0: 0, y0: 0, x1: 256, y1: 256 };
const opts = { levels: CANDIDATE_LEVELS, minPixels: 10, minAreaM2: 3, maxAreaM2: 2000 };

describe('candidate features', () => {
  it('describe a rectangular pool on grey ground', () => {
    const px = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 40, h: 20, rgb: POOL_RGB }]);
    const { candidates } = analyseWindow(px, 256, 256, all, () => MPP, opts);
    expect(candidates).toHaveLength(1);
    const f = candidates[0].features;
    expect(f).toHaveLength(FEATURE_COUNT);
    expect(at(f, 'level')).toBe(0);
    // The morphological clean-up rounds off the four corner pixels.
    const px0 = candidates[0].component.pixelCount;
    expect(px0).toBe(796);
    expect(at(f, 'fill')).toBeCloseTo(796 / 800, 6);
    expect(at(f, 'aspect')).toBeCloseTo(2, 6);
    expect(at(f, 'extent_m')).toBeCloseTo(40 * MPP, 6);
    expect(at(f, 'log_area')).toBeCloseTo(Math.log(px0 * MPP * MPP), 6);
    expect(at(f, 'in_strict')).toBe(1);
    expect(at(f, 'in_gate')).toBe(1);
    expect(at(f, 'touches')).toBe(0);
    // Pool water against the grey ring: the ring is darker.
    const { v } = rgbToHsv(...POOL_RGB);
    expect(at(f, 'in_v')).toBeCloseTo(v, 5);
    expect(at(f, 'contrast_b')).toBeLessThan(0);
    expect(at(f, 'b_perm')).toBe(0);
  });

  it('leave pixels without imagery out of the rings', () => {
    const px = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 40, h: 20, rgb: POOL_RGB }]);
    const ref = analyseWindow(px, 256, 256, all, () => MPP, opts).candidates[0].features;
    // Make the outer ring on the left transparent and black: ring statistics must not move.
    for (let y = 70; y < 110; y++) for (let x = 90; x < 96; x++) px.set([0, 0, 0, 0], (y * 256 + x) * 4);
    const f = analyseWindow(px, 256, 256, all, () => MPP, opts).candidates[0].features;
    expect(at(f, 'b_v')).toBeCloseTo(at(ref, 'b_v'), 6);
    expect(at(f, 'b_dark')).toBe(0);
  });

  it('use the v1 colour test as level 0', () => {
    const px = makeTile(64, 64, GREY_RGB, [{ x: 10, y: 10, w: 20, h: 9, rgb: POOL_RGB }, { x: 40, y: 40, w: 9, h: 9, rgb: [150, 180, 190] }]);
    const n = 64 * 64;
    const hue = new Float32Array(n), sat = new Float32Array(n), val = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const h = rgbToHsv(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      hue[i] = h.h;
      sat[i] = h.s;
      val[i] = h.v;
    }
    expect(Array.from(colourGate(px, hue, sat, val, CANDIDATE_LEVELS[0].gate))).toEqual(Array.from(buildWaterMask(px, 64, 64, DEFAULT_THRESHOLDS).mask));
  });

  it('keep only shapes whose centroid is in the central square', () => {
    const px = makeTile(256, 256, GREY_RGB, [
      { x: 20, y: 20, w: 20, h: 12, rgb: POOL_RGB },
      { x: 120, y: 120, w: 20, h: 12, rgb: POOL_RGB },
    ]);
    const { candidates } = analyseWindow(px, 256, 256, { x0: 64, y0: 64, x1: 192, y1: 192 }, () => MPP, opts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cx).toBeGreaterThan(64);
  });
});
