import { buildScanPlan, type Ring } from '@marco-polo/core';
import { v1Detector } from './detectors.js';
import type { TileSource } from './imagery.js';
import { loadLabels } from './labels.js';
import { median } from './metrics.js';
import type { Zone } from './zones.js';

/**
 * Estimate how far OSM sits from the imagery in one area: pair confident,
 * mid-sized v1 detections with the nearest OSM polygon (within 15 m) and take
 * the median of (detection centre − label centroid). The detector only
 * supplies water centroids here; it does not decide what counts as a pool.
 */
export async function measureOffset(zone: Zone, src: TileSource): Promise<{ east: number; north: number; n: number; spread: number }> {
  const ring: Ring = [
    [zone.bbox.west, zone.bbox.south],
    [zone.bbox.east, zone.bbox.south],
    [zone.bbox.east, zone.bbox.north],
    [zone.bbox.west, zone.bbox.north],
  ];
  const plan = buildScanPlan(ring, 19);
  const run = await v1Detector.run(plan.tiles, (t) => src.get(t.tile));
  const { labels } = await loadLabels(zone.id, { osmShiftM: [0, 0] }); // raw OSM, no shift
  const polys = labels.filter((l) => l.source === 'osm' && !l.point && l.areaM2 >= 12 && l.areaM2 <= 600);
  const dets = run.detections.filter((d) => d.confidence >= 0.5 && d.areaM2 >= 12 && d.areaM2 <= 600 && !d.truncated);
  const dx: number[] = [], dy: number[] = [];
  for (const d of dets) {
    let best: { e: number; n: number; dist: number } | null = null;
    for (const l of polys) {
      const e = (d.center.lon - l.centroid.lon) * 111320 * Math.cos((l.centroid.lat * Math.PI) / 180);
      const n = (d.center.lat - l.centroid.lat) * 110540;
      const dist = Math.hypot(e, n);
      if (dist <= 15 && (!best || dist < best.dist)) best = { e, n, dist };
    }
    if (best) {
      dx.push(best.e);
      dy.push(best.n);
    }
  }
  const east = median(dx) ?? 0, north = median(dy) ?? 0;
  const spread = median(dx.map((x, i) => Math.hypot(x - east, dy[i] - north))) ?? 0;
  return { east, north, n: dx.length, spread };
}
