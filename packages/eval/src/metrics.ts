import type { ScopedCounts } from './match.js';

export interface Scores {
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

/**
 * Precision over detections, recall over labels. Undefined ratios are null,
 * never 0 or 1: an area with no labels has no recall, it does not have perfect
 * recall.
 */
export function scores(c: Pick<ScopedCounts, 'labels' | 'tpLabels' | 'dets' | 'tpDets'>): Scores {
  const precision = c.dets > 0 ? c.tpDets / c.dets : null;
  const recall = c.labels > 0 ? c.tpLabels / c.labels : null;
  const f1 =
    precision !== null && recall !== null
      ? precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0
      : null;
  return { precision, recall, f1 };
}

/** Sum counts across areas (micro-average input). */
export function sumCounts(list: ScopedCounts[]): ScopedCounts {
  const out: ScopedCounts = { labels: 0, tpLabels: 0, dets: 0, tpDets: 0, fp: 0, fn: 0, ignored: 0 };
  for (const c of list) {
    out.labels += c.labels;
    out.tpLabels += c.tpLabels;
    out.dets += c.dets;
    out.tpDets += c.tpDets;
    out.fp += c.fp;
    out.fn += c.fn;
    out.ignored += c.ignored;
  }
  return out;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface AreaError {
  /** Median of |det − label| / label. */
  medianAbsRel: number | null;
  /** Median of (det − label) / label: negative = under-measures. */
  medianSignedRel: number | null;
  n: number;
}

export function areaError(pairs: Array<{ detM2: number; labelM2: number }>): AreaError {
  const rel = pairs.filter((p) => p.labelM2 > 0).map((p) => (p.detM2 - p.labelM2) / p.labelM2);
  return {
    medianAbsRel: median(rel.map(Math.abs)),
    medianSignedRel: median(rel),
    n: rel.length,
  };
}
