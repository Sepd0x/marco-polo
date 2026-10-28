import { describe, expect, it } from 'vitest';
import {
  anchorGeometry,
  anchorsInView,
  EDGE_INSET,
  EM_PX,
  HIDDEN,
  ICON_PADDING,
  KEEPOUT_LONG,
  keepoutImages,
  levelAnchors,
  NEAREST_MARGIN,
  poolBox,
  worldX,
  worldY,
  type AnchorList,
  type PoolBox,
} from '../../src/map/labelPlace.js';

/** A pool of `w` x `h` metres centred at lon/lat, near Madrid. */
function pool(lon: number, lat: number, w: number, h: number): PoolBox {
  const dLon = w / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = h / 110_540;
  return poolBox({ lon, lat }, { west: lon - dLon / 2, east: lon + dLon / 2, south: lat - dLat / 2, north: lat + dLat / 2 });
}

const anchorsOf = (list: AnchorList) => list.filter((v): v is string => typeof v === 'string');
const LABEL = { width: 14, height: 15 };

describe('keep-out boxes', () => {
  it('cover the whole pool, with the image of the nearest aspect not above its own', () => {
    const p = pool(-3.826, 40.437, 12, 3.8);
    const x0 = worldX(-3.826 - 6 / (111_320 * Math.cos((40.437 * Math.PI) / 180)));
    const halfW = worldX(-3.826) - x0;
    expect(p.hw).toBeGreaterThanOrEqual(halfW * 0.999);
    expect(p.hh).toBeGreaterThanOrEqual(p.hw / 3.01);
    expect(p.image).toBe(`keepout:${KEEPOUT_LONG}x${Math.ceil(KEEPOUT_LONG / 3)}`);
    expect(keepoutImages().map((i) => i.id)).toContain(p.image);
  });

  it('turn with the pool', () => {
    expect(pool(-3.826, 40.437, 3.8, 12).image).toBe(`keepout:${Math.ceil(KEEPOUT_LONG / 3)}x${KEEPOUT_LONG}`);
    expect(pool(-3.826, 40.437, 6, 6).image).toBe(`keepout:${KEEPOUT_LONG}x${KEEPOUT_LONG}`);
  });

  it('size the icon so the box doubles each zoom', () => {
    const p = pool(-3.826, 40.437, 10, 5);
    expect(KEEPOUT_LONG * p.size0).toBeCloseTo(2 * p.hw, 9);
  });

  it('use Web Mercator world px at zoom 0', () => {
    expect(worldX(0)).toBe(256);
    expect(worldY(0)).toBeCloseTo(256, 9);
  });
});

describe('anchor offsets', () => {
  it('put the number just outside its own box, padding included', () => {
    const g = anchorGeometry('left', 20, 10, LABEL);
    expect(g.offset[0] * EM_PX).toBeGreaterThanOrEqual(20 + ICON_PADDING);
    expect(g.dx).toBeGreaterThan(20 + ICON_PADDING + LABEL.width / 2);
    expect(anchorGeometry('right', 20, 10, LABEL).dx).toBe(-g.dx);
  });

  it('add back the baseline shift MapLibre gives top and bottom anchors', () => {
    const top = anchorGeometry('top', 20, 10, LABEL);
    const bottom = anchorGeometry('bottom', 20, 10, LABEL);
    expect(top.offset[1] * EM_PX).toBeGreaterThan(10 + ICON_PADDING + 3);
    expect(bottom.offset[1]).toBe(-top.offset[1]);
  });
});

describe('anchors per zoom level', () => {
  it('give a lone pool every side', () => {
    const [a] = levelAnchors([pool(-3.826, 40.437, 10, 5)], [LABEL], 17);
    expect(anchorsOf(a)).toEqual(['left', 'right', 'top', 'bottom']);
  });

  it('drop a side whose number would lie nearer to another pool centre', () => {
    // A small pool 14 m east of a large one: a number east of the large pool reads as the small one's.
    const big = pool(-3.826, 40.437, 14, 6);
    const small = pool(-3.826 + 14 / 84_800, 40.437, 3, 3);
    const [a, b] = levelAnchors([big, small], [LABEL, LABEL], 18);
    expect(anchorsOf(a)).not.toContain('left');
    expect(anchorsOf(a)).toContain('right');
    expect(anchorsOf(b)).toContain('left');
  });

  it('keep every number it allows nearer to its own centre by the margin', () => {
    const pools = [pool(-3.826, 40.437, 10, 5), pool(-3.8258, 40.4371, 8, 4), pool(-3.8259, 40.4368, 4, 9)];
    for (const level of [15, 16, 17, 18, 19]) {
      const lists = levelAnchors(pools, pools.map(() => LABEL), level);
      const s = 2 ** level;
      lists.forEach((list, i) => {
        for (const anchor of anchorsOf(list)) {
          if (anchor === 'center') continue;
          const g = anchorGeometry(anchor as 'left', pools[i].hw * 2 * s, pools[i].hh * 2 * s, LABEL);
          const lx = pools[i].x * s + g.dx;
          const ly = pools[i].y * s + g.dy;
          const own = Math.hypot(g.dx, g.dy);
          pools.forEach((q, j) => {
            if (j !== i) expect(Math.hypot(q.x * s - lx, q.y * s - ly)).toBeGreaterThanOrEqual(own + NEAREST_MARGIN);
          });
        }
      });
    }
  });

  it('hide the number of a pool with no safe side', () => {
    const c = pool(-3.826, 40.437, 6, 6);
    const d = 8 / 84_800;
    const around = [pool(-3.826 + d, 40.437, 3, 3), pool(-3.826 - d, 40.437, 3, 3), pool(-3.826, 40.437 + d * 0.76, 3, 3), pool(-3.826, 40.437 - d * 0.76, 3, 3)];
    const [list] = levelAnchors([c, ...around], Array(5).fill(LABEL), 18);
    expect(list).toEqual(HIDDEN);
  });
});

describe('numbers inside the view', () => {
  const view = { left: 0, top: 0, right: 400, bottom: 300 };
  const box = { x: 0, y: 0, hw: 4 / 2 ** 17, hh: 4 / 2 ** 17, image: '', size0: 0, extent0: 0 };
  const level = 16;
  const all = (['left', 'right', 'top', 'bottom'] as const).flatMap((a) => [a, anchorGeometry(a, 8, 8, LABEL).offset] as AnchorList);

  it('keep every side for a pool in the middle', () => {
    expect(anchorsInView(all, { x: 200, y: 150 }, box, LABEL, level, view)).toEqual(all);
  });

  it('drop the side that would cross the edge, under the frame', () => {
    // A pool 10 px from the right edge: a number on its right (anchor left) would be cut.
    const fit = anchorsOf(anchorsInView(all, { x: 390, y: 150 }, box, LABEL, level, view));
    expect(fit).not.toContain('left');
    expect(fit).toContain('right');
    const top = anchorsOf(anchorsInView(all, { x: 200, y: 8 }, box, LABEL, level, view));
    expect(top).not.toContain('bottom');
    expect(top).toContain('top');
  });

  it('keep each number whole and EDGE_INSET clear of the edge', () => {
    for (const at of [
      { x: 2, y: 2 },
      { x: 398, y: 150 },
      { x: 200, y: 297 },
      { x: 25, y: 280 },
    ]) {
      const fit = anchorsInView(all, at, box, LABEL, level, view);
      for (const a of anchorsOf(fit)) {
        if (a === 'center') continue;
        const g = anchorGeometry(a as 'left', 8, 8, LABEL);
        const x = at.x + g.dx;
        const y = at.y + g.dy;
        expect(x - LABEL.width / 2).toBeGreaterThanOrEqual(EDGE_INSET);
        expect(x + LABEL.width / 2).toBeLessThanOrEqual(view.right - EDGE_INSET);
        expect(y - LABEL.height / 2).toBeGreaterThanOrEqual(EDGE_INSET);
        expect(y + LABEL.height / 2).toBeLessThanOrEqual(view.bottom - EDGE_INSET);
      }
    }
  });

  it('hide the number when no side fits, and leave a hidden one hidden', () => {
    const tiny = { left: 0, top: 0, right: 20, bottom: 20 };
    expect(anchorsInView(all, { x: 10, y: 10 }, box, LABEL, level, tiny)).toEqual(HIDDEN);
    expect(anchorsInView(HIDDEN, { x: 200, y: 150 }, box, LABEL, level, view)).toBe(HIDDEN);
  });

  it('keep off the panels over the map', () => {
    // The tool bar at the top left: a pool just right of it keeps its number off the bar.
    const tools = { left: 12, top: 12, right: 44, bottom: 120 };
    const fit = anchorsOf(anchorsInView(all, { x: 60, y: 60 }, box, LABEL, level, view, [tools]));
    expect(fit).not.toContain('right');
    expect(fit).toContain('left');
  });
});
