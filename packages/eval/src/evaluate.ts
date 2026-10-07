import { buildScanPlan, expandBBoxMeters, type Ring } from '@marco-polo/core';
import type { Detector } from './detectors.js';
import type { GalleryItem } from './gallery.js';
import { hits, matchDetections, scopedCounts, type ScopedCounts } from './match.js';
import { areaError, scores, type AreaError, type Scores } from './metrics.js';
import type { TileSource } from './imagery.js';
import type { EvalDetection, Label } from './types.js';
import { bboxIoU, pointInBBox } from './geom.js';
import type { Zone } from './zones.js';

/** The scan covers the area plus this margin, so pools on the boundary are imaged whole. */
export const SCAN_MARGIN_M = 40;

export const SWEEP = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

export interface ZoneResult {
  zone: string;
  name: string;
  split: 'dev' | 'test';
  review: 'full' | 'candidates';
  areaKm2: number;
  tiles: number;
  tilesMissing: number;
  labels: { pool: number; ignore: number; points: number; visual: number; overrides: number };
  threshold: number;
  counts: ScopedCounts;
  scores: Scores;
  area: AreaError;
  /** (detected − label) / label for every polygon hit, for pooling across areas. */
  areaRel: number[];
  computeMs: number;
  msPerKm2: number;
  detectionsAll: number;
  sweep: Array<{ threshold: number; counts: ScopedCounts; scores: Scores }>;
  items: GalleryItem[];
}

export interface ZoneRun {
  result: ZoneResult;
  shown: EvalDetection[];
  faint: EvalDetection[];
}

export async function evaluateZone(
  zone: Zone,
  labels: Label[],
  labelInfo: { visual: number; overrides: number },
  detector: Detector,
  src: TileSource,
  threshold: number,
): Promise<ZoneRun> {
  const scan = expandBBoxMeters(zone.bbox, SCAN_MARGIN_M);
  const ring: Ring = [
    [scan.west, scan.south],
    [scan.east, scan.south],
    [scan.east, scan.north],
    [scan.west, scan.north],
  ];
  const plan = buildScanPlan(ring, 19);
  const run = await detector.run(plan.tiles, (t) => src.get(t.tile));
  const all = run.detections;
  const shown = all.filter((d) => d.confidence >= threshold);
  const faint = all.filter((d) => d.confidence < threshold);

  const m = matchDetections(shown, labels);
  const counts = scopedCounts(m, labels, zone.bbox);
  const areaKm2 = zone.areaKm2;

  const sweep = SWEEP.map((t) => {
    const c = scopedCounts(matchDetections(all.filter((d) => d.confidence >= t), labels), labels, zone.bbox);
    return { threshold: t, counts: c, scores: scores(c) };
  });

  // Area error only against OSM polygons: hand labels are boxes or loose candidate outlines.
  const tpInScope = m.pairs.filter((p) => pointInBBox(p.label.centroid, zone.bbox) && !p.label.point && p.label.source === 'osm');
  const area = areaError(tpInScope.map((p) => ({ detM2: p.det.areaM2, labelM2: p.label.areaM2 })));

  // Gallery items, with the automatic part of the error taxonomy.
  const items: GalleryItem[] = [];
  for (const d of m.unmatchedDets) {
    if (!pointInBBox(d.center, zone.bbox)) continue;
    items.push({
      n: 0, kind: 'fp', id: d.id, center: d.center, bbox: d.bbox, areaM2: d.areaM2, confidence: d.confidence,
      auto: m.duplicateOf.has(d.id) ? 'duplicate' : 'unlabelled',
    });
  }
  for (const l of m.unmatchedLabels) {
    if (!pointInBBox(l.centroid, zone.bbox)) continue;
    const below = faint.filter((d) => hits(d, l).ok).sort((a, b) => b.confidence - a.confidence)[0];
    const partial = shown.some((d) => bboxIoU(d.bbox, l.bbox) > 0);
    items.push({
      n: 0, kind: 'fn', id: l.id, center: l.centroid, bbox: l.bbox, areaM2: l.areaM2,
      confidence: below ? below.confidence : null,
      auto: below ? 'below-threshold' : partial ? 'partial-overlap' : 'not-detected',
    });
  }
  items.sort((a, b) => (a.kind === b.kind ? b.center.lat - a.center.lat || a.center.lon - b.center.lon : a.kind === 'fp' ? -1 : 1));
  let nfp = 0, nfn = 0;
  for (const it of items) it.n = it.kind === 'fp' ? ++nfp : ++nfn;

  const pools = labels.filter((l) => l.role === 'pool' && pointInBBox(l.centroid, zone.bbox));
  return {
    shown,
    faint,
    result: {
      zone: zone.id,
      name: zone.name,
      split: zone.split,
      review: zone.review,
      areaKm2,
      tiles: plan.tiles.length,
      tilesMissing: run.tilesMissing,
      labels: {
        pool: pools.length,
        ignore: labels.filter((l) => l.role === 'ignore' && pointInBBox(l.centroid, zone.bbox)).length,
        points: pools.filter((l) => l.point).length,
        visual: pools.filter((l) => l.source === 'visual').length,
        overrides: labelInfo.overrides,
      },
      threshold,
      counts,
      scores: scores(counts),
      area,
      areaRel: tpInScope.filter((p) => p.label.areaM2 > 0).map((p) => (p.det.areaM2 - p.label.areaM2) / p.label.areaM2),
      computeMs: run.computeMs,
      msPerKm2: run.computeMs / (plan.areaM2 / 1e6),
      detectionsAll: all.length,
      sweep,
      items,
    },
  };
}
