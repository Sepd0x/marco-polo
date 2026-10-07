import type { BBox } from '@marco-polo/core';
import { bboxIoU, distanceM, pointInBBox, pointInPolygons } from './geom.js';
import type { EvalDetection, Label } from './types.js';

export interface MatchOptions {
  /** Box IoU at or above which a detection hits a label even if its centre misses. */
  iouMin: number;
}

export const DEFAULT_MATCH: MatchOptions = { iouMin: 0.3 };

export interface Pair {
  det: EvalDetection;
  label: Label;
  iou: number;
  centerIn: boolean;
}

export interface MatchResult {
  /** One-to-one hits (every label and every detection appears at most once). */
  pairs: Pair[];
  /** Detections left unmatched that sit on an `ignore` label: not counted at all. */
  ignored: EvalDetection[];
  /** Unmatched, not ignored detections. */
  unmatchedDets: EvalDetection[];
  /** `pool` labels nobody matched. */
  unmatchedLabels: Label[];
  /**
   * For unmatched detections that would have hit a label already taken by a
   * better detection: the label id. These are duplicates / fragments.
   */
  duplicateOf: Map<string, string>;
}

/** The hit test: centre inside the label, or box IoU ≥ iouMin. Point labels use a radius. */
export function hits(det: EvalDetection, label: Label, opts: MatchOptions = DEFAULT_MATCH): { ok: boolean; iou: number; centerIn: boolean } {
  if (label.point) {
    // A mapped point has no outline: hit when the detection centre is within
    // the radius, or the point falls inside the detected outline (large pools
    // are often tagged near one end).
    const near =
      distanceM(det.center, label.point) <= (label.radiusM ?? 5) ||
      (pointInBBox(label.point, det.bbox) && pointInPolygons(label.point, det.outline));
    return { ok: near, iou: 0, centerIn: near };
  }
  const iou = bboxIoU(det.bbox, label.bbox);
  const centerIn = pointInBBox(det.center, label.bbox) && pointInPolygons(det.center, label.polygons);
  return { ok: centerIn || iou >= opts.iouMin, iou, centerIn };
}

/**
 * Greedy one-to-one matching. Candidate pairs are ranked by (centre inside
 * first, then IoU, then ids for determinism) and accepted while both sides are
 * free. With pools this sparse, greedy and optimal assignment agree in practice;
 * the tests pin the tie-breaking.
 */
export function matchDetections(dets: EvalDetection[], labels: Label[], opts: MatchOptions = DEFAULT_MATCH): MatchResult {
  const pools = labels.filter((l) => l.role === 'pool');
  const ignores = labels.filter((l) => l.role === 'ignore');

  const candidates: Pair[] = [];
  for (const det of dets) {
    for (const label of pools) {
      if (!label.point && !boxesNear(det.bbox, label.bbox)) continue;
      const h = hits(det, label, opts);
      if (h.ok) candidates.push({ det, label, iou: h.iou, centerIn: h.centerIn });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.centerIn) - Number(a.centerIn) ||
      b.iou - a.iou ||
      a.det.id.localeCompare(b.det.id) ||
      a.label.id.localeCompare(b.label.id),
  );

  const usedDet = new Set<string>();
  const usedLabel = new Set<string>();
  const pairs: Pair[] = [];
  for (const c of candidates) {
    if (usedDet.has(c.det.id) || usedLabel.has(c.label.id)) continue;
    usedDet.add(c.det.id);
    usedLabel.add(c.label.id);
    pairs.push(c);
  }

  const duplicateOf = new Map<string, string>();
  for (const c of candidates) {
    if (!usedDet.has(c.det.id) && !duplicateOf.has(c.det.id)) duplicateOf.set(c.det.id, c.label.id);
  }

  const ignored: EvalDetection[] = [];
  const unmatchedDets: EvalDetection[] = [];
  for (const det of dets) {
    if (usedDet.has(det.id)) continue;
    if (!duplicateOf.has(det.id) && ignores.some((l) => (l.point || boxesNear(det.bbox, l.bbox)) && hits(det, l, opts).ok)) {
      ignored.push(det);
    } else {
      unmatchedDets.push(det);
    }
  }
  const unmatchedLabels = pools.filter((l) => !usedLabel.has(l.id));
  return { pairs, ignored, unmatchedDets, unmatchedLabels, duplicateOf };
}

function boxesNear(a: BBox, b: BBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

export interface ScopedCounts {
  /** Pool labels inside the scope. */
  labels: number;
  /** …of which matched. */
  tpLabels: number;
  /** Detections inside the scope that are not ignored. */
  dets: number;
  /** …of which matched a pool label. */
  tpDets: number;
  fp: number;
  fn: number;
  ignored: number;
}

/**
 * Count inside an evaluation window. Labels are in scope by centroid, detections
 * by centre. Matching runs on everything (labels are fetched with a margin) so a
 * detection near the window edge is not punished for a label just outside it.
 */
export function scopedCounts(m: MatchResult, labels: Label[], scope: BBox): ScopedCounts {
  const inL = (l: Label) => pointInBBox(l.centroid, scope);
  const inD = (d: EvalDetection) => pointInBBox(d.center, scope);
  const poolLabels = labels.filter((l) => l.role === 'pool' && inL(l));
  const tpLabels = m.pairs.filter((p) => inL(p.label)).length;
  const tpDets = m.pairs.filter((p) => inD(p.det)).length;
  const fp = m.unmatchedDets.filter(inD).length;
  return {
    labels: poolLabels.length,
    tpLabels,
    dets: tpDets + fp,
    tpDets,
    fp,
    fn: poolLabels.length - tpLabels,
    ignored: m.ignored.filter(inD).length,
  };
}
