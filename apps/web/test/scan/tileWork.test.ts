import { describe, expect, it } from 'vitest';
import { createV1Detector, metersPerPixelOfBitmap, type Detector, type TileWindow } from '@marco-polo/core';
import { productDetector } from '../../src/scan/productDetector.js';
import { haloFor, pieceTiles, runJob, sniffType, thumbRect, type DecodedImage, type WorkJob } from '../../src/scan/tileWork.js';
import { makeTile as plainTile, POOL_RGB, type RectSpec } from '../../../../packages/core/test/helpers.js';

/** Synthetic tile with a little ground texture, so it does not read as a flat no-data fill. */
function makeTile(w: number, h: number, bg?: [number, number, number], rects: RectSpec[] = []): Uint8ClampedArray {
  const px = plainTile(w, h, bg, []);
  if (!bg) {
    let seed = 7;
    for (let i = 0; i < px.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 21) - 10;
      px[i] += n;
      px[i + 1] += n;
      px[i + 2] += n;
    }
  }
  const out = plainTile(w, h, [0, 0, 0], rects);
  for (let i = 0; i < px.length; i += 4) {
    const inRect = rects.some((r) => {
      const x = (i / 4) % w;
      const y = Math.floor(i / 4 / w);
      return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    });
    if (inRect) px.set(out.subarray(i, i + 4), i);
  }
  return px;
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

function job(over: Partial<WorkJob> = {}): WorkJob {
  return {
    id: 1,
    scanId: 'scan-t',
    providerId: 'esri-world-imagery',
    tile: { z: 19, x: 100_000, y: 200_000 },
    tilePx: 256,
    halo: 0,
    bytes: jpeg.slice().buffer,
    thumbs: true,
    ...over,
  };
}

const deps = (img: DecodedImage) => ({
  decode: async () => img,
  encodeThumb: async (_p: Uint8ClampedArray, w: number, h: number) => new Blob([`${w}x${h}`]),
  detector: createV1Detector(),
  now: () => 0,
});

describe('tile work', () => {
  it('finds a pool in a 256 px tile and crops its thumbnail', async () => {
    const pixels = makeTile(256, 256, undefined, [{ x: 100, y: 110, w: 30, h: 16, rgb: POOL_RGB }]);
    const r = await runJob(job(), deps({ pixels, width: 256, height: 256 }));
    expect(r.error).toBeUndefined();
    expect(r.noData).toBeNull();
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].detections).toHaveLength(1);
    expect(r.thumbs).toHaveLength(1);
    expect(r.thumbs[0].key).toBe('19/100000/200000:100,110');
  });

  it('cuts a 512 px DGT tile into its four z+1 children for v1', async () => {
    const pixels = makeTile(512, 512, undefined, [{ x: 300, y: 40, w: 30, h: 16, rgb: POOL_RGB }]);
    const tile = { z: 18, x: 50_000, y: 100_000 };
    const r = await runJob(job({ tile, tilePx: 512, providerId: 'dgt-ortos2025' }), deps({ pixels, width: 512, height: 512 }));
    expect(r.pieces.map((p) => p.tile)).toEqual(pieceTiles(tile, 512, 'v1'));
    expect(r.pieces.map((p) => p.tile.z)).toEqual([19, 19, 19, 19]);
    // The pool sits in the top-right child.
    expect(r.pieces[1].detections).toHaveLength(1);
    expect(r.pieces[1].detections[0].bboxPx.minX).toBe(300 - 256);
  });

  it('calls a white tile no imagery, before any detection', async () => {
    const pixels = makeTile(256, 256, [255, 255, 255]);
    const r = await runJob(job(), deps({ pixels, width: 256, height: 256 }));
    expect(r.noData).toBe('blank');
    expect(r.pieces).toEqual([]);
  });

  it('a probe only answers whether there is imagery', async () => {
    const pixels = makeTile(256, 256, undefined, [{ x: 100, y: 110, w: 30, h: 16, rgb: POOL_RGB }]);
    const r = await runJob(job({ probe: true }), deps({ pixels, width: 256, height: 256 }));
    expect(r.noData).toBeNull();
    expect(r.pieces).toEqual([]);
  });

  it('reports a bitmap of the wrong size as an error, not as a result', async () => {
    const pixels = makeTile(200, 200);
    const r = await runJob(job(), deps({ pixels, width: 200, height: 200 }));
    expect(r.error).toMatch(/200x200/);
    expect(r.pieces).toEqual([]);
  });

  it('crops no thumbnails unless asked', async () => {
    const pixels = makeTile(256, 256, undefined, [{ x: 100, y: 110, w: 30, h: 16, rgb: POOL_RGB }]);
    const r = await runJob(job({ thumbs: false }), deps({ pixels, width: 256, height: 256 }));
    expect(r.pieces[0].detections).toHaveLength(1);
    expect(r.thumbs).toEqual([]);
  });

  it('hands v2 a 512 px DGT window with its 96 px halo, unchanged', async () => {
    const seen: TileWindow[] = [];
    const spy: Detector = { id: 'v2', version: 'spy', detectTile: (w) => (seen.push(w), []) };
    const side = 512 + 2 * haloFor('v2', 512);
    const pixels = makeTile(side, side);
    const tile = { z: 18, x: 50_000, y: 100_000 };
    const r = await runJob(job({ tile, tilePx: 512, halo: haloFor('v2', 512), providerId: 'dgt-ortos2025' }), { ...deps({ pixels, width: side, height: side }), detector: spy });
    expect(r.error).toBeUndefined();
    expect(haloFor('v2', 512)).toBe(96);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ tile, tilePx: 512, halo: 96, width: 704, height: 704 });
    expect(r.pieces.map((p) => p.tile)).toEqual([tile]);
  });

  it('builds an XYZ window for v2 from the bare tile and its eight neighbours', async () => {
    const seen: TileWindow[] = [];
    const spy: Detector = { id: 'v2', version: 'spy', detectTile: (w) => (seen.push(w), []) };
    const pixels = makeTile(256, 256);
    const neighbours = Array.from({ length: 8 }, (_, i) => (i === 7 ? null : jpeg.slice().buffer));
    const r = await runJob(job({ halo: 48, neighbours }), { ...deps({ pixels, width: 256, height: 256 }), detector: spy });
    expect(r.error).toBeUndefined();
    expect(seen[0]).toMatchObject({ tilePx: 256, halo: 48, width: 352, height: 352 });
    // The missing bottom-right neighbour stays transparent.
    expect(seen[0].pixels[(351 * 352 + 351) * 4 + 3]).toBe(0);
    expect(seen[0].pixels[(200 * 352 + 200) * 4 + 3]).toBe(255);
  });

  it('runs the shipped model on a DGT window and cuts the thumbnail where the list expects it', async () => {
    const side = 704;
    const pixels = makeTile(side, side, undefined, [{ x: 330, y: 300, w: 44, h: 24, rgb: POOL_RGB }]);
    const tile = { z: 18, x: 125_000, y: 98_000 };
    const crops: [number, number][] = [];
    const r = await runJob(job({ tile, tilePx: 512, halo: 96, providerId: 'dgt-ortos2025' }), {
      ...deps({ pixels, width: side, height: side }),
      encodeThumb: async (_p, w, h) => (crops.push([w, h]), new Blob(['x'])),
      detector: productDetector(),
    });
    expect(r.error).toBeUndefined();
    for (const p of r.pieces) for (const d of p.detections) expect(d.score).toBeGreaterThanOrEqual(0);
    const d = r.pieces[0]?.detections[0];
    expect(d).toBeDefined();
    {
      const rect = thumbRect(d!.bboxPx, 512, 96, metersPerPixelOfBitmap(tile, 512));
      expect(crops[0]).toEqual([rect.x1 - rect.x0, rect.y1 - rect.y0]);
      expect(rect.x0).toBeGreaterThanOrEqual(-96);
      expect(rect.x1).toBeLessThanOrEqual(512 + 96);
    }
  });

  it('names image types by their magic bytes', () => {
    expect(sniffType(jpeg)).toBe('image/jpeg');
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
  });
});
