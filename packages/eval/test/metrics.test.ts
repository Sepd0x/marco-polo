import { describe, expect, it } from 'vitest';
import { areaError, median, scores, sumCounts } from '../src/metrics.js';

describe('scores', () => {
  it('precision, recall and F1 from counts', () => {
    const s = scores({ labels: 10, tpLabels: 6, dets: 8, tpDets: 6 });
    expect(s.precision).toBeCloseTo(0.75);
    expect(s.recall).toBeCloseTo(0.6);
    expect(s.f1).toBeCloseTo((2 * 0.75 * 0.6) / 1.35);
  });

  it('undefined ratios are null, not 0 or 1', () => {
    expect(scores({ labels: 0, tpLabels: 0, dets: 3, tpDets: 0 })).toEqual({ precision: 0, recall: null, f1: null });
    expect(scores({ labels: 4, tpLabels: 0, dets: 0, tpDets: 0 })).toEqual({ precision: null, recall: 0, f1: null });
  });

  it('F1 is 0 when nothing is right', () => {
    expect(scores({ labels: 4, tpLabels: 0, dets: 5, tpDets: 0 }).f1).toBe(0);
  });

  it('micro-average sums counts before dividing', () => {
    const a = { labels: 10, tpLabels: 9, dets: 10, tpDets: 9, fp: 1, fn: 1, ignored: 0 };
    const b = { labels: 90, tpLabels: 45, dets: 50, tpDets: 45, fp: 5, fn: 45, ignored: 2 };
    const sum = sumCounts([a, b]);
    expect(sum).toEqual({ labels: 100, tpLabels: 54, dets: 60, tpDets: 54, fp: 6, fn: 46, ignored: 2 });
    expect(scores(sum).recall).toBeCloseTo(0.54);
  });
});

describe('area error', () => {
  it('median of odd and even lists', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('relative error, absolute and signed', () => {
    const e = areaError([
      { detM2: 40, labelM2: 50 }, // −20%
      { detM2: 55, labelM2: 50 }, // +10%
      { detM2: 50, labelM2: 50 }, // 0
      { detM2: 10, labelM2: 0 }, // no label area: skipped
    ]);
    expect(e.n).toBe(3);
    expect(e.medianAbsRel).toBeCloseTo(0.1);
    expect(e.medianSignedRel).toBeCloseTo(0);
  });
});
