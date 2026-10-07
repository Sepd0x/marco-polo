import type { BBox, LonLat, Ring } from '@marco-polo/core';
import { sleep } from '../../cli/src/tiles.js';
import { closeRing, pointInPolygons, polygonsCentroid, type Polygon } from './geom.js';

export const UA = 'marco-polo-eval/0.2 (pool detection benchmark; github.com/Sepd0x/marco-polo)';

/** Public Overpass instances, tried in order. One query at a time, with pauses. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

interface OsmGeomPoint {
  lat: number;
  lon: number;
}

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  /** Centre of the element's bounding box, with `out center`. */
  center?: OsmGeomPoint;
  tags?: Record<string, string>;
  geometry?: OsmGeomPoint[];
  members?: Array<{ type: string; role: string; geometry?: OsmGeomPoint[] }>;
}

export async function overpass(query: string): Promise<OsmElement[]> {
  let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(300_000),
      });
      if (res.ok) {
        const json = (await res.json()) as { elements: OsmElement[]; remark?: string };
        if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
        return json.elements;
      }
      lastErr = `${endpoint} HTTP ${res.status}`;
    } catch (err) {
      lastErr = `${endpoint} ${String(err)}`;
    }
    console.error(`  overpass retry ${attempt + 1}: ${lastErr.slice(0, 120)}`);
    await sleep(8000 * (attempt + 1));
  }
  throw new Error(`Overpass failed: ${lastErr}`);
}

const bboxStr = (b: BBox) => `${b.south},${b.west},${b.north},${b.east}`;

export const poolQuery = (b: BBox) =>
  `[out:json][timeout:90];(` +
  `way["leisure"="swimming_pool"](${bboxStr(b)});` +
  `relation["leisure"="swimming_pool"]["type"="multipolygon"](${bboxStr(b)});` +
  `node["leisure"="swimming_pool"](${bboxStr(b)});` +
  `);out geom;`;

export const buildingQuery = (b: BBox) =>
  `[out:json][timeout:90];(way["building"](${bboxStr(b)});relation["building"]["type"="multipolygon"](${bboxStr(b)}););out geom;`;

const toRing = (g: OsmGeomPoint[]): Ring => g.map((p) => [p.lon, p.lat] as [number, number]);

/** Join way segments into closed rings (multipolygon members may be split). */
export function stitchRings(segments: Ring[]): Ring[] {
  const open = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Ring[] = [];
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  while (open.length) {
    let cur = open.shift()!;
    let grown = true;
    while (!same(cur[0], cur[cur.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i];
        const end = cur[cur.length - 1];
        if (same(end, s[0])) cur = cur.concat(s.slice(1));
        else if (same(end, s[s.length - 1])) cur = cur.concat(s.slice(0, -1).reverse());
        else if (same(cur[0], s[s.length - 1])) cur = s.slice(0, -1).concat(cur);
        else if (same(cur[0], s[0])) cur = s.slice(1).reverse().concat(cur);
        else continue;
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

function elementPolygons(el: OsmElement): Polygon[] {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
    const r = toRing(el.geometry);
    const closed = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
    return closed ? [[r]] : [];
  }
  if (el.type === 'relation' && el.members) {
    const outers = stitchRings(el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => toRing(m.geometry!)));
    const inners = stitchRings(el.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => toRing(m.geometry!)));
    return outers.map((o) => {
      const holes = inners.filter((h) => pointInPolygons({ lon: h[0][0], lat: h[0][1] }, [[o]]));
      return [o, ...holes];
    });
  }
  return [];
}

export interface LabelFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] } | { type: 'Point'; coordinates: number[] };
  properties: {
    id: string;
    source: 'osm' | 'visual';
    role: 'pool' | 'ignore';
    reason?: string;
    tags?: Record<string, string>;
    radius_m?: number;
    method?: string;
    note?: string;
  };
}

const KEEP_TAGS = ['leisure', 'indoor', 'covered', 'location', 'access', 'swimming_pool', 'sport', 'name', 'building', 'layer', 'level'];

/**
 * OSM elements → label features. Pools tagged indoor/covered or sitting inside a
 * building footprint become `ignore` labels. Tagged points (no outline) become
 * point labels matched within `pointRadiusM`.
 */
export function toLabelFeatures(pools: OsmElement[], buildings: OsmElement[], pointRadiusM: number): LabelFeature[] {
  const buildingPolys = buildings.flatMap((b) => elementPolygons(b).map((p) => ({ id: `${b.type}/${b.id}`, poly: p })));
  const out: LabelFeature[] = [];
  for (const el of pools) {
    const tags: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (el.tags?.[k] !== undefined) tags[k] = el.tags[k];
    let reason: string | undefined;
    if (el.tags?.indoor === 'yes') reason = 'indoor=yes';
    else if (el.tags?.covered === 'yes') reason = 'covered=yes';
    else if (el.tags?.location === 'indoor') reason = 'location=indoor';

    if (el.type === 'node') {
      const at: LonLat = { lon: el.lon!, lat: el.lat! };
      if (!reason) {
        const host = buildingPolys.find((b) => pointInPolygons(at, [b.poly]));
        if (host) reason = `inside ${host.id}`;
      }
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [at.lon, at.lat] },
        properties: { id: `node/${el.id}`, source: 'osm', role: reason ? 'ignore' : 'pool', reason, tags, radius_m: pointRadiusM },
      });
      continue;
    }

    const polys = elementPolygons(el);
    if (!polys.length) continue;
    if (!reason) {
      const c = polygonsCentroid(polys);
      const host = buildingPolys.find((b) => b.id !== `${el.type}/${el.id}` && pointInPolygons(c, [b.poly]));
      if (host) reason = `inside ${host.id}`;
    }
    out.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map((r) => closeRing(r))) },
      properties: { id: `${el.type}/${el.id}`, source: 'osm', role: reason ? 'ignore' : 'pool', reason, tags },
    });
  }
  out.sort((a, b) => a.properties.id.localeCompare(b.properties.id));
  return out;
}
