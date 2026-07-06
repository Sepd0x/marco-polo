/**
 * Component outline extraction.
 *
 * Rather than Moore-neighbour tracing (fragile on single pixels and diagonal
 * touches), this walks the *lattice edges* between inside and outside pixels:
 * every boundary side of a labelled pixel becomes a directed edge on the pixel
 * corner grid, edges chain start→end into closed loops, and the longest loop is
 * the outer boundary. Deterministic, hole-safe, and exact.
 */

export type PxPoint = [number, number];

/** Trace the outer boundary of the component with `label`, in pixel-corner coordinates. */
export function traceOutline(
  labels: Int32Array,
  width: number,
  height: number,
  label: number,
): PxPoint[] {
  const inside = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && labels[y * width + x] === label;

  // Directed edges, clockwise around each inside pixel (image coords, y down):
  // start corner key → array of end corner keys.
  const edges = new Map<number, number[]>();
  const corner = (x: number, y: number) => y * (width + 1) + x;
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const k = corner(x1, y1);
    const list = edges.get(k);
    if (list) list.push(corner(x2, y2));
    else edges.set(k, [corner(x2, y2)]);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (labels[y * width + x] !== label) continue;
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y); // top
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // right
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bottom
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y); // left
    }
  }

  // Chain edges into loops; keep the loop with the largest bbox (outer boundary).
  let best: PxPoint[] = [];
  let bestExtent = -1;
  while (edges.size > 0) {
    const [startKey, ends] = edges.entries().next().value as [number, number[]];
    const loop: number[] = [startKey];
    let cur = startKey;
    for (;;) {
      const list = edges.get(cur);
      if (!list || list.length === 0) break;
      const nxt = list.pop()!;
      if (list.length === 0) edges.delete(cur);
      cur = nxt;
      if (cur === startKey) break;
      loop.push(cur);
      if (loop.length > (width + 1) * (height + 1) * 4) break; // safety guard
    }
    void ends;
    const pts: PxPoint[] = loop.map((k) => [k % (width + 1), (k / (width + 1)) | 0]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const extent = (maxX - minX) * (maxY - minY);
    if (extent > bestExtent) {
      bestExtent = extent;
      best = pts;
    }
  }
  return best;
}

/** Remove collinear points from a closed ring of axis-aligned/staircase segments. */
export function removeCollinear(ring: PxPoint[]): PxPoint[] {
  const n = ring.length;
  if (n < 3) return ring.slice();
  const out: PxPoint[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[(i + n - 1) % n];
    const [bx, by] = ring[i];
    const [cx, cy] = ring[(i + 1) % n];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross !== 0) out.push(ring[i]);
  }
  return out.length >= 3 ? out : ring.slice();
}

/** Ramer–Douglas–Peucker simplification for a closed ring. */
export function simplifyRing(ring: PxPoint[], epsilon: number): PxPoint[] {
  if (ring.length <= 4 || epsilon <= 0) return ring.slice();
  // Split at the two most distant points so RDP endpoints are stable.
  let iA = 0, iB = 0, maxD = -1;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + (ring.length >> 1)) % ring.length;
    const d = dist2(ring[i], ring[j]);
    if (d > maxD) {
      maxD = d;
      iA = i;
      iB = j;
    }
  }
  const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
  const half1 = ring.slice(lo, hi + 1);
  const half2 = ring.slice(hi).concat(ring.slice(0, lo + 1));
  const s1 = rdp(half1, epsilon);
  const s2 = rdp(half2, epsilon);
  const merged = s1.slice(0, -1).concat(s2.slice(0, -1));
  return merged.length >= 3 ? merged : ring.slice();
}

function dist2(a: PxPoint, b: PxPoint): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function perpDist(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(dist2(p, a));
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(len2);
}

function rdp(points: PxPoint[], epsilon: number): PxPoint[] {
  if (points.length < 3) return points.slice();
  let maxD = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [a, b];
  const left = rdp(points.slice(0, idx + 1), epsilon);
  const right = rdp(points.slice(idx), epsilon);
  return left.slice(0, -1).concat(right);
}
