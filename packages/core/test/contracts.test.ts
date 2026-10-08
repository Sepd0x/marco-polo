import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';
import { createV1Detector, detectTile, ESRI_WORLD_IMAGERY, findProvider, IMAGERY_PROVIDERS } from '../src/index.js';
import { lonLatToTile, metersPerPixel } from '../src/geo/mercator.js';
import type { TileWindow } from '../src/types.js';
import { GREY_RGB, makeTile, POOL_RGB } from './helpers.js';

const TILE = lonLatToTile(-8.0172, 37.0894, 19);

function windowOf(pixels: Uint8ClampedArray, size: number, halo = 0): TileWindow {
  return { tile: TILE, tilePx: size - 2 * halo, halo, width: size, height: size, pixels, mPerPx: metersPerPixel(37.0894, 19) };
}

describe('v1 detector behind the Detector seam', () => {
  it('returns exactly what detectTile returns for a bare 256 px tile', () => {
    const rgba = makeTile(256, 256, GREY_RGB, [{ x: 100, y: 80, w: 30, h: 16, rgb: POOL_RGB }]);
    const det = createV1Detector();
    expect(det.id).toBe('v1');
    const viaSeam = det.detectTile(windowOf(rgba, 256), { providerId: ESRI_WORLD_IMAGERY.id });
    expect(viaSeam).toEqual(detectTile(rgba, 256, 256, TILE));
    expect(viaSeam).toHaveLength(1);
  });

  it('refuses a window with a halo instead of projecting it wrong', () => {
    const rgba = makeTile(320, 320, GREY_RGB);
    expect(() => createV1Detector().detectTile(windowOf(rgba, 320, 32), { providerId: 'x' })).toThrow(/halo/);
  });

  it('projects a 512 px tile by its real width instead of refusing it', () => {
    const rgba = makeTile(512, 512, GREY_RGB, [{ x: 200, y: 160, w: 60, h: 32, rgb: POOL_RGB }]);
    const [d] = createV1Detector().detectTile(windowOf(rgba, 512), { providerId: 'x' });
    const mpp = metersPerPixel(d.center.lat, TILE.z) / 2;
    expect(d.areaM2 / (60 * 32 * mpp * mpp)).toBeGreaterThan(0.9);
    expect(d.areaM2 / (60 * 32 * mpp * mpp)).toBeLessThan(1.1);
  });
});

describe('imagery provider registry', () => {
  it('has no keyed or free-form sources', () => {
    for (const p of IMAGERY_PROVIDERS) {
      expect(p.template).not.toMatch(/key=|access_token|\{key\}/i);
      expect(p.id).not.toMatch(/mapbox|maptiler|custom/i);
    }
  });

  it('gives every source a licence URL, attribution and a usable template', () => {
    for (const p of IMAGERY_PROVIDERS) {
      expect(p.licenceUrl).toMatch(/^https:\/\//);
      expect(p.attribution.length).toBeGreaterThan(0);
      expect(p.template).toMatch(/^https:\/\//);
      if (p.kind === 'xyz') expect(p.template).toMatch(/\{z\}.*\{[xy]\}.*\{[xy]\}/);
      else expect(p.template).toContain('{bbox-epsg-3857}');
      expect(p.requestPx).toBeGreaterThanOrEqual(p.tileSize);
      expect(p.rate.maxPerSec).toBeGreaterThan(0);
      if (p.fallback) expect(findProvider(p.fallback)).toBeDefined();
    }
  });

  it('keeps Esri out of persistent storage and credits it as its terms ask', () => {
    expect(ESRI_WORLD_IMAGERY.cachePolicy).not.toBe('persistent');
    expect(ESRI_WORLD_IMAGERY.attribution).toContain('Powered by Esri');
    expect(ESRI_WORLD_IMAGERY.attribution).toContain('Esri, Vantor, Earthstar Geographics, and the GIS User Community');
  });

  it('no longer exports the free-form provider helper', () => {
    expect('makeCustomProvider' in core).toBe(false);
  });
});
