import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ring } from '@marco-polo/core';
import { bboxIoU, distanceM, pointInPolygons, polygonsAreaM2, polygonsBBox, polygonsCentroid, type Polygon } from './geom.js';
import type { LabelFeature } from './overpass.js';
import type { Label } from './types.js';

export const LABELS_DIR = fileURLToPath(new URL('../labels/', import.meta.url));

export interface LabelFile {
  type: 'FeatureCollection';
  zone: string;
  features: LabelFeature[];
  [k: string]: unknown;
}

/** Move a feature by [east, north] metres (small-offset approximation). */
export function shiftFeature(f: LabelFeature, [e, n]: [number, number]): LabelFeature {
  if (!e && !n) return f;
  const mv = ([lon, lat]: number[]) => [lon + e / (111320 * Math.cos((lat * Math.PI) / 180)), lat + n / 110540];
  const geometry =
    f.geometry.type === 'Point'
      ? { type: 'Point' as const, coordinates: mv(f.geometry.coordinates) }
      : { type: 'MultiPolygon' as const, coordinates: f.geometry.coordinates.map((p) => p.map((r) => r.map(mv))) };
  return { ...f, geometry };
}

export function featureToLabel(f: LabelFeature): Label {
  const p = f.properties;
  if (f.geometry.type === 'Point') {
    const [lon, lat] = f.geometry.coordinates;
    const r = p.radius_m ?? 5;
    const dLat = r / 110540;
    const dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
    return {
      id: p.id,
      source: p.source,
      role: p.role,
      reason: p.reason,
      polygons: [],
      point: { lon, lat },
      radiusM: r,
      bbox: { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat },
      centroid: { lon, lat },
      areaM2: 0,
    };
  }
  const polygons: Polygon[] = f.geometry.coordinates.map((poly) =>
    poly.map((ring) => {
      const r = ring.map(([lon, lat]) => [lon, lat] as [number, number]) as Ring;
      return r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
    }),
  );
  return {
    id: p.id,
    source: p.source,
    role: p.role,
    reason: p.reason,
    polygons,
    bbox: polygonsBBox(polygons),
    centroid: polygonsCentroid(polygons),
    areaM2: polygonsAreaM2(polygons),
  };
}

async function readIfExists(path: string): Promise<LabelFile | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as LabelFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** OSM labels plus the hand-made supplement, if the area has one. */
export async function loadLabels(zone: string, dir = LABELS_DIR, osmShiftM: [number, number] = [0, 0]): Promise<{ labels: Label[]; osm: number; visual: number; overrides: number }> {
  const osm = await readIfExists(join(dir, `${zone}.geojson`));
  if (!osm) throw new Error(`no labels for ${zone}: run "npm run eval -- labels --zone ${zone}" first`);
  const extra = await readIfExists(join(dir, `${zone}.extra.geojson`));
  // A hand-made feature with an OSM id replaces that OSM feature (used to mark a
  // mapped pool as `ignore` when the imagery shows it covered or not built yet).
  const byId = new Map<string, LabelFeature>();
  for (const f of osm.features) byId.set(f.properties.id, shiftFeature(f, osmShiftM));
  let overrides = 0;
  for (const f of extra?.features ?? []) {
    if (byId.has(f.properties.id)) overrides++;
    // Overrides carry OSM geometry: shift it like the rest of OSM.
    byId.set(f.properties.id, f.properties.source === 'osm' ? shiftFeature(f, osmShiftM) : f);
  }
  const labels = dedupeLabels([...byId.values()].map(featureToLabel));
  return { labels, osm: osm.features.length, visual: (extra?.features.length ?? 0) - overrides, overrides };
}

/**
 * OSM sometimes maps one pool twice (two ways, or a way plus a point). A
 * duplicate would be an unavoidable miss, so the second copy becomes `ignore`.
 * Polygons are duplicates when each centroid lies in the other or their boxes
 * overlap with IoU >= 0.5; a point is a duplicate when it lies in a polygon
 * label or within its radius of the polygon's centroid. The first id in sort
 * order is kept.
 */
export function dedupeLabels(labels: Label[]): Label[] {
  const pools = labels.filter((l) => l.role === 'pool').sort((a, b) => Number(!!a.point) - Number(!!b.point) || a.id.localeCompare(b.id));
  const dup = new Map<string, string>();
  for (let i = 0; i < pools.length; i++) {
    const a = pools[i];
    if (dup.has(a.id)) continue;
    for (let j = i + 1; j < pools.length; j++) {
      const b = pools[j];
      if (dup.has(b.id)) continue;
      let same = false;
      if (!a.point && !b.point) {
        same =
          bboxIoU(a.bbox, b.bbox) >= 0.5 ||
          (pointInPolygons(a.centroid, b.polygons) && pointInPolygons(b.centroid, a.polygons));
      } else if (!a.point && b.point) {
        same = pointInPolygons(b.point, a.polygons) || distanceM(b.point, a.centroid) <= (b.radiusM ?? 5);
      }
      if (same) dup.set(b.id, a.id);
    }
  }
  return labels.map((l) => (dup.has(l.id) ? { ...l, role: 'ignore' as const, reason: `duplicate of ${dup.get(l.id)}` } : l));
}
