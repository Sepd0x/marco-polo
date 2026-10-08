import { describe, expect, it } from 'vitest';
import { measuredDims, MIN_RECT_FILL } from '../src/detect/measure.js';
import type { Ring } from '../src/types.js';

/** A rectangle or polygon given in metres around (lon 0, lat 40), as lon/lat. */
const KX = 1 / (111320 * Math.cos((40 * Math.PI) / 180));
const KY = 1 / 110574;
const ring = (pts: [number, number][]): Ring => pts.map(([x, y]) => [x * KX, 40 + y * KY]);

describe('measured dimensions', () => {
  it('measure a plain rectangle', () => {
    const d = measuredDims({ outline: [ring([[0, 0], [10, 0], [10, 5], [0, 5]])], truncated: false })!;
    expect(d.lengthM).toBeCloseTo(10, 1);
    expect(d.widthM).toBeCloseTo(5, 1);
  });

  it('do not measure a shape cut by the edge of the imagery or joined from parts', () => {
    const r = ring([[0, 0], [10, 0], [10, 5], [0, 5]]);
    expect(measuredDims({ outline: [r], truncated: true })).toBeNull();
    expect(measuredDims({ outline: [r, ring([[20, 0], [24, 0], [24, 3], [20, 3]])], truncated: false })).toBeNull();
  });

  it('do not measure a shape that fills little of its rectangle', () => {
    // An L: 10 x 2 plus 2 x 8, 36 m² of a 10 x 10 rectangle.
    const l = ring([[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]]);
    expect(36 / 100).toBeLessThan(MIN_RECT_FILL);
    expect(measuredDims({ outline: [l], truncated: false })).toBeNull();
    // A disc fills pi/4 of its square: measured.
    const disc = ring(Array.from({ length: 32 }, (_, i) => [3 * Math.cos((i / 32) * 2 * Math.PI), 3 * Math.sin((i / 32) * 2 * Math.PI)] as [number, number]));
    expect(measuredDims({ outline: [disc], truncated: false })!.lengthM).toBeCloseTo(6, 0);
  });
});
