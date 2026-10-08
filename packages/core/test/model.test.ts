import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES } from '../src/detect/features.js';
import { calibrate, calibratedScore, defaultThreshold, gbdtMargin, mlpMargin, rawScore, sourceFamily, type PoolModel } from '../src/detect/model.js';

const tree = {
  // x0 <= 0.5 ? (x1 <= 2 ? -1 : 1) : 3
  f: [[0, 1, -1, -1, -1]],
  t: [[0.5, 2, 0, 0, 0]],
  l: [[1, 3, -1, -1, -1]],
  r: [[2, 4, -1, -1, -1]],
  v: [[0, 0, 3, -1, 1]],
  bias: 0.25,
};

describe('learned scorer', () => {
  it('walks gradient-boosted trees, left on <=', () => {
    expect(gbdtMargin(tree, [0.5, 2])).toBe(-0.75);
    expect(gbdtMargin(tree, [0.5, 2.0001])).toBe(1.25);
    expect(gbdtMargin(tree, [0.6, 0])).toBe(3.25);
    expect(gbdtMargin(tree, [9, 9, 0.5, 2], 2)).toBe(-0.75);
  });

  it('runs a ReLU MLP with standardised inputs', () => {
    const mlp = {
      mean: [1, 2],
      scale: [2, 4],
      weights: [[[1, -1], [1, 1]], [[2], [-3]]],
      biases: [[0, 0.5], [0.1]],
    };
    // inputs (3, 6) -> (1, 1); hidden = relu(1 + 1, -1 + 1 + 0.5) = (2, 0.5); out = 4 - 1.5 + 0.1
    expect(mlpMargin(mlp, [3, 6])).toBeCloseTo(2.6, 12);
  });

  it('blends the two scorers and calibrates by family', () => {
    const m: PoolModel = {
      format: 'marco-polo-pool-model/1',
      features: [],
      gbdt: tree,
      mlp: { mean: [0, 0], scale: [1, 1], weights: [[[0], [0]]], biases: [[0]] },
      gbdtWeight: 0.5,
      calibration: { esri: { x: [0.2, 0.8], y: [0.1, 0.9] } },
      thresholds: { esri: 0.6, default: 0.4 },
      meta: {},
    };
    const g = 1 / (1 + Math.exp(-3.25));
    expect(rawScore(m, [0.6, 0])).toBeCloseTo(0.5 * g + 0.25, 12);
    expect(calibratedScore(m, 'esri', [0.6, 0])).toBeCloseTo(0.1 + ((0.5 * g + 0.25 - 0.2) * 0.8) / 0.6, 12);
    // No calibration for the family and no default: the raw score.
    expect(calibratedScore(m, 'ign', [0.6, 0])).toBeCloseTo(rawScore(m, [0.6, 0]), 12);
    expect(defaultThreshold(m, 'esri-world-imagery')).toBe(0.6);
    expect(defaultThreshold(m, 'pnoa')).toBe(0.4);
  });

  it('interpolates the isotonic map like numpy.interp and clips at the ends', () => {
    const c = { x: [0.1, 0.3, 0.3, 0.7], y: [0, 0.2, 0.5, 1] };
    expect(calibrate(c, 0)).toBe(0);
    expect(calibrate(c, 0.2)).toBeCloseTo(0.1, 12);
    expect(calibrate(c, 0.5)).toBeCloseTo(0.75, 12);
    expect(calibrate(c, 0.9)).toBe(1);
    expect(calibrate(undefined, 0.42)).toBe(0.42);
  });

  it('maps provider ids to source families', () => {
    expect(sourceFamily('dgt-ortos2025')).toBe('dgt');
    expect(sourceFamily('dgt-ortos2018')).toBe('dgt');
    expect(sourceFamily('pnoa')).toBe('pnoa');
    expect(sourceFamily('ign-orthophotos')).toBe('ign');
    expect(sourceFamily('esri-world-imagery')).toBe('esri');
    expect(sourceFamily('fixture')).toBe('default');
  });
});

const MODEL = new URL('../models/pool-v2.json', import.meta.url);
const PARITY = new URL('./fixtures/model-parity.json', import.meta.url);

interface Parity {
  modelSha256: string;
  rows: number[][];
  gbdt: number[];
  mlp: number[];
  blend: number[];
  calibrated: Record<string, number[]>;
}

describe.skipIf(!existsSync(MODEL) || !existsSync(PARITY))('shipped model', () => {
  const load = () => ({
    model: JSON.parse(readFileSync(MODEL, 'utf8')) as PoolModel,
    ref: JSON.parse(readFileSync(PARITY, 'utf8')) as Parity,
  });

  it('reads the features in the order the detector writes them', () => {
    expect(load().model.features).toEqual([...FEATURE_NAMES]);
  });

  it('is the exact file the reference scores were written for', () => {
    const bytes = readFileSync(MODEL, 'utf8').replace(/\r\n/g, '\n');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(load().ref.modelSha256);
  });

  it('scores like the Python model within 1e-5', () => {
    const { model, ref } = load();
    const sig = (z: number) => 1 / (1 + Math.exp(-z));
    let worst = 0;
    ref.rows.forEach((x, i) => {
      worst = Math.max(worst, Math.abs(sig(gbdtMargin(model.gbdt!, x)) - ref.gbdt[i]));
      worst = Math.max(worst, Math.abs(sig(mlpMargin(model.mlp!, x)) - ref.mlp[i]));
      worst = Math.max(worst, Math.abs(rawScore(model, x) - ref.blend[i]));
      for (const [fam, values] of Object.entries(ref.calibrated)) {
        worst = Math.max(worst, Math.abs(calibrate(model.calibration[fam as 'esri'], ref.blend[i]) - values[i]));
      }
    });
    expect(ref.rows.length).toBeGreaterThanOrEqual(50);
    expect(worst).toBeLessThanOrEqual(1e-5);
  });
});
