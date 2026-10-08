/**
 * Confidence intervals by block bootstrap. Errors are not independent from
 * pool to pool (one bad image strip, one odd neighbourhood), so the unit of
 * resampling is a block of 4 x 4 z19 tiles, not a pool. Blocks are drawn with
 * replacement inside each zone, so every replicate keeps the zone mix.
 * Paired comparisons (v2 against v1) use the same draws for both runs.
 */
import type { LonLat } from '@marco-polo/core';
import { lonToWorldX, latToWorldY, TILE_SIZE } from '@marco-polo/core';
import type { ScopedCounts } from './match.js';
import { median, scores } from './metrics.js';

export const BOOT = { replicates: 2000, seed: 20261007, blockTiles: 4, zoom: 19 } as const;

/** Block of a point: 4 x 4 tiles of z19 (about 230 x 230 m at 40 degrees). */
export function blockKey(p: LonLat, blockTiles: number = BOOT.blockTiles, z: number = BOOT.zoom): string {
  const bx = Math.floor(lonToWorldX(p.lon, z) / TILE_SIZE / blockTiles);
  const by = Math.floor(latToWorldY(p.lat, z) / TILE_SIZE / blockTiles);
  return `${bx}:${by}`;
}

/** Counts of one block, plus the relative area errors of its hits. */
export interface BlockCounts extends ScopedCounts {
  key: string;
  areaRel: number[];
}

export const emptyBlock = (key: string): BlockCounts => ({ key, labels: 0, tpLabels: 0, dets: 0, tpDets: 0, fp: 0, fn: 0, ignored: 0, areaRel: [] });

/** Small, fast, seedable PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Interval {
  lo: number | null;
  hi: number | null;
}

export function percentile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < sorted.length ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

function interval(xs: number[]): Interval {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return { lo: percentile(s, 0.025), hi: percentile(s, 0.975) };
}

/**
 * Index draws: for each replicate and each zone, which of its blocks are
 * taken. Built once and shared by every run that is compared.
 */
export function drawBlocks(blocksPerZone: number[], replicates: number = BOOT.replicates, seed: number = BOOT.seed): number[][][] {
  const r = rng(seed);
  const out: number[][][] = [];
  for (let k = 0; k < replicates; k++) {
    out.push(blocksPerZone.map((n) => Array.from({ length: n }, () => Math.floor(r() * n))));
  }
  return out;
}

function sumBlocks(zones: BlockCounts[][], draw: number[][]): BlockCounts {
  const acc = emptyBlock('');
  draw.forEach((idx, z) => {
    for (const i of idx) {
      const b = zones[z][i];
      acc.labels += b.labels;
      acc.tpLabels += b.tpLabels;
      acc.dets += b.dets;
      acc.tpDets += b.tpDets;
      acc.fp += b.fp;
      acc.fn += b.fn;
      for (const a of b.areaRel) acc.areaRel.push(a);
    }
  });
  return acc;
}

export type Metric = (c: BlockCounts) => number | null;

export const METRICS: Record<string, Metric> = {
  precision: (c) => scores(c).precision,
  recall: (c) => scores(c).recall,
  f1: (c) => scores(c).f1,
  errors: (c) => c.fp + c.fn,
  medianAreaAbsRel: (c) => median(c.areaRel.map(Math.abs)),
  medianAreaSignedRel: (c) => median(c.areaRel),
};

/**
 * Zones as lists of blocks. Both runs of a paired comparison must list the
 * same blocks in the same order (`alignBlocks`).
 */
export function bootstrapCI(zones: BlockCounts[][], metric: Metric, draws?: number[][][]): Interval {
  const d = draws ?? drawBlocks(zones.map((z) => z.length));
  const xs: number[] = [];
  for (const draw of d) {
    const v = metric(sumBlocks(zones, draw));
    if (v !== null) xs.push(v);
  }
  return interval(xs);
}

/** CI of metric(b) - metric(a), or metric(b) / metric(a), on the same draws. */
export function pairedCI(a: BlockCounts[][], b: BlockCounts[][], metric: Metric, op: 'diff' | 'ratio' = 'diff', draws?: number[][][]): Interval {
  if (a.length !== b.length || a.some((z, i) => z.length !== b[i].length)) throw new Error('paired bootstrap needs the same blocks on both sides');
  const d = draws ?? drawBlocks(a.map((z) => z.length));
  const xs: number[] = [];
  for (const draw of d) {
    const va = metric(sumBlocks(a, draw));
    const vb = metric(sumBlocks(b, draw));
    if (va === null || vb === null) continue;
    if (op === 'diff') xs.push(vb - va);
    else if (va !== 0) xs.push(vb / va);
  }
  return interval(xs);
}

/**
 * Put two runs' blocks of one zone on the same key list (union of keys,
 * missing blocks empty), so a paired bootstrap draws the same ground.
 */
export function alignBlocks(a: BlockCounts[], b: BlockCounts[]): [BlockCounts[], BlockCounts[]] {
  const keys = [...new Set([...a.map((x) => x.key), ...b.map((x) => x.key)])].sort();
  const ma = new Map(a.map((x) => [x.key, x]));
  const mb = new Map(b.map((x) => [x.key, x]));
  return [keys.map((k) => ma.get(k) ?? emptyBlock(k)), keys.map((k) => mb.get(k) ?? emptyBlock(k))];
}
