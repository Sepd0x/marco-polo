/**
 * `eval blind <render|second|osm-sheet|merge|agree> --zone <id>`
 *
 *   render     clean windows of the zone into <dir>/<zone>/pass1 (images stay outside the repo)
 *   second     the 20% of windows for the second pass into <dir>/<zone>/pass2, nothing else
 *   osm-sheet  after pass 1: crops of every OSM pool the pass did not box, for a pool/absent/unsure verdict
 *   merge      pass 1 + OSM verdicts -> labels/<zone>.geojson
 *   agree      F1 between pass 1 and pass 2 on the second-pass windows -> labels/review/<zone>/agreement.json
 *
 * Review files live in labels/review/<zone>/: pass1.json, pass2.json, osm.geojson
 * (from `eval labels`), osm-check.json ({ "<osm id>": "pool" | "absent" | "unsure" }).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latToWorldY, lonToWorldX, type BBox, type LonLat } from '@marco-polo/core';
import { encodePng } from '../../cli/src/tiles.js';
import {
  agreement,
  boxFeature,
  dedupeBoxes,
  missingWindows,
  passToGeo,
  renderZoneWindows,
  sameObject,
  secondPassWindows,
  WINDOW,
  Z,
  zoneWindows,
  type GeoBox,
  type PassFile,
} from './blind.js';
import type { SourceId } from './candidates.js';
import { Raster } from './draw.js';
import { bboxIoU, distanceM, pointInBBox } from './geom.js';
import type { TileSource } from './imagery.js';
import { featureToLabel, LABELS_DIR, shiftFeature } from './labels.js';
import { median } from './metrics.js';
import type { LabelFeature } from './overpass.js';
import { sourceFor, zoneById } from './zones.js';

export interface BlindContext {
  zone?: string;
  source: SourceId | 'auto';
  dir?: string;
  src: (s: SourceId) => TileSource;
}

const DEFAULT_DIR = 'C:/dev/mp-research/blind';

const reviewDir = (zone: string) => join(LABELS_DIR, 'review', zone);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export const INSTRUCTIONS = `Each PNG is one window of aerial or satellite imagery, 1024 x 1024 pixels, with a ruler around it: the numbers give pixel coordinates (0 to 1024) and the faint dotted lines inside are every 128 px.

Find every swimming pool in each window: outdoor pools of any colour (blue, turquoise, green, dark, empty or half-covered), any size from a small plunge pool or hot tub upward. Not pools: blue roofs, tarps, solar panels, cars, trampolines, ponds and lakes, fountains, sea and marina water, irrigation tanks you are sure are tanks.

For each pool write a box [x0, y0, x1, y1, "p"] in window pixels (top-left, bottom-right) tight around the water or the pool shell. If you cannot tell whether it is a pool, write it with "u" instead of "p". Pools cut by the window edge count; box the visible part.

Answer with one JSON object, one key per window file name without .png, value the list of boxes (empty list when there is none). Every window must appear.`;

function zoneAndSource(ctx: BlindContext) {
  if (!ctx.zone) throw new Error('blind needs --zone');
  const zone = zoneById(ctx.zone);
  const sid = sourceFor(zone, ctx.source === 'esri' ? 'auto' : ctx.source);
  return { zone, sid, dir: join(ctx.dir ?? DEFAULT_DIR, zone.id) };
}

export async function blindCommand(sub: string[], ctx: BlindContext): Promise<void> {
  const { zone, sid, dir } = zoneAndSource(ctx);
  const windows = zoneWindows(zone);
  const what = sub[0];
  if (what === 'render') {
    await renderZoneWindows(zone, ctx.src(sid), join(dir, 'pass1'));
    await writeFile(join(dir, 'pass1', 'INSTRUCTIONS.txt'), INSTRUCTIONS + '\n', 'utf8');
    console.log(`${zone.id}: ${windows.length} windows on ${sid} -> ${join(dir, 'pass1')}`);
    return;
  }
  if (what === 'second') {
    const ids = secondPassWindows(zone.id, windows);
    await renderZoneWindows(zone, ctx.src(sid), join(dir, 'pass2'), ids);
    await writeFile(join(dir, 'pass2', 'INSTRUCTIONS.txt'), INSTRUCTIONS + '\n', 'utf8');
    console.log(`${zone.id}: second pass on ${ids.length} of ${windows.length} windows: ${ids.join(', ')}`);
    return;
  }
  const rd = reviewDir(zone.id);
  const pass1 = readJson<PassFile>(join(rd, 'pass1.json'));
  const miss = missingWindows(pass1, windows.map((w) => w.id));
  if (miss.length) throw new Error(`pass1.json misses windows: ${miss.join(', ')}`);
  const boxes = dedupeBoxes(passToGeo(pass1, windows));

  if (what === 'agree') {
    const ids = secondPassWindows(zone.id, windows);
    const pass2 = readJson<PassFile>(join(rd, 'pass2.json'));
    const miss2 = missingWindows(pass2, ids);
    if (miss2.length) throw new Error(`pass2.json misses windows: ${miss2.join(', ')}`);
    const sub2 = windows.filter((w) => ids.includes(w.id));
    // Compare on the ground both passes looked at: the second-pass windows.
    const inSub = (b: GeoBox) => {
      const c = { lon: (b.bbox.west + b.bbox.east) / 2, lat: (b.bbox.south + b.bbox.north) / 2 };
      const x = lonToWorldX(c.lon, Z), y = latToWorldY(c.lat, Z);
      return sub2.some((w) => x >= w.x0 && x < w.x0 + w.size && y >= w.y0 && y < w.y0 + w.size);
    };
    const a = boxes.filter(inSub);
    const b = dedupeBoxes(passToGeo(pass2, windows)).filter(inSub);
    const r = agreement(a, b);
    const out = { zone: zone.id, windows: ids, pass1Pools: a.filter((x) => x.kind === 'p').length, pass2Pools: b.filter((x) => x.kind === 'p').length, ...r, threshold: 0.9, ok: r.f1 !== null && r.f1 >= 0.9 };
    await writeFile(join(rd, 'agreement.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
    console.log(`${zone.id}: agreement F1 ${r.f1 === null ? 'n/a' : r.f1.toFixed(3)} (matched ${r.matched}, only pass 1 ${r.onlyA}, only pass 2 ${r.onlyB})${out.ok ? '' : ' BELOW 0.90: review the zone again'}`);
    return;
  }

  const osmPath = join(rd, 'osm.geojson');
  if (!existsSync(osmPath)) throw new Error(`no ${osmPath}: run "eval labels --zone ${zone.id}" after pass 1`);
  const osm = readJson<{ features: LabelFeature[] }>(osmPath).features;
  const shift = osmShift(osm, boxes);
  const moved = osm.map((f) => shiftFeature(f, shift.m));
  const osmPools = moved.filter((f) => f.properties.role === 'pool');
  const matchOf = (f: LabelFeature) => {
    const l = featureToLabel(f);
    return boxes.find((b) => (l.point ? pointInBBox(l.point, grow(b.bbox, 2)) || distanceM(l.point, center(b.bbox)) <= 4 : sameObject(l.bbox, b.bbox)));
  };
  const osmOnly = osmPools.filter((f) => !matchOf(f));

  if (what === 'osm-sheet') {
    await osmSheets(osmOnly, ctx.src(sid), join(dir, 'osm'));
    await writeFile(join(dir, 'osm', 'items.json'), JSON.stringify(osmOnly.map((f, i) => ({ n: i + 1, id: f.properties.id })), null, 1));
    console.log(`${zone.id}: OSM shift onto ${sid} ${shift.m.map((v) => v.toFixed(1)).join(', ')} m (n=${shift.n}); ${osmOnly.length} OSM pools not in pass 1 -> ${join(dir, 'osm')}`);
    return;
  }

  if (what === 'merge') {
    const verdictPath = join(rd, 'osm-check.json');
    const verdicts = existsSync(verdictPath) ? readJson<Record<string, 'pool' | 'absent' | 'unsure'>>(verdictPath) : {};
    const missing = osmOnly.filter((f) => !verdicts[f.properties.id]);
    if (missing.length) throw new Error(`osm-check.json needs a verdict for ${missing.length} OSM pools (eval blind osm-sheet): ${missing.slice(0, 8).map((f) => f.properties.id).join(', ')}`);
    const features: LabelFeature[] = [];
    let n = 0;
    const usedBoxes = new Set<GeoBox>();
    for (const f of osmPools) {
      const b = matchOf(f);
      const l = featureToLabel(f);
      if (b) {
        usedBoxes.add(b);
        // The OSM outline stands in for the box when it fits the pool the reviewer saw.
        if (!l.point && b.kind === 'p' && bboxIoU(l.bbox, b.bbox) >= 0.3) {
          features.push({ ...f, properties: { ...f.properties, method: 'blind box confirmed, OSM outline' } });
        }
        continue;
      }
      const v = verdicts[f.properties.id];
      if (v === 'pool') features.push({ ...f, properties: { ...f.properties, method: 'OSM only, checked on the imagery' } });
      if (v === 'unsure') features.push({ ...f, properties: { ...f.properties, role: 'ignore', reason: 'OSM only, unsure on the imagery' } });
    }
    for (const b of boxes) {
      const covered = features.some((f) => f.properties.method === 'blind box confirmed, OSM outline' && sameObject(featureToLabel(f).bbox, b.bbox));
      if (covered) continue;
      n++;
      features.push(boxFeature(b.bbox, `visual/${zone.id}/b${n}`, b.kind === 'p' ? 'pool' : 'ignore', { method: 'blind box', reason: b.kind === 'u' ? 'unsure in the blind pass' : 'box' }));
    }
    for (const f of moved.filter((x) => x.properties.role === 'ignore')) features.push(f);
    features.sort((a, b) => a.properties.id.localeCompare(b.properties.id));
    const pools = features.filter((f) => f.properties.role === 'pool' && pointInBBox(featureToLabel(f).centroid, zone.bbox)).length;
    const file = {
      type: 'FeatureCollection',
      zone: zone.id,
      review: 'blind',
      source: sid,
      attribution: 'Hand labels drawn on the source named above; OSM features (c) OpenStreetMap contributors. ODbL 1.0 (https://www.openstreetmap.org/copyright)',
      osmShiftM: shift.m,
      osmShiftPairs: shift.n,
      windows: windows.length,
      poolsInZone: pools,
      features,
    };
    await writeFile(join(LABELS_DIR, `${zone.id}.geojson`), JSON.stringify(file, null, 1) + '\n', 'utf8');
    console.log(`${zone.id}: ${features.length} features, ${pools} pools inside the zone (blind boxes ${boxes.length}, OSM pools ${osmPools.length}, OSM only ${osmOnly.length})`);
    return;
  }
  throw new Error('blind render | second | osm-sheet | merge | agree');
}

const center = (b: BBox): LonLat => ({ lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 });
const grow = (b: BBox, m: number): BBox => {
  const dLat = m / 110540, dLon = m / (111320 * Math.cos((center(b).lat * Math.PI) / 180));
  return { west: b.west - dLon, east: b.east + dLon, south: b.south - dLat, north: b.north + dLat };
};

/**
 * Where OSM sits on this imagery: median offset from OSM polygon centroids
 * to the centre of the nearest blind pool box (within 8 m). The boxes come
 * from the reviewer, not from a detector.
 */
export function osmShift(osm: LabelFeature[], boxes: GeoBox[]): { m: [number, number]; n: number } {
  const de: number[] = [], dn: number[] = [];
  for (const f of osm) {
    if (f.properties.role !== 'pool' || f.geometry.type === 'Point') continue;
    const c = featureToLabel(f).centroid;
    let best: { e: number; n: number; d: number } | null = null;
    for (const b of boxes) {
      if (b.kind !== 'p') continue;
      const bc = center(b.bbox);
      const e = (bc.lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180);
      const n = (bc.lat - c.lat) * 110540;
      const d = Math.hypot(e, n);
      if (d <= 8 && (!best || d < best.d)) best = { e, n, d };
    }
    if (best) {
      de.push(best.e);
      dn.push(best.n);
    }
  }
  const r = (x: number | null) => Math.round((x ?? 0) * 10) / 10;
  return { m: [r(median(de)), r(median(dn))], n: de.length };
}

/** 12 crops per sheet, 3x zoom, the OSM outline (or a ring around the point) in yellow. */
async function osmSheets(items: LabelFeature[], src: TileSource, out: string): Promise<void> {
  await mkdir(out, { recursive: true });
  const CROP = 96, SCALE = 3, CELL = CROP * SCALE, COLS = 4, ROWS = 3, GAP = 6;
  for (let s = 0; s * COLS * ROWS < items.length; s++) {
    const r = new Raster(COLS * (CELL + GAP), ROWS * (CELL + GAP + 20), [20, 20, 20]);
    for (let k = 0; k < COLS * ROWS; k++) {
      const i = s * COLS * ROWS + k;
      if (i >= items.length) break;
      const l = featureToLabel(items[i]);
      const cx = lonToWorldX(l.centroid.lon, Z), cy = latToWorldY(l.centroid.lat, Z);
      const x0 = Math.round(cx - CROP / 2), y0 = Math.round(cy - CROP / 2);
      const px = await src.crop(Z, x0, y0, CROP, CROP);
      const ox = (k % COLS) * (CELL + GAP), oy = Math.floor(k / COLS) * (CELL + GAP + 20);
      r.blit(px, CROP, CROP, ox, oy + 20, CELL, CELL);
      const toPx = (lon: number, lat: number): [number, number] => [ox + (lonToWorldX(lon, Z) - x0) * SCALE, oy + 20 + (latToWorldY(lat, Z) - y0) * SCALE];
      if (l.point) {
        const [x, y] = toPx(l.point.lon, l.point.lat);
        const rr = 6 * SCALE;
        const ring: Array<[number, number]> = Array.from({ length: 24 }, (_, j) => [x + rr * Math.cos((j / 24) * 2 * Math.PI), y + rr * Math.sin((j / 24) * 2 * Math.PI)]);
        r.ring(ring, [255, 230, 0], 1, 4);
      } else {
        for (const poly of l.polygons) r.ring(poly[0].map(([lon, lat]) => toPx(lon, lat)), [255, 230, 0], 1, 4);
      }
      r.text(ox + 2, oy + 2, `${i + 1}`, [255, 255, 255], 2);
    }
    await writeFile(join(out, `sheet-${String(s + 1).padStart(2, '0')}.png`), encodePng(r.data, r.width, r.height));
  }
}

export { WINDOW };
