import type { TileCoord, TileWindow } from '../types.js';
import { metersPerPixelOfBitmap } from '../geo/mercator.js';

type Pixels = Uint8ClampedArray | Uint8Array;

/** Offsets of the eight neighbours, row by row. */
export const NEIGHBOUR_OFFSETS: readonly [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** The tile at an offset, wrapping across the antimeridian; null past the poles. */
export function neighbourTile(tile: TileCoord, dx: number, dy: number): TileCoord | null {
  const n = 2 ** tile.z;
  const y = tile.y + dy;
  if (y < 0 || y >= n) return null;
  return { z: tile.z, x: (((tile.x + dx) % n) + n) % n, y };
}

/**
 * Assemble a detector window for an XYZ source: the central tile plus `halo`
 * pixels from each of the eight neighbours. `pixelsAt(dx, dy)` returns the
 * RGBA of the tile at that offset (each `tilePx` square), or null when it is
 * missing; missing parts stay transparent (alpha 0) so a detector can tell
 * them from imagery.
 */
export function buildTileWindow(
  tile: TileCoord,
  tilePx: number,
  halo: number,
  pixelsAt: (dx: number, dy: number) => Pixels | null,
): TileWindow {
  if (!Number.isInteger(halo) || halo < 0 || halo > tilePx) {
    throw new RangeError(`halo must be a whole number from 0 to ${tilePx}, got ${halo}`);
  }
  const size = tilePx + 2 * halo;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (halo === 0 && (dx !== 0 || dy !== 0)) continue;
      const src = pixelsAt(dx, dy);
      if (!src) {
        if (dx === 0 && dy === 0) throw new Error('the central tile is required');
        continue;
      }
      if (src.length !== tilePx * tilePx * 4) {
        throw new Error(`tile at (${dx},${dy}) has ${src.length / 4} px, expected ${tilePx}x${tilePx}`);
      }
      // Source columns/rows of this neighbour that fall inside the window.
      const sx0 = dx < 0 ? tilePx - halo : 0;
      const sx1 = dx > 0 ? halo : tilePx;
      const sy0 = dy < 0 ? tilePx - halo : 0;
      const sy1 = dy > 0 ? halo : tilePx;
      const ox = halo + dx * tilePx;
      const oy = halo + dy * tilePx;
      for (let sy = sy0; sy < sy1; sy++) {
        const from = (sy * tilePx + sx0) * 4;
        const to = ((oy + sy) * size + ox + sx0) * 4;
        out.set(src.subarray(from, from + (sx1 - sx0) * 4), to);
      }
    }
  }
  return {
    tile,
    tilePx,
    halo,
    width: size,
    height: size,
    pixels: out,
    mPerPx: metersPerPixelOfBitmap(tile, tilePx),
  };
}

/**
 * Window from one bitmap that already holds the halo (a WMS request grown by
 * `halo` px per side, see `wmsTileRequest`).
 */
export function windowFromBitmap(tile: TileCoord, pixels: Pixels, width: number, height: number, halo: number): TileWindow {
  if (width !== height) throw new Error(`window must be square, got ${width}x${height}`);
  const tilePx = width - 2 * halo;
  if (tilePx <= 0) throw new RangeError(`halo ${halo} leaves no central tile in ${width} px`);
  if (pixels.length !== width * height * 4) throw new Error('pixel buffer does not match the size');
  return { tile, tilePx, halo, width, height, pixels, mPerPx: metersPerPixelOfBitmap(tile, tilePx) };
}
