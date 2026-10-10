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

export interface LoadOptions {
  dir?: string;
  /** Source the labels are evaluated on; selects `<zone>.absent.<source>.json`. */
  source?: string;
  /** Shift of raw OSM geometry onto that source, metres [east, north]; null = not measured. */
  osmShiftM?: [number, number] | null;
  /** Shift of hand labels from the zone's label source onto `source`, metres [east, north]. */
  visualShiftM?: [number, number];
  /**
   * The same shift onto any other source, for hand labels drawn on that source
   * (`drawnOn`): they move by `visualShiftM` minus the shift of their own source.
   */
  visualShiftFor?: (source: string) => [number, number] | undefined;
}

/** Pools that are not in a given source's imagery (built later, filled in, covered): ignored there. */
export interface AbsentFile {
  source: string;
  method: string;
  ids: string[];
}

/** OSM labels plus the hand-made supplement, if the area has one, moved onto the source under test. */
export async function loadLabels(
  zone: string,
  opts: LoadOptions = {},
): Promise<{ labels: Label[]; osm: number; visual: number; overrides: number; absent: number }> {
  const dir = opts.dir ?? LABELS_DIR;
  const osmShift = opts.osmShiftM === undefined ? [0, 0] as [number, number] : opts.osmShiftM;
  const visualShift = opts.visualShiftM ?? [0, 0];
  const osm = await readIfExists(join(dir, `${zone}.geojson`));
  if (!osm) throw new Error(`no labels for ${zone}: run "npm run eval -- labels --zone ${zone}" first`);
  const extra = await readIfExists(join(dir, `${zone}.extra.geojson`));
  const all = [...osm.features, ...(extra?.features ?? [])];
  if (!osmShift && all.some((f) => f.properties.source === 'osm')) {
    throw new Error(`${zone}: OSM shift on ${opts.source ?? 'this source'} not measured (eval offset), refusing to guess`);
  }
  // A hand label drawn on the source being read (`drawnOn`) is already in place;
  // one drawn on another source moves by the difference of the two shifts; the
  // rest were drawn on the label source and take the visual shift.
  const drawnShift = (on: string): [number, number] => {
    const own = opts.visualShiftFor?.(on);
    if (!own) throw new Error(`${zone}: labels drawn on ${on} need the label shift onto ${on}, refusing to guess`);
    return [visualShift[0] - own[0], visualShift[1] - own[1]];
  };
  const move = (f: LabelFeature) => {
    if (f.properties.source === 'osm') return shiftFeature(f, osmShift!);
    const on = f.properties.drawnOn;
    if (!on) return shiftFeature(f, visualShift);
    return on === opts.source ? f : shiftFeature(f, drawnShift(on));
  };
  // A hand-made feature with an OSM id replaces that OSM feature (used to mark a
  // mapped pool as `ignore` when the imagery shows it covered or not built yet).
  const byId = new Map<string, LabelFeature>();
  for (const f of osm.features) byId.set(f.properties.id, move(f));
  let overrides = 0;
  for (const f of extra?.features ?? []) {
    if (byId.has(f.properties.id)) overrides++;
    // Overrides carry OSM geometry: shift it like the rest of OSM.
    byId.set(f.properties.id, move(f));
  }
  let absent = 0;
  if (opts.source) {
    const abs = (await readIfExists(join(dir, `${zone}.absent.${opts.source}.json`))) as unknown as AbsentFile | null;
    for (const id of abs?.ids ?? []) {
      const f = byId.get(id);
      if (!f) throw new Error(`${zone}: absent list names unknown label ${id}`);
      byId.set(id, { ...f, properties: { ...f.properties, role: 'ignore', reason: `absent on ${opts.source}` } });
      absent++;
    }
  }
  const labels = dedupeLabels([...byId.values()].map(featureToLabel));
  const visual = osm.features.filter((f) => f.properties.source === 'visual').length + (extra?.features.length ?? 0) - overrides;
  return { labels, osm: osm.features.filter((f) => f.properties.source === 'osm').length, visual, overrides, absent };
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
