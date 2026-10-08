import { sha256Hex } from './sha256.js';

/**
 * Why a tile response holds no imagery. Such tiles count as "no coverage",
 * never as "no pools".
 * - `not-found`: the server said there is nothing there (IGN answers 404).
 * - `placeholder`: a known stand-in image (Esri "Map data not yet available").
 * - `blank`: white or fully transparent (DGT outside Portugal, IGN near borders).
 * - `flat`: one or two flat colours with no texture (PNOA outside Spain).
 */
export type NoDataReason = 'not-found' | 'placeholder' | 'blank' | 'flat';

/** What came back for one tile; give whatever is at hand. */
export interface TileResponse {
  status?: number;
  /** Encoded body as received. */
  bytes?: Uint8Array;
  /** Decoded RGBA, row-major. */
  pixels?: Uint8ClampedArray | Uint8Array;
  width?: number;
  height?: number;
}

/**
 * SHA-256 of placeholder bodies seen in the wild. The Esri one is 2 521 bytes,
 * served with HTTP 200 and ETag "vvvvvvvvvvvvf" at z20 and z21 over Vilamoura
 * and at z20 over Scottsdale (7 Oct 2026).
 */
export const KNOWN_PLACEHOLDERS: Readonly<Record<string, string>> = {
  '9eafd300d61393184a4abc1d458564cfd1cd9b6f9c4e9c74687045c0a0e5b858': 'Esri: Map data not yet available',
};

/**
 * Below this mean absolute difference between neighbouring pixels (luminance,
 * 0 to 255) a tile is flat. Measured 7 Oct 2026: PNOA fill outside Spain 0.000
 * to 0.027, DGT white 0.000; the smoothest of 6 081 real tiles in the cache
 * (open water, Esri) 0.104.
 */
export const FLAT_THRESHOLD = 0.05;

/** Share of pixels that must be white or transparent for a tile to be blank. */
export const BLANK_SHARE = 0.995;

export function noDataReason(
  res: TileResponse,
  placeholders: Readonly<Record<string, string>> = KNOWN_PLACEHOLDERS,
): NoDataReason | null {
  if (res.status === 404 || res.status === 204) return 'not-found';
  if (res.bytes && res.bytes.length > 0 && res.bytes.length < 64 * 1024) {
    if (sha256Hex(res.bytes) in placeholders) return 'placeholder';
  }
  if (res.pixels && res.width && res.height) {
    if (blankShare(res.pixels) >= BLANK_SHARE) return 'blank';
    if (flatness(res.pixels, res.width, res.height) < FLAT_THRESHOLD) return 'flat';
  }
  return null;
}

/** Share of pixels that are fully transparent or white (all channels >= 250). */
export function blankShare(pixels: Uint8ClampedArray | Uint8Array): number {
  const n = pixels.length >> 2;
  if (n === 0) return 1;
  let blank = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0 || (pixels[i] >= 250 && pixels[i + 1] >= 250 && pixels[i + 2] >= 250)) blank++;
  }
  return blank / n;
}

/** Mean absolute luminance difference between horizontal and vertical neighbours. */
export function flatness(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  if (width < 2 || height < 2) return 0;
  const lum = new Float32Array(width * height);
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    lum[p] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = lum[row + x];
      if (x + 1 < width) {
        sum += Math.abs(lum[row + x + 1] - v);
        count++;
      }
      if (y + 1 < height) {
        sum += Math.abs(lum[row + width + x] - v);
        count++;
      }
    }
  }
  return sum / count;
}
