import type { BBox, Ring } from '../types.js';
import { EARTH_RADIUS } from './mercator.js';

const DEG = Math.PI / 180;

/** Ray-casting point-in-polygon test. Works on unclosed rings. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function ringBBox(ring: Ring): BBox {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return (
    Math.min(ax, bx) <= px && px <= Math.max(ax, bx) &&
    Math.min(ay, by) <= py && py <= Math.max(ay, by)
  );
}

/** Proper + collinear segment intersection test. */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/** True if a geographic bbox intersects (or contains / is contained by) a polygon ring. */
export function bboxIntersectsRing(bbox: BBox, ring: Ring): boolean {
  const rb = ringBBox(ring);
  if (bbox.west > rb.east || bbox.east < rb.west || bbox.south > rb.north || bbox.north < rb.south) {
    return false;
  }
  // Any bbox corner (or centre) inside the ring?
  const corners: [number, number][] = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
  ];
  for (const [lon, lat] of corners) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  // Any ring vertex inside the bbox?
  for (const [lon, lat] of ring) {
    if (lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north) return true;
  }
  // Any ring edge crossing any bbox edge?
  const n = ring.length;
  const edges: [number, number, number, number][] = [
    [bbox.west, bbox.south, bbox.east, bbox.south],
    [bbox.east, bbox.south, bbox.east, bbox.north],
    [bbox.east, bbox.north, bbox.west, bbox.north],
    [bbox.west, bbox.north, bbox.west, bbox.south],
  ];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    for (const [ex1, ey1, ex2, ey2] of edges) {
      if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true;
    }
  }
  return false;
}

/**
 * Geodesic ring area in m², using the spherical excess approximation
 * (same approach as turf/geographiclib for small polygons).
 */
export function ringAreaM2(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [lon1, lat1] = ring[j];
    const [lon2, lat2] = ring[i];
    total += (lon2 - lon1) * DEG * (2 + Math.sin(lat1 * DEG) + Math.sin(lat2 * DEG));
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

export function unionBBox(a: BBox, b: BBox): BBox {
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

/** Expand a bbox by metre distances converted to degrees at its latitude. */
export function expandBBoxMeters(bbox: BBox, meters: number): BBox {
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.max(0.05, Math.cos(midLat * DEG)));
  return {
    west: bbox.west - dLon,
    east: bbox.east + dLon,
    south: bbox.south - dLat,
    north: bbox.north + dLat,
  };
}
