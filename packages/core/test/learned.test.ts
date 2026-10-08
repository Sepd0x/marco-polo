import { describe, expect, it } from 'vitest';
import { analyseWindow, CANDIDATE_LEVELS, splitByBrightness } from '../src/detect/candidates.js';
import { MIN_POOL_AREA_M2 } from '../src/detect/detector.js';
import { FEATURE_COUNT, FEATURE_NAMES } from '../src/detect/features.js';
import { createV2Detector, DEFAULT_LEARNED_OPTIONS, detectWindow, windowFrame } from '../src/detect/learned.js';
import type { PoolModel } from '../src/detect/model.js';
import { bitmapPixelToLonLat, lonLatToTile, metersPerPixel, metersPerPixelOfBitmap } from '../src/geo/mercator.js';
import { buildTileWindow } from '../src/imagery/window.js';
import { DetectionMerger } from '../src/merge/merger.js';
import type { TileCoord, TileWindow } from '../src/types.js';
import { GREY_RGB, makeTile, POOL_RGB, type RectSpec } from './helpers.js';

/** Scores every candidate 1: the tests look at geometry, not at the scorer. */
const EVERYTHING: PoolModel = {
  format: 'marco-polo-pool-model/1',
  features: [...FEATURE_NAMES],
  gbdt: null,
  mlp: null,
  gbdtWeight: 1,
  calibration: { default: { x: [0], y: [1] } },
  thresholds: { default: 0.5 },
  meta: {},
};

const T = lonLatToTile(-8.0172, 37.0894, 19);

/** A 3 x 3 block of z19 tiles around T drawn as one picture, cut into windows. */
function mosaic(rects: RectSpec[]): (tile: TileCoord, halo: number) => TileWindow {
  const big = makeTile(768, 768, GREY_RGB, rects);
  const tileAt = (dx: number, dy: number) => {
    const out = new Uint8ClampedArray(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
      const from = (((dy + 1) * 256 + y) * 768 + (dx + 1) * 256) * 4;
      out.set(big.subarray(from, from + 1024), y * 1024);
    }
    return out;
  };
  return (tile, halo) => {
    const ox = tile.x - T.x, oy = tile.y - T.y;
    return buildTileWindow(tile, 256, halo, (dx, dy) => {
      const x = ox + dx, y = oy + dy;
      return Math.abs(x) <= 1 && Math.abs(y) <= 1 ? tileAt(x, y) : null;
    });
  };
}

describe('v2 window detector', () => {
  it('reports a pool cut by the tile border once and whole', () => {
    // Centre tile spans x 256..511 of the mosaic; the pool (x 500..543) crosses its east edge.
    const win = mosaic([{ x: 500, y: 380, w: 44, h: 22, rgb: POOL_RGB }]);
    const east = { z: 19, x: T.x + 1, y: T.y };
    const a = detectWindow(win(T, 48), { providerId: 'pnoa' }, EVERYTHING);
    const b = detectWindow(win(east, 48), { providerId: 'pnoa' }, EVERYTHING);
    const all = [...a, ...b];
    expect(all).toHaveLength(1);
    const mpp = metersPerPixel(all[0].center.lat, 19);
    expect(all[0].areaM2 / (44 * 22 * mpp * mpp)).toBeGreaterThan(0.95);
    expect(all[0].areaM2 / (44 * 22 * mpp * mpp)).toBeLessThan(1.05);
    // Its centroid (x 521.5 in the mosaic) lies in the east tile, which reports it.
    expect(b).toHaveLength(1);
    expect(all[0].touches).toEqual({ n: false, e: false, s: false, w: false });
  });

  it('without a halo the same pool comes out in two pieces, as v1 sees it', () => {
    const win = mosaic([{ x: 500, y: 380, w: 44, h: 22, rgb: POOL_RGB }]);
    const a = detectWindow(win(T, 0), { providerId: 'pnoa' }, EVERYTHING);
    const b = detectWindow(win({ z: 19, x: T.x + 1, y: T.y }, 0), { providerId: 'pnoa' }, EVERYTHING);
    expect(a.length + b.length).toBe(2);
  });

  it('places detections of a 512 px window by its real width', () => {
    const z18 = lonLatToTile(-8.0172, 37.0894, 18);
    const halo = 96;
    const size = 512 + 2 * halo;
    const px = makeTile(size, size, GREY_RGB, [{ x: halo + 200, y: halo + 160, w: 60, h: 32, rgb: POOL_RGB }]);
    const w: TileWindow = { tile: z18, tilePx: 512, halo, width: size, height: size, pixels: px, mPerPx: metersPerPixelOfBitmap(z18, 512) };
    const [d] = detectWindow(w, { providerId: 'dgt-ortos2025' }, EVERYTHING);
    const c = bitmapPixelToLonLat(z18, 230, 176, 512);
    expect(d.center.lon).toBeCloseTo(c.lon, 6);
    expect(d.center.lat).toBeCloseTo(c.lat, 6);
    const mpp = metersPerPixelOfBitmap(z18, 512);
    expect(d.areaM2 / (60 * 32 * mpp * mpp)).toBeGreaterThan(0.95);
    expect(d.areaM2 / (60 * 32 * mpp * mpp)).toBeLessThan(1.05);
    expect(d.bboxPx).toEqual({ minX: 200, minY: 160, maxX: 259, maxY: 191 });
  });

  it('keeps one candidate where the colour levels find the same shape', () => {
    const win = mosaic([{ x: 330, y: 330, w: 30, h: 16, rgb: POOL_RGB }]);
    const w = win(T, 48);
    const { frame, central } = windowFrame(w);
    void frame;
    const a = analyseWindow(w.pixels, w.width, w.height, central, () => w.mPerPx, DEFAULT_LEARNED_OPTIONS.candidates);
    // Identical blobs found by several levels are kept once.
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0].features).toHaveLength(FEATURE_COUNT);
    expect(detectWindow(w, { providerId: 'ign-orthophotos' }, EVERYTHING)).toHaveLength(1);
  });

  it('lets a 4 m² hot tub through the merger as a hot tub', () => {
    const win = mosaic([{ x: 380, y: 380, w: 9, h: 8, rgb: POOL_RGB }]);
    const dets = detectWindow(win(T, 48), { providerId: 'pnoa' }, EVERYTHING);
    expect(dets).toHaveLength(1);
    expect(dets[0].areaM2).toBeGreaterThan(MIN_POOL_AREA_M2);
    const merger = new DetectionMerger({}, [T]);
    merger.addTileDetections(T, dets);
    merger.finalize();
    const [d] = merger.getAll();
    expect(d.kind).toBe('hot_tub');
    expect(d.confidence).toBe(1);
  });

  it('ignores transparent pixels where a neighbour tile is missing', () => {
    const w = buildTileWindow(T, 256, 48, (dx, dy) => (dx === 0 && dy === 0 ? makeTile(256, 256, GREY_RGB, [{ x: 100, y: 100, w: 30, h: 16, rgb: POOL_RGB }]) : null));
    const dets = detectWindow(w, { providerId: 'pnoa' }, EVERYTHING);
    expect(dets).toHaveLength(1);
  });

  it('drops candidates under the floor and keeps the scorer version', () => {
    const none: PoolModel = { ...EVERYTHING, calibration: { default: { x: [0], y: [0.05] } } };
    const win = mosaic([{ x: 330, y: 330, w: 30, h: 16, rgb: POOL_RGB }]);
    expect(detectWindow(win(T, 48), { providerId: 'pnoa' }, none)).toHaveLength(0);
    const det = createV2Detector({ ...EVERYTHING, meta: { sha256: 'abc' } });
    expect(det.version).toBe('v2:abc');
    expect(det.detectTile(win(T, 48), { providerId: 'pnoa' })).toHaveLength(1);
  });

  it('runs the green band level only with its shape test', () => {
    const green = CANDIDATE_LEVELS.find((l) => l.gate.hueMin === 140 && l.gate.hueMax === 170)!;
    expect(green.gate.hueMin).toBe(140);
    expect(green.gate.hueMax).toBe(170);
    expect(green.minFill).toBeGreaterThan(0.5);
    // A long thin green strip (a hedge) fails the shape test; a compact green pool passes.
    const algae: [number, number, number] = [70, 150, 120];
    const win = mosaic([
      { x: 300, y: 300, w: 120, h: 6, rgb: algae },
      { x: 330, y: 400, w: 28, h: 16, rgb: algae },
    ]);
    const w = win(T, 48);
    const { central } = windowFrame(w);
    const a = analyseWindow(w.pixels, w.width, w.height, central, () => w.mPerPx, { ...DEFAULT_LEARNED_OPTIONS.candidates, levels: [green] });
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0].component.maxY - a.candidates[0].component.minY).toBeGreaterThan(10);
  });

  it('splits an olive pool from the darker tree it touches', () => {
    const olive = CANDIDATE_LEVELS.find((l) => l.split)!;
    const pool: [number, number, number] = [95, 112, 80];
    const tree: [number, number, number] = [40, 58, 36];
    // The pool (mosaic x 330..357, y 330..345) touches an L of tree: together they fill too little of their box.
    const win = mosaic([
      { x: 330, y: 330, w: 28, h: 16, rgb: pool },
      { x: 358, y: 300, w: 14, h: 70, rgb: tree },
      { x: 300, y: 346, w: 72, h: 14, rgb: tree },
    ]);
    const w = win(T, 48);
    const { central } = windowFrame(w);
    const opts = { ...DEFAULT_LEARNED_OPTIONS.candidates, levels: [olive] };
    const isPool = (c: { component: { minX: number; minY: number; maxX: number; maxY: number } }) =>
      Math.abs(c.component.minX - (330 - 256 + 48)) <= 1 && Math.abs(c.component.minY - (330 - 256 + 48)) <= 1 &&
      Math.abs(c.component.maxX - (357 - 256 + 48)) <= 1 && Math.abs(c.component.maxY - (345 - 256 + 48)) <= 1;
    const whole = analyseWindow(w.pixels, w.width, w.height, central, () => w.mPerPx, { ...opts, levels: [{ ...olive, split: undefined }] });
    expect(whole.candidates.some(isPool)).toBe(false);
    const split = analyseWindow(w.pixels, w.width, w.height, central, () => w.mPerPx, opts);
    const found = split.candidates.filter(isPool);
    expect(found).toHaveLength(1);
    // Split parts take the level numbers after the colour levels: the brighter part here.
    expect(found[0].level).toBe(2);
    expect(found[0].labels[Math.round(found[0].cy) * w.width + Math.round(found[0].cx)]).toBe(found[0].component.label);
  });
});

describe('brightness split', () => {
  const W = 40, H = 30;
  const comp = (labels: Int32Array) => {
    let n = 0, minX = W, minY = H, maxX = 0, maxY = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (labels[y * W + x] === 1) {
      n++; sx += x; sy += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { label: 1, pixelCount: n, minX, minY, maxX, maxY, sumX: sx, sumY: sy };
  };

  it('cuts a two-toned blob in two and leaves an even one alone', () => {
    const labels = new Int32Array(W * H);
    const val = new Float32Array(W * H);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 35; x++) {
      labels[y * W + x] = 1;
      val[y * W + x] = x < 20 ? 0.25 : 0.6;
    }
    const parts = { labels: new Int32Array(W * H), next: 0 };
    const out = splitByBrightness(comp(labels), labels, val, W, H, 0.08, parts);
    expect(out.map((o) => o.bright)).toEqual([false, true]);
    expect(out[0].component.maxX).toBeLessThan(20);
    expect(out[1].component.minX).toBeGreaterThanOrEqual(20);
    expect(parts.next).toBe(2);
    const even = new Float32Array(W * H).fill(0.4);
    expect(splitByBrightness(comp(labels), labels, even, W, H, 0.08, { labels: new Int32Array(W * H), next: 0 })).toHaveLength(0);
  });
});
