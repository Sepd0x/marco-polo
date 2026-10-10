import { describe, expect, it } from 'vitest';
import { formatDegrees, wrapLongitude, isMultiple, metresPerPixel, multiples, niceStep, scaleFor, stepDecimals } from '../../src/map/frame.js';

describe('frame graduation', () => {
  it('picks 1, 2 or 5 times a power of ten, never below the asked step', () => {
    expect(niceStep(0.00042)).toBeCloseTo(0.0005, 12);
    expect(niceStep(0.0005)).toBeCloseTo(0.0005, 12);
    expect(niceStep(0.0011)).toBeCloseTo(0.002, 12);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
  });

  it('writes every multiple of the step exactly', () => {
    expect(stepDecimals(0.0005)).toBe(4);
    expect(stepDecimals(0.002)).toBe(3);
    expect(stepDecimals(0.001)).toBe(3);
    expect(stepDecimals(5)).toBe(0);
    expect(multiples(-9.4457, -9.4441, 0.0005)).toEqual([-9.4455, -9.445, -9.4445]);
    expect(isMultiple(-9.445, 0.0005)).toBe(true);
    expect(isMultiple(-9.4451, 0.0005)).toBe(false);
  });

  it('brings longitudes back into -180 to 180 for display', () => {
    expect(wrapLongitude(181)).toBeCloseTo(-179, 9);
    expect(wrapLongitude(-200)).toBeCloseTo(160, 9);
    expect(wrapLongitude(-9.44)).toBeCloseTo(-9.44, 9);
    expect(wrapLongitude(180)).toBe(180);
  });

  it('formats degrees with the typographic minus and the degree sign', () => {
    expect(formatDegrees(-9.4455, 4)).toBe('−9.4455°');
    expect(formatDegrees(38.718888, 6)).toBe('38.718888°');
    expect(formatDegrees(-0.00001, 4)).toBe('0.0000°');
  });
});

describe('scale bar', () => {
  it('works out ground metres per pixel for 512 px tiles', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.5, 0);
    expect(metresPerPixel(18, 60)).toBeCloseTo(78271.5 / 2 ** 18 / 2, 3);
  });

  it('takes the longest round length that fits', () => {
    expect(scaleFor(0.5, 110)).toEqual({ metres: 50, px: 100 });
    expect(scaleFor(0.3, 110)).toEqual({ metres: 20, px: 20 / 0.3 });
    expect(scaleFor(12, 100).metres).toBe(1000);
  });
});
