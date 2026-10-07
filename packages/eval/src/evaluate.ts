import { buildScanPlan, expandBBoxMeters, type BBox, type LonLat, type Ring, type ScanTile, type TileWindow } from '@marco-polo/core';
import type { DecodedTile } from '../../cli/src/tiles.js';
import { blockKey, emptyBlock, type BlockCounts } from './bootstrap.js';
import type { Detector, DetectorRun } from './detectors.js';
import type { GalleryItem } from './gallery.js';
import { bboxIoU, distanceM, pointInBBox } from './geom.js';
import type { TileSource } from './imagery.js';
import { DEFAULT_MATCH, hits, matchDetections, pointAreaCap, scopedCounts, type MatchOptions, type ScopedCounts } from './match.js';
import { areaError, scores, type AreaError, type Scores } from './metrics.js';
import { ringsDims, type Dims } from './obb.js';
import type { EvalDetection, Label } from './types.js';
import type { Zone } from './zones.js';

/** The scan covers the area plus this margin, so pools on the boundary are imaged whole. */
export const SCAN_MARGIN_M = 40;

export const SWEEP = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

/** One hit, kept in the report so runs can be compared on the same labels. */
export interface PairRecord {
  label: string;
  det: string;
  /** Bootstrap block of the label. */
  block: string;
  /** Label area, m², polygon labels only (0 for points). */
  labelM2: number;
  detM2: number;
  /** Detection centre to label centroid (or point), metres. */
  centerOffsetM: number;
  labelDims: Dims | null;
  detDims: Dims | null;
}

/** A detection with no label: what symmetric adjudication looks at. */
export interface UnmatchedRecord {
  id: string;
  center: LonLat;
  bbox: BBox;
  areaM2: number;
  confidence: number;
  duplicate: boolean;
}

export interface ZoneResult {
  zone: string;
  name: string;
  role: Zone['role'];
  stratum: string | null;
  reportedApart: boolean;
  review: Zone['review'];
  source: string;
  areaKm2: number;
  tiles: number;
  tilesMissing: number;
  labels: { pool: number; ignore: number; points: number; visual: number; overrides: number; absent: number };
  threshold: number;
  match: { pointRule: MatchOptions['pointRule']; pointMaxAreaM2: number };
  counts: ScopedCounts;
  scores: Scores;
  area: AreaError;
  /** (detected - label) / label for every polygon hit, for pooling across areas. */
  areaRel: number[];
  /** Per block of 4 x 4 z19 tiles, for the bootstrap. */
  blocks: BlockCounts[];
  pairs: PairRecord[];
  unmatched: UnmatchedRecord[];
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

export interface WindowAccess {
  providerId: string;
  /** Central tile plus a halo, for detectors that read one. */
  window(tile: ScanTile, halo: number): Promise<TileWindow | null>;
}

type RunWithWindows = (tiles: ScanTile[], get: (t: ScanTile) => Promise<DecodedTile | null>, windows: WindowAccess) => Promise<DetectorRun>;

/** Area and dimensions are judged against OSM outlines only: hand labels are boxes or loose outlines. */
function hasOutline(l: Label): boolean {
  return l.source === 'osm' && !l.point && l.areaM2 > 0;
}

export async function evaluateZone(
  zone: Zone,
  labels: Label[],
  labelInfo: { visual: number; overrides: number; absent: number },
  detector: Detector,
  src: TileSource,
  threshold: number,
  matchRule: MatchOptions['pointRule'] = 'v2',
): Promise<ZoneRun> {
  const scan = expandBBoxMeters(zone.bbox, SCAN_MARGIN_M);
  const ring: Ring = [
    [scan.west, scan.south],
    [scan.east, scan.south],
    [scan.east, scan.north],
    [scan.west, scan.north],
  ];
  const plan = buildScanPlan(ring, 19);
  const windows: WindowAccess = { providerId: src.provider.id, window: (t, halo) => src.window(t.tile, halo) };
  // Detectors that read a halo take the third argument; v1 ignores it.
  const run = await (detector.run as RunWithWindows)(plan.tiles, (t) => src.get(t.tile), windows);
  const all = run.detections;
  const shown = all.filter((d) => d.confidence >= threshold);
  const faint = all.filter((d) => d.confidence < threshold);

  const opts: MatchOptions = { ...DEFAULT_MATCH, pointRule: matchRule, pointMaxAreaM2: matchRule === 'v2' ? pointAreaCap(labels.filter((l) => pointInBBox(l.centroid, zone.bbox))) : Infinity };
  const m = matchDetections(shown, labels, opts);
  const counts = scopedCounts(m, labels, zone.bbox);

  const sweep = SWEEP.map((t) => {
    const c = scopedCounts(matchDetections(all.filter((d) => d.confidence >= t), labels, opts), labels, zone.bbox);
    return { threshold: t, counts: c, scores: scores(c) };
  });

  const inScope = (p: LonLat) => pointInBBox(p, zone.bbox);
  const tpInScope = m.pairs.filter((p) => inScope(p.label.centroid));
  const areaPairs = tpInScope.filter((p) => hasOutline(p.label));
  const area = areaError(areaPairs.map((p) => ({ detM2: p.det.areaM2, labelM2: p.label.areaM2 })));

  // Blocks: labels by centroid, detections by centre, like the scoped counts.
  const blocks = new Map<string, BlockCounts>();
  const block = (p: LonLat) => {
    const k = blockKey(p);
    let b = blocks.get(k);
    if (!b) blocks.set(k, (b = emptyBlock(k)));
    return b;
  };
  for (const l of labels) if (l.role === 'pool' && inScope(l.centroid)) block(l.centroid).labels++;
  for (const p of tpInScope) {
    const b = block(p.label.centroid);
    b.tpLabels++;
    if (hasOutline(p.label)) b.areaRel.push((p.det.areaM2 - p.label.areaM2) / p.label.areaM2);
  }
  for (const p of m.pairs) {
    if (!inScope(p.det.center)) continue;
    const b = block(p.det.center);
    b.tpDets++;
    b.dets++;
  }
  for (const d of m.unmatchedDets) {
    if (!inScope(d.center)) continue;
    const b = block(d.center);
    b.fp++;
    b.dets++;
  }
  for (const d of m.ignored) if (inScope(d.center)) block(d.center).ignored++;
  for (const b of blocks.values()) b.fn = b.labels - b.tpLabels;

  const pairs: PairRecord[] = tpInScope.map((p) => {
    const at = p.label.point ?? p.label.centroid;
    return {
      label: p.label.id,
      det: p.det.id,
      block: blockKey(p.label.centroid),
      labelM2: hasOutline(p.label) ? p.label.areaM2 : 0,
      detM2: p.det.areaM2,
      centerOffsetM: distanceM(p.det.center, at),
      labelDims: hasOutline(p.label) ? ringsDims(p.label.polygons.map((poly) => poly[0]), p.label.centroid) : null,
      detDims: p.det.dims !== undefined ? p.det.dims : ringsDims(p.det.outline.map((poly) => poly[0]), p.det.center),
    };
  });
  const unmatched: UnmatchedRecord[] = m.unmatchedDets
    .filter((d) => inScope(d.center))
    .map((d) => ({ id: d.id, center: d.center, bbox: d.bbox, areaM2: d.areaM2, confidence: d.confidence, duplicate: m.duplicateOf.has(d.id) }));

  // Gallery items, with the automatic part of the error taxonomy.
  const items: GalleryItem[] = [];
  for (const d of m.unmatchedDets) {
    if (!inScope(d.center)) continue;
    items.push({
      n: 0, kind: 'fp', id: d.id, center: d.center, bbox: d.bbox, areaM2: d.areaM2, confidence: d.confidence,
      auto: m.duplicateOf.has(d.id) ? 'duplicate' : 'unlabelled',
    });
  }
  for (const l of m.unmatchedLabels) {
    if (!inScope(l.centroid)) continue;
    const below = faint.filter((d) => hits(d, l, opts).ok).sort((a, b) => b.confidence - a.confidence)[0];
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

  const pools = labels.filter((l) => l.role === 'pool' && inScope(l.centroid));
  return {
    shown,
    faint,
    result: {
      zone: zone.id,
      name: zone.name,
      role: zone.role,
      stratum: zone.stratum ?? null,
      reportedApart: !!zone.reportedApart,
      review: zone.review,
      source: src.provider.id,
      areaKm2: zone.areaKm2,
      tiles: plan.tiles.length,
      tilesMissing: run.tilesMissing,
      labels: {
        pool: pools.length,
        ignore: labels.filter((l) => l.role === 'ignore' && inScope(l.centroid)).length,
        points: pools.filter((l) => l.point).length,
        visual: pools.filter((l) => l.source === 'visual').length,
        overrides: labelInfo.overrides,
        absent: labelInfo.absent,
      },
      threshold,
      match: { pointRule: opts.pointRule, pointMaxAreaM2: opts.pointMaxAreaM2 },
      counts,
      scores: scores(counts),
      area,
      areaRel: areaPairs.filter((p) => p.label.areaM2 > 0).map((p) => (p.det.areaM2 - p.label.areaM2) / p.label.areaM2),
      blocks: [...blocks.values()].sort((a, b) => a.key.localeCompare(b.key)),
      pairs,
      unmatched,
      computeMs: run.computeMs,
      msPerKm2: run.computeMs / (plan.areaM2 / 1e6),
      detectionsAll: all.length,
      sweep,
      items,
    },
  };
}
