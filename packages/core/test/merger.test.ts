import { describe, expect, it } from 'vitest';
import { DetectionMerger } from '../src/merge/merger.js';
import { rankDetections } from '../src/rank/rank.js';
import type { TileCoord } from '../src/types.js';
import { makeFragment } from './helpers.js';

const Z = 19;
const A: TileCoord = { z: Z, x: 250400, y: 201560 };
const B: TileCoord = { z: Z, x: 250401, y: 201560 }; // east neighbour of A
const C: TileCoord = { z: Z, x: 250402, y: 201560 };

const plan = [A, B, C];

describe('cross-tile merger', () => {
  it('merges a pool split across two tiles into one detection', () => {
    const merger = new DetectionMerger({}, plan);

    const left = makeFragment(A, { x: 236, y: 100, w: 20, h: 16 }); // touches east edge
    const right = makeFragment(B, { x: 0, y: 100, w: 20, h: 16 }); // touches west edge

    const e1 = merger.addTileDetections(A, [left]);
    expect(e1.filter((e) => e.type === 'add')).toHaveLength(1);
    const first = e1.find((e) => e.type === 'add')!;
    expect(first.type === 'add' && first.detection.truncated).toBe(true);

    const e2 = merger.addTileDetections(B, [right]);
    const updates = e2.filter((e) => e.type === 'update');
    expect(updates.length).toBeGreaterThanOrEqual(1);

    const all = merger.getAll();
    expect(all).toHaveLength(1);
    const merged = all[0];
    expect(merged.pixelCount).toBe(20 * 16 * 2);
    expect(merged.areaM2).toBeCloseTo(left.areaM2 + right.areaM2, 6);
    expect(merged.tiles).toHaveLength(2);
    expect(merged.outline).toHaveLength(2);
  });

  it('resolves truncation when the neighbour completes empty', () => {
    const merger = new DetectionMerger({}, plan);
    const left = makeFragment(A, { x: 236, y: 100, w: 20, h: 16 });
    merger.addTileDetections(A, [left]);
    expect(merger.getAll()[0].truncated).toBe(true);

    const events = merger.addTileDetections(B, []);
    expect(events.some((e) => e.type === 'update')).toBe(true);
    expect(merger.getAll()[0].truncated).toBe(false);
  });

  it('uses a learned score as the confidence, the best of merged fragments', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [makeFragment(A, { x: 236, y: 100, w: 20, h: 16 }, { score: 0.4 })]);
    merger.addTileDetections(B, [makeFragment(B, { x: 0, y: 100, w: 20, h: 16 }, { score: 0.7 })]);
    merger.finalize();
    const all = merger.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].confidence).toBe(0.7);
  });

  it('does not merge distant detections in adjacent tiles', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [makeFragment(A, { x: 236, y: 20, w: 20, h: 16 })]);
    merger.addTileDetections(B, [makeFragment(B, { x: 0, y: 200, w: 20, h: 16 })]);
    expect(merger.getAll()).toHaveLength(2);
  });

  it('withholds fragments until the merged shape clears the minimum area', () => {
    const merger = new DetectionMerger({ minAreaM2: 8 }, plan);
    // Each fragment is about 4.5 m²: too small alone, valid together.
    const left = makeFragment(A, { x: 251, y: 100, w: 5, h: 16 });
    const right = makeFragment(B, { x: 0, y: 100, w: 5, h: 16 });

    const e1 = merger.addTileDetections(A, [left]);
    expect(e1.filter((e) => e.type === 'add')).toHaveLength(0);

    const e2 = merger.addTileDetections(B, [right]);
    expect(e2.filter((e) => e.type === 'add')).toHaveLength(1);
    expect(merger.getAll()).toHaveLength(1);
  });

  it('reclassifies clusters that grow beyond the pool ceiling as open water', () => {
    const merger = new DetectionMerger({ maxAreaM2: 100 }, plan);
    const big1 = makeFragment(A, { x: 156, y: 0, w: 100, h: 256 }); // about 1450 m², over any ceiling
    const e1 = merger.addTileDetections(A, [big1]);
    expect(e1.filter((e) => e.type === 'add')).toHaveLength(0);
    expect(merger.waterBodiesFiltered).toBe(1);
    expect(merger.getAll()).toHaveLength(0);
  });

  it('removes an emitted detection that later merges into open water', () => {
    const merger = new DetectionMerger({ maxAreaM2: 60 }, plan);
    const left = makeFragment(A, { x: 236, y: 100, w: 20, h: 16 }); // about 18 m², emitted
    const e1 = merger.addTileDetections(A, [left]);
    expect(e1.filter((e) => e.type === 'add')).toHaveLength(1);

    const right = makeFragment(B, { x: 0, y: 60, w: 256, h: 140 }); // huge, overlaps boundary
    const e2 = merger.addTileDetections(B, [right]);
    expect(e2.some((e) => e.type === 'remove')).toBe(true);
    expect(merger.getAll()).toHaveLength(0);
  });

  it('marks shapes at the plan boundary as permanently truncated', () => {
    const merger = new DetectionMerger({}, [A]); // plan contains only tile A
    const frag = makeFragment(A, { x: 236, y: 100, w: 20, h: 16 }); // touches east, outside the plan
    merger.addTileDetections(A, [frag]);
    const events = merger.finalize();
    void events;
    expect(merger.getAll()[0].truncated).toBe(true);
  });

  it('ranks by area, largest first', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [
      makeFragment(A, { x: 20, y: 20, w: 20, h: 10 }),
      makeFragment(A, { x: 100, y: 100, w: 40, h: 20 }),
    ]);
    merger.addTileDetections(B, []);
    const ranked = rankDetections(merger.getAll());
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].areaM2).toBeGreaterThan(ranked[1].areaM2);
  });

  // v2 fragments are whole shapes from windows with a halo: they never touch an edge.
  const whole = { n: false, e: false, s: false, w: false };

  it('keeps one detection when two tiles report the same scored shape across their border', () => {
    const merger = new DetectionMerger({}, plan);
    // A sees the pool cut by its window (the part up to its halo), B sees it whole and scores it higher.
    const cut = makeFragment(A, { x: 230, y: 100, w: 40, h: 30 }, { score: 0.6, touches: whole });
    const full = makeFragment(B, { x: -26, y: 100, w: 60, h: 30 }, { score: 0.8, touches: whole });
    merger.addTileDetections(A, [cut]);
    const events = merger.addTileDetections(B, [full]);
    expect(events.filter((e) => e.type === 'add')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'update')).toHaveLength(1);
    const all = merger.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pixelCount).toBe(60 * 30);
    expect(all[0].areaM2).toBeCloseTo(full.areaM2, 6);
    expect(all[0].confidence).toBe(0.8);
  });

  it('keeps the earlier view when it scores better', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [makeFragment(A, { x: 220, y: 100, w: 30, h: 30 }, { score: 0.9, touches: whole })]);
    merger.addTileDetections(B, [makeFragment(B, { x: -40, y: 95, w: 60, h: 40 }, { score: 0.5, touches: whole })]);
    const all = merger.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].pixelCount).toBe(30 * 30);
    expect(all[0].tiles).toEqual([A]);
    expect(all[0].confidence).toBe(0.9);
  });

  it('keeps two scored shapes of neighbouring tiles that barely overlap', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [makeFragment(A, { x: 226, y: 100, w: 32, h: 20 }, { score: 0.8, touches: whole })]);
    merger.addTileDetections(B, [makeFragment(B, { x: -1, y: 100, w: 30, h: 20 }, { score: 0.8, touches: whole })]);
    expect(merger.getAll()).toHaveLength(2);
  });

  it('never folds two scored shapes of the same tile together', () => {
    const merger = new DetectionMerger({}, plan);
    merger.addTileDetections(A, [
      makeFragment(A, { x: 100, y: 100, w: 40, h: 30 }, { score: 0.8, touches: whole }),
      makeFragment(A, { x: 110, y: 105, w: 10, h: 10 }, { score: 0.7, touches: whole }),
    ]);
    expect(merger.getAll()).toHaveLength(2);
  });
});
