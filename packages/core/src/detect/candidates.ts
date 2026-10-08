import { DEFAULT_THRESHOLDS, hsvInto, type WaterThresholds } from './color.js';
import { cleanMask, labelComponents, type Component } from './mask.js';
import { componentFeatures, FEATURE_COUNT, type FeatureContext } from './features.js';

/** One colour gate of the candidate stage, with an optional shape test. */
export interface CandidateLevel {
  gate: WaterThresholds;
  /** Components below this fill of their box are dropped (level-specific shape test). */
  minFill?: number;
  /** Components with a longer box side to shorter side ratio are dropped. */
  maxAspect?: number;
  /**
   * Split a component that fills less than `belowFill` of its box, or is
   * larger than the area limit, into its darker and its brighter pixels
   * (Otsu threshold on brightness inside it) when the two means differ by at
   * least `minDelta`. A pool often joins a pale deck or a dark shadow of
   * the same hue into one blob; the parts become candidates of their own.
   */
  split?: { belowFill: number; minDelta: number; partMinFill?: number; partMaxAspect?: number };
}

/**
 * Colour gates of the candidate levels. Level 0 is the v1 gate; 1 and 2
 * loosen it for pale, greenish and shaded water. Level 3 keeps only bright
 * saturated water, which splits a pool from a blue shadow it touches (the
 * DGT renders shadows blue). Level 4 is the green band (hue 140 to 170, green
 * above blue: algae, green liners) with a shape test, since lawns pass a
 * green colour test. Level 5 takes olive and dark green water (abandoned
 * pools, algae), again with a shape test; such a pool often touches a lawn or
 * a tree of the same colour, so its blobs are also split by brightness. The
 * learned scorer sorts the candidates out.
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
  {
    gate: {
      ...DEFAULT_THRESHOLDS,
      hueMin: 50, hueMax: 175, satMin: 0.08, satStrong: 0.08, valBright: 0, valMin: 0.1,
      blueOverRed: -40, greenOverRed: 3, blueOverGreenMin: -60, blueOverGreenMax: 20,
    },
    minFill: 0.6,
    maxAspect: 3.5,
    split: { belowFill: 0.6, minDelta: 0.08, partMinFill: 0.5, partMaxAspect: 4 },
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
  hsvInto(pixels, hue, sat, val);
  const gates = colourGates(pixels, hue, sat, val, options.levels.map((lv) => lv.gate));

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
  const consider = (c: Component, labels: Int32Array, level: number, minFill: number, maxAspect: number) => {
    if (c.pixelCount < options.minPixels) return;
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    if (c.pixelCount / (bw * bh) < minFill || Math.max(bw, bh) / Math.min(bw, bh) > maxAspect) return;
    const cx = c.sumX / c.pixelCount;
    const cy = c.sumY / c.pixelCount;
    // Half-open on both axes, so a shape seen by two windows is reported by exactly one.
    if (cx < central.x0 || cx >= central.x1 || cy < central.y0 || cy >= central.y1) return;
    const mPerPx = mPerPxAt(cy);
    const areaM2 = c.pixelCount * mPerPx * mPerPx;
    if (areaM2 < options.minAreaM2 || areaM2 > options.maxAreaM2) return;
    const key = `${c.pixelCount}:${c.minX}:${c.minY}:${c.maxX}:${c.maxY}`;
    if (seen.has(key)) return;
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
  };
  // Split parts take the level numbers after the colour levels: dark parts, then bright parts.
  const darkLevel = options.levels.length;
  const brightLevel = darkLevel + 1;
  for (let level = 0; level < gates.length; level++) {
    const { minFill = 0, maxAspect = Infinity, split } = options.levels[level];
    const { labels, components } = labelComponents(cleanMask(gates[level], width, height), width, height);
    let parts: SplitParts | null = null;
    for (const c of components) {
      // Parts of a component outside the central square cannot have their centroid in it.
      const reaches = c.maxX >= central.x0 && c.minX < central.x1 && c.maxY >= central.y0 && c.minY < central.y1;
      if (split && reaches && c.pixelCount >= 2 * options.minPixels) {
        const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
        const big = c.pixelCount * mPerPxAt(c.sumY / c.pixelCount) ** 2 > options.maxAreaM2;
        if (big || c.pixelCount / (bw * bh) < split.belowFill) {
          parts ??= { labels: new Int32Array(width * height), next: 0 };
          for (const part of splitByBrightness(c, labels, val, width, height, split.minDelta, parts)) {
            consider(part.component, parts.labels, part.bright ? brightLevel : darkLevel, split.partMinFill ?? 0, split.partMaxAspect ?? Infinity);
          }
        }
      }
      consider(c, labels, level, minFill, maxAspect);
    }
  }
  return { width, height, hue, sat, val, candidates };
}

/** Labels of the split parts of one level, shared by all its components (parts never overlap). */
export interface SplitParts {
  labels: Int32Array;
  next: number;
}

/**
 * The darker and the brighter pixels of component `c`, cleaned and labelled
 * again, written into `parts.labels`. Nothing when the brightness inside
 * the component is not clearly two-sided.
 */
export function splitByBrightness(
  c: Component,
  labels: Int32Array,
  val: Float32Array,
  width: number,
  height: number,
  minDelta: number,
  parts: SplitParts,
): { component: Component; bright: boolean }[] {
  const BINS = 64;
  const hist = new Float64Array(BINS);
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      const i = y * width + x;
      if (labels[i] === c.label) hist[Math.min(BINS - 1, Math.floor(val[i] * BINS))]++;
    }
  }
  // Otsu: the cut with the largest between-class variance.
  const total = c.pixelCount;
  let sumAll = 0;
  for (let b = 0; b < BINS; b++) sumAll += b * hist[b];
  let w0 = 0, sum0 = 0, best = -1, cut = -1, gap = 0;
  for (let b = 0; b < BINS - 1; b++) {
    w0 += hist[b];
    sum0 += b * hist[b];
    const w1 = total - w0;
    if (w0 === 0 || w1 === 0) continue;
    const m0 = sum0 / w0, m1 = (sumAll - sum0) / w1;
    const between = w0 * w1 * (m0 - m1) ** 2;
    if (between > best) {
      best = between;
      cut = b;
      gap = (m1 - m0) / BINS;
    }
  }
  if (cut < 0 || gap < minDelta) return [];
  const threshold = (cut + 1) / BINS;

  // Local grid: the component's box plus a margin of one pixel that stays empty.
  const x0 = Math.max(0, c.minX - 1), y0 = Math.max(0, c.minY - 1);
  const x1 = Math.min(width - 1, c.maxX + 1), y1 = Math.min(height - 1, c.maxY + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out: { component: Component; bright: boolean }[] = [];
  for (const bright of [false, true]) {
    const m = new Uint8Array(w * h);
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        const i = y * width + x;
        if (labels[i] === c.label && val[i] >= threshold === bright) m[(y - y0) * w + (x - x0)] = 1;
      }
    }
    const local = labelComponents(cleanMask(m, w, h), w, h);
    const base = parts.next;
    parts.next += local.components.length;
    for (const lc of local.components) {
      out.push({
        component: {
          label: base + lc.label,
          pixelCount: lc.pixelCount,
          minX: lc.minX + x0,
          minY: lc.minY + y0,
          maxX: lc.maxX + x0,
          maxY: lc.maxY + y0,
          sumX: lc.sumX + x0 * lc.pixelCount,
          sumY: lc.sumY + y0 * lc.pixelCount,
        },
        bright,
      });
    }
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const l = local.labels[ly * w + lx];
        if (l) parts.labels[(ly + y0) * width + lx + x0] = base + l;
      }
    }
  }
  return out;
}

/** `colourGate` for several gates in one pass over the pixels. */
export function colourGates(
  pixels: Uint8ClampedArray | Uint8Array,
  hue: Float32Array,
  sat: Float32Array,
  val: Float32Array,
  gates: readonly WaterThresholds[],
): Uint8Array[] {
  const n = hue.length;
  const out = gates.map(() => new Uint8Array(n));
  const k = gates.length;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (pixels[o + 3] < 200) continue;
    const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
    const h = hue[i], s = sat[i], v = val[i];
    const br = b - r, gr = g - r, bg = b - g;
    for (let j = 0; j < k; j++) {
      const t = gates[j];
      if (
        h >= t.hueMin && h <= t.hueMax &&
        v >= t.valMin &&
        (s >= t.satStrong || (s >= t.satMin && v >= t.valBright)) &&
        br >= t.blueOverRed &&
        gr >= t.greenOverRed &&
        bg >= t.blueOverGreenMin &&
        bg <= t.blueOverGreenMax
      ) {
        out[j][i] = 1;
      }
    }
  }
  return out;
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
