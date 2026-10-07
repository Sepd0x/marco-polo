/**
 * OSM recall check for training zones (plan A8): 10 windows of the zone, picked
 * by hash, are reviewed blind (same instructions as `eval blind`); OSM recall is
 * the share of hand-boxed pools that OSM has. A training zone needs >= 0.90.
 *
 *   osm-recall render --zone <id>   windows into <dir>/<zone>/recall
 *   osm-recall score  --zone <id>   reads labels/review/<zone>/recall.json and osm.geojson
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latToWorldY, lonToWorldX } from '@marco-polo/core';
import { dedupeBoxes, missingWindows, passToGeo, renderZoneWindows, sameObject, Z, zoneWindows, type PassFile } from './blind.js';
import { INSTRUCTIONS, osmShift, type BlindContext } from './blindcli.js';
import { distanceM, pointInBBox } from './geom.js';
import { featureToLabel, LABELS_DIR, shiftFeature } from './labels.js';
import type { LabelFeature } from './overpass.js';
import { sourceFor, zoneById } from './zones.js';

export const RECALL_WINDOWS = 10;
export const RECALL_MIN = 0.9;

export function recallWindows(zone: string, ids: string[], k = RECALL_WINDOWS): string[] {
  return ids
    .map((id) => ({ id, h: createHash('sha256').update(`${zone}:${id}:osm-recall`).digest('hex') }))
    .sort((a, b) => a.h.localeCompare(b.h))
    .slice(0, k)
    .map((x) => x.id)
    .sort();
}

/** Share of hand-boxed pools that some OSM pool feature covers. */
export function osmRecall(boxes: ReturnType<typeof passToGeo>, osm: LabelFeature[]): { pools: number; inOsm: number; recall: number | null } {
  const pools = boxes.filter((b) => b.kind === 'p');
  let inOsm = 0;
  for (const b of pools) {
    const c = { lon: (b.bbox.west + b.bbox.east) / 2, lat: (b.bbox.south + b.bbox.north) / 2 };
    const hit = osm.some((f) => {
      if (f.properties.role !== 'pool') return false;
      const l = featureToLabel(f);
      return l.point ? pointInBBox(l.point, b.bbox) || distanceM(l.point, c) <= 4 : sameObject(l.bbox, b.bbox);
    });
    if (hit) inOsm++;
  }
  return { pools: pools.length, inOsm, recall: pools.length ? inOsm / pools.length : null };
}

export async function osmRecallCommand(sub: string[], ctx: BlindContext): Promise<void> {
  if (!ctx.zone) throw new Error('osm-recall needs --zone');
  const zone = zoneById(ctx.zone);
  const sid = sourceFor(zone, ctx.source === 'esri' ? 'auto' : ctx.source);
  const windows = zoneWindows(zone);
  const ids = recallWindows(zone.id, windows.map((w) => w.id));
  const dir = join(ctx.dir ?? 'C:/dev/mp-research/blind', zone.id, 'recall');
  if (sub[0] === 'render') {
    await renderZoneWindows(zone, ctx.src(sid), dir, ids);
    await writeFile(join(dir, 'INSTRUCTIONS.txt'), INSTRUCTIONS + '\n', 'utf8');
    console.log(`${zone.id}: ${ids.length} windows -> ${dir}`);
    return;
  }
  if (sub[0] === 'score') {
    const rd = join(LABELS_DIR, 'review', zone.id);
    const pass = JSON.parse(readFileSync(join(rd, 'recall.json'), 'utf8')) as PassFile;
    const miss = missingWindows(pass, ids);
    if (miss.length) throw new Error(`recall.json misses windows: ${miss.join(', ')}`);
    const osmPath = join(rd, 'osm.geojson');
    if (!existsSync(osmPath)) throw new Error(`no ${osmPath}: run "eval labels --zone ${zone.id}"`);
    const sub2 = windows.filter((w) => ids.includes(w.id));
    const inSub = (b: { bbox: { west: number; east: number; south: number; north: number } }) => {
      const x = lonToWorldX((b.bbox.west + b.bbox.east) / 2, Z), y = latToWorldY((b.bbox.south + b.bbox.north) / 2, Z);
      return sub2.some((w) => x >= w.x0 && x < w.x0 + w.size && y >= w.y0 && y < w.y0 + w.size);
    };
    const boxes = dedupeBoxes(passToGeo(pass, windows)).filter(inSub);
    const osm = (JSON.parse(readFileSync(osmPath, 'utf8')) as { features: LabelFeature[] }).features;
    const shift = osmShift(osm, boxes);
    const r = osmRecall(boxes, osm.map((f) => shiftFeature(f, shift.m)));
    const out = { zone: zone.id, windows: ids, osmShiftM: shift.m, ...r, threshold: RECALL_MIN, ok: r.recall !== null && r.recall >= RECALL_MIN };
    await writeFile(join(rd, 'osm-recall.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
    console.log(`${zone.id}: OSM has ${r.inOsm} of ${r.pools} hand-counted pools (recall ${r.recall === null ? 'n/a' : r.recall.toFixed(3)}), ${out.ok ? 'usable for training' : 'NOT usable for training'}`);
    return;
  }
  throw new Error('osm-recall render | score');
}
