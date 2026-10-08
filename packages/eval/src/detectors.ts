import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  defaultThreshold,
  DEFAULT_HALO_PX,
  DEFAULT_LEARNED_OPTIONS,
  DetectionMerger,
  detectTile,
  detectWindow,
  scoreImage,
  sourceFamily,
  TILE_SIZE,
  toTileDetection,
  type Detection,
  type DetectorOptions,
  type LearnedOptions,
  type MergerOptions,
  type PoolModel,
  type ScanTile,
  type TileCoord,
  type TileDetection,
  type TileWindow,
} from '@marco-polo/core';
import type { DecodedTile } from '../../cli/src/tiles.js';
import type { EvalDetection } from './types.js';

export interface DetectorRun {
  /** Every detection the detector emitted, any confidence. The threshold is applied later. */
  detections: EvalDetection[];
  /** Detector CPU time, ms (decode and network excluded). */
  computeMs: number;
  tilesMissing: number;
}

/** Central tile plus a halo, as the product would hand it to the detector. */
export interface WindowAccess {
  providerId: string;
  /** `tilePx` 512 asks a WMS source for the tile at 512 px (the DGT scan grid is z18 at 512 px). */
  window(tile: ScanTile, halo: number, tilePx?: number): Promise<TileWindow | null>;
}

/**
 * A detector under test. It sees decoded tiles of the scan plan in traversal
 * order, exactly like the web app, and returns merged detections. Detectors
 * that read a halo use `windows`.
 */
export interface Detector {
  id: string;
  description: string;
  run(tiles: ScanTile[], get: (t: ScanTile) => Promise<DecodedTile | null>, windows?: WindowAccess): Promise<DetectorRun>;
  /** Threshold for a source, when the detector has its own per source. */
  thresholdFor?(providerId: string): number;
}

function toEval(d: Detection): EvalDetection {
  return { id: d.id, center: d.center, bbox: d.bbox, outline: d.outline.map((r) => [r]), areaM2: d.areaM2, confidence: d.confidence, kind: d.kind, truncated: d.truncated };
}

/** A detector built from packages/core with option overrides. */
export function coreDetector(id: string, description: string, det: Partial<DetectorOptions> = {}, merge: Partial<MergerOptions> = {}): Detector {
  return {
    id,
    description,
    async run(tiles, get) {
      const merger = new DetectionMerger(merge, tiles.map((t) => t.tile));
      let computeMs = 0;
      let tilesMissing = 0;
      for (const st of tiles) {
        const img = await get(st);
        const t0 = performance.now();
        if (img) {
          merger.addTileDetections(st.tile, detectTile(img.rgba, img.width, img.height, st.tile, det));
        } else {
          tilesMissing++;
          merger.addTileDetections(st.tile, []);
        }
        computeMs += performance.now() - t0;
      }
      const t0 = performance.now();
      merger.finalize();
      const all = merger.getAll();
      computeMs += performance.now() - t0;
      return { computeMs, tilesMissing, detections: all.map(toEval) };
    },
  };
}

/**
 * v1: packages/core as shipped. The merger then emitted nothing under 8 m²;
 * the shared minimum is 3 m² now, so v1 keeps its own value to stay the
 * baseline it was.
 */
export const v1Detector = coreDetector('v1', 'packages/core detectTile + DetectionMerger as shipped (merger minimum 8 m²)', {}, { minAreaM2: 8 });

/** The model the product ships, or the file named by MARCO_POLO_MODEL (experiments only). */
export const MODEL_PATH = process.env.MARCO_POLO_MODEL ?? fileURLToPath(new URL('../../core/models/pool-v2.json', import.meta.url));

let modelCache: { path: string; model: PoolModel } | null = null;
export function loadModel(path = MODEL_PATH): PoolModel {
  if (modelCache?.path !== path) modelCache = { path, model: JSON.parse(readFileSync(path, 'utf8')) as PoolModel };
  return modelCache.model;
}

/** WMS sources are scanned on a z18 grid at 512 px; XYZ sources tile by tile at z19. */
function productTiles(tiles: ScanTile[], providerId: string): { tiles: ScanTile[]; tilePx: number } {
  if (!providerId.startsWith('dgt')) return { tiles, tilePx: TILE_SIZE };
  const parents = new Map<string, ScanTile>();
  for (const t of tiles) {
    const p: TileCoord = { z: t.tile.z - 1, x: t.tile.x >> 1, y: t.tile.y >> 1 };
    const k = `${p.x}/${p.y}`;
    if (!parents.has(k)) parents.set(k, { tile: p, bbox: t.bbox, index: parents.size });
  }
  return { tiles: [...parents.values()], tilePx: 2 * TILE_SIZE };
}

function mustWindows(windows: WindowAccess | undefined): WindowAccess {
  if (!windows) throw new Error('this detector reads windows with a halo; run it through evaluateZone');
  return windows;
}

/** v2 on the product path: one window per scan tile, halo around it, centroid rule, then the merger. */
export function v2Detector(opts: { halo?: number; learned?: Partial<LearnedOptions>; id?: string } = {}): Detector {
  const halo = opts.halo ?? DEFAULT_HALO_PX;
  const learned: LearnedOptions = { ...DEFAULT_LEARNED_OPTIONS, ...opts.learned };
  return {
    id: opts.id ?? 'v2',
    description: `packages/core detectWindow (halo ${halo} px, model ${MODEL_PATH.split(/[\\/]/).slice(-1)[0]}) + DetectionMerger`,
    thresholdFor: (providerId) => defaultThreshold(loadModel(), providerId),
    async run(tiles, _get, windows) {
      const w = mustWindows(windows);
      const model = loadModel();
      const plan = productTiles(tiles, w.providerId);
      const merger = new DetectionMerger({}, plan.tiles.map((t) => t.tile));
      let computeMs = 0;
      let tilesMissing = 0;
      for (const st of plan.tiles) {
        const win = await w.window(st, halo * (plan.tilePx / TILE_SIZE), plan.tilePx);
        const t0 = performance.now();
        if (win) merger.addTileDetections(st.tile, detectWindow(win, { providerId: w.providerId }, model, learned));
        else {
          tilesMissing++;
          merger.addTileDetections(st.tile, []);
        }
        computeMs += performance.now() - t0;
      }
      merger.finalize();
      return { computeMs, tilesMissing, detections: merger.getAll().map(toEval) };
    },
  };
}

/**
 * Every candidate of the product path with confidence 1: what the scorer can
 * at best recover (the recall ceiling of the candidate stage).
 */
export function v2CandidateDetector(opts: { halo?: number; levels?: LearnedOptions['candidates']['levels'] } = {}): Detector {
  const halo = opts.halo ?? DEFAULT_HALO_PX;
  const everything: PoolModel = { format: 'marco-polo-pool-model/1', features: [], gbdt: null, mlp: null, gbdtWeight: 1, calibration: { default: { x: [0], y: [1] } }, thresholds: {}, meta: {} };
  const learned: LearnedOptions = {
    ...DEFAULT_LEARNED_OPTIONS,
    nmsOverlap: Infinity,
    candidates: { ...DEFAULT_LEARNED_OPTIONS.candidates, ...(opts.levels ? { levels: opts.levels } : {}) },
  };
  return {
    id: 'v2-candidates',
    description: `every candidate of the product path (halo ${halo} px), confidence 1`,
    async run(tiles, _get, windows) {
      const w = mustWindows(windows);
      const plan = productTiles(tiles, w.providerId);
      const out: EvalDetection[] = [];
      let computeMs = 0;
      let tilesMissing = 0;
      for (const st of plan.tiles) {
        const win = await w.window(st, halo * (plan.tilePx / TILE_SIZE), plan.tilePx);
        if (!win) {
          tilesMissing++;
          continue;
        }
        const t0 = performance.now();
        for (const d of detectWindow(win, { providerId: w.providerId }, everything, learned)) out.push(fromTile(d, `c${out.length}`));
        computeMs += performance.now() - t0;
      }
      return { computeMs, tilesMissing, detections: out };
    },
  };
}

function fromTile(d: TileDetection, id: string): EvalDetection {
  return { id, center: d.center, bbox: d.bbox, outline: [[d.outline]], areaM2: d.areaM2, confidence: d.score ?? 0, kind: d.areaM2 <= 10 ? 'hot_tub' : 'pool', truncated: false };
}

/**
 * The same scorer over the whole area stitched into one image, no tile
 * borders at all: the reference the product path is held to on the gold (P8).
 */
export function v2MosaicDetector(opts: { learned?: Partial<LearnedOptions> } = {}): Detector {
  const learned: LearnedOptions = { ...DEFAULT_LEARNED_OPTIONS, ...opts.learned };
  return {
    id: 'v2-mosaic',
    description: 'v2 scorer on the whole area as one image (no tiles, no halo)',
    thresholdFor: (providerId) => defaultThreshold(loadModel(), providerId),
    async run(tiles, _get, windows) {
      const w = mustWindows(windows);
      if (w.providerId.startsWith('dgt')) throw new Error('the mosaic reference is built from XYZ tiles');
      const model = loadModel();
      const z = tiles[0].tile.z;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of tiles) {
        x0 = Math.min(x0, t.tile.x);
        y0 = Math.min(y0, t.tile.y);
        x1 = Math.max(x1, t.tile.x);
        y1 = Math.max(y1, t.tile.y);
      }
      const W = (x1 - x0 + 1) * TILE_SIZE, H = (y1 - y0 + 1) * TILE_SIZE;
      const pixels = new Uint8ClampedArray(W * H * 4);
      let tilesMissing = 0;
      for (const t of tiles) {
        const win = await w.window(t, 0);
        if (!win) {
          tilesMissing++;
          continue;
        }
        const ox = (t.tile.x - x0) * TILE_SIZE, oy = (t.tile.y - y0) * TILE_SIZE;
        for (let y = 0; y < TILE_SIZE; y++) pixels.set(win.pixels.subarray(y * TILE_SIZE * 4, (y + 1) * TILE_SIZE * 4), ((oy + y) * W + ox) * 4);
      }
      const t0 = performance.now();
      const frame = { tile: { z, x: x0, y: y0 }, tilePx: TILE_SIZE, offsetX: 0, offsetY: 0 };
      const { analysis, kept } = scoreImage(pixels, W, H, frame, { x0: 0, y0: 0, x1: W, y1: H }, sourceFamily(w.providerId), model, learned);
      const dets = kept.map((s, i) => fromTile(toTileDetection(s, pixels, W, H, frame, analysis, learned), `m${i}`));
      return { computeMs: performance.now() - t0, tilesMissing, detections: dets.filter((d) => d.areaM2 >= learned.candidates.minAreaM2) };
    },
  };
}

export const DETECTORS: Record<string, Detector> = {
  v1: v1Detector,
  v2: v2Detector(),
  'v2-candidates': v2CandidateDetector(),
  'v2-mosaic': v2MosaicDetector(),
};
