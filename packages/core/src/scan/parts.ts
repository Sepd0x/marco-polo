import type { ImageryProvider, ImagerySetting, Ring, ScanPlan, TileCoord, TraversalOrder } from '../types.js';
import { TILE_SIZE, tileBBox } from '../geo/mercator.js';
import { nextScanProvider, pickProvider } from '../imagery/coverage.js';
import { buildScanPlan } from './plan.js';

/**
 * Zoom of the scan grid for a source: the zoom at which one request covers a
 * tile at the source's resolution. A 512 px WMS request at maxZoom 19 scans
 * a z18 grid (about 25 cm per pixel); 256 px XYZ sources scan at maxZoom.
 */
export function scanZoomFor(provider: ImageryProvider): number {
  const steps = Math.log2(provider.requestPx / TILE_SIZE);
  if (!Number.isInteger(steps) || steps < 0) {
    throw new Error(`${provider.id}: requestPx ${provider.requestPx} is not 256 times a power of two`);
  }
  return provider.maxZoom - steps;
}

/** Part of a plan scanned on one source. */
export interface PlanPart {
  /** Stable while the part exists, also across a fallback (`p1`, `p2`, ...). */
  id: string;
  provider: ImageryProvider;
  /** Tiles at the source's scan zoom, in traversal order. */
  plan: ScanPlan;
  /** Grid cells (at `cellZoom`) this part owns; parts never share a cell. */
  cells: TileCoord[];
  cellZoom: number;
  /** Share of the drawn area that falls in this part, m². */
  areaM2: number;
}

export interface SplitPlan {
  area: Ring;
  order: TraversalOrder;
  cellZoom: number;
  parts: PlanPart[];
}

/**
 * Split an area into parts, one per source. Each cell of a fine grid goes to
 * the source `pickProvider` gives for its centre; each part then scans, at
 * its own zoom, every tile holding one of its cells. Parts may overlap by up
 * to one of their tiles at a border, never leave a gap.
 */
export function splitPlanBySource(
  area: Ring,
  setting: ImagerySetting = { mode: 'auto' },
  order: TraversalOrder = 'serpentine',
): SplitPlan {
  const cellZoom = 19;
  const grid = buildScanPlan(area, cellZoom, order);
  const groups = new Map<string, { provider: ImageryProvider; cells: TileCoord[] }>();
  for (const { tile, bbox } of grid.tiles) {
    const centre = { lon: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 };
    const provider = pickProvider(centre, setting);
    let g = groups.get(provider.id);
    if (!g) groups.set(provider.id, (g = { provider, cells: [] }));
    g.cells.push(tile);
  }
  const total = grid.tiles.length || 1;
  const parts: PlanPart[] = [];
  let n = 0;
  for (const { provider, cells } of groups.values()) {
    n++;
    parts.push(partFor(`p${n}`, provider, cells, cellZoom, area, order, (grid.areaM2 * cells.length) / total));
  }
  return { area, order, cellZoom, parts };
}

function partFor(
  id: string,
  provider: ImageryProvider,
  cells: TileCoord[],
  cellZoom: number,
  area: Ring,
  order: TraversalOrder,
  areaM2: number,
): PlanPart {
  const zoom = scanZoomFor(provider);
  if (zoom > cellZoom) throw new Error(`${provider.id} scans at z${zoom}, finer than the z${cellZoom} grid`);
  const shift = cellZoom - zoom;
  const wanted = new Set<string>();
  for (const c of cells) wanted.add(`${c.x >> shift},${c.y >> shift}`);
  const full = buildScanPlan(area, zoom, order);
  const tiles = full.tiles
    .filter((t) => wanted.has(`${t.tile.x},${t.tile.y}`))
    .map((t, index) => ({ ...t, index }));
  return { id, provider, plan: { ...full, tiles }, cells, cellZoom, areaM2 };
}

/**
 * The same part on the next source of its fallback chain, for when a sample
 * shows the source has no data there. Null when the chain ends.
 */
export function fallbackPart(part: PlanPart, area: Ring, order: TraversalOrder = part.plan.order): PlanPart | null {
  const next = nextScanProvider(part.provider);
  if (!next) return null;
  return partFor(part.id, next, part.cells, part.cellZoom, area, order, part.areaM2);
}

/** `n` tiles spread evenly through a part, for probing a source before scanning. */
export function sampleTiles(part: PlanPart, n: number): TileCoord[] {
  const tiles = part.plan.tiles;
  if (n <= 0 || tiles.length === 0) return [];
  if (n >= tiles.length) return tiles.map((t) => t.tile);
  const out: TileCoord[] = [];
  for (let i = 0; i < n; i++) out.push(tiles[Math.floor(((i + 0.5) * tiles.length) / n)].tile);
  return out;
}

/**
 * Tiles next to a set (eight-neighbourhood) that are not in it: what an XYZ
 * scan must also fetch to give every tile a full halo.
 */
export function haloRing(tiles: TileCoord[]): TileCoord[] {
  const own = new Set(tiles.map((t) => `${t.z},${t.x},${t.y}`));
  const ring = new Map<string, TileCoord>();
  for (const t of tiles) {
    const n = 2 ** t.z;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const y = t.y + dy;
        if (y < 0 || y >= n) continue;
        const x = (((t.x + dx) % n) + n) % n;
        const key = `${t.z},${x},${y}`;
        if (!own.has(key) && !ring.has(key)) ring.set(key, { z: t.z, x, y });
      }
    }
  }
  return [...ring.values()];
}

/**
 * A point inside a part for its one metadata lookup: the centre of the owned
 * cell nearest the mean of all cell centres, so it never falls in another part.
 */
export function partCentre(part: PlanPart): { lon: number; lat: number } {
  const centres = part.cells.map((c) => {
    const b = tileBBox({ z: part.cellZoom, x: c.x, y: c.y });
    return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
  });
  if (centres.length === 0) throw new Error(`part ${part.id} has no cells`);
  const mLon = centres.reduce((s, c) => s + c.lon, 0) / centres.length;
  const mLat = centres.reduce((s, c) => s + c.lat, 0) / centres.length;
  let best = centres[0];
  let bestD = Infinity;
  for (const c of centres) {
    const d = (c.lon - mLon) ** 2 + (c.lat - mLat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
