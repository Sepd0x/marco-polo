import { describe, expect, it } from 'vitest';
import {
  autoChain,
  coverageContains,
  coversArea,
  nextScanProvider,
  pickProvider,
  providersCovering,
} from '../src/imagery/coverage.js';
import {
  DGT_ORTOS2018,
  DGT_ORTOS2025,
  DGT_ORTOSAT2023,
  ESRI_WORLD_IMAGERY,
  findAnyProvider,
  findProvider,
  IGN_ORTHOPHOTOS,
  IMAGERY_PROVIDERS,
  PNOA,
} from '../src/providers.js';
import { estimatePlan, PLAN_LIMITS, planLevel } from '../src/scan/estimate.js';
import { fallbackPart, haloRing, partCentre, sampleTiles, scanZoomFor, splitPlanBySource } from '../src/scan/parts.js';
import { ringAreaM2 } from '../src/geo/polygon.js';
import type { Ring } from '../src/types.js';

/** A square of `side` metres centred on a point. */
function square(lat: number, lon: number, side: number): Ring {
  const dLat = side / 2 / 111320;
  const dLon = side / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ];
}

describe('source registry', () => {
  it('scans only sources with a licence found in writing', () => {
    expect(DGT_ORTOS2025.scanAllowed).toBe(true);
    expect(PNOA.scanAllowed).toBe(true);
    expect(IGN_ORTHOPHOTOS.scanAllowed).toBe(true);
    // OrtoSat2023 has no published licence: view only.
    expect(DGT_ORTOSAT2023.scanAllowed).toBe(false);
  });

  it('keeps tiles across sessions only for open licences', () => {
    for (const p of [...IMAGERY_PROVIDERS, DGT_ORTOS2018]) {
      if (p.cachePolicy === 'persistent') expect(p.licence).toMatch(/CC BY 4\.0|Licence Ouverte/);
    }
    expect(DGT_ORTOSAT2023.cachePolicy).not.toBe('persistent');
  });

  it('has no Mapbox, MapTiler or free template', () => {
    const ids = IMAGERY_PROVIDERS.map((p) => p.id).join(' ');
    expect(ids).not.toMatch(/mapbox|maptiler|custom/i);
  });

  it('asks the DGT for 512 px on a z18 grid and the rest at z19', () => {
    expect(scanZoomFor(DGT_ORTOS2025)).toBe(18);
    expect(scanZoomFor(PNOA)).toBe(19);
    expect(scanZoomFor(IGN_ORTHOPHOTOS)).toBe(19);
    expect(scanZoomFor(ESRI_WORLD_IMAGERY)).toBe(19);
  });

  it('keeps the training-only source out of the app list', () => {
    expect(findProvider(DGT_ORTOS2018.id)).toBeUndefined();
    expect(findAnyProvider(DGT_ORTOS2018.id)).toBe(DGT_ORTOS2018);
    expect(DGT_ORTOS2018.template).toContain('/wms/ortos2018?');
    expect(DGT_ORTOS2018.template).toContain('LAYERS=Ortos2018-RGB');
  });

  it('has coverage rings that are closed enough to test points', () => {
    for (const p of IMAGERY_PROVIDERS) {
      if (!p.coverage) continue;
      expect(p.coverage.polygons.length).toBeGreaterThan(0);
      for (const ring of p.coverage.polygons) expect(ring.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('picking a source by place', () => {
  const at = (lat: number, lon: number) => pickProvider({ lat, lon }).id;

  it('scans mainland Portugal on the DGT, north and south', () => {
    expect(at(41.5503, -8.42)).toBe('dgt-ortos2025'); // Braga
    expect(at(38.7223, -9.1393)).toBe('dgt-ortos2025'); // Lisboa
    expect(at(37.0745, -8.1155)).toBe('dgt-ortos2025'); // Vilamoura
    expect(at(38.75, -9.05)).toBe('dgt-ortos2025'); // Tagus estuary
  });

  it('scans Spain on PNOA, France on IGN, the rest on Esri', () => {
    expect(at(36.4899, -4.9587)).toBe('pnoa'); // Marbella
    expect(at(39.57, 2.65)).toBe('pnoa'); // Palma
    expect(at(43.6, 7.0)).toBe('ign-orthophotos'); // Mougins
    expect(at(41.93, 8.74)).toBe('ign-orthophotos'); // Ajaccio
    expect(at(33.594, -111.926)).toBe('esri-world-imagery'); // Scottsdale
    expect(at(37.74, -25.67)).toBe('esri-world-imagery'); // Azores
    expect(at(35.29, -2.94)).toBe('esri-world-imagery'); // Melilla, not CC BY
    expect(at(42.507, 1.521)).toBe('esri-world-imagery'); // Andorra
  });

  it('honours a fixed choice and refuses a view-only one', () => {
    const p = pickProvider({ lat: 41.55, lon: -8.42 }, { mode: 'fixed', providerId: 'esri-world-imagery' });
    expect(p.id).toBe('esri-world-imagery');
    expect(() => pickProvider({ lat: 41.55, lon: -8.42 }, { mode: 'fixed', providerId: 'dgt-ortosat2023' })).toThrow(/viewed/);
    expect(() => pickProvider({ lat: 0, lon: 0 }, { mode: 'fixed', providerId: 'mapbox' })).toThrow(/unknown/);
  });

  it('lists the sources that cover a whole area', () => {
    const braga = square(41.55, -8.42, 500);
    expect(providersCovering(braga).map((p) => p.id)).toEqual(['dgt-ortos2025', 'esri-world-imagery']);
    expect(coversArea(PNOA, braga)).toBe(false);
    expect(coverageContains(null, 10, 10)).toBe(true);
  });

  it('falls back past view-only sources', () => {
    expect(nextScanProvider(DGT_ORTOS2025)?.id).toBe('esri-world-imagery');
    expect(nextScanProvider(PNOA)?.id).toBe('esri-world-imagery');
    expect(nextScanProvider(ESRI_WORLD_IMAGERY)).toBeNull();
    expect(autoChain().every((p) => p.scanAllowed)).toBe(true);
  });
});

describe('plans split by source', () => {
  // Across the Minho between Valença (PT) and Tui (Galicia).
  const border: Ring = [
    [-8.66, 42.02],
    [-8.62, 42.02],
    [-8.62, 42.06],
    [-8.66, 42.06],
  ];

  it('splits an area across the Minho into a DGT part and a PNOA part', () => {
    const split = splitPlanBySource(border);
    expect(split.parts.map((p) => p.provider.id).sort()).toEqual(['dgt-ortos2025', 'pnoa']);
    const dgt = split.parts.find((p) => p.provider.id === 'dgt-ortos2025')!;
    const pnoa = split.parts.find((p) => p.provider.id === 'pnoa')!;
    expect(dgt.plan.zoom).toBe(18);
    expect(pnoa.plan.zoom).toBe(19);
    expect(dgt.cells.length).toBeGreaterThan(100);
    expect(pnoa.cells.length).toBeGreaterThan(100);
    // South of the river is Portugal.
    expect(partCentre(dgt).lat).toBeLessThan(partCentre(pnoa).lat);
  });

  it('gives every cell to exactly one part and leaves no gap', () => {
    const split = splitPlanBySource(border);
    const seen = new Set<string>();
    let total = 0;
    for (const part of split.parts) {
      const shift = split.cellZoom - part.plan.zoom;
      const tiles = new Set(part.plan.tiles.map((t) => `${t.tile.x},${t.tile.y}`));
      for (const c of part.cells) {
        const key = `${c.x},${c.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(tiles.has(`${c.x >> shift},${c.y >> shift}`)).toBe(true);
      }
      total += part.cells.length;
      expect(part.plan.tiles.map((t) => t.index)).toEqual(part.plan.tiles.map((_, i) => i));
    }
    const areas = split.parts.reduce((s, p) => s + p.areaM2, 0);
    expect(areas).toBeCloseTo(ringAreaM2(border), -1);
    expect(total).toBe(seen.size);
  });

  it('keeps an area inside one country in one part', () => {
    const split = splitPlanBySource(square(41.55, -8.42, 400));
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].provider.id).toBe('dgt-ortos2025');
  });

  it('uses one part for a fixed source', () => {
    const split = splitPlanBySource(border, { mode: 'fixed', providerId: 'esri-world-imagery' });
    expect(split.parts).toHaveLength(1);
    expect(split.parts[0].plan.zoom).toBe(19);
  });

  it('moves a whole part to the next source, same id and cells', () => {
    const [part] = splitPlanBySource(square(41.55, -8.42, 400)).parts;
    const next = fallbackPart(part, square(41.55, -8.42, 400))!;
    expect(next.id).toBe(part.id);
    expect(next.provider.id).toBe('esri-world-imagery');
    expect(next.plan.zoom).toBe(19);
    expect(next.cells).toBe(part.cells);
    expect(next.plan.tiles.length).toBeGreaterThan(part.plan.tiles.length);
    expect(fallbackPart(next, square(41.55, -8.42, 400))).toBeNull();
  });

  it('samples tiles spread through a part, the same way each time', () => {
    const [part] = splitPlanBySource(square(41.55, -8.42, 600)).parts;
    const a = sampleTiles(part, 5);
    expect(a).toHaveLength(5);
    expect(new Set(a.map((t) => `${t.x},${t.y}`)).size).toBe(5);
    expect(sampleTiles(part, 5)).toEqual(a);
    expect(sampleTiles(part, 0)).toEqual([]);
    expect(sampleTiles(part, 10_000)).toHaveLength(part.plan.tiles.length);
  });

  it('finds the ring of neighbours a halo needs', () => {
    const block = [
      { z: 19, x: 10, y: 10 },
      { z: 19, x: 11, y: 10 },
      { z: 19, x: 10, y: 11 },
      { z: 19, x: 11, y: 11 },
    ];
    expect(haloRing(block)).toHaveLength(12);
  });
});

describe('plan estimate and limits', () => {
  it('passes a small area', () => {
    const e = estimatePlan(square(41.55, -8.42, 500));
    expect(e.level).toBe('ok');
    expect(e.approximate).toBe(false);
    expect(e.parts).toHaveLength(1);
    expect(e.parts[0].providerId).toBe('dgt-ortos2025');
    // About a quarter as many 512 px DGT requests as z19 tiles.
    expect(e.requests).toBeLessThan(e.z19Tiles / 2);
    expect(e.seconds).toBeCloseTo(e.requests / DGT_ORTOS2025.rate.maxPerSec, 6);
  });

  it('warns from 2 000 z19 tiles and blocks above 10 000', () => {
    expect(planLevel(PLAN_LIMITS.warnTiles - 1)).toBe('ok');
    expect(planLevel(PLAN_LIMITS.warnTiles)).toBe('warn');
    expect(planLevel(PLAN_LIMITS.blockTiles)).toBe('warn');
    expect(planLevel(PLAN_LIMITS.blockTiles + 1)).toBe('block');
    expect(estimatePlan(square(33.594, -111.926, 3000)).level).toBe('warn');
    expect(estimatePlan(square(33.594, -111.926, 7000)).level).toBe('block');
  });

  it('blocks a 20 x 20 km area without splitting it', () => {
    const t0 = performance.now();
    const e = estimatePlan(square(37.07, -8.11, 20_000));
    expect(performance.now() - t0).toBeLessThan(200);
    expect(e.level).toBe('block');
    expect(e.approximate).toBe(true);
    expect(e.z19Tiles).toBeGreaterThan(90_000);
  });

  it('counts halo requests for XYZ sources only', () => {
    const esri = estimatePlan(square(33.594, -111.926, 500), { mode: 'auto' }, { haloPx: 32 });
    expect(esri.haloRequests).toBeGreaterThan(0);
    const dgt = estimatePlan(square(41.55, -8.42, 500), { mode: 'auto' }, { haloPx: 32 });
    expect(dgt.haloRequests).toBe(0);
  });
});
