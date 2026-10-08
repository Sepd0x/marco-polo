/**
 * The learned candidate scorer: gradient-boosted trees and a small MLP, both
 * stored as plain JSON and evaluated here with a few loops (no dependencies).
 * The file in packages/core/models is written by tools/train; its score for a
 * feature vector matches the Python model to 1e-5 (tests/model.test.ts).
 */

/** Gradient-boosted trees, binary logistic. Node i is a leaf when `f[i] < 0`. */
export interface GbdtModel {
  /** Split feature per node, -1 at leaves. */
  f: number[][];
  /** Split threshold: go left when `x[f] <= t`. */
  t: number[][];
  l: number[][];
  r: number[][];
  /** Leaf value (raw margin). */
  v: number[][];
  /** Added to the summed margin. */
  bias: number;
}

/** Fully connected network with ReLU hidden layers and one logistic output. */
export interface MlpModel {
  /** Feature standardisation: (x - mean) / scale. */
  mean: number[];
  scale: number[];
  /** Weights per layer, row-major `[inputs][outputs]`. */
  weights: number[][][];
  biases: number[][];
}

/** Monotone step function from raw score to probability (isotonic regression). */
export interface Calibration {
  /** Ascending raw scores where the probability changes. */
  x: number[];
  /** Probability at and above each `x` (piecewise linear between points). */
  y: number[];
}

export type SourceFamily = 'dgt' | 'pnoa' | 'ign' | 'esri';

export interface PoolModel {
  format: 'marco-polo-pool-model/1';
  /** Feature names in input order; must equal FEATURE_NAMES. */
  features: string[];
  gbdt: GbdtModel | null;
  mlp: MlpModel | null;
  /** Raw score = wGbdt * p(gbdt) + (1 - wGbdt) * p(mlp). */
  gbdtWeight: number;
  /** Per source family, plus `default` for anything else. */
  calibration: Partial<Record<SourceFamily | 'default', Calibration>>;
  /** Default threshold on the calibrated probability, per source family and `default`. */
  thresholds: Partial<Record<SourceFamily | 'default', number>>;
  /** Free-form provenance written by the trainer (recipe hash, zones, seed). */
  meta: Record<string, unknown>;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function gbdtMargin(m: GbdtModel, x: ArrayLike<number>, offset = 0): number {
  let s = m.bias;
  const nt = m.f.length;
  for (let k = 0; k < nt; k++) {
    const f = m.f[k], t = m.t[k], l = m.l[k], r = m.r[k];
    let i = 0;
    while (f[i] >= 0) i = x[offset + f[i]] <= t[i] ? l[i] : r[i];
    s += m.v[k][i];
  }
  return s;
}

export function mlpMargin(m: MlpModel, x: ArrayLike<number>, offset = 0): number {
  let a: number[] = [];
  for (let j = 0; j < m.mean.length; j++) a.push((x[offset + j] - m.mean[j]) / m.scale[j]);
  const last = m.weights.length - 1;
  for (let layer = 0; layer <= last; layer++) {
    const w = m.weights[layer], b = m.biases[layer];
    const out = b.slice();
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      if (ai === 0) continue;
      const wi = w[i];
      for (let j = 0; j < out.length; j++) out[j] += ai * wi[j];
    }
    if (layer < last) for (let j = 0; j < out.length; j++) if (out[j] < 0) out[j] = 0;
    a = out;
  }
  return a[0];
}

/** Uncalibrated score in 0..1. */
export function rawScore(m: PoolModel, x: ArrayLike<number>, offset = 0): number {
  const g = m.gbdt ? sigmoid(gbdtMargin(m.gbdt, x, offset)) : 0;
  const n = m.mlp ? sigmoid(mlpMargin(m.mlp, x, offset)) : 0;
  if (m.gbdt && m.mlp) return m.gbdtWeight * g + (1 - m.gbdtWeight) * n;
  return m.gbdt ? g : n;
}

export function calibrate(c: Calibration | undefined, raw: number): number {
  if (!c || c.x.length === 0) return raw;
  const { x, y } = c;
  if (raw <= x[0]) return y[0];
  const last = x.length - 1;
  if (raw >= x[last]) return y[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= raw) lo = mid;
    else hi = mid;
  }
  const span = x[hi] - x[lo];
  return span > 0 ? y[lo] + ((y[hi] - y[lo]) * (raw - x[lo])) / span : y[hi];
}

/** Source family of an imagery provider id (`dgt-ortos2025` is `dgt`). */
export function sourceFamily(providerId: string): SourceFamily | 'default' {
  if (providerId.startsWith('dgt')) return 'dgt';
  if (providerId === 'pnoa' || providerId.startsWith('pnoa')) return 'pnoa';
  if (providerId.startsWith('ign')) return 'ign';
  if (providerId.startsWith('esri')) return 'esri';
  return 'default';
}

export function calibratedScore(m: PoolModel, family: SourceFamily | 'default', x: ArrayLike<number>, offset = 0): number {
  return calibrate(m.calibration[family] ?? m.calibration.default, rawScore(m, x, offset));
}

/** Default threshold for a provider: its family's, else the model default, else 0.5. */
export function defaultThreshold(m: PoolModel, providerId: string): number {
  const fam = sourceFamily(providerId);
  return m.thresholds[fam] ?? m.thresholds.default ?? 0.5;
}
