import type { OrientedDims, Ring } from '../types.js';
import { EARTH_RADIUS } from './mercator.js';

const DEG = Math.PI / 180;

type Pt = [number, number];

/** Andrew's monotone chain. Returns the hull counter-clockwise, without repeats. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Minimum-area rectangle around a set of points in a planar metric frame
 * (x east, y north), by checking every hull edge direction.
 */
export function minAreaRect(points: Pt[]): { length: number; width: number; headingDeg: number } | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best: { area: number; length: number; width: number; headingDeg: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const a = maxU - minU;
    const b = maxV - minV;
    const area = a * b;
    if (best === null || area < best.area - 1e-12) {
      // Heading of the long side: along the edge if a >= b, else perpendicular.
      const [dx, dy] = a >= b ? [ux, uy] : [-uy, ux];
      let heading = Math.atan2(dx, dy) / DEG;
      heading = ((heading % 180) + 180) % 180;
      best = { area, length: Math.max(a, b), width: Math.min(a, b), headingDeg: heading };
    }
  }
  if (!best || best.width <= 0) return null;
  return { length: best.length, width: best.width, headingDeg: best.headingDeg };
}

/**
 * Length, width and heading of a traced outline, from its minimum-area
 * rectangle. Returns null when the outline cannot give a measure (fewer than
 * three distinct points, or no width).
 */
export function orientedDims(rings: Ring[]): OrientedDims | null {
  const all = rings.flat();
  if (all.length < 3) return null;
  let lon0 = 0, lat0 = 0;
  for (const [lon, lat] of all) {
    lon0 += lon;
    lat0 += lat;
  }
  lon0 /= all.length;
  lat0 /= all.length;
  const kx = EARTH_RADIUS * DEG * Math.cos(lat0 * DEG);
  const ky = EARTH_RADIUS * DEG;
  const pts: Pt[] = all.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  const r = minAreaRect(pts);
  if (!r) return null;
  return { lengthM: r.length, widthM: r.width, angleDeg: r.headingDeg };
}
