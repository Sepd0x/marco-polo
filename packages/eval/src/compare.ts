/**
 * Paired comparison of two runs (v1 and v2) on the same zones and labels.
 * Every interval comes from the same block draws on both sides.
 */
import { alignBlocks, drawBlocks, emptyBlock, METRICS, pairedCI, bootstrapCI, type BlockCounts, type Interval } from './bootstrap.js';
import type { ZoneResult } from './evaluate.js';
import { median, scores, sumCounts } from './metrics.js';

export interface Paired {
  zones: string[];
  f1A: number | null;
  f1B: number | null;
  f1Diff: number | null;
  f1DiffCI: Interval;
  errorsA: number;
  errorsB: number;
  errorsRatio: number | null;
  errorsRatioCI: Interval;
  fpPerKm2A: number;
  fpPerKm2B: number;
  /** Area error of B over the labels both runs hit (same sample for both). */
  pairedAreaN: number;
  pairedAreaAbsA: number | null;
  pairedAreaAbsB: number | null;
  pairedAreaAbsBCI: Interval;
  signedAreaB: number | null;
  signedAreaBCI: Interval;
}

function byZone(rs: ZoneResult[]): Map<string, ZoneResult> {
  return new Map(rs.map((r) => [r.zone, r]));
}

/** Blocks of B whose area errors are restricted to labels A also hit. */
function pairedAreaBlocks(a: ZoneResult, b: ZoneResult): { A: BlockCounts[]; B: BlockCounts[] } {
  const hitA = new Map(a.pairs.filter((p) => p.labelM2 > 0).map((p) => [p.label, p]));
  const keep = (r: ZoneResult, other: Map<string, unknown>) => {
    const m = new Map<string, BlockCounts>();
    for (const p of r.pairs) {
      if (p.labelM2 <= 0 || !other.has(p.label)) continue;
      const blk = m.get(p.block) ?? emptyBlock(p.block);
      blk.areaRel.push((p.detM2 - p.labelM2) / p.labelM2);
      m.set(p.block, blk);
    }
    return [...m.values()];
  };
  const hitB = new Map(b.pairs.filter((p) => p.labelM2 > 0).map((p) => [p.label, p]));
  const [A, B] = alignBlocks(keep(a, hitB), keep(b, hitA));
  return { A, B };
}

export function comparePaired(runA: ZoneResult[], runB: ZoneResult[], zones: string[]): Paired {
  const A = byZone(runA), B = byZone(runB);
  const missing = zones.filter((z) => !A.has(z) || !B.has(z));
  if (missing.length) throw new Error(`zones missing from one of the runs: ${missing.join(', ')}`);
  const aligned = zones.map((z) => alignBlocks(A.get(z)!.blocks, B.get(z)!.blocks));
  const blocksA = aligned.map((x) => x[0]);
  const blocksB = aligned.map((x) => x[1]);
  const draws = drawBlocks(blocksA.map((z) => z.length));
  const ca = sumCounts(zones.map((z) => A.get(z)!.counts));
  const cb = sumCounts(zones.map((z) => B.get(z)!.counts));
  const f1A = scores(ca).f1, f1B = scores(cb).f1;
  const km2 = zones.reduce((k, z) => k + A.get(z)!.areaKm2, 0);

  const area = zones.map((z) => pairedAreaBlocks(A.get(z)!, B.get(z)!));
  const areaDraws = drawBlocks(area.map((x) => x.B.length));
  const relA = area.flatMap((x) => x.A.flatMap((b) => b.areaRel));
  const relB = area.flatMap((x) => x.B.flatMap((b) => b.areaRel));
  return {
    zones,
    f1A,
    f1B,
    f1Diff: f1A !== null && f1B !== null ? f1B - f1A : null,
    f1DiffCI: pairedCI(blocksA, blocksB, METRICS.f1, 'diff', draws),
    errorsA: ca.fp + ca.fn,
    errorsB: cb.fp + cb.fn,
    errorsRatio: ca.fp + ca.fn > 0 ? (cb.fp + cb.fn) / (ca.fp + ca.fn) : null,
    errorsRatioCI: pairedCI(blocksA, blocksB, METRICS.errors, 'ratio', draws),
    fpPerKm2A: km2 > 0 ? ca.fp / km2 : 0,
    fpPerKm2B: km2 > 0 ? cb.fp / km2 : 0,
    pairedAreaN: relB.length,
    pairedAreaAbsA: median(relA.map(Math.abs)),
    pairedAreaAbsB: median(relB.map(Math.abs)),
    pairedAreaAbsBCI: bootstrapCI(area.map((x) => x.B), METRICS.medianAreaAbsRel, areaDraws),
    signedAreaB: median(relB),
    signedAreaBCI: bootstrapCI(area.map((x) => x.B), METRICS.medianAreaSignedRel, areaDraws),
  };
}
