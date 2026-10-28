/**
 * Import hand outlines of pools of 400 m² or more into the labels of DEV and
 * TRAIN zones. The labels hold few pools that large, so the benchmark could
 * not see the class; these outlines give it one.
 *
 *   eval large-import --file <outlines.geojson> [--write]
 *
 * An outline goes to the DEV or TRAIN zone whose box holds its centroid, as a
 * visual pool label drawn on the source named by its `drawnOn` property (else
 * the zone's product source). Outlines outside every such zone, inside a
 * DEV-2, GOLD or TEST zone, or already covered by a pool label are reported
 * and left out. Without --write nothing changes; with it, the
 * `<zone>.extra.geojson` files grow and the next run needs
 * `--relabel "<why>"`, which logs the change in labels/RELABEL_LOG.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandBBoxMeters } from '@marco-polo/core';
import type { SourceId } from './candidates.js';
import type { Detector } from './detectors.js';
import { evaluateZone } from './evaluate.js';
import { pointInBBox, pointInPolygons, polygonsAreaM2, polygonsCentroid } from './geom.js';
import type { TileSource } from './imagery.js';
import { haversineKm, zoneCenter } from './registry.js';
import { LARGE_POOL_M2 } from './evaluate.js';
import { featureToLabel } from './labels.js';
import type { LabelFeature } from './overpass.js';
import { allZones, type Zone } from './zones.js';

/** Roles an imported outline may join. DEV-2 and GOLD are never edited here; TEST never at all. */
export const LARGE_IMPORT_ROLES: readonly Zone['role'][] = ['DEV', 'TRAIN'];

type Polygons = number[][][][];

interface InFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: Polygons };
  properties?: Record<string, unknown> | null;
}

export interface LargePlan {
  /** Zone id to the new label features. */
  add: Map<string, LabelFeature[]>;
  skipped: { index: number; why: string }[];
}

const polygonsOf = (f: InFeature): Polygons => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);

/**
 * Where each outline goes. `existing(zone)` gives the zone's current label
 * features; an outline whose centroid falls in an existing pool label, or
 * whose own outline holds an existing pool's centroid, is already labelled.
 */
export function planLargeImport(features: InFeature[], zones: Zone[], existing: (zone: string) => LabelFeature[]): LargePlan {
  const add = new Map<string, LabelFeature[]>();
  const skipped: LargePlan['skipped'] = [];
  const known = new Map<string, ReturnType<typeof featureToLabel>[]>();
  features.forEach((f, index) => {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
      skipped.push({ index, why: 'not a polygon' });
      return;
    }
    const polys = polygonsOf(f) as [number, number][][][];
    const c = polygonsCentroid(polys);
    const area = polygonsAreaM2(polys);
    if (area < LARGE_POOL_M2) {
      skipped.push({ index, why: `${area.toFixed(0)} m², under ${LARGE_POOL_M2} m²` });
      return;
    }
    const at = zones.filter((z) => pointInBBox(c, z.bbox));
    const barred = at.find((z) => !LARGE_IMPORT_ROLES.includes(z.role));
    if (barred) {
      skipped.push({ index, why: `inside ${barred.role} zone ${barred.id}` });
      return;
    }
    const zone = at[0];
    if (!zone) {
      skipped.push({ index, why: 'outside every DEV and TRAIN zone' });
      return;
    }
    if (!known.has(zone.id)) known.set(zone.id, existing(zone.id).map(featureToLabel).filter((l) => l.role === 'pool'));
    const labels = known.get(zone.id)!;
    const dup = labels.find((l) => (!l.point && pointInPolygons(c, l.polygons)) || pointInPolygons(l.centroid, polys));
    if (dup) {
      skipped.push({ index, why: `already labelled as ${dup.id} in ${zone.id}` });
      return;
    }
    const list = add.get(zone.id) ?? [];
    const n = existing(zone.id).filter((e) => e.properties.id.startsWith(`visual/${zone.id}/large-`)).length + list.length + 1;
    const drawnOn = typeof f.properties?.drawnOn === 'string' ? f.properties.drawnOn : zone.productSource;
    const feature: LabelFeature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polys },
      properties: { id: `visual/${zone.id}/large-${n}`, source: 'visual', role: 'pool', method: `outline of a pool of ${LARGE_POOL_M2} m² or more, drawn by hand on ${drawnOn}`, drawnOn },
    } as LabelFeature;
    list.push(feature);
    add.set(zone.id, list);
    labels.push(featureToLabel(feature));
  });
  return { add, skipped };
}

interface FeatureFile {
  type: 'FeatureCollection';
  features: LabelFeature[];
  [k: string]: unknown;
}

function readCollection(path: string): FeatureFile | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as FeatureFile) : null;
}

export function largeImportCommand(file: string, labelsDir: string, write: boolean): void {
  const input = JSON.parse(readFileSync(file, 'utf8')) as { features: InFeature[] };
  const existing = (zone: string) => [...(readCollection(join(labelsDir, `${zone}.geojson`))?.features ?? []), ...(readCollection(join(labelsDir, `${zone}.extra.geojson`))?.features ?? [])];
  const plan = planLargeImport(input.features, allZones(), existing);
  for (const s of plan.skipped) console.log(`skip #${s.index}: ${s.why}`);
  for (const [zone, feats] of plan.add) console.log(`${zone}: ${feats.length} outlines of ${LARGE_POOL_M2} m² or more`);
  if (!write) {
    console.log('dry run: pass --write to add them to labels/<zone>.extra.geojson');
    return;
  }
  for (const [zone, feats] of plan.add) {
    const path = join(labelsDir, `${zone}.extra.geojson`);
    const fc = readCollection(path) ?? { type: 'FeatureCollection', zone, note: 'Hand-checked supplement to the OSM labels.', features: [] };
    fc.features.push(...feats);
    writeFileSync(path, JSON.stringify(fc, null, 1) + '\n');
  }
  console.log('written: the next run needs --relabel "<why>"');
}

/** The frozen set of large-pool outlines (a label "zone" of its own in labels.sha256). */
export const LARGE_SET = 'large-pools';

/** Margin around each outline scanned for it, metres. */
export const LARGE_SCAN_MARGIN_M = 30;

export interface LargeRecall {
  /** Per imagery family: outlines, hits and the scores of the best detection on each. */
  bySource: Record<string, { labels: number; hits: number }>;
  rows: { id: string; source: string; areaM2: number; hit: boolean; detM2: number | null }[];
}

const SOURCE_OF: Record<string, SourceId> = { 'dgt-ortos2025': 'dgt', dgt: 'dgt', pnoa: 'pnoa', ign: 'ign' };

/**
 * Recall of a detector on the large-pool set: each outline of 400 m² or more
 * is scanned on its own imagery in a box `LARGE_SCAN_MARGIN_M` around it, at
 * the detector's threshold for that source, with the benchmark's matching.
 * The set holds only large pools, so precision is not measured here. OSM
 * outlines are not shifted: a pool of 400 m² is far larger than the shift.
 */
export async function largeRecall(detector: Detector, features: LabelFeature[], src: (s: SourceId) => TileSource, threshold: number): Promise<LargeRecall> {
  const labels = features.map(featureToLabel);
  const out: LargeRecall = { bySource: {}, rows: [] };
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l.role !== 'pool' || l.point || l.areaM2 < LARGE_POOL_M2) continue;
    const sid = SOURCE_OF[String((features[i].properties as Record<string, unknown>).imagery ?? '')];
    if (!sid) throw new Error(`${l.id}: no imagery named`);
    const bbox = expandBBoxMeters(l.bbox, LARGE_SCAN_MARGIN_M);
    const zone = { id: `large/${l.id}`, name: l.id, role: 'DEV', bbox, areaKm2: 0, review: 'full', productSource: sid, labelSource: sid, country: '', why: 'large-pool set' } as unknown as Zone;
    const run = await evaluateZone(zone, labels, { visual: 0, overrides: 0, absent: 0 }, detector, src(sid), threshold);
    const pair = run.result.pairs.find((p) => p.label === l.id);
    out.rows.push({ id: l.id, source: sid, areaM2: Math.round(l.areaM2), hit: !!pair, detM2: pair ? Math.round(pair.detM2) : null });
    const b = (out.bySource[sid] ??= { labels: 0, hits: 0 });
    b.labels++;
    if (pair) b.hits++;
  }
  return out;
}

/** Outlines of the set closer than `minKm` to a TEST zone: refused, the set must stay away from TEST. */
export function largeNearTest(features: LabelFeature[], zones: Zone[], minKm: number): string[] {
  const tests = zones.filter((z) => z.role === 'TEST');
  return features.map(featureToLabel).filter((l) => tests.some((t) => haversineKm(zoneCenter(t), [l.centroid.lat, l.centroid.lon]) < minKm)).map((l) => l.id);
}
