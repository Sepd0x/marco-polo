import { describe, expect, it } from 'vitest';
import { ESRI_WORLD_IMAGERY, tileBBox } from '@marco-polo/core';
import {
  areaFacts,
  cellStates,
  chaikin,
  chipSource,
  dimsOf,
  newestId,
  sortPools,
  splitByScore,
  thresholdToShowAll,
  thumbFor,
  viewRing,
} from '../../src/ui/model.js';
import { fragKey } from '../../src/lib/fragKey.js';
import { AREA, planTiles, pool, ranked, VILAMOURA } from './fixtures.js';
import { parseCoordinates, parseNominatim } from '../../src/ui/search.js';

describe('pool sizes', () => {
  it('measures length and width from the outline', () => {
    const d = ranked().find((r) => r.id === 'a')!;
    const dims = dimsOf(d)!;
    expect(dims.lengthM).toBeCloseTo(10, 0);
    expect(dims.widthM).toBeCloseTo(5, 0);
  });

  it('does not measure a pool cut by the edge of the imagery', () => {
    const d = ranked().find((r) => r.id === 'd')!;
    expect(d.truncated).toBe(true);
    expect(dimsOf(d)).toBeNull();
  });

  it('keeps what the detector reports, including "not measured"', () => {
    const d = { ...ranked()[0], dims: null };
    expect(dimsOf(d)).toBeNull();
  });

  it('is not the old 2:1 guess from the area', () => {
    const square = pool('sq', 8, 8, 0, 0, 0.9);
    const dims = dimsOf({ ...square, rank: 1 })!;
    expect(dims.lengthM / dims.widthM).toBeCloseTo(1, 1);
  });
});

describe('one count', () => {
  it('splits by the minimum score and counts what fell below', () => {
    const { shown, below, lowestBelow } = splitByScore(ranked(), 0.55, true);
    expect(shown.map((d) => d.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(shown.map((d) => d.rank)).toEqual([1, 2, 3, 4]);
    expect(below).toBe(1);
    expect(lowestBelow).toBe(0.4);
    expect(thresholdToShowAll(0.4)).toBe(0.4);
    expect(thresholdToShowAll(0.43)).toBe(0.4);
  });

  it('leaves hot tubs out of both numbers when they are hidden', () => {
    const { shown, below } = splitByScore(ranked(), 0.55, false);
    expect(shown.some((d) => d.kind === 'hot_tub')).toBe(false);
    expect(below).toBe(1);
  });

  it('sorts by score without changing the rank numbers', () => {
    const { shown } = splitByScore(ranked(), 0, true);
    const byScore = sortPools(shown, 'score');
    expect(byScore.map((d) => d.confidence)).toEqual([0.91, 0.77, 0.7, 0.62, 0.4]);
    expect(byScore[0].id).toBe('a');
    expect(byScore[0].rank).toBe(2);
  });
});

describe('scan progress', () => {
  it('marks done, busy and waiting cells in scan order', () => {
    expect(cellStates(6, 2, 3, false)).toEqual(['done', 'done', 'busy', 'busy', 'wait', 'wait']);
    expect(cellStates(4, 2, 3, true)).toEqual(['done', 'done', 'wait', 'wait']);
    expect(cellStates(3, 3, null, false)).toEqual(['done', 'done', 'done']);
  });

  it('tags the pool from the most recently scanned tile as new', () => {
    const tiles = planTiles(16);
    const early = pool('early', 10, 5, 0, 0, 0.9, { tiles: [tiles[2].tile] });
    const late = pool('late', 4, 3, 0, 0, 0.9, { tiles: [tiles[1].tile, tiles[9].tile] });
    const list = [early, late].map((d, i) => ({ ...d, rank: i + 1 }));
    expect(newestId(list, tiles)).toBe('late');
    expect(newestId(list, null)).toBeNull();
  });
});

describe('area facts', () => {
  it('names the open source auto picks in Portugal, its resolution and its rate', () => {
    const f = areaFacts(AREA, { mode: 'auto' }, 5);
    expect(f.sources.map((s) => s.id)).toEqual(['dgt-ortos2025']);
    expect(f.sources[0].resM).toBe(0.25);
    expect(f.rate).toBe(4);
    expect(f.tiles).toBeGreaterThan(0);
    expect(f.level).toBe('ok');
    expect(f.areaM2).toBeGreaterThan(260_000);
    expect(f.areaM2).toBeLessThan(280_000);
  });

  it('caps the speed at the slower of the setting and the source', () => {
    expect(areaFacts(AREA, { mode: 'auto' }, 2).rate).toBe(2);
  });

  it('blocks an area over the limit', () => {
    const big = viewRing([-8.3, 37.0, -8.0, 37.2], 0);
    expect(areaFacts(big, { mode: 'auto' }, 5).level).toBe('block');
  });

  it('labels the chip with the fixed choice or with what auto picks here', () => {
    expect(chipSource({ mode: 'fixed', providerId: ESRI_WORLD_IMAGERY.id }, null)?.id).toBe(ESRI_WORLD_IMAGERY.id);
    expect(chipSource({ mode: 'auto' }, VILAMOURA)?.id).toBe('dgt-ortos2025');
    expect(chipSource({ mode: 'auto' }, { lat: 33.59, lon: -111.93 })?.id).toBe(ESRI_WORLD_IMAGERY.id);
  });
});

describe('thumbnails', () => {
  it('places a stored crop on the ground it covers', () => {
    const d = ranked()[0];
    const key = fragKey(d.primary.tile, d.primary.bboxPx);
    const t = thumbFor(d, { [key]: 'data:image/png;base64,x' })!;
    const b = tileBBox(d.primary.tile);
    const w = (b.east - b.west) / 256;
    expect(t.bbox.west).toBeCloseTo(b.west + 94 * w, 10);
    expect(t.bbox.east).toBeCloseTo(b.west + 137 * w, 10);
    expect(t.bbox.north).toBeGreaterThan(t.bbox.south);
    expect(thumbFor(d, {})).toBeNull();
  });

  it('smooths an outline for drawing without moving it', () => {
    const sq: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const out = chaikin(sq);
    expect(out.length).toBe(16);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
  });
});

describe('search', () => {
  it('reads coordinates typed by hand', () => {
    expect(parseCoordinates('37.0745, -8.1155')).toEqual({ lat: 37.0745, lon: -8.1155 });
    expect(parseCoordinates('37.0745 -8.1155')).toEqual({ lat: 37.0745, lon: -8.1155 });
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('Vilamoura')).toBeNull();
  });

  it('keeps only well-formed Nominatim results', () => {
    const json = [
      { display_name: 'Vilamoura, Loulé', lat: '37.08', lon: '-8.11', boundingbox: ['37.0', '37.1', '-8.2', '-8.0'] },
      { display_name: 'no coordinates' },
      { display_name: 'bad box', lat: '1', lon: '2', boundingbox: ['x', '1', '2', '3'] },
      { display_name: 42, lat: '1', lon: '2' },
      'junk',
      null,
    ];
    const out = parseNominatim(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'Vilamoura, Loulé', lat: 37.08, lon: -8.11, bbox: [-8.2, 37.0, -8.0, 37.1] });
    expect(out[1].bbox).toBeNull();
    expect(parseNominatim({ error: 'x' })).toEqual([]);
  });
});
