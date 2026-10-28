import { describe, expect, it, vi } from 'vitest';
import { lonLatToTile, tileBBox, type Ring } from '@marco-polo/core';

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }));

const { cellRelation, cellsUnder, regionBounds, ringRelation, tileRelation } = await import('../../src/map/clip.js');

const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('ringRelation', () => {
  it('inside, outside and across', () => {
    expect(ringRelation({ west: 2, south: 2, east: 3, north: 3 }, square)).toBe('inside');
    expect(ringRelation({ west: 20, south: 2, east: 30, north: 3 }, square)).toBe('outside');
    expect(ringRelation({ west: 9, south: 2, east: 11, north: 3 }, square)).toBe('partial');
  });

  it('a box holding the whole ring is partial', () => {
    expect(ringRelation({ west: -1, south: -1, east: 11, north: 11 }, square)).toBe('partial');
  });

  it('a thin spike through a box with no corner or vertex inside is partial', () => {
    const spike: Ring = [[0, 4.9], [100, 4.9], [100, 5.1], [0, 5.1]];
    expect(ringRelation({ west: 40, south: 0, east: 50, north: 10 }, spike)).toBe('partial');
  });

  it('a box beside a concave notch is outside', () => {
    const u: Ring = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
    expect(ringRelation({ west: 4, south: 5, east: 6, north: 9 }, u)).toBe('outside');
    expect(ringRelation({ west: 4, south: 1, east: 6, north: 2 }, u)).toBe('inside');
  });
});

describe('cellRelation', () => {
  const cells = { zoom: 19, keys: new Set(['0,0', '1,0', '0,1']) };
  it('a coarser tile over owned and foreign cells is partial', () => {
    expect(cellRelation({ z: 18, x: 0, y: 0 }, cells)).toBe('partial');
  });
  it('a coarser tile over owned cells only is inside', () => {
    expect(cellRelation({ z: 18, x: 0, y: 0 }, { zoom: 19, keys: new Set(['0,0', '1,0', '0,1', '1,1']) })).toBe('inside');
  });
  it('a finer tile takes the relation of its cell', () => {
    expect(cellRelation({ z: 20, x: 1, y: 1 }, cells)).toBe('inside');
    expect(cellRelation({ z: 20, x: 3, y: 3 }, cells)).toBe('outside');
  });
});

describe('cells under a zoomed out tile', () => {
  // An Elvas to Badajoz area split between two sources: some 6000 z19 cells on one side.
  const zoom = 19;
  const a = lonLatToTile(-7.05, 38.89, zoom);
  const b = lonLatToTile(-6.98, 38.86, zoom);
  const keys = new Set<string>();
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) if ((x + y) % 7 !== 0) keys.add(`${x},${y}`);
  const cells = { zoom, keys };

  it('give the cells of the tile, as offsets in it', () => {
    const t = { z: 18, x: a.x >> 1, y: a.y >> 1 };
    const under = cellsUnder(t, cells);
    for (const [i, j] of under) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(2);
      expect(keys.has(`${(t.x << 1) + i},${(t.y << 1) + j}`)).toBe(true);
    }
    expect(under.length).toBeGreaterThan(0);
  });

  it('cost the cells of the area, not 4^(19 - z) cells per tile, down to zoom 0', () => {
    const t0 = performance.now();
    let total = 0;
    for (let z = 12; z >= 0; z--) {
      const s = zoom - z;
      const t = { z, x: a.x >> s, y: a.y >> s };
      const rel = cellRelation(t, cells);
      expect(rel).toBe('partial');
      total += cellsUnder(t, cells).length;
    }
    // The old walk took 1.9 s for one tile at zoom 7 and grew 4x per level.
    expect(performance.now() - t0).toBeLessThan(500);
    expect(total).toBeGreaterThan(0);
  });

  it('leave a tile away from the area outside', () => {
    expect(cellRelation({ z: 12, x: (a.x >> 7) + 3, y: a.y >> 7 }, cells)).toBe('outside');
  });

  it('count a tile inside when every cell under it is owned', () => {
    const t = { z: 17, x: 10, y: 10 };
    const all = new Set<string>();
    for (let x = 40; x < 44; x++) for (let y = 40; y < 44; y++) all.add(`${x},${y}`);
    expect(cellRelation(t, { zoom: 19, keys: all })).toBe('inside');
    all.delete('41,41');
    expect(cellRelation(t, { zoom: 19, keys: all })).toBe('partial');
  });
});

describe('tileRelation', () => {
  const area: Ring = [[-8.3798, 41.5713], [-8.3764, 41.5713], [-8.3764, 41.5738], [-8.3798, 41.5738]];
  it('tiles of a drawn area: inside, on its edge, away from it', () => {
    const mid = lonLatToTile(-8.3781, 41.57255, 19);
    expect(tileRelation(mid, { rings: [area], cells: null })).toBe('inside');
    const edge = lonLatToTile(-8.3798, 41.57255, 19);
    expect(tileRelation(edge, { rings: [area], cells: null })).toBe('partial');
    const far = lonLatToTile(-8.39, 41.57255, 19);
    expect(tileRelation(far, { rings: [area], cells: null })).toBe('outside');
  });

  it('cells narrow the region further', () => {
    const t = lonLatToTile(-8.3781, 41.57255, 19);
    expect(tileRelation(t, { rings: [area], cells: { zoom: 19, keys: new Set() } })).toBe('outside');
    expect(tileRelation(t, { rings: [area], cells: { zoom: 19, keys: new Set([`${t.x},${t.y}`]) } })).toBe('inside');
    const parent = { z: 18, x: t.x >> 1, y: t.y >> 1 };
    expect(tileRelation(parent, { rings: [area], cells: { zoom: 19, keys: new Set([`${t.x},${t.y}`]) } })).toBe('partial');
  });

  it('a union of rings counts as inside when one ring holds the tile', () => {
    const t = { z: 19, x: 100, y: 100 };
    const b = tileBBox(t);
    const holder: Ring = [[b.west - 1, b.south - 1], [b.east + 1, b.south - 1], [b.east + 1, b.north + 1], [b.west - 1, b.north + 1]];
    expect(tileRelation(t, { rings: [square, holder], cells: null })).toBe('inside');
  });

  it('bounds of a region cover every ring', () => {
    expect(regionBounds({ rings: [square, [[20, -5], [30, -5], [30, 1]]], cells: null })).toEqual([0, -5, 30, 10]);
  });
});
