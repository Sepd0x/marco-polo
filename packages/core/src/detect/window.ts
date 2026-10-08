import type { DetectContext, Detector, TileDetection, TileWindow } from '../types.js';
import { DEFAULT_DETECTOR_OPTIONS, detectTile, type DetectorOptions } from './detector.js';

/**
 * The v1 pipeline behind the `Detector` seam. v1 has no notion of a halo,
 * so it accepts only bare tiles (any bitmap size); a window with a halo is
 * refused rather than mis-projected.
 */
export function createV1Detector(options: Partial<DetectorOptions> = {}): Detector {
  const opts: DetectorOptions = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
  return {
    id: 'v1',
    version: 'v1',
    detectTile(window: TileWindow, _ctx: DetectContext): TileDetection[] {
      if (window.halo !== 0) {
        throw new Error(`v1 detector reads tiles without halo (got halo ${window.halo})`);
      }
      if (window.width !== window.tilePx || window.height !== window.tilePx) {
        throw new Error(`window is ${window.width}x${window.height}, expected ${window.tilePx}x${window.tilePx}`);
      }
      return detectTile(window.pixels, window.width, window.height, window.tile, opts);
    },
  };
}
