import { describe, expect, it } from 'vitest';
import { bboxIoU, pointInPolygons, polygonsAreaM2, polygonsCentroid } from '../src/geom.js';
import { dedupeLabels, featureToLabel } from '../src/labels.js';
import { matchDetections, scopedCounts } from '../src/match.js';
import { stitchRings } from '../src/overpass.js';
import { colourFamily, failedRules } from '../src/diagnose.js';
import { LARGE_POOL_M2, largePoolCounts } from '../src/evaluate.js';
import type { EvalDetection, Label } from '../src/types.js';

// Small boxes near Vilamoura. Here 1e-4° is about 11 m along a meridian and about 9 m along a parallel.
const LON = -8.1;
const LAT = 37.07;

function rectLabel(id: string, x: number, y: number, w: number, h: number, role: Label['role'] = 'pool'): Label {
  const ring: [number, number][] = [
    [LON + x, LAT + y],
    [LON + x + w, LAT + y],
    [LON + x + w, LAT + y + h],
    [LON + x, LAT + y + h],
  ];
  return featureToLabel({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: [[[...ring, ring[0]]]] },
    properties: { id, source: 'osm', role },
  });
}

function det(id: string, x: number, y: number, w: number, h: number, confidence = 0.9): EvalDetection {
  const bbox = { west: LON + x, east: LON + x + w, south: LAT + y, north: LAT + y + h };
  return {
    id,
    center: { lon: LON + x + w / 2, lat: LAT + y + h / 2 },
    bbox,
    outline: [[[[bbox.west, bbox.south], [bbox.east, bbox.south], [bbox.east, bbox.north], [bbox.west, bbox.north]]]],
    areaM2: 50,
    confidence,
  };
}

const SCOPE = { west: LON - 0.01, east: LON + 0.01, south: LAT - 0.01, north: LAT + 0.01 };

describe('geometry', () => {
  it('box IoU', () => {
    const a = { west: 0, east: 2, south: 0, north: 2 };
    expect(bboxIoU(a, a)).toBe(1);
    expect(bboxIoU(a, { west: 1, east: 3, south: 0, north: 2 })).toBeCloseTo(2 / 6);
    expect(bboxIoU(a, { west: 2, east: 3, south: 0, north: 2 })).toBe(0);
    expect(bboxIoU(a, { west: 5, east: 6, south: 5, north: 6 })).toBe(0);
  });

  it('IoU does not depend on axis scaling', () => {
    const a = { west: 0, east: 2, south: 0, north: 2 };
    const b = { west: 1, east: 3, south: 1, north: 2 };
    const s = (x: typeof a) => ({ west: x.west * 0.8, east: x.east * 0.8, south: x.south * 1.3, north: x.north * 1.3 });
    expect(bboxIoU(s(a), s(b))).toBeCloseTo(bboxIoU(a, b));
  });

  it('point in polygon respects holes', () => {
    const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6]];
    expect(pointInPolygons({ lon: 2, lat: 2 }, [[outer, hole]])).toBe(true);
    expect(pointInPolygons({ lon: 5, lat: 5 }, [[outer, hole]])).toBe(false);
    expect(pointInPolygons({ lon: 11, lat: 5 }, [[outer, hole]])).toBe(false);
  });

  it('area subtracts holes and centroid sits in the middle of a rectangle', () => {
    const l = rectLabel('a', 0, 0, 1e-4, 1e-4);
    // ~8.88 m × 11.07 m at 37.07°N
    expect(l.areaM2).toBeGreaterThan(95);
    expect(l.areaM2).toBeLessThan(102);
    expect(l.centroid.lon).toBeCloseTo(LON + 0.5e-4, 9);
    expect(l.centroid.lat).toBeCloseTo(LAT + 0.5e-4, 9);
    const outer: [number, number][] = [[LON, LAT], [LON + 2e-4, LAT], [LON + 2e-4, LAT + 2e-4], [LON, LAT + 2e-4]];
    const hole: [number, number][] = [[LON + 0.5e-4, LAT + 0.5e-4], [LON + 1.5e-4, LAT + 0.5e-4], [LON + 1.5e-4, LAT + 1.5e-4], [LON + 0.5e-4, LAT + 1.5e-4]];
    expect(polygonsAreaM2([[outer, hole]])).toBeCloseTo(polygonsAreaM2([[outer]]) * 0.75, 1);
    const c = polygonsCentroid([[outer]]);
    expect(c.lon).toBeCloseTo(LON + 1e-4, 9);
  });

  it('stitches multipolygon members into closed rings', () => {
    const rings = stitchRings([
      [[0, 0], [1, 0], [1, 1]],
      [[0, 0], [0, 1]],
      [[1, 1], [0, 1]],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][4]);
  });
});

describe('matching', () => {
  it('centre inside the label is a hit even with low IoU', () => {
    const l = rectLabel('L', 0, 0, 2e-4, 2e-4);
    const d = det('d', 0.9e-4, 0.9e-4, 0.2e-4, 0.2e-4); // tiny box in the middle, IoU 0.01
    const m = matchDetections([d], [l]);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].centerIn).toBe(true);
  });

  it('IoU ≥ 0.3 is a hit even when the centre misses an L-shaped label', () => {
    // L shape: the bbox centre falls in the notch.
    const ring: [number, number][] = [
      [LON, LAT], [LON + 2e-4, LAT], [LON + 2e-4, LAT + 0.5e-4], [LON + 0.5e-4, LAT + 0.5e-4], [LON + 0.5e-4, LAT + 2e-4], [LON, LAT + 2e-4],
    ];
    const l = featureToLabel({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[...ring, ring[0]]]] }, properties: { id: 'L', source: 'osm', role: 'pool' } });
    const d = det('d', 0, 0, 2e-4, 2e-4);
    const m = matchDetections([d], [l]);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].centerIn).toBe(false);
    expect(m.pairs[0].iou).toBeCloseTo(1);
  });

  it('a near miss below IoU 0.3 with the centre outside is no hit', () => {
    const l = rectLabel('L', 0, 0, 1e-4, 1e-4);
    const d = det('d', 0.8e-4, 0, 1e-4, 1e-4); // overlap 0.2 wide: IoU = 0.2/1.8
    const m = matchDetections([d], [l]);
    expect(m.pairs).toHaveLength(0);
    expect(m.unmatchedDets).toHaveLength(1);
    expect(m.unmatchedLabels).toHaveLength(1);
  });

  it('a label matches once; the second detection is a flagged duplicate', () => {
    const l = rectLabel('L', 0, 0, 2e-4, 1e-4);
    const a = det('a', 0, 0, 1e-4, 1e-4); // left half, centre inside, IoU 0.5
    const b = det('b', 1e-4, 0, 1e-4, 1e-4); // right half, centre inside, IoU 0.5
    const m = matchDetections([b, a], [l]);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].det.id).toBe('a'); // tie broken by id, independent of input order
    expect(m.unmatchedDets.map((d) => d.id)).toEqual(['b']);
    expect(m.duplicateOf.get('b')).toBe('L');
  });

  it('prefers the centre-inside pair over a higher-IoU pair without centre', () => {
    const l1 = rectLabel('L1', 0, 0, 1e-4, 1e-4);
    const l2 = rectLabel('L2', 3e-4, 0, 1e-4, 1e-4);
    const big = det('big', 0, 0, 1e-4, 1e-4);
    const m = matchDetections([big], [l1, l2]);
    expect(m.pairs[0].label.id).toBe('L1');
    expect(m.unmatchedLabels.map((l) => l.id)).toEqual(['L2']);
  });

  it('one detection over two adjacent pools hits only one of them', () => {
    const l1 = rectLabel('L1', 0, 0, 1e-4, 1e-4);
    const l2 = rectLabel('L2', 1.1e-4, 0, 1e-4, 1e-4);
    const d = det('d', 0, 0, 2.1e-4, 1e-4);
    const m = matchDetections([d], [l1, l2]);
    expect(m.pairs).toHaveLength(1);
    expect(m.unmatchedLabels).toHaveLength(1);
  });

  it('detections on ignore labels are neither hits nor false positives', () => {
    const covered = rectLabel('C', 0, 0, 1e-4, 1e-4, 'ignore');
    const d = det('d', 0, 0, 1e-4, 1e-4);
    const m = matchDetections([d], [covered]);
    expect(m.pairs).toHaveLength(0);
    expect(m.ignored).toHaveLength(1);
    expect(m.unmatchedDets).toHaveLength(0);
    expect(m.unmatchedLabels).toHaveLength(0);
  });

  it('point labels match within their radius', () => {
    const p = featureToLabel({ type: 'Feature', geometry: { type: 'Point', coordinates: [LON, LAT] }, properties: { id: 'n', source: 'osm', role: 'pool', radius_m: 5 } });
    const near = det('near', -0.2e-4, -0.2e-4, 0.4e-4, 0.4e-4); // centre on the point
    const far = det('far', 1e-4, 0, 0.4e-4, 0.4e-4); // ~10 m away
    expect(matchDetections([near], [p]).pairs).toHaveLength(1);
    expect(matchDetections([far], [p]).pairs).toHaveLength(0);
  });

  it('a point label also matches when it falls inside a large detected outline', () => {
    const p = featureToLabel({ type: 'Feature', geometry: { type: 'Point', coordinates: [LON + 0.1e-4, LAT + 0.5e-4] }, properties: { id: 'n', source: 'osm', role: 'pool', radius_m: 5 } });
    const long = det('long', 0, 0, 2e-4, 1e-4); // ~18 m long, centre ~8 m from the point
    expect(matchDetections([long], [p]).pairs).toHaveLength(1);
  });
});

describe('label dedupe', () => {
  it('turns a double-mapped pool and a point on a polygon into ignore labels', () => {
    const a = rectLabel('way/1', 0, 0, 1e-4, 1e-4);
    const b = rectLabel('way/2', 0.05e-4, 0, 1e-4, 1e-4); // same pool, slightly shifted
    const c = rectLabel('way/3', 3e-4, 0, 1e-4, 1e-4); // a different pool
    const p = featureToLabel({ type: 'Feature', geometry: { type: 'Point', coordinates: [LON + 0.5e-4, LAT + 0.5e-4] }, properties: { id: 'node/9', source: 'osm', role: 'pool', radius_m: 5 } });
    const out = dedupeLabels([b, p, c, a]);
    const role = (id: string) => out.find((l) => l.id === id)!.role;
    expect(role('way/1')).toBe('pool');
    expect(role('way/2')).toBe('ignore');
    expect(role('way/3')).toBe('pool');
    expect(role('node/9')).toBe('ignore');
  });
});

describe('scoped counts', () => {
  it('counts labels by centroid and detections by centre', () => {
    const inside = rectLabel('in', 0, 0, 1e-4, 1e-4);
    const outside = rectLabel('out', 0.02, 0, 1e-4, 1e-4);
    const missed = rectLabel('missed', 0.001, 0.001, 1e-4, 1e-4);
    const hitIn = det('hitIn', 0, 0, 1e-4, 1e-4);
    const hitOut = det('hitOut', 0.02, 0, 1e-4, 1e-4);
    const fpIn = det('fpIn', 0.002, 0.002, 1e-4, 1e-4);
    const fpOut = det('fpOut', 0.03, 0.03, 1e-4, 1e-4);
    const labels = [inside, outside, missed];
    const m = matchDetections([hitIn, hitOut, fpIn, fpOut], labels);
    const c = scopedCounts(m, labels, SCOPE);
    expect(c).toEqual({ labels: 2, tpLabels: 1, dets: 2, tpDets: 1, fp: 1, fn: 1, ignored: 0 });
  });
});

describe('miss diagnosis rules', () => {
  it('names the colour rules a pixel fails', () => {
    expect(failedRules(70, 200, 210)).toEqual([]); // clear cyan water
    expect(failedRules(20, 40, 35)).toContain('too dark');
    expect(failedRules(73, 201, 172)).toEqual(['green over blue']); // turquoise-green pool seen in Scottsdale
    expect(failedRules(40, 80, 200)).toContain('hue too blue');
  });

  it('groups rule combinations into families', () => {
    expect(colourFamily('hue too green + too dark + not blue over red + green over blue')).toBe('dull green or grey water');
    expect(colourFamily('green over blue')).toBe('turquoise-green water (green above blue)');
    expect(colourFamily('hue too blue + too pale')).toBe('deep blue water (hue above the band)');
    expect(colourFamily('too pale')).toBe('pale water (low saturation)');
  });
});

describe('pools of 400 m² or more', () => {
  it('counts outline labels from 400 m² and the ones hit, never points or ignores', () => {
    // 1e-4° x 1e-4° is about 11 m x 9 m here: 4e-4 x 2e-4 is about 790 m², 1e-4 x 1e-4 about 99 m².
    const big = rectLabel('big', 0, 0, 4e-4, 2e-4);
    const big2 = rectLabel('big2', 1e-3, 0, 4e-4, 2e-4);
    const small = rectLabel('small', 2e-3, 0, 1e-4, 1e-4);
    const covered = rectLabel('covered', 3e-3, 0, 4e-4, 2e-4, 'ignore');
    const point = featureToLabel({ type: 'Feature', geometry: { type: 'Point', coordinates: [LON, LAT] }, properties: { id: 'pt', source: 'osm', role: 'pool' } });
    expect(big.areaM2).toBeGreaterThan(LARGE_POOL_M2);
    expect(small.areaM2).toBeLessThan(LARGE_POOL_M2);
    expect(largePoolCounts([big, big2, small, covered, point], new Set(['big', 'small']))).toEqual({ labels: 2, hits: 1 });
  });
});
