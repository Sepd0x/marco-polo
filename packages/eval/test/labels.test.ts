import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLabels } from '../src/labels.js';

const square = (lon: number, lat: number) => ({
  type: 'MultiPolygon',
  coordinates: [[[[lon, lat], [lon + 1e-4, lat], [lon + 1e-4, lat + 1e-4], [lon, lat + 1e-4], [lon, lat]]]],
});

describe('label loading', () => {
  it('shifts hand labels drawn on another source, not those drawn on the source read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-labels-'));
    writeFileSync(join(dir, 'z.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
    writeFileSync(
      join(dir, 'z.extra.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: square(1, 43), properties: { id: 'a', source: 'visual', role: 'pool' } },
          { type: 'Feature', geometry: square(1.01, 43), properties: { id: 'b', source: 'visual', role: 'pool', drawnOn: 'ign' } },
        ],
      }),
    );
    const { labels } = await loadLabels('z', { dir, source: 'ign', osmShiftM: [0, 0], visualShiftM: [10, 0] });
    const a = labels.find((l) => l.id === 'a')!;
    const b = labels.find((l) => l.id === 'b')!;
    expect(a.bbox.west).toBeGreaterThan(1 + 1e-5);
    expect(b.bbox.west).toBeCloseTo(1.01, 9);
  });

  it('moves a label drawn on a third source by the difference of the two shifts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-labels-'));
    writeFileSync(join(dir, 'z.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
    writeFileSync(
      join(dir, 'z.extra.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(1, 0), properties: { id: 'b', source: 'visual', role: 'pool', drawnOn: 'ign' } }] }),
    );
    // Label source esri; ign sits 10 m east of it, dgt 4 m east: an ign label read on dgt moves 6 m west.
    const shifts: Record<string, [number, number]> = { esri: [0, 0], ign: [10, 0], dgt: [4, 0] };
    const { labels } = await loadLabels('z', { dir, source: 'dgt', osmShiftM: [0, 0], visualShiftM: shifts.dgt, visualShiftFor: (on) => shifts[on] });
    expect(labels[0].bbox.west).toBeCloseTo(1 - 6 / 111320, 9);
    await expect(loadLabels('z', { dir, source: 'dgt', osmShiftM: [0, 0], visualShiftM: shifts.dgt })).rejects.toThrow(/drawn on ign/);
  });
});
