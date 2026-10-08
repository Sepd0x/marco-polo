import type { LonLat, Ring } from '@marco-polo/core';

export interface Dims {
  lengthM: number;
  widthM: number;
}

type P = [number, number];

/** Rings to local metres around `origin` (equirectangular; fine at pool scale). */
export function toLocalM(rings: Ring[], origin: LonLat): P[] {
  const kx = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110540;
  const pts: P[] = [];
  for (const r of rings) for (const [lon, lat] of r) pts.push([(lon - origin.lon) * kx, (lat - origin.lat) * ky]);
  return pts;
}

function cross(o: P, a: P, b: P): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull, Andrew's monotone chain, counter-clockwise. */
export function convexHull(points: P[]): P[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Minimum-area enclosing rectangle: one side is collinear with a hull edge,
 * so trying every edge direction finds it. Null for fewer than 3 distinct points.
 */
export function minAreaRect(points: P[]): Dims | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  let best: { area: number; a: number; b: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len === 0) continue;
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const h of hull) {
      const u = h[0] * ux + h[1] * uy;
      const v = -h[0] * uy + h[1] * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const a = maxU - minU, b = maxV - minV;
    if (!best || a * b < best.area) best = { area: a * b, a, b };
  }
  if (!best) return null;
  return { lengthM: Math.max(best.a, best.b), widthM: Math.min(best.a, best.b) };
}

export function ringsDims(rings: Ring[], origin: LonLat): Dims | null {
  return minAreaRect(toLocalM(rings, origin));
}
