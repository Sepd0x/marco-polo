import { pointInRing, ringAreaM2, type BBox, type LonLat, type Ring } from '@marco-polo/core';

/** A polygon as [outer, ...holes], [lon, lat] rings. */
export type Polygon = Ring[];

export function polygonsBBox(polys: Polygon[]): BBox {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const poly of polys) {
    for (const [lon, lat] of poly[0] ?? []) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, south, east, north };
}

/** Point inside any polygon of the set (holes respected). */
export function pointInPolygons(p: LonLat, polys: Polygon[]): boolean {
  for (const poly of polys) {
    if (!poly.length || !pointInRing(p.lon, p.lat, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(p.lon, p.lat, poly[i])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Geodesic area of a polygon set, holes subtracted, m². */
export function polygonsAreaM2(polys: Polygon[]): number {
  let total = 0;
  for (const poly of polys) {
    if (!poly.length) continue;
    total += ringAreaM2(poly[0]);
    for (let i = 1; i < poly.length; i++) total -= ringAreaM2(poly[i]);
  }
  return Math.max(0, total);
}

/** Area-weighted centroid of the outer rings (planar in degrees: fine at pool scale). */
export function polygonsCentroid(polys: Polygon[]): LonLat {
  // Shoelace relative to a local origin: absolute degrees cancel badly at pool scale.
  const o = polys[0]?.[0]?.[0];
  if (!o) return { lon: NaN, lat: NaN };
  let a = 0, cx = 0, cy = 0;
  for (const poly of polys) {
    const r = poly[0];
    if (!r || r.length < 3) continue;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xj = r[j][0] - o[0], yj = r[j][1] - o[1], xi = r[i][0] - o[0], yi = r[i][1] - o[1];
      const f = xj * yi - xi * yj;
      a += f;
      cx += (xj + xi) * f;
      cy += (yj + yi) * f;
    }
  }
  if (Math.abs(a) < 1e-20) {
    const b = polygonsBBox(polys);
    return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
  }
  return { lon: o[0] + cx / (3 * a), lat: o[1] + cy / (3 * a) };
}

/**
 * Intersection-over-union of two axis-aligned boxes.
 * IoU is invariant under independent scaling of the axes, so computing it in
 * degrees gives the same value as in metres.
 */
export function bboxIoU(a: BBox, b: BBox): number {
  const iw = Math.min(a.east, b.east) - Math.max(a.west, b.west);
  const ih = Math.min(a.north, b.north) - Math.max(a.south, b.south);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const ua = (a.east - a.west) * (a.north - a.south) + (b.east - b.west) * (b.north - b.south) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function pointInBBox(p: LonLat, b: BBox): boolean {
  return p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;
}

/** Approximate ground distance between two nearby points, metres. */
export function distanceM(a: LonLat, b: LonLat): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (a.lon - b.lon) * 111320 * Math.cos(lat);
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

/** Close a ring for GeoJSON output. */
export function closeRing(r: Ring): Ring {
  if (!r.length) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}
