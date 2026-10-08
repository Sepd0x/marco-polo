/**
 * Colour analysis for water detection.
 *
 * Swimming-pool water has one of the most distinctive colour signatures in aerial
 * imagery: chlorinated water over a light liner reflects strongly in the cyan band
 * (hue about 170 to 205°), with moderate to high saturation. Natural water (sea,
 * lakes, rivers) trends darker, greener or muddier, and is orders of magnitude
 * larger: the geometry filters handle it downstream.
 */

export interface WaterThresholds {
  /** Broad hue window (degrees) a pixel may occupy to count as water at all. */
  hueMin: number;
  hueMax: number;
  /** Absolute saturation floor (0 to 1): rejects grey roofs, concrete, shadow haze. */
  satMin: number;
  /**
   * Saturation at which a pixel qualifies regardless of brightness.
   * Below it, the pixel must also be bright (≥ valBright): pale pools are
   * bright, deep pools are saturated, asphalt shadow is neither.
   */
  satStrong: number;
  /** Brightness that lets a weakly-saturated pixel through (pale sunlit water). */
  valBright: number;
  /** Minimum value/brightness (0 to 1): rejects deep shadow. */
  valMin: number;
  /** Blue channel must exceed red by this much (0 to 255): rejects warm surfaces. */
  blueOverRed: number;
  /** Green must not lag red (turquoise = green and blue high together). */
  greenOverRed: number;
  /**
   * Allowed blue minus green window (0 to 255). Turquoise water has green and blue
   * nearly balanced; photovoltaic panels and blue roofs are strongly
   * blue-dominant, vegetation strongly green-dominant. This band rejects both.
   */
  blueOverGreenMin: number;
  blueOverGreenMax: number;
  /** Tight “unmistakably pool” band used for confidence scoring. */
  strictHueMin: number;
  strictHueMax: number;
  strictSatMin: number;
}

export const DEFAULT_THRESHOLDS: WaterThresholds = {
  hueMin: 148,
  hueMax: 215,
  satMin: 0.2,
  satStrong: 0.34,
  valBright: 0.5,
  valMin: 0.24,
  blueOverRed: 10,
  greenOverRed: -8,
  blueOverGreenMin: -12,
  blueOverGreenMax: 70,
  strictHueMin: 168,
  strictHueMax: 205,
  strictSatMin: 0.34,
};

/** RGB (0 to 255) to HSV (h in degrees 0 to 360, s and v in 0 to 1). */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/** `rgbToHsv` for every pixel of an RGBA buffer, written into the three arrays. */
export function hsvInto(pixels: Uint8ClampedArray | Uint8Array, hue: Float32Array, sat: Float32Array, val: Float32Array): void {
  const n = hue.length;
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
    }
    hue[i] = h;
    sat[i] = max === 0 ? 0 : d / max;
    val[i] = max / 255;
  }
}

export interface WaterMask {
  /** 1 where the pixel matches the broad water signature. */
  mask: Uint8Array;
  hue: Float32Array;
  sat: Float32Array;
  val: Float32Array;
  width: number;
  height: number;
}

/** Classify every pixel of an RGBA buffer against the water signature. */
export function buildWaterMask(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  t: WaterThresholds = DEFAULT_THRESHOLDS,
): WaterMask {
  const n = width * height;
  const mask = new Uint8Array(n);
  const hue = new Float32Array(n);
  const sat = new Float32Array(n);
  const val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const a = rgba[o + 3];
    const { h, s, v } = rgbToHsv(r, g, b);
    hue[i] = h;
    sat[i] = s;
    val[i] = v;
    if (
      a >= 200 &&
      h >= t.hueMin && h <= t.hueMax &&
      v >= t.valMin &&
      (s >= t.satStrong || (s >= t.satMin && v >= t.valBright)) &&
      b - r >= t.blueOverRed &&
      g - r >= t.greenOverRed &&
      b - g >= t.blueOverGreenMin &&
      b - g <= t.blueOverGreenMax
    ) {
      mask[i] = 1;
    }
  }
  return { mask, hue, sat, val, width, height };
}

export function isStrictPoolPixel(h: number, s: number, t: WaterThresholds = DEFAULT_THRESHOLDS): boolean {
  return h >= t.strictHueMin && h <= t.strictHueMax && s >= t.strictSatMin;
}
