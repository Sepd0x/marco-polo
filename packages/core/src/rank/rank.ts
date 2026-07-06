import type { Detection, RankedDetection } from '../types.js';

/** Rank detections largest-first (confidence breaks ties). */
export function rankDetections(detections: Detection[]): RankedDetection[] {
  return detections
    .slice()
    .sort((a, b) => b.areaM2 - a.areaM2 || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .map((d, i) => ({ ...d, rank: i + 1 }));
}
