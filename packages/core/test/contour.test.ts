import { describe, expect, it } from 'vitest';
import { removeCollinear, simplifyRing, traceOutline } from '../src/detect/contour.js';

function labelsFrom(rows: string[]): { labels: Int32Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const labels = new Int32Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) if (row[x] !== '.') labels[y * w + x] = Number(row[x]);
  });
  return { labels, w, h };
}

const asSet = (pts: [number, number][]) => new Set(pts.map(([x, y]) => `${x},${y}`));

describe('contour tracing', () => {
  it('a single pixel traces to its 4 corners', () => {
    const { labels, w, h } = labelsFrom(['...', '.1.', '...']);
    const ring = removeCollinear(traceOutline(labels, w, h, 1));
    expect(ring).toHaveLength(4);
    expect(asSet(ring)).toEqual(new Set(['1,1', '2,1', '2,2', '1,2']));
  });

  it('a 2×2 block reduces to 4 corners', () => {
    const { labels, w, h } = labelsFrom(['....', '.11.', '.11.', '....']);
    const ring = removeCollinear(traceOutline(labels, w, h, 1));
    expect(ring).toHaveLength(4);
    expect(asSet(ring)).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']));
  });

  it('an L-shape keeps 6 corners', () => {
    const { labels, w, h } = labelsFrom(['1..', '1..', '11.']);
    const ring = removeCollinear(traceOutline(labels, w, h, 1));
    expect(ring).toHaveLength(6);
  });

  it('ignores other labels', () => {
    const { labels, w, h } = labelsFrom(['1.2', '...', '...']);
    const ring = removeCollinear(traceOutline(labels, w, h, 2));
    expect(asSet(ring)).toEqual(new Set(['2,0', '3,0', '3,1', '2,1']));
  });

  it('outline with a hole returns the outer boundary', () => {
    const { labels, w, h } = labelsFrom(['111', '1.1', '111']);
    const ring = removeCollinear(traceOutline(labels, w, h, 1));
    expect(asSet(ring)).toEqual(new Set(['0,0', '3,0', '3,3', '0,3']));
  });

  it('rdp simplification collapses collinear midpoints', () => {
    const ring: [number, number][] = [
      [0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1],
    ];
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified).toHaveLength(4);
  });
});
