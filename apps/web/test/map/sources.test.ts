import { describe, expect, it } from 'vitest';
import { DGT_ORTOS2025, ESRI_WORLD_IMAGERY, IGN_ORTHOPHOTOS, PNOA, type ImageryProvider } from '@marco-polo/core';
import {
  devicePxPerImagePx,
  displayTileSize,
  imagePxPerTile,
  mapMaxZoom,
  MAX_DEVICE_PX_PER_IMAGE_PX,
  rasterPieces,
  requestedTileZoom,
  TOP_LEVEL_BAND,
  wmsRequestPx,
  type DisplayOptions,
} from '../../src/map/sources.js';

const DPRS = [1, 1.25, 1.5, 2, 3];
const SOURCES: ImageryProvider[] = [ESRI_WORLD_IMAGERY, DGT_ORTOS2025, PNOA, IGN_ORTHOPHOTOS];

/** Zoom from which a piece would overzoom: past it the source has no more detail. */
function endZoom(maxzoom: number, tileSize: number): number {
  return maxzoom - Math.log2(512 / tileSize) + 0.5;
}

describe('tile size and WMS request', () => {
  it('uses 128 px tiles at DPR 2 and 256 at DPR 1', () => {
    expect(displayTileSize({ devicePixelRatio: 2, saveData: false })).toBe(128);
    expect(displayTileSize({ devicePixelRatio: 1, saveData: false })).toBe(256);
    expect(displayTileSize({ devicePixelRatio: 1.5, saveData: false })).toBe(171);
    expect(displayTileSize({ devicePixelRatio: 3, saveData: false })).toBe(85);
  });

  it('keeps 256 px tiles with data saver on, whatever the DPR', () => {
    for (const dpr of DPRS) expect(displayTileSize({ devicePixelRatio: dpr, saveData: true })).toBe(256);
  });

  it('asks the WMS for tileSize x DPR pixels, at most 512', () => {
    expect(wmsRequestPx(128, { devicePixelRatio: 2, saveData: false })).toBe(256);
    expect(wmsRequestPx(256, { devicePixelRatio: 2, saveData: true })).toBe(512);
    expect(wmsRequestPx(256, { devicePixelRatio: 3, saveData: true })).toBe(512);
    expect(wmsRequestPx(256, { devicePixelRatio: 1, saveData: false })).toBe(256);
  });

  it('treats a missing or odd DPR as 1', () => {
    expect(displayTileSize({ devicePixelRatio: Number.NaN, saveData: false })).toBe(256);
    expect(displayTileSize({ devicePixelRatio: 0, saveData: false })).toBe(256);
  });
});

describe('sharpness up to the zoom where each source runs out', () => {
  for (const provider of SOURCES) {
    for (const dpr of DPRS) {
      it(`${provider.id} at DPR ${dpr}: at most ${MAX_DEVICE_PX_PER_IMAGE_PX} device px per image px`, () => {
        const o: DisplayOptions = { devicePixelRatio: dpr, saveData: false };
        for (const piece of rasterPieces('t', provider, o)) {
          const ts = piece.source.tileSize;
          const px = imagePxPerTile(provider, ts, o);
          const lo = piece.layer.minzoom ?? 0;
          const hi = Math.min(piece.layer.maxzoom ?? 99, endZoom(provider.maxZoom, ts));
          for (let z = Math.max(lo, 3); z < hi; z += 0.01) {
            expect(devicePxPerImagePx(z, ts, px, provider.maxZoom, o)).toBeLessThanOrEqual(MAX_DEVICE_PX_PER_IMAGE_PX);
          }
        }
      });
    }
  }

  it('the Esri ends at z17.5 on a DPR 2 screen', () => {
    expect(endZoom(19, displayTileSize({ devicePixelRatio: 2, saveData: false }))).toBe(17.5);
  });
});

describe('top band: only top-level tiles from maxzoom - 2.5', () => {
  for (const provider of SOURCES) {
    for (const dpr of DPRS) {
      for (const saveData of [false, true]) {
        it(`${provider.id}, DPR ${dpr}, saveData ${saveData}`, () => {
          const o = { devicePixelRatio: dpr, saveData };
          const pieces = rasterPieces('t', provider, o);
          const from = provider.maxZoom - TOP_LEVEL_BAND;
          for (let z = from; z <= mapMaxZoom(provider) + 1e-9; z += 0.01) {
            // A layer is shown for minzoom <= z < maxzoom.
            const shown = pieces.filter((p) => (p.layer.minzoom ?? 0) <= z && z < (p.layer.maxzoom ?? 99));
            expect(shown.length).toBeGreaterThan(0);
            for (const p of shown) {
              expect(requestedTileZoom(z, p.source.tileSize, p.source.maxzoom)).toBe(provider.maxZoom);
            }
          }
        });
      }
    }
  }

  it('needs a second piece only when the tile size is above 128', () => {
    expect(rasterPieces('t', ESRI_WORLD_IMAGERY, { devicePixelRatio: 2, saveData: false })).toHaveLength(1);
    expect(rasterPieces('t', ESRI_WORLD_IMAGERY, { devicePixelRatio: 3, saveData: false })).toHaveLength(1);
    const two = rasterPieces('t', ESRI_WORLD_IMAGERY, { devicePixelRatio: 1, saveData: false });
    expect(two.map((p) => [p.source.tileSize, p.layer.minzoom, p.layer.maxzoom])).toEqual([
      [256, undefined, 16.5],
      [128, 16, undefined],
    ]);
  });
});

describe('pieces of a source', () => {
  it('carry the source maxzoom, its coverage as bounds and its attribution', () => {
    const [p] = rasterPieces('base', PNOA, { devicePixelRatio: 2, saveData: false });
    expect(p.source.maxzoom).toBe(19);
    expect(p.source.attribution).toBe(PNOA.attribution);
    const b = PNOA.coverage!.bbox;
    expect(p.source.bounds).toEqual([b.west, b.south, b.east, b.north]);
    expect(p.layer.paint['raster-fade-duration']).toBe(120);
  });

  it('a global source has no bounds unless asked', () => {
    const [p] = rasterPieces('base', ESRI_WORLD_IMAGERY, { devicePixelRatio: 2, saveData: false });
    expect(p.source.bounds).toBeUndefined();
    const [q] = rasterPieces('b', ESRI_WORLD_IMAGERY, { devicePixelRatio: 2, saveData: false }, { bounds: [1, 2, 3, 4] });
    expect(q.source.bounds).toEqual([1, 2, 3, 4]);
  });

  it('clips the extra bounds to the coverage box', () => {
    const b = DGT_ORTOS2025.coverage!.bbox;
    const [p] = rasterPieces('b', DGT_ORTOS2025, { devicePixelRatio: 2, saveData: false }, { bounds: [-20, 40, -8, 50] });
    expect(p.source.bounds).toEqual([b.west, 40, -8, b.north]);
  });

  it('sizes the DGT WMS request for the screen and keeps the bbox placeholder', () => {
    const [p] = rasterPieces('b', DGT_ORTOS2025, { devicePixelRatio: 2, saveData: false });
    const url = p.source.tiles[0];
    expect(url).toContain('WIDTH=256&HEIGHT=256');
    expect(url).toContain('BBOX={bbox-epsg-3857}');
    expect(url).not.toContain('512');
    const [q] = rasterPieces('b', DGT_ORTOS2025, { devicePixelRatio: 1, saveData: true });
    expect(q.source.tiles[0]).toContain('WIDTH=256&HEIGHT=256');
    expect(rasterPieces('b', DGT_ORTOS2025, { devicePixelRatio: 3, saveData: false })[0].source.tiles[0]).toContain('WIDTH=255&HEIGHT=255');
  });

  it('passes the filled template and image size through a URL hook', () => {
    const [p] = rasterPieces('b', DGT_ORTOS2025, { devicePixelRatio: 2, saveData: false }, { url: (t, px) => `x://${px}/${t.length > 0}` });
    expect(p.source.tiles[0]).toBe('x://256/true');
  });

  it('caps the map zoom half a level under the source top', () => {
    for (const s of SOURCES) expect(mapMaxZoom(s)).toBe(18.5);
  });
});
