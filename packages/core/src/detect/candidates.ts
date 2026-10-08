import { DEFAULT_THRESHOLDS, rgbToHsv, type WaterThresholds } from './color.js';
import { cleanMask, labelComponents, type Component } from './mask.js';
import { componentFeatures, FEATURE_COUNT, type FeatureContext } from './features.js';

/** One colour gate of the candidate stage, with an optional shape test. */
export interface CandidateLevel {
  gate: WaterThresholds;
  /** Components below this fill of their box are dropped (level-specific shape test). */
  minFill?: number;
  /** Components with a longer box side to shorter side ratio are dropped. */
  maxAspect?: number;
}

/**
 * Colour gates of the candidate levels. Level 0 is the v1 gate; 1 and 2
 * loosen it for pale, greenish and shaded water. Level 3 keeps only bright
 * saturated water, which splits a pool from a blue shadow it touches (the
 * DGT renders shadows blue). Level 4 is the green band (hue 140 to 170, green
 * above blue: algae, green liners) with a shape test, since lawns pass a
 * green colour test. The learned scorer sorts the candidates out.
 */
export const CANDIDATE_LEVELS: readonly CandidateLevel[] = [
  { gate: DEFAULT_THRESHOLDS },
  {
    gate: {
      ...DEFAULT_THRESHOLDS,
      hueMin: 145, hueMax: 225, satMin: 0.14, satStrong: 0.26, valBright: 0.42, valMin: 0.16,
      blueOverRed: 4, greenOverRed: -14, blueOverGreenMin: -20, blueOverGreenMax: 80,
    },
  },
  {
    gate: {
      ...DEFAULT_THRESHOLDS,
      hueMin: 140, hueMax: 232, satMin: 0.1, satStrong: 0.1, valBright: 0, valMin: 0.12,
      blueOverRed: 0, greenOverRed: -24, blueOverGreenMin: -30, blueOverGreenMax: 95,
    },
  },
  {
    gate: {
      ...DEFAULT_THRESHOLDS,
      hueMin: 165, hueMax: 215, satMin: 0.25, satStrong: 0.25, valBright: 0, valMin: 0.45,
      blueOverRed: 25, greenOverRed: 5, blueOverGreenMin: -12, blueOverGreenMax: 70,
    },
  },
  {
    gate: {
      ...DEFAULT_THRESHOLDS,
      hueMin: 140, hueMax: 170, satMin: 0.15, satStrong: 0.3, valBright: 0.35, valMin: 0.15,
      blueOverRed: 0, greenOverRed: 10, blueOverGreenMin: -60, blueOverGreenMax: 0,
    },
    minFill: 0.55,
    maxAspect: 4,
  },
];

export interface CandidateOptions {
  levels: readonly CandidateLevel[];
  /** Noise floor before any geographic reasoning, px. */
  minPixels: number;
  /** Smallest candidate kept, m². */
  minAreaM2: number;
  /** Largest candidate kept, m² (bigger blobs are open water or roofs). */
  maxAreaM2: number;
}

/** Pixel rectangle `[x0, x1) x [y0, y1)`. */
export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Candidate {
  level: number;
  component: Component;
  /** Labels of the candidate's level; `component.label` marks its pixels. */
  labels: Int32Array;
  /** Centroid, window px. */
  cx: number;
  cy: number;
  mPerPx: number;
  areaM2: number;
  /** The shape reaches the window border: it may continue outside the window. */
  touchesBorder: boolean;
  features: Float64Array;
}

export interface WindowAnalysis {
  width: number;
  height: number;
  hue: Float32Array;
  sat: Float32Array;
  val: Float32Array;
  candidates: Candidate[];
}

/**
 * Candidates of one window: each gate, cleaned and labelled; components whose
 * centroid falls inside `central`, sized between the limits, each with its
 * features. A blob found identical by a stricter level is kept once.
 * `mPerPxAt(cy)` gives the ground size of a pixel on window row `cy`.
 */
export function analyseWindow(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  central: PxRect,
  mPerPxAt: (cy: number) => number,
  options: CandidateOptions,
): WindowAnalysis {
  const n = width * height;
  const hue = new Float32Array(n);
  const sat = new Float32Array(n);
  const val = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { h, s, v } = rgbToHsv(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
    hue[i] = h;
    sat[i] = s;
    val[i] = v;
  }
  const gates = options.levels.map((lv) => colourGate(pixels, hue, sat, val, lv.gate));

  let sv = 0, ss = 0, sn = 0;
  for (let y = central.y0; y < central.y1; y++) {
    for (let x = central.x0; x < central.x1; x++) {
      const i = y * width + x;
      if (pixels[i * 4 + 3] < 200) continue;
      sv += val[i];
      ss += sat[i];
      sn++;
    }
  }
  const ctx: FeatureContext = {
    pixels,
    width,
    height,
    hue,
    sat,
    val,
    strictGate: gates[0],
    permissiveGate: gates[Math.min(2, gates.length - 1)],
    contextV: sn ? sv / sn : 0,
    contextS: sn ? ss / sn : 0,
  };

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (let level = 0; level < gates.length; level++) {
    const { minFill = 0, maxAspect = Infinity } = options.levels[level];
    const { labels, components } = labelComponents(cleanMask(gates[level], width, height), width, height);
    for (const c of components) {
      if (c.pixelCount < options.minPixels) continue;
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      if (c.pixelCount / (bw * bh) < minFill || Math.max(bw, bh) / Math.min(bw, bh) > maxAspect) continue;
      const cx = c.sumX / c.pixelCount;
      const cy = c.sumY / c.pixelCount;
      // Half-open on both axes, so a shape seen by two windows is reported by exactly one.
      if (cx < central.x0 || cx >= central.x1 || cy < central.y0 || cy >= central.y1) continue;
      const mPerPx = mPerPxAt(cy);
      const areaM2 = c.pixelCount * mPerPx * mPerPx;
      if (areaM2 < options.minAreaM2 || areaM2 > options.maxAreaM2) continue;
      const key = `${c.pixelCount}:${c.minX}:${c.minY}:${c.maxX}:${c.maxY}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const features = new Float64Array(FEATURE_COUNT);
      componentFeatures(ctx, labels, c, level, mPerPx, features);
      candidates.push({
        level,
        component: c,
        labels,
        cx,
        cy,
        mPerPx,
        areaM2,
        touchesBorder: c.minX === 0 || c.minY === 0 || c.maxX === width - 1 || c.maxY === height - 1,
        features,
      });
    }
  }
  return { width, height, hue, sat, val, candidates };
}

/** The colour test of `buildWaterMask`, on precomputed HSV. */
export function colourGate(
  pixels: Uint8ClampedArray | Uint8Array,
  hue: Float32Array,
  sat: Float32Array,
  val: Float32Array,
  t: WaterThresholds,
): Uint8Array {
  const n = hue.length;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
    const h = hue[i], s = sat[i], v = val[i];
    if (
      pixels[o + 3] >= 200 &&
      h >= t.hueMin && h <= t.hueMax &&
      v >= t.valMin &&
      (s >= t.satStrong || (s >= t.satMin && v >= t.valBright)) &&
      b - r >= t.blueOverRed &&
      g - r >= t.greenOverRed &&
      b - g >= t.blueOverGreenMin &&
      b - g <= t.blueOverGreenMax
    ) {
      m[i] = 1;
    }
  }
  return m;
}
