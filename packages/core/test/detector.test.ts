import { describe, expect, it } from 'vitest';
import { detectTile, scoreConfidence } from '../src/detect/detector.js';
import { lonLatToTile, metersPerPixel, tilePixelToLonLat } from '../src/geo/mercator.js';
import { GRASS_RGB, GREY_RGB, makeTile, POOL_RGB, ROOF_BLUE_RGB } from './helpers.js';

// A z19 tile over the Algarve (pool country).
const TILE = lonLatToTile(-8.0172, 37.0894, 19);

describe('detector', () => {
  it('finds a pool-coloured rectangle with accurate area and position', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 30, h: 16, rgb: POOL_RGB }]);
    const dets = detectTile(rgba, 256, 256, TILE);
    expect(dets).toHaveLength(1);
    const d = dets[0];

    const mpp = metersPerPixel(d.center.lat, TILE.z);
    const expectedArea = 30 * 16 * mpp * mpp;
    expect(d.areaM2).toBeGreaterThan(expectedArea * 0.9);
    expect(d.areaM2).toBeLessThan(expectedArea * 1.1);

    const expectedCenter = tilePixelToLonLat(TILE, 115, 88);
    expect(d.center.lon).toBeCloseTo(expectedCenter.lon, 6);
    expect(d.center.lat).toBeCloseTo(expectedCenter.lat, 6);

    expect(d.touches).toEqual({ n: false, e: false, s: false, w: false });
    expect(d.outline.length).toBeGreaterThanOrEqual(4);
    expect(d.strictRatio).toBeGreaterThan(0.8);
    expect(d.fillRatio).toBeGreaterThan(0.85);
  });

  it('ignores grass, grey and blue-roof rectangles', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [
      { x: 20, y: 20, w: 24, h: 16, rgb: GRASS_RGB },
      { x: 80, y: 20, w: 24, h: 16, rgb: ROOF_BLUE_RGB },
    ]);
    expect(detectTile(rgba, 256, 256, TILE)).toHaveLength(0);
  });

  it('drops speckle noise below the pixel floor', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 50, y: 50, w: 2, h: 2, rgb: POOL_RGB }]);
    expect(detectTile(rgba, 256, 256, TILE)).toHaveLength(0);
  });

  it('rejects interior shapes larger than a plausible pool', () => {
    // ~200×200 px ≈ 2270 m² at this latitude/zoom — a pond, not a pool.
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 20, y: 20, w: 200, h: 200, rgb: POOL_RGB }]);
    expect(detectTile(rgba, 256, 256, TILE)).toHaveLength(0);
  });

  it('keeps small fragments that touch a tile edge (merger decides later)', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 248, y: 100, w: 8, h: 14, rgb: POOL_RGB }]);
    const dets = detectTile(rgba, 256, 256, TILE);
    expect(dets).toHaveLength(1);
    expect(dets[0].touches.e).toBe(true);
  });

  it('separates two distinct pools', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [
      { x: 30, y: 30, w: 20, h: 12, rgb: POOL_RGB },
      { x: 150, y: 180, w: 26, h: 14, rgb: POOL_RGB },
    ]);
    const dets = detectTile(rgba, 256, 256, TILE);
    expect(dets).toHaveLength(2);
  });

  it('confidence rewards pool-like evidence', () => {
    const strong = scoreConfidence({
      meanHue: 188,
      meanSat: 0.7,
      strictRatio: 0.95,
      fillRatio: 0.9,
      texture: 0.015,
      areaM2: 40,
      truncated: false,
    });
    const weak = scoreConfidence({
      meanHue: 152,
      meanSat: 0.2,
      strictRatio: 0.1,
      fillRatio: 0.3,
      texture: 0.11,
      areaM2: 4,
      truncated: true,
    });
    expect(strong).toBeGreaterThan(0.85);
    expect(weak).toBeLessThan(0.35);
  });

  it('rejects textured surfaces even in a perfect pool colour', () => {
    // A pool-coloured rectangle with a strong checker texture — a hedge or a
    // photovoltaic array as the colour gate sees it.
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 30, h: 16, rgb: POOL_RGB }]);
    for (let y = 80; y < 96; y++) {
      for (let x = 100; x < 130; x++) {
        if ((x + y) % 2 === 0) {
          const o = (y * 256 + x) * 4;
          // darken alternating pixels strongly, staying inside the colour gate
          rgba[o] = 30;
          rgba[o + 1] = 110;
          rgba[o + 2] = 126;
        }
      }
    }
    expect(detectTile(rgba, 256, 256, TILE)).toHaveLength(0);
  });

  it('keeps smooth water with mild brightness variation', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 30, h: 16, rgb: POOL_RGB }]);
    for (let y = 80; y < 96; y++) {
      for (let x = 100; x < 130; x++) {
        const o = (y * 256 + x) * 4;
        const ripple = Math.round(3 * Math.sin(x / 5));
        rgba[o + 1] = 170 + ripple;
        rgba[o + 2] = 190 + ripple;
      }
    }
    expect(detectTile(rgba, 256, 256, TILE)).toHaveLength(1);
  });
});
