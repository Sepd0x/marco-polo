import { describe, expect, it } from 'vitest';
import { buildScanPlan, estimateTileCount } from '../src/scan/plan.js';
import { tileBBox } from '../src/geo/mercator.js';
import type { Ring } from '../src/types.js';

/** Polygon slightly inset inside an N×M block of tiles (so neighbours are excluded). */
function insetPolygonOverTiles(z: number, x0: number, y0: number, cols: number, rows: number): Ring {
  const nw = tileBBox({ z, x: x0, y: y0 });
  const se = tileBBox({ z, x: x0 + cols - 1, y: y0 + rows - 1 });
  const dx = (se.east - nw.west) * 1e-4;
  const dy = (nw.north - se.south) * 1e-4;
  return [
    [nw.west + dx, se.south + dy],
    [se.east - dx, se.south + dy],
    [se.east - dx, nw.north - dy],
    [nw.west + dx, nw.north - dy],
  ];
}

describe('scan plan', () => {
  const z = 14;
  const x0 = 7770;
  const y0 = 6300;

  it('covers exactly the tiles a rectangle spans', () => {
    const plan = buildScanPlan(insetPolygonOverTiles(z, x0, y0, 3, 3), z);
    expect(plan.tiles).toHaveLength(9);
    expect(plan.range).toEqual({ minX: x0, minY: y0, maxX: x0 + 2, maxY: y0 + 2 });
  });

  it('serpentine order alternates row direction', () => {
    const plan = buildScanPlan(insetPolygonOverTiles(z, x0, y0, 3, 2), z, 'serpentine');
    const xs = plan.tiles.map((t) => t.tile.x - x0);
    const ys = plan.tiles.map((t) => t.tile.y - y0);
    expect(ys).toEqual([0, 0, 0, 1, 1, 1]);
    expect(xs).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it('spiral order starts at the centre tile', () => {
    const plan = buildScanPlan(insetPolygonOverTiles(z, x0, y0, 3, 3), z, 'spiral');
    expect(plan.tiles[0].tile).toEqual({ z, x: x0 + 1, y: y0 + 1 });
    expect(plan.tiles).toHaveLength(9);
  });

  it('a triangle keeps fewer tiles than its bounding box', () => {
    const nw = tileBBox({ z, x: x0, y: y0 });
    const se = tileBBox({ z, x: x0 + 4, y: y0 + 4 });
    const triangle: Ring = [
      [nw.west, nw.north],
      [se.east, nw.north],
      [nw.west, se.south],
    ];
    const plan = buildScanPlan(triangle, z);
    expect(plan.tiles.length).toBeGreaterThan(10);
    expect(plan.tiles.length).toBeLessThan(25);
  });

  it('tile indices follow traversal order', () => {
    const plan = buildScanPlan(insetPolygonOverTiles(z, x0, y0, 2, 2), z);
    expect(plan.tiles.map((t) => t.index)).toEqual([0, 1, 2, 3]);
  });

  it('estimate matches the exact plan for small areas', () => {
    const polygon = insetPolygonOverTiles(z, x0, y0, 3, 3);
    const est = estimateTileCount(polygon, z);
    expect(est.approximate).toBe(false);
    expect(est.count).toBe(buildScanPlan(polygon, z).tiles.length);
  });

  it('plan area is the polygon geodesic area', () => {
    const plan = buildScanPlan(insetPolygonOverTiles(z, x0, y0, 2, 2), z);
    expect(plan.areaM2).toBeGreaterThan(0);
  });
});
