import type { TileCoord, TileDetection } from '../src/types.js';
import { metersPerPixel, tilePixelToLonLat } from '../src/geo/mercator.js';

export const POOL_RGB: [number, number, number] = [45, 170, 190]; // hue ≈ 188°, clearly pool
export const GREY_RGB: [number, number, number] = [120, 118, 115];
export const GRASS_RGB: [number, number, number] = [80, 140, 60];
export const ROOF_BLUE_RGB: [number, number, number] = [60, 80, 200]; // hue ≈ 231°, too blue

export interface RectSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: [number, number, number];
}

/** Build a synthetic RGBA tile: solid background plus rectangles. */
export function makeTile(
  width = 256,
  height = 256,
  background: [number, number, number] = GREY_RGB,
  rects: RectSpec[] = [],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = background[0];
    rgba[i * 4 + 1] = background[1];
    rgba[i * 4 + 2] = background[2];
    rgba[i * 4 + 3] = 255;
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        rgba[o] = r.rgb[0];
        rgba[o + 1] = r.rgb[1];
        rgba[o + 2] = r.rgb[2];
      }
    }
  }
  return rgba;
}

/** Build a TileDetection directly from a pixel rect (bypassing the detector). */
export function makeFragment(
  tile: TileCoord,
  rect: { x: number; y: number; w: number; h: number },
  overrides: Partial<TileDetection> = {},
): TileDetection {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const center = tilePixelToLonLat(tile, cx, cy);
  const mpp = metersPerPixel(center.lat, tile.z);
  const nw = tilePixelToLonLat(tile, rect.x, rect.y);
  const se = tilePixelToLonLat(tile, rect.x + rect.w, rect.y + rect.h);
  const pixelCount = rect.w * rect.h;
  return {
    tile,
    pixelCount,
    bboxPx: { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w - 1, maxY: rect.y + rect.h - 1 },
    bbox: { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat },
    center,
    outline: [
      [nw.lon, nw.lat],
      [se.lon, nw.lat],
      [se.lon, se.lat],
      [nw.lon, se.lat],
    ],
    areaM2: pixelCount * mpp * mpp,
    meanHue: 188,
    meanSat: 0.7,
    meanVal: 0.7,
    strictRatio: 0.9,
    fillRatio: 1,
    texture: 0.01,
    touches: {
      n: rect.y === 0,
      w: rect.x === 0,
      s: rect.y + rect.h === 256,
      e: rect.x + rect.w === 256,
    },
    ...overrides,
  };
}
