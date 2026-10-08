import { describe, expect, it } from 'vitest';
import {
  bitmapPixelToLonLat,
  metersPerPixel,
  metersPerPixelOfBitmap,
  tileBBox,
  tileBBox3857,
  tileUrl,
} from '../src/geo/mercator.js';
import { convexHull, minAreaRect, orientedDims } from '../src/geo/obb.js';
import { tileRequest, wmsTileRequest } from '../src/geo/wms.js';
import { DGT_ORTOS2025, ESRI_WORLD_IMAGERY } from '../src/providers.js';
import type { Ring } from '../src/types.js';

describe('EPSG:3857 tile bounds', () => {
  it('match the bounds PNOA reports for a tile, to the centimetre', () => {
    // geowebcache-tile-bounds sent by https://www.ign.es/wmts/pnoa-ma for
    // tile-index [254922, 319292, 19] (TMS row from the bottom), 7 Oct 2026.
    const tmsRow = 319292;
    const tile = { z: 19, x: 254922, y: 2 ** 19 - 1 - tmsRow };
    const expected = [-552028.2181988172, 4368223.291833047, -551951.7811705396, 4368299.728861321];
    const got = tileBBox3857(tile);
    for (let i = 0; i < 4; i++) expect(Math.abs(got[i] - expected[i])).toBeLessThan(0.01);
  });

  it('cover the whole square at z0', () => {
    const [minX, minY, maxX, maxY] = tileBBox3857({ z: 0, x: 0, y: 0 });
    expect(minX).toBeCloseTo(-20037508.342789244, 6);
    expect(maxY).toBeCloseTo(20037508.342789244, 6);
    expect(maxX).toBeCloseTo(-minX, 6);
    expect(minY).toBeCloseTo(-maxY, 6);
  });
});

describe('scale from the real bitmap', () => {
  it('halves m/px for a 512 px bitmap of the same tile', () => {
    const tile = { z: 18, x: 125202, y: 100781 };
    const lat = (tileBBox(tile).north + tileBBox(tile).south) / 2;
    expect(metersPerPixelOfBitmap(tile, 256)).toBeCloseTo(metersPerPixel(lat, 18), 6);
    expect(metersPerPixelOfBitmap(tile, 512)).toBeCloseTo(metersPerPixel(lat, 18) / 2, 6);
    // A z18 tile at 512 px is the same ground resolution as z19 at 256 px.
    expect(metersPerPixelOfBitmap(tile, 512)).toBeCloseTo(metersPerPixel(lat, 19), 4);
  });

  it('maps bitmap pixels to the tile corners at any size', () => {
    const tile = { z: 18, x: 125202, y: 100781 };
    const b = tileBBox(tile);
    const se = bitmapPixelToLonLat(tile, 512, 512, 512);
    expect(se.lon).toBeCloseTo(b.east, 10);
    expect(se.lat).toBeCloseTo(b.south, 10);
    const mid = bitmapPixelToLonLat(tile, 256, 256, 512);
    const mid256 = bitmapPixelToLonLat(tile, 128, 128, 256);
    expect(mid).toEqual(mid256);
    // A halo pixel lies outside the tile.
    expect(bitmapPixelToLonLat(tile, -32, 0, 512).lon).toBeLessThan(b.west);
  });

  it('refuses a bitmap with no width', () => {
    expect(() => metersPerPixelOfBitmap({ z: 1, x: 0, y: 0 }, 0)).toThrow(RangeError);
  });
});

describe('WMS requests', () => {
  const tile = { z: 18, x: 125202, y: 100781 };

  function bboxOf(url: string): number[] {
    return /BBOX=([^&]+)/.exec(url)![1].split(',').map(Number);
  }

  it('fill the bbox and keep 512 px without a halo', () => {
    const r = wmsTileRequest(DGT_ORTOS2025, tile);
    expect(r.width).toBe(512);
    expect(r.url).toContain('WIDTH=512&HEIGHT=512');
    expect(r.url).not.toContain('{bbox-epsg-3857}');
    const want = tileBBox3857(tile);
    bboxOf(r.url).forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.001));
  });

  it('grow bbox and size together for a halo, keeping the centre on the tile', () => {
    const halo = 32;
    const r = wmsTileRequest(DGT_ORTOS2025, tile, halo);
    expect(r.width).toBe(576);
    expect(r.url).toContain('WIDTH=576&HEIGHT=576');
    const [minX, , maxX] = bboxOf(r.url);
    const [tMinX, , tMaxX] = tileBBox3857(tile);
    const mPerPx = (tMaxX - tMinX) / 512;
    expect(Math.abs(tMinX - minX - halo * mPerPx)).toBeLessThan(0.002);
    expect(Math.abs((maxX - minX) / 576 - mPerPx)).toBeLessThan(1e-5);
  });

  it('reject a fractional halo and non-WMS sources', () => {
    expect(() => wmsTileRequest(DGT_ORTOS2025, tile, 1.5)).toThrow(RangeError);
    expect(() => wmsTileRequest(ESRI_WORLD_IMAGERY, tile)).toThrow(/not a WMS/);
  });

  it('tileUrl fills WMS templates too', () => {
    expect(tileUrl(DGT_ORTOS2025.template, tile)).toBe(wmsTileRequest(DGT_ORTOS2025, tile).url);
    const xyz = tileRequest(ESRI_WORLD_IMAGERY, { z: 19, x: 1, y: 2 }, 32);
    expect(xyz.url).toMatch(/\/tile\/19\/2\/1$/);
    expect(xyz.halo).toBe(0);
  });
});

describe('oriented dimensions', () => {
  const lat0 = 38.7;
  const lon0 = -9.14;
  const mPerDegLat = (6378137 * Math.PI) / 180;
  const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);

  /** A length x width rectangle whose long side heads `heading` degrees from north. */
  function rect(length: number, width: number, heading: number): Ring {
    const h = (heading * Math.PI) / 180;
    const ux = Math.sin(h), uy = Math.cos(h);
    const vx = Math.cos(h), vy = -Math.sin(h);
    const corners: [number, number][] = [
      [-length / 2, -width / 2],
      [length / 2, -width / 2],
      [length / 2, width / 2],
      [-length / 2, width / 2],
    ];
    return corners.map(([a, b]) => {
      const x = a * ux + b * vx;
      const y = a * uy + b * vy;
      return [lon0 + x / mPerDegLon, lat0 + y / mPerDegLat];
    });
  }

  for (const heading of [0, 17, 45, 90, 133, 179]) {
    it(`measures a 12 x 6 m rectangle heading ${heading} degrees within 1%`, () => {
      const d = orientedDims([rect(12, 6, heading)])!;
      expect(Math.abs(d.lengthM - 12) / 12).toBeLessThan(0.01);
      expect(Math.abs(d.widthM - 6) / 6).toBeLessThan(0.01);
      const diff = Math.abs(((d.angleDeg - heading + 90) % 180 + 180) % 180 - 90);
      expect(diff).toBeLessThan(0.5);
    });
  }

  it('ignores points inside the outline', () => {
    const r = rect(10, 4, 30);
    const inner: Ring = [[lon0, lat0], [lon0 + 1e-6, lat0]];
    const d = orientedDims([r, inner])!;
    expect(d.lengthM).toBeCloseTo(10, 1);
    expect(d.widthM).toBeCloseTo(4, 1);
  });

  it('is not measured for a line or a point', () => {
    expect(orientedDims([[[0, 0], [1e-5, 0], [2e-5, 0]]])).toBeNull();
    expect(orientedDims([[[0, 0]]])).toBeNull();
  });

  it('finds the hull and the smallest rectangle in the plane', () => {
    expect(convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])).toHaveLength(4);
    const r = minAreaRect([[0, 0], [4, 0], [4, 2], [0, 2], [2, 1]])!;
    expect(r.length).toBeCloseTo(4, 9);
    expect(r.width).toBeCloseTo(2, 9);
    expect(r.headingDeg).toBeCloseTo(90, 9);
  });
});
