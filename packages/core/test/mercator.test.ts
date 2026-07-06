import { describe, expect, it } from 'vitest';
import {
  EARTH_CIRCUMFERENCE,
  latToWorldY,
  lonLatToTile,
  lonToWorldX,
  metersPerPixel,
  tileBBox,
  tilePixelToLonLat,
  tileUrl,
  worldXToLon,
  worldYToLat,
} from '../src/geo/mercator.js';

describe('mercator', () => {
  it('places the origin in the expected tile', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ z: 1, x: 1, y: 1 });
    expect(lonLatToTile(-180, 85, 1)).toEqual({ z: 1, x: 0, y: 0 });
  });

  it('round-trips longitude and latitude through world pixels', () => {
    for (const lon of [-171.3, -8.0172, 0, 55.5]) {
      expect(worldXToLon(lonToWorldX(lon, 19), 19)).toBeCloseTo(lon, 9);
    }
    for (const lat of [-33.9, 0, 37.0894, 61.2]) {
      expect(worldYToLat(latToWorldY(lat, 19), 19)).toBeCloseTo(lat, 9);
    }
  });

  it('computes ground resolution', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(EARTH_CIRCUMFERENCE / 256, 3); // ≈ 156543 m/px
    // Half at 60° latitude.
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
    // Typical detection zoom: ~0.3 m/px near the equator at z19.
    expect(metersPerPixel(0, 19)).toBeCloseTo(0.2986, 3);
  });

  it('tile bbox of the root tile is the whole mercator world', () => {
    const b = tileBBox({ z: 0, x: 0, y: 0 });
    expect(b.west).toBeCloseTo(-180, 6);
    expect(b.east).toBeCloseTo(180, 6);
    expect(b.north).toBeCloseTo(85.0511, 3);
    expect(b.south).toBeCloseTo(-85.0511, 3);
  });

  it('pixel 0,0 of a tile is its north-west corner', () => {
    const tile = { z: 15, x: 15633, y: 12320 };
    const b = tileBBox(tile);
    const p = tilePixelToLonLat(tile, 0, 0);
    expect(p.lon).toBeCloseTo(b.west, 9);
    expect(p.lat).toBeCloseTo(b.north, 9);
    const q = tilePixelToLonLat(tile, 256, 256);
    expect(q.lon).toBeCloseTo(b.east, 9);
    expect(q.lat).toBeCloseTo(b.south, 9);
  });

  it('fills url templates', () => {
    expect(tileUrl('https://x/{z}/{y}/{x}', { z: 19, x: 250405, y: 201562 })).toBe(
      'https://x/19/201562/250405',
    );
  });
});
