import { describe, expect, it } from 'vitest';
import { DetectionMerger, rankDetections, type Detection, type ScanTile } from '@marco-polo/core';
import { scanResult, toCSV, toGeoJSON } from '../../src/lib/export.js';
import type { PartView } from '../../src/state/store.js';
import { detectionId } from '../../src/scan/ids.js';
import { PT_AREA, US_TILE } from '../scan/harness.js';
import { makeFragment } from '../../../../packages/core/test/helpers.js';

function part(id: string, providerId: string, providerName: string, date: string | null, zoom: number): PartView {
  return {
    id, providerId, providerName, attribution: '', licence: '', date, zoom, nativeResM: 0.25,
    tiles: [{} as ScanTile, {} as ScanTile], tilesDone: 2, tilesFailed: 0, tilesNoCoverage: 1, areaM2: 1000, status: 'done', fellBackFrom: null,
  };
}

function detectionsFor(scanId: string, partId: string, x: number): Detection[] {
  const tile = { z: 19, x: US_TILE.x + x, y: US_TILE.y };
  const m = new DetectionMerger({}, [tile]);
  m.addTileDetections(tile, [makeFragment(tile, { x: 100, y: 100, w: 40, h: 20 })]);
  return m.getAll().map((d) => ({ ...d, id: detectionId(scanId, partId, d.id) }));
}

const parts = [
  part('p1', 'dgt-ortos2025', 'DGT Ortos2025', '2025-03-31/2025-07-26', 18),
  part('p2', 'pnoa', 'PNOA (IGN Spain)', '2023-09', 19),
];
const ranked = rankDetections([...detectionsFor('scan-x', 'p1', 1), ...detectionsFor('scan-x', 'p2', 3)]);
const state = { area: PT_AREA, parts, ranked, settings: { minConfidence: 0.5 } };

describe('export', () => {
  it('gives every detection the provenance of its own part', () => {
    const r = scanResult(state);
    expect(r.parts.map((p) => p.provenance.providerId)).toEqual(['dgt-ortos2025', 'pnoa']);
    const byPart = Object.fromEntries(r.detections.map((d) => [d.provenance.partId, d.provenance]));
    expect(byPart.p1.date).toBe('2025-03-31/2025-07-26');
    expect(byPart.p2.providerId).toBe('pnoa');
    expect(r.detections.every((d) => d.dims !== null)).toBe(true);
  });

  it('writes GeoJSON and CSV with sources and dates and no URL, template or key', () => {
    const gj = toGeoJSON(ranked, state);
    const csv = toCSV(ranked, state);
    for (const text of [gj, csv]) {
      expect(text).not.toMatch(/\{z\}|\{bbox|access_token|api[_-]?key|SERVICE=WMS|arcgisonline|geopf|dgterritorio/i);
    }
    const doc = JSON.parse(gj);
    expect(doc.parts).toHaveLength(2);
    expect(doc.attribution.some((a: string) => a.includes('PNOA'))).toBe(true);
    expect(doc.features[0].properties.source).toBeTruthy();
    expect(doc.features[0].properties.length_m).toBeGreaterThan(0);
    expect(csv.split('\n')[0]).toContain('source');
    expect(csv).toContain('dgt-ortos2025');
    expect(csv).toContain('pnoa');
  });

  it('counts what the filter left out as below the threshold', () => {
    const r = scanResult(state, ranked.slice(0, 1));
    expect(r.detections).toHaveLength(1);
    expect(r.belowThreshold).toBe(1);
  });

  it('marks scans saved by older builds as having no recorded source', () => {
    const old = rankDetections(detectionsFor('x', 'p1', 1).map((d) => ({ ...d, id: 'p7' })));
    const r = scanResult({ area: PT_AREA, parts: [], ranked: old, settings: { minConfidence: 0.5 } });
    expect(r.detections[0].provenance.providerId).toBe('unknown');
    expect(toCSV(old, { area: PT_AREA, parts: [], ranked: old, settings: { minConfidence: 0.5 } })).toContain('unknown');
  });
});
