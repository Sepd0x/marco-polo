import type { Ring, TileCoord, TileDetection } from '../types.js';
import { metersPerPixel, tilePixelToLonLat } from '../geo/mercator.js';
import { buildWaterMask, DEFAULT_THRESHOLDS, isStrictPoolPixel, type WaterThresholds } from './color.js';
import { cleanMask, labelComponents } from './mask.js';
import { removeCollinear, simplifyRing, traceOutline } from './contour.js';

export interface DetectorOptions {
  thresholds: WaterThresholds;
  /** Smallest shape worth keeping, m² (hot tubs start around 3 m²). */
  minAreaM2: number;
  /** Largest single pool considered plausible, m². Bigger blobs are natural water. */
  maxAreaM2: number;
  /** Noise floor in pixels, applied before any geographic reasoning. */
  minPixels: number;
  /** Above this aspect ratio a non-edge shape is a canal/ditch/paint stripe, not a pool. */
  maxAspect: number;
  /**
   * Hard ceiling on interior surface texture. Pool water is glassy — mean local
   * brightness gradients stay very low. Bushes, hedges and photovoltaic arrays
   * that sneak through the colour gate are strongly textured and fail this.
   */
  maxTexture: number;
  /** Outline simplification tolerance in pixels. */
  simplifyEpsilonPx: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  thresholds: DEFAULT_THRESHOLDS,
  minAreaM2: 3,
  maxAreaM2: 2000,
  minPixels: 12,
  maxAspect: 8,
  maxTexture: 0.15,
  simplifyEpsilonPx: 1.2,
};

/**
 * Detect pool candidates in one satellite tile.
 *
 * Pipeline: water-signature mask → morphological cleanup → 8-connected
 * components → shape/size filters → outline tracing → geographic projection.
 * Components touching a tile edge are kept even when small: they may be
 * fragments of a pool that continues in the neighbouring tile, and the
 * cross-tile merger makes the final call.
 */
export function detectTile(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  tile: TileCoord,
  options: Partial<DetectorOptions> = {},
): TileDetection[] {
  const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
  const t = opts.thresholds;

  const { mask, hue, sat, val } = buildWaterMask(rgba, width, height, t);
  const cleaned = cleanMask(mask, width, height);
  const { labels, components } = labelComponents(cleaned, width, height);

  const detections: TileDetection[] = [];
  if (components.length === 0) return detections;

  // Per-component colour + texture statistics in one pass over the labelled
  // pixels. Texture (mean local brightness gradient) is sampled only where a
  // pixel's 4-neighbourhood shares its label — component borders would
  // otherwise contaminate the measurement with the shape's own edge.
  const stats = new Map<number, { h: number; s: number; v: number; strict: number; tex: number; texN: number }>();
  for (const c of components) stats.set(c.label, { h: 0, s: 0, v: 0, strict: 0, tex: 0, texN: 0 });
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (!l) continue;
    const st = stats.get(l)!;
    st.h += hue[i];
    st.s += sat[i];
    st.v += val[i];
    if (isStrictPoolPixel(hue[i], sat[i], t)) st.strict++;
    const x = i % width;
    const y = (i / width) | 0;
    if (
      x > 0 && x < width - 1 && y > 0 && y < height - 1 &&
      labels[i - 1] === l && labels[i + 1] === l &&
      labels[i - width] === l && labels[i + width] === l
    ) {
      // Forward differences on purpose: central differences straddle
      // 1-px-period texture (checker-like panel seams) and read it as smooth.
      st.tex += Math.abs(val[i + 1] - val[i]) + Math.abs(val[i + width] - val[i]);
      st.texN++;
    }
  }

  for (const c of components) {
    if (c.pixelCount < opts.minPixels) continue;

    const touches = {
      n: c.minY === 0,
      w: c.minX === 0,
      s: c.maxY === height - 1,
      e: c.maxX === width - 1,
    };
    const touchesEdge = touches.n || touches.e || touches.s || touches.w;

    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const aspect = Math.max(bw, bh) / Math.min(bw, bh);
    const fillRatio = c.pixelCount / (bw * bh);

    // Elongated low-fill shapes that are fully inside the tile are linear
    // features (canals, painted lanes), not pools.
    if (!touchesEdge && aspect > opts.maxAspect) continue;
    if (!touchesEdge && fillRatio < 0.22) continue;

    // Textured surfaces (hedges, photovoltaic arrays) are not water, no matter
    // how convincing their colour. Judged only with enough interior samples.
    const stRef = stats.get(c.label)!;
    const texture = stRef.texN >= Math.max(6, c.pixelCount * 0.12) ? stRef.tex / stRef.texN : 0;
    if (texture > opts.maxTexture) continue;

    const cxPx = c.sumX / c.pixelCount;
    const cyPx = c.sumY / c.pixelCount;
    const center = tilePixelToLonLat(tile, cxPx + 0.5, cyPx + 0.5);
    const mpp = metersPerPixel(center.lat, tile.z);
    const areaM2 = c.pixelCount * mpp * mpp;

    // Interior shapes must be pool-sized. Edge fragments stay candidates —
    // unless they are already far beyond any plausible pool (open water).
    if (!touchesEdge && (areaM2 < opts.minAreaM2 || areaM2 > opts.maxAreaM2)) continue;
    if (touchesEdge && areaM2 > opts.maxAreaM2 * 4) continue;

    const st = stRef;
    const outlinePx = simplifyRing(
      removeCollinear(traceOutline(labels, width, height, c.label)),
      opts.simplifyEpsilonPx,
    );
    const outline: Ring = outlinePx.map(([px, py]) => {
      const { lon, lat } = tilePixelToLonLat(tile, px, py);
      return [lon, lat] as [number, number];
    });

    const nwCorner = tilePixelToLonLat(tile, c.minX, c.minY);
    const seCorner = tilePixelToLonLat(tile, c.maxX + 1, c.maxY + 1);

    detections.push({
      tile,
      pixelCount: c.pixelCount,
      bboxPx: { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY },
      bbox: { west: nwCorner.lon, north: nwCorner.lat, east: seCorner.lon, south: seCorner.lat },
      center,
      outline,
      areaM2,
      meanHue: st.h / c.pixelCount,
      meanSat: st.s / c.pixelCount,
      meanVal: st.v / c.pixelCount,
      strictRatio: st.strict / c.pixelCount,
      fillRatio,
      texture,
      touches,
    });
  }
  return detections;
}

export interface ConfidenceInput {
  meanHue: number;
  meanSat: number;
  strictRatio: number;
  fillRatio: number;
  texture: number;
  areaM2: number;
  truncated: boolean;
}

/**
 * Score how pool-like a detection is, 0–1.
 * Blends colour evidence (dominant), surface smoothness, shape compactness
 * and size plausibility.
 */
export function scoreConfidence(d: ConfidenceInput): number {
  const hueScore = Math.exp(-((d.meanHue - 189) ** 2) / (2 * 26 ** 2));
  const satScore = clamp01((d.meanSat - 0.15) / 0.45);
  const shapeScore = clamp01((d.fillRatio - 0.28) / 0.45);
  const smoothScore = clamp01((0.1 - d.texture) / 0.08);
  const sizeScore =
    d.areaM2 < 10
      ? clamp01(d.areaM2 / 10)
      : d.areaM2 <= 150
        ? 1
        : Math.max(0.25, 1 - (d.areaM2 - 150) / 2500);
  let c =
    0.3 * d.strictRatio +
    0.18 * hueScore +
    0.14 * satScore +
    0.15 * smoothScore +
    0.12 * shapeScore +
    0.11 * sizeScore;
  if (d.truncated) c *= 0.9;
  return Math.round(clamp01(c) * 1000) / 1000;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
