import { describe, expect, it } from 'vitest';
import {
  ciede2000,
  hexToRgb,
  POOL_OUTLINE,
  rgbToLab,
  scoreOutlineColours,
  type SurfaceSample,
} from '../../src/map/outline.js';

import fixture from './fixtures/surface-samples.json';

const samples = fixture.samples as unknown as (SurfaceSample & { source: string })[];

describe('CIEDE2000', () => {
  // Pairs and expected values from Sharma, Wu and Dalal (2005), table 1.
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [56, -27, -3], 31.903],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it.each(pairs)('%j vs %j', (a, b, want) => {
    expect(ciede2000(a, b)).toBeCloseTo(want, 4);
    expect(ciede2000(b, a)).toBeCloseTo(want, 4);
  });

  it('white is L 100 and black is L 0', () => {
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 3);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 6);
  });
});

describe('outline colour', () => {
  it('has samples of water, roof tiles and grass from every open source', () => {
    expect([...new Set(samples.map((s) => s.class))].sort()).toEqual(['grass', 'roof', 'water']);
    expect([...new Set(samples.map((s) => s.source))].sort()).toEqual(['dgt', 'ign', 'pnoa']);
  });

  it('is the magenta of the design, over a dark casing', async () => {
    const { OUTLINE_CASING } = await import('../../src/map/outline.js');
    expect(POOL_OUTLINE).toBe('#ff52ff');
    expect(OUTLINE_CASING).toBe('#140814');
  });

  it('keeps clear of roof tiles and grass', () => {
    const s = scoreOutlineColours([POOL_OUTLINE], samples)[0];
    expect(s.byClass.roof).toBeGreaterThan(30);
    expect(s.byClass.grass).toBeGreaterThan(40);
  });

  it('on water, where the magenta is closest, leaves the edge to its casing', async () => {
    const { OUTLINE_CASING } = await import('../../src/map/outline.js');
    const { contrastRatio } = await import('../../src/lib/theme.js');
    const [line, casing] = scoreOutlineColours([POOL_OUTLINE, OUTLINE_CASING], samples).sort((x, y) =>
      x.colour === POOL_OUTLINE ? -1 : y.colour === POOL_OUTLINE ? 1 : 0,
    );
    expect(line.byClass.water).toBeGreaterThan(15);
    expect(casing.byClass.water).toBeGreaterThan(25);
    expect(contrastRatio(POOL_OUTLINE, OUTLINE_CASING)).toBeGreaterThan(7);
  });

  it('rejects malformed colours', () => {
    expect(() => hexToRgb('cyan')).toThrow();
  });
});

describe('chaikin', () => {
  const shoelace = (r: [number, number][]) =>
    Math.abs(r.reduce((s, [x, y], i) => {
      const [x2, y2] = r[(i + 1) % r.length];
      return s + x * y2 - x2 * y;
    }, 0)) / 2;

  it('never touches the detection it draws', async () => {
    const { chaikin } = await import('../../src/map/outline.js');
    const ring: [number, number][] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const copy = JSON.parse(JSON.stringify(ring));
    chaikin(ring, 2);
    expect(ring).toEqual(copy);
  });

  it('doubles the points per pass and drops a repeated closing point', async () => {
    const { chaikin } = await import('../../src/map/outline.js');
    expect(chaikin([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], 1)).toHaveLength(8);
    expect(chaikin([[0, 0], [1, 0], [1, 1], [0, 1]], 2)).toHaveLength(16);
    expect(chaikin([[0, 0], [1, 1]], 2)).toEqual([[0, 0], [1, 1]]);
  });

  it('changes the drawn area of a traced pool by a few percent at most', async () => {
    const { chaikin } = await import('../../src/map/outline.js');
    // An 8 x 4 m pool traced at 0.25 m: a staircase of 32 x 16 px with clipped corners.
    const px: [number, number][] = [[1, 0], [31, 0], [32, 1], [32, 15], [31, 16], [1, 16], [0, 15], [0, 1]];
    const before = shoelace(px);
    const after = shoelace(chaikin(px, 2));
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });
});
