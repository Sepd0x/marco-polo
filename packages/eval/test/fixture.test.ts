import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tileBBox, type ScanTile } from '@marco-polo/core';
import { decodeImage } from '../../cli/src/tiles.js';
import { v1Detector } from '../src/detectors.js';
import { FIXTURE_MAX_BYTES } from '../src/fixture.js';
import { featureToLabel } from '../src/labels.js';
import { matchDetections, scopedCounts } from '../src/match.js';
import type { LabelFeature } from '../src/overpass.js';

const dir = new URL('../fixtures/open/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as {
  blocks: Array<{ id: string; source: string; bbox: { west: number; south: number; east: number; north: number } }>;
  tiles: Array<{ block: string; source: string; x: number; y: number; z: number; file: string; sha256: string }>;
};
const labels = (JSON.parse(readFileSync(new URL('labels.geojson', dir), 'utf8')) as { features: LabelFeature[] }).features.map(featureToLabel);
const baseline = JSON.parse(readFileSync(new URL('baseline.json', dir), 'utf8')) as Record<string, Record<string, { fp: number; fn: number }>>;

describe('open fixture', () => {
  it('is small, open and unmodified', () => {
    const bytes = manifest.tiles.reduce((k, t) => k + statSync(new URL(t.file, dir)).size, 0);
    expect(bytes).toBeLessThan(FIXTURE_MAX_BYTES);
    expect(manifest.tiles.length).toBeGreaterThanOrEqual(50);
    expect(manifest.tiles.every((t) => t.source !== 'esri')).toBe(true);
    for (const t of manifest.tiles) expect(createHash('sha256').update(readFileSync(new URL(t.file, dir))).digest('hex')).toBe(t.sha256);
    const attribution = readFileSync(new URL('ATTRIBUTION.md', dir), 'utf8');
    expect(attribution).toContain('Direção-Geral do Território');
    expect(attribution).toContain('scne.es');
    expect(attribution).toContain('IGN');
  });

  it('v1 errors per block do not exceed the recorded baseline', async () => {
    for (const block of manifest.blocks) {
      const tiles = manifest.tiles.filter((t) => t.block === block.id);
      const scan: ScanTile[] = tiles.map((t, index) => ({ tile: { z: t.z, x: t.x, y: t.y }, bbox: tileBBox({ z: t.z, x: t.x, y: t.y }), index }));
      const byKey = new Map(tiles.map((t) => [`${t.x}/${t.y}`, t]));
      const run = await v1Detector.run(scan, async (st) => decodeImage(readFileSync(new URL(byKey.get(`${st.tile.x}/${st.tile.y}`)!.file, dir))));
      const shown = run.detections.filter((d) => d.confidence >= 0.55);
      const c = scopedCounts(matchDetections(shown, labels), labels, block.bbox);
      const base = baseline.v1[block.id];
      expect(base, `no baseline for ${block.id}`).toBeDefined();
      expect(c.fp + c.fn).toBeLessThanOrEqual(base.fp + base.fn);
    }
  });
});
