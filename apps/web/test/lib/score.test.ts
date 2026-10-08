import { describe, expect, it } from 'vitest';
import { thresholds } from '@marco-polo/core/models/pool-v2.json';
import { cutoffFn, cutoffsInUse, recommendedFor } from '../../src/lib/score.js';

const parts = [
  { id: 'p1', providerId: 'dgt-ortos2025' },
  { id: 'p2', providerId: 'pnoa' },
];

describe('minimum score', () => {
  it('uses the threshold the model was calibrated to on each source', () => {
    expect(recommendedFor('dgt-ortos2025')).toBe(thresholds.dgt);
    expect(recommendedFor('pnoa')).toBe(thresholds.pnoa);
    expect(recommendedFor('esri-world-imagery')).toBe(thresholds.esri);
    expect(recommendedFor(null)).toBe(thresholds.default);
  });

  it('holds each pool to the minimum of its own part', () => {
    const cut = cutoffFn({ minConfidence: 0.9, recommendedScore: true }, parts);
    expect(cut({ id: 'scan-a:p1:3' })).toBe(thresholds.dgt);
    expect(cut({ id: 'scan-a:p2:3' })).toBe(thresholds.pnoa);
    expect(cutoffsInUse({ minConfidence: 0.9, recommendedScore: true }, parts)).toEqual(
      [...new Set([thresholds.dgt, thresholds.pnoa])].sort((a, b) => a - b),
    );
  });

  it('a value set by hand applies to every source', () => {
    const cut = cutoffFn({ minConfidence: 0.7, recommendedScore: false }, parts);
    expect(cut({ id: 'scan-a:p1:3' })).toBe(0.7);
    expect(cut({ id: 'scan-a:p2:3' })).toBe(0.7);
    expect(cutoffsInUse({ minConfidence: 0.7, recommendedScore: false }, parts)).toEqual([0.7]);
  });

  it('pools of older archives without parts get the model default', () => {
    const cut = cutoffFn({ minConfidence: 0.7, recommendedScore: true }, []);
    expect(cut({ id: 'old-id' })).toBe(thresholds.default);
  });
});
