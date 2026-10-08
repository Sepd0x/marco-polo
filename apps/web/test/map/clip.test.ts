import { describe, expect, it, vi } from 'vitest';
import { lonLatToTile, tileBBox, type Ring } from '@marco-polo/core';

vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }));

const { cellRelation, regionBounds, ringRelation, tileRelation } = await import('../../src/map/clip.js');

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
