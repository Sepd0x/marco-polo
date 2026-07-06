import { describe, expect, it } from 'vitest';
import {
  bboxIntersectsRing,
  expandBBoxMeters,
  pointInRing,
  ringAreaM2,
  ringBBox,
  segmentsIntersect,
} from '../src/geo/polygon.js';
import type { Ring } from '../src/types.js';

const square: Ring = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('polygon', () => {
  it('point-in-ring', () => {
    expect(pointInRing(0.5, 0.5, square)).toBe(true);
    expect(pointInRing(1.5, 0.5, square)).toBe(false);
    expect(pointInRing(-0.1, -0.1, square)).toBe(false);
  });

  it('segment intersection', () => {
    expect(segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0)).toBe(true);
    expect(segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1)).toBe(false);
    // Collinear overlap
    expect(segmentsIntersect(0, 0, 2, 0, 1, 0, 3, 0)).toBe(true);
  });

  it('ring bbox', () => {
    expect(ringBBox(square)).toEqual({ west: 0, south: 0, east: 1, north: 1 });
  });

  it('bbox vs ring: containment both ways and disjoint', () => {
    // bbox fully inside polygon
    expect(bboxIntersectsRing({ west: 0.4, south: 0.4, east: 0.6, north: 0.6 }, square)).toBe(true);
    // polygon fully inside bbox
    expect(bboxIntersectsRing({ west: -1, south: -1, east: 2, north: 2 }, square)).toBe(true);
    // edge crossing without contained vertices
    expect(bboxIntersectsRing({ west: -0.5, south: 0.4, east: 1.5, north: 0.6 }, square)).toBe(true);
    // disjoint
    expect(bboxIntersectsRing({ west: 2, south: 2, east: 3, north: 3 }, square)).toBe(false);
  });

  it('geodesic area of a small equatorial square', () => {
    const ring: Ring = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ];
    const area = ringAreaM2(ring);
    // 0.01° ≈ 1113.2 m at the equator → ≈ 1.239 km²
    expect(area).toBeGreaterThan(1.2e6);
    expect(area).toBeLessThan(1.28e6);
  });

  it('expands bboxes by metres', () => {
    const b = expandBBoxMeters({ west: 0, south: 0, east: 0, north: 0 }, 111.32);
    expect(b.north).toBeCloseTo(0.001, 5);
    expect(b.west).toBeCloseTo(-0.001, 5);
  });
});
