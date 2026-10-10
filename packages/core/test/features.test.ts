import { describe, expect, it } from 'vitest';
import { analyseWindow, CANDIDATE_LEVELS, colourGate, colourGates } from '../src/detect/candidates.js';
import { buildWaterMask, DEFAULT_THRESHOLDS, hsvInto, rgbToHsv } from '../src/detect/color.js';
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

  it('compute HSV and every gate in one pass exactly like the per-pixel helpers', () => {
    // Every 5th level of each channel, plus transparent pixels.
    const cols: number[][] = [];
    for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) cols.push([r, g, b]);
    const n = cols.length;
    const px = new Uint8ClampedArray(n * 4);
    cols.forEach(([r, g, b], i) => px.set([r, g, b, i % 17 === 0 ? 100 : 255], i * 4));
    const hue = new Float32Array(n), sat = new Float32Array(n), val = new Float32Array(n);
    hsvInto(px, hue, sat, val);
    const ref = { h: new Float32Array(n), s: new Float32Array(n), v: new Float32Array(n) };
    cols.forEach(([r, g, b], i) => {
      const q = rgbToHsv(r, g, b);
      ref.h[i] = q.h;
      ref.s[i] = q.s;
      ref.v[i] = q.v;
    });
    expect(Array.from(hue)).toEqual(Array.from(ref.h));
    expect(Array.from(sat)).toEqual(Array.from(ref.s));
    expect(Array.from(val)).toEqual(Array.from(ref.v));
    const fused = colourGates(px, hue, sat, val, CANDIDATE_LEVELS.map((l) => l.gate));
    CANDIDATE_LEVELS.forEach((l, k) => expect(Array.from(fused[k])).toEqual(Array.from(colourGate(px, hue, sat, val, l.gate))));
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

  it('measure a padel-sized court with its painted line as a court', () => {
    // 20 x 10 m at 0.25 m/px, split across its width by a 1 px white line.
    const px = makeTile(256, 256, GREY_RGB, [
      { x: 60, y: 100, w: 80, h: 40, rgb: POOL_RGB },
      { x: 99, y: 104, w: 1, h: 32, rgb: [240, 240, 240] },
    ]);
    const { candidates } = analyseWindow(px, 256, 256, all, () => MPP, opts);
    const f = candidates.find((c) => c.level === 0)!.features;
    expect(at(f, 'obb_len_m')).toBeCloseTo(20, 0);
    expect(at(f, 'obb_wid_m')).toBeCloseTo(10, 0);
    expect(at(f, 'court_dev')).toBeLessThan(0.05);
    expect(at(f, 'obb_fill')).toBeGreaterThan(0.97);
    // The clean-up closes the 1 px line into the shape; it still shows as bright grey pixels.
    expect(at(f, 'in_line')).toBeGreaterThan(0.01);
  });

  it('give a rotated rectangle a full oriented box', () => {
    // A 60 x 20 px bar drawn at 45 degrees: its axis-aligned box is mostly empty.
    const px = makeTile(256, 256, GREY_RGB);
    for (let t = 0; t < 60; t++) {
      for (let u = -10; u < 10; u++) {
        for (const [dx, dy] of [[0, 0], [1, 0]]) {
          const x = Math.round(100 + t * 0.7071 - u * 0.7071) + dx;
          const y = Math.round(80 + t * 0.7071 + u * 0.7071) + dy;
          px.set([...POOL_RGB, 255], (y * 256 + x) * 4);
        }
      }
    }
    const f = analyseWindow(px, 256, 256, all, () => MPP, opts).candidates.find((c) => c.level === 0)!.features;
    expect(at(f, 'fill')).toBeLessThan(0.6);
    expect(at(f, 'obb_fill')).toBeGreaterThan(0.85);
    expect(at(f, 'obb_aspect')).toBeGreaterThan(2.5);
  });

  it('tell a shape with a bright rim on every side from one lit on a single side', () => {
    const rimmed = makeTile(256, 256, GREY_RGB, [
      { x: 96, y: 76, w: 48, h: 28, rgb: [235, 235, 230] },
      { x: 100, y: 80, w: 40, h: 20, rgb: POOL_RGB },
    ]);
    const lopsided = makeTile(256, 256, GREY_RGB, [
      { x: 140, y: 60, w: 30, h: 60, rgb: [235, 235, 230] },
      { x: 100, y: 80, w: 40, h: 20, rgb: POOL_RGB },
    ]);
    const a = analyseWindow(rimmed, 256, 256, all, () => MPP, opts).candidates.find((c) => c.level === 0)!.features;
    const b = analyseWindow(lopsided, 256, 256, all, () => MPP, opts).candidates.find((c) => c.level === 0)!.features;
    expect(at(a, 'a_deck_min')).toBeGreaterThan(0.9);
    expect(at(a, 'in_line')).toBe(0);
    expect(at(b, 'a_deck_min')).toBe(0);
    expect(at(b, 'b_vasym')).toBeGreaterThan(at(a, 'b_vasym'));
  });
});
