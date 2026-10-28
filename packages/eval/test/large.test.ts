import { describe, expect, it } from 'vitest';
import { planLargeImport } from '../src/large.js';
import type { LabelFeature } from '../src/overpass.js';
import type { Zone } from '../src/zones.js';

// Near Vilamoura: 1e-4° is about 11 m north and 9 m east.
const LON = -8.115, LAT = 37.074;
const box = { west: LON - 0.005, south: LAT - 0.004, east: LON + 0.005, north: LAT + 0.004 };
const zone = (id: string, role: Zone['role'], at = box) => ({ id, role, bbox: at, productSource: 'dgt' }) as unknown as Zone;
const rect = (x: number, y: number, w: number, h: number) => ({
  type: 'Feature' as const,
  geometry: { type: 'Polygon' as const, coordinates: [[[LON + x, LAT + y], [LON + x + w, LAT + y], [LON + x + w, LAT + y + h], [LON + x, LAT + y + h], [LON + x, LAT + y]]] },
  properties: {},
});

describe('large-pool import', () => {
  it('adds outlines of 400 m² or more to DEV zones, drawn on the product source', () => {
    const plan = planLargeImport([rect(0, 0, 4e-4, 2e-4)], [zone('vilamoura', 'DEV')], () => []);
    const added = plan.add.get('vilamoura')!;
    expect(added).toHaveLength(1);
    expect(added[0].properties).toMatchObject({ id: 'visual/vilamoura/large-1', source: 'visual', role: 'pool', drawnOn: 'dgt' });
    expect(plan.skipped).toEqual([]);
  });

  it('never touches TEST, DEV-2 or GOLD zones, and leaves out small, outside and known pools', () => {
    const known: LabelFeature = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [rect(1e-3, 0, 4e-4, 2e-4).geometry.coordinates] }, properties: { id: 'osm/1', source: 'osm', role: 'pool' } };
    const far = { west: 10, south: 10, east: 10.01, north: 10.01 };
    const features = [rect(1e-3, 0, 4e-4, 2e-4), rect(2e-3, 0, 1e-4, 1e-4), rect(0, 0, 4e-4, 2e-4)];
    const dev = planLargeImport(features.slice(0, 2), [zone('vilamoura', 'DEV')], () => [known]);
    expect(dev.add.size).toBe(0);
    expect(dev.skipped.map((s) => s.why)).toEqual([expect.stringContaining('already labelled'), expect.stringContaining('under 400')]);
    for (const role of ['TEST', 'DEV-2', 'GOLD'] as const) {
      const p = planLargeImport([features[2]], [zone('dev', 'DEV'), zone('x', role)], () => []);
      expect(p.add.size).toBe(0);
      expect(p.skipped[0].why).toContain(role);
    }
    expect(planLargeImport([features[2]], [zone('elsewhere', 'DEV', far)], () => []).skipped[0].why).toContain('outside');
  });
});
