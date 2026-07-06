import type { Ring, ScanPlan, ScanTile, TraversalOrder } from '../types.js';
import { lonLatToTile, tileBBox } from '../geo/mercator.js';
import { bboxIntersectsRing, ringAreaM2, ringBBox } from '../geo/polygon.js';

/**
 * Build the ordered list of tiles a scan must visit to cover a polygon at a zoom level.
 *
 * Tiles are kept only if their bounds intersect the polygon, then sequenced with a
 * traversal order chosen for spatial locality — neighbours complete close together,
 * which lets cross-tile detection merging resolve quickly and reads as a coherent
 * sweep on the map.
 */
export function buildScanPlan(polygon: Ring, zoom: number, order: TraversalOrder = 'serpentine'): ScanPlan {
  const bbox = ringBBox(polygon);
  const nw = lonLatToTile(bbox.west, bbox.north, zoom);
  const se = lonLatToTile(bbox.east, bbox.south, zoom);
  const range = { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y };

  const kept = new Set<string>();
  const bboxes = new Map<string, ReturnType<typeof tileBBox>>();
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      const tb = tileBBox({ z: zoom, x, y });
      if (bboxIntersectsRing(tb, polygon)) {
        const key = `${x},${y}`;
        kept.add(key);
        bboxes.set(key, tb);
      }
    }
  }

  const sequence = order === 'spiral' ? spiralSequence(range) : serpentineSequence(range);
  const tiles: ScanTile[] = [];
  for (const [x, y] of sequence) {
    const key = `${x},${y}`;
    if (!kept.has(key)) continue;
    tiles.push({ tile: { z: zoom, x, y }, bbox: bboxes.get(key)!, index: tiles.length });
  }

  return { zoom, order, tiles, range, areaM2: ringAreaM2(polygon), polygon };
}

/** Row-by-row, alternating direction — the classic scanner sweep. */
function serpentineSequence(range: { minX: number; minY: number; maxX: number; maxY: number }): [number, number][] {
  const out: [number, number][] = [];
  let reverse = false;
  for (let y = range.minY; y <= range.maxY; y++) {
    if (reverse) {
      for (let x = range.maxX; x >= range.minX; x--) out.push([x, y]);
    } else {
      for (let x = range.minX; x <= range.maxX; x++) out.push([x, y]);
    }
    reverse = !reverse;
  }
  return out;
}

/** Outward square spiral from the centre of the range. */
function spiralSequence(range: { minX: number; minY: number; maxX: number; maxY: number }): [number, number][] {
  const cx = Math.round((range.minX + range.maxX) / 2);
  const cy = Math.round((range.minY + range.maxY) / 2);
  const maxRadius = Math.max(cx - range.minX, range.maxX - cx, cy - range.minY, range.maxY - cy);
  const out: [number, number][] = [];
  const push = (x: number, y: number) => {
    if (x >= range.minX && x <= range.maxX && y >= range.minY && y <= range.maxY) out.push([x, y]);
  };
  push(cx, cy);
  for (let r = 1; r <= maxRadius; r++) {
    // Top edge, left → right
    for (let x = cx - r; x <= cx + r; x++) push(x, cy - r);
    // Right edge, top → bottom
    for (let y = cy - r + 1; y <= cy + r; y++) push(cx + r, y);
    // Bottom edge, right → left
    for (let x = cx + r - 1; x >= cx - r; x--) push(x, cy + r);
    // Left edge, bottom → top
    for (let y = cy + r - 1; y >= cy - r + 1; y--) push(cx - r, y);
  }
  return out;
}

/**
 * Cheap tile-count estimate for UI feedback while an area is being drawn.
 * Exact for small ranges; falls back to the bounding-box count (flagged
 * approximate) when the range is too large to test tile-by-tile.
 */
export function estimateTileCount(
  polygon: Ring,
  zoom: number,
  exactLimit = 50_000,
): { count: number; approximate: boolean } {
  const bbox = ringBBox(polygon);
  const nw = lonLatToTile(bbox.west, bbox.north, zoom);
  const se = lonLatToTile(bbox.east, bbox.south, zoom);
  const cols = se.x - nw.x + 1;
  const rows = se.y - nw.y + 1;
  if (cols * rows > exactLimit) {
    return { count: cols * rows, approximate: true };
  }
  let count = 0;
  for (let y = nw.y; y <= se.y; y++) {
    for (let x = nw.x; x <= se.x; x++) {
      if (bboxIntersectsRing(tileBBox({ z: zoom, x, y }), polygon)) count++;
    }
  }
  return { count, approximate: false };
}
