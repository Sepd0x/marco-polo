import { performance } from 'node:perf_hooks';
import { DetectionMerger, detectTile, type DetectorOptions, type MergerOptions, type ScanTile } from '@marco-polo/core';
import type { DecodedTile } from '../../cli/src/tiles.js';
import type { EvalDetection } from './types.js';

export interface DetectorRun {
  /** Every detection the detector emitted, any confidence. The threshold is applied later. */
  detections: EvalDetection[];
  /** Detector CPU time, ms (decode and network excluded). */
  computeMs: number;
  tilesMissing: number;
}

/**
 * A detector under test. It sees decoded tiles of the scan plan in traversal
 * order, exactly like the web app, and returns merged detections.
 */
export interface Detector {
  id: string;
  description: string;
  run(tiles: ScanTile[], get: (t: ScanTile) => Promise<DecodedTile | null>): Promise<DetectorRun>;
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
      return {
        computeMs,
        tilesMissing,
        detections: all.map((d) => ({
          id: d.id,
          center: d.center,
          bbox: d.bbox,
          outline: d.outline.map((r) => [r]),
          areaM2: d.areaM2,
          confidence: d.confidence,
          kind: d.kind,
          truncated: d.truncated,
        })),
      };
    },
  };
}

/**
 * v1: packages/core as shipped. The merger then emitted nothing under 8 m²;
 * the shared minimum is 3 m² now, so v1 keeps its own value to stay the
 * baseline it was.
 */
export const v1Detector = coreDetector('v1', 'packages/core detectTile + DetectionMerger as shipped (merger minimum 8 m²)', {}, { minAreaM2: 8 });

export const DETECTORS: Record<string, Detector> = { v1: v1Detector };
