import type { DetectContext, Detector, Ring, TileCoord, TileDetection, TileWindow } from '../types.js';
import { bitmapPixelToLonLat, metersPerPixel, TILE_SIZE } from '../geo/mercator.js';
import { DEFAULT_THRESHOLDS, isStrictPoolPixel } from './color.js';
import { removeCollinear, simplifyRing, traceOutline } from './contour.js';
import { analyseWindow, CANDIDATE_LEVELS, type Candidate, type CandidateOptions, type PxRect, type WindowAnalysis } from './candidates.js';
import { MIN_POOL_AREA_M2 } from './detector.js';
import { FEATURE_NAMES } from './features.js';
import { calibratedScore, sourceFamily, type PoolModel, type SourceFamily } from './model.js';

export interface LearnedOptions {
  candidates: CandidateOptions;
  /** Candidates under this calibrated probability are not reported at all. */
  floor: number;
  /** Two candidates clash when their boxes share more than this share of the smaller box. */
  nmsOverlap: number;
  /**
   * How far the measured area reaches: `mask` counts the water pixels,
   * `half` adds half a pixel along the outline, `ring` adds the full pixel ring.
   */
  rim: 'mask' | 'half' | 'ring';
  /** Outline simplification tolerance, px. */
  simplifyEpsilonPx: number;
}

export const DEFAULT_LEARNED_OPTIONS: LearnedOptions = {
  candidates: { levels: CANDIDATE_LEVELS, minPixels: 10, minAreaM2: MIN_POOL_AREA_M2, maxAreaM2: 2000 },
  floor: 0.1,
  nmsOverlap: 0.3,
  rim: 'mask',
  simplifyEpsilonPx: 1.2,
};

/** Halo the product asks for around each tile, px of the tile's own bitmap. */
export const DEFAULT_HALO_PX = 48;

/**
 * Where the pixels of an image sit on the map: pixel (x, y) is pixel
 * (x - offsetX, y - offsetY) of `tile` drawn at `tilePx` per side.
 */
export interface PixelFrame {
  tile: TileCoord;
  tilePx: number;
  offsetX: number;
  offsetY: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
}

const TEX = FEATURE_NAMES.indexOf('in_tex');

export interface ScoredImage {
  analysis: WindowAnalysis;
  kept: ScoredCandidate[];
}

/**
 * Candidates of an image placed on the map by `frame`. `central` is the part
 * of the image this call answers for: a candidate counts only when its
 * centroid falls inside it. The training tools call this too, through the
 * CLI, so they see exactly the candidates the product scores.
 */
export function imageCandidates(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  frame: PixelFrame,
  central: PxRect,
  options: LearnedOptions = DEFAULT_LEARNED_OPTIONS,
): WindowAnalysis {
  const scale = TILE_SIZE / frame.tilePx;
  const mPerPxAt = (cy: number) => {
    const { lat } = bitmapPixelToLonLat(frame.tile, 0, cy - frame.offsetY, frame.tilePx);
    return metersPerPixel(lat, frame.tile.z) * scale;
  };
  return analyseWindow(pixels, width, height, central, mPerPxAt, options.candidates);
}

/** Frame and central square of a detector window. */
export function windowFrame(window: TileWindow): { frame: PixelFrame; central: PxRect } {
  const { width, height, halo, tilePx } = window;
  if (width !== tilePx + 2 * halo || height !== width) {
    throw new Error(`window is ${width}x${height}, expected ${tilePx + 2 * halo} square`);
  }
  if (window.pixels.length !== width * height * 4) throw new Error('pixel buffer does not match the window size');
  return {
    frame: { tile: window.tile, tilePx, offsetX: halo, offsetY: halo },
    central: { x0: halo, y0: halo, x1: halo + tilePx, y1: halo + tilePx },
  };
}

/** Score the candidates and keep the best of each overlapping group (greedy, by score). */
export function selectCandidates(
  analysis: WindowAnalysis,
  family: SourceFamily | 'default',
  model: PoolModel,
  options: LearnedOptions = DEFAULT_LEARNED_OPTIONS,
): ScoredCandidate[] {
  const scored = analysis.candidates
    .map((candidate) => ({ candidate, score: calibratedScore(model, family, candidate.features) }))
    .filter((s) => s.score >= options.floor)
    .sort((a, b) => b.score - a.score || a.candidate.level - b.candidate.level);
  const kept: ScoredCandidate[] = [];
  for (const s of scored) {
    const a = s.candidate.component;
    const areaA = (a.maxX - a.minX + 1) * (a.maxY - a.minY + 1);
    const clash = kept.some((k) => {
      const b = k.candidate.component;
      const iw = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) + 1;
      const ih = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1;
      if (iw <= 0 || ih <= 0) return false;
      const areaB = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
      return (iw * ih) / Math.min(areaA, areaB) > options.nmsOverlap;
    });
    if (!clash) kept.push(s);
  }
  return kept;
}

/** Candidates, scores and the kept set of one image. */
export function scoreImage(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  frame: PixelFrame,
  central: PxRect,
  family: SourceFamily | 'default',
  model: PoolModel,
  options: LearnedOptions = DEFAULT_LEARNED_OPTIONS,
): ScoredImage {
  const analysis = imageCandidates(pixels, width, height, frame, central, options);
  return { analysis, kept: selectCandidates(analysis, family, model, options) };
}

/** Turn a kept candidate into the detection the merger and the UI read. */
export function toTileDetection(
  s: ScoredCandidate,
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  frame: PixelFrame,
  hsv: { hue: Float32Array; sat: Float32Array; val: Float32Array },
  options: LearnedOptions = DEFAULT_LEARNED_OPTIONS,
): TileDetection {
  const { candidate: cand, score } = s;
  const c = cand.component;
  const geo = (x: number, y: number) => bitmapPixelToLonLat(frame.tile, x - frame.offsetX, y - frame.offsetY, frame.tilePx);

  let h = 0, sat = 0, v = 0, strict = 0, outside = 0, borderEdges = 0;
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      const i = y * width + x;
      if (cand.labels[i] !== c.label) continue;
      h += hsv.hue[i];
      sat += hsv.sat[i];
      v += hsv.val[i];
      if (isStrictPoolPixel(hsv.hue[i], hsv.sat[i], DEFAULT_THRESHOLDS)) strict++;
      for (const [dx, dy] of NEIGHBOURS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || cand.labels[ny * width + nx] !== c.label) borderEdges++;
      }
    }
  }
  if (options.rim === 'ring') outside = ringPixels(cand.labels, width, height, c);
  const px = c.pixelCount;
  const rimPx = options.rim === 'mask' ? 0 : options.rim === 'half' ? borderEdges / 2 : outside;
  const areaM2 = (px + rimPx) * cand.mPerPx * cand.mPerPx;

  const outlinePx = simplifyRing(removeCollinear(traceOutline(cand.labels, width, height, c.label, c)), options.simplifyEpsilonPx);
  const outline: Ring = outlinePx.map(([x, y]) => {
    const p = geo(x, y);
    return [p.lon, p.lat] as [number, number];
  });
  const nw = geo(c.minX, c.minY);
  const se = geo(c.maxX + 1, c.maxY + 1);
  const bw = c.maxX - c.minX + 1;
  const bh = c.maxY - c.minY + 1;
  const tex = cand.features[TEX];
  return {
    tile: frame.tile,
    pixelCount: px,
    bboxPx: { minX: c.minX - frame.offsetX, minY: c.minY - frame.offsetY, maxX: c.maxX - frame.offsetX, maxY: c.maxY - frame.offsetY },
    bbox: { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat },
    center: geo(cand.cx + 0.5, cand.cy + 0.5),
    outline,
    areaM2,
    meanHue: h / px,
    meanSat: sat / px,
    meanVal: v / px,
    strictRatio: strict / px,
    fillRatio: px / (bw * bh),
    texture: tex < 0 ? 0 : tex,
    // Shapes are whole within the window: nothing for the merger to join.
    touches: { n: false, e: false, s: false, w: false },
    score,
  };
}

const NEIGHBOURS4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Pixels outside the shape that touch it on a side: the one-pixel ring around it. */
function ringPixels(labels: Int32Array, width: number, height: number, c: { label: number; minX: number; minY: number; maxX: number; maxY: number }): number {
  let n = 0;
  for (let y = Math.max(0, c.minY - 1); y <= Math.min(height - 1, c.maxY + 1); y++) {
    for (let x = Math.max(0, c.minX - 1); x <= Math.min(width - 1, c.maxX + 1); x++) {
      const i = y * width + x;
      if (labels[i] === c.label) continue;
      if (
        (x > 0 && labels[i - 1] === c.label) ||
        (x < width - 1 && labels[i + 1] === c.label) ||
        (y > 0 && labels[i - width] === c.label) ||
        (y < height - 1 && labels[i + width] === c.label)
      ) n++;
    }
  }
  return n;
}

/** Detections of one window: candidates with their centroid in the central tile. */
export function detectWindow(window: TileWindow, ctx: DetectContext, model: PoolModel, options: LearnedOptions = DEFAULT_LEARNED_OPTIONS): TileDetection[] {
  const { frame, central } = windowFrame(window);
  const { pixels, width, height } = window;
  const { analysis, kept } = scoreImage(pixels, width, height, frame, central, sourceFamily(ctx.providerId), model, options);
  return kept.map((s) => toTileDetection(s, pixels, width, height, frame, analysis, options));
}

/** The v2 detector behind the shared seam. `version` changes with the model. */
export function createV2Detector(model: PoolModel, options: Partial<LearnedOptions> = {}): Detector {
  const opts: LearnedOptions = { ...DEFAULT_LEARNED_OPTIONS, ...options };
  const version = `v2:${String(model.meta.sha256 ?? model.meta.trainedAt ?? 'dev')}`;
  return {
    id: 'v2',
    version,
    detectTile: (window, ctx) => detectWindow(window, ctx, model, opts),
  };
}
