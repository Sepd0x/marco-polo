import * as maplibregl from 'maplibre-gl';
import {
  latToWorldY,
  lonToWorldX,
  pointInRing,
  tileBBox,
  tileUrl,
  type BBox,
  type ImageryProvider,
  type Ring,
  type TileCoord,
} from '@marco-polo/core';
import { templateFor } from './sources.js';

/**
 * Raster tiles cut to a region. MapLibre cannot mask a raster layer by a
 * polygon, so tiles of a clipped source go through the `mpclip://` protocol:
 * a tile wholly inside is passed through untouched, a tile wholly outside is
 * never fetched, and only tiles on the edge are redrawn with the outside made
 * transparent. Used for the scanned source inside the drawn area and for
 * national sources at their borders.
 */

export interface ClipRegion {
  /** Union of these rings (lon, lat). */
  rings: Ring[];
  /** When set, also only these grid cells (`x,y` at `zoom`). */
  cells: { zoom: number; keys: Set<string> } | null;
}

export type Relation = 'inside' | 'outside' | 'partial';

function ringBox(ring: Ring): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

const boxes = new WeakMap<Ring, BBox>();
function boxOf(ring: Ring): BBox {
  let b = boxes.get(ring);
  if (!b) boxes.set(ring, (b = ringBox(ring)));
  return b;
}

/** Where a box lies against one ring. */
export function ringRelation(b: BBox, ring: Ring): Relation {
  const r = boxOf(ring);
  if (b.west > r.east || b.east < r.west || b.south > r.north || b.north < r.south) return 'outside';
  const corners: [number, number][] = [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
  ];
  const inside = corners.filter(([x, y]) => pointInRing(x, y, ring)).length;
  if (inside > 0 && inside < 4) return 'partial';
  for (const [x, y] of ring) {
    if (x > b.west && x < b.east && y > b.south && y < b.north) return 'partial';
  }
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    if (crossesInterior(x1, y1, x2, y2, b)) return 'partial';
  }
  return inside === 4 ? 'inside' : 'outside';
}

/** True when a segment passes through the open interior of a box. */
function crossesInterior(x1: number, y1: number, x2: number, y2: number, b: BBox): boolean {
  // Liang-Barsky clip of the segment to the box.
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const tests: [number, number][] = [
    [-dx, x1 - b.west],
    [dx, b.east - x1],
    [-dy, y1 - b.south],
    [dy, b.north - y1],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  const tm = (t0 + t1) / 2;
  const mx = x1 + tm * dx;
  const my = y1 + tm * dy;
  return mx > b.west && mx < b.east && my > b.south && my < b.north && t1 - t0 > 1e-12;
}

/** Where a tile lies against a set of grid cells. */
export function cellRelation(tile: TileCoord, cells: { zoom: number; keys: Set<string> }): Relation {
  if (tile.z >= cells.zoom) {
    const s = tile.z - cells.zoom;
    return cells.keys.has(`${tile.x >> s},${tile.y >> s}`) ? 'inside' : 'outside';
  }
  const s = cells.zoom - tile.z;
  const x0 = tile.x << s;
  const y0 = tile.y << s;
  const n = 1 << s;
  let hit = 0;
  for (let y = y0; y < y0 + n; y++) {
    for (let x = x0; x < x0 + n; x++) if (cells.keys.has(`${x},${y}`)) hit++;
  }
  if (hit === 0) return 'outside';
  return hit === n * n ? 'inside' : 'partial';
}

/** Where a tile lies against a region. */
export function tileRelation(tile: TileCoord, region: ClipRegion): Relation {
  const b = tileBBox(tile);
  let rel: Relation = 'outside';
  for (const ring of region.rings) {
    const r = ringRelation(b, ring);
    if (r === 'inside') {
      rel = 'inside';
      break;
    }
    if (r === 'partial') rel = 'partial';
  }
  if (rel === 'outside' || !region.cells) return rel;
  const c = cellRelation(tile, region.cells);
  if (c === 'outside') return 'outside';
  return rel === 'inside' && c === 'inside' ? 'inside' : 'partial';
}

/** Box of a region, for the source bounds. */
export function regionBounds(region: ClipRegion): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of region.rings) {
    const b = boxOf(ring);
    w = Math.min(w, b.west);
    s = Math.min(s, b.south);
    e = Math.max(e, b.east);
    n = Math.max(n, b.north);
  }
  return [w, s, e, n];
}

interface ClipEntry {
  provider: ImageryProvider;
  region: ClipRegion;
}

const PROTOCOL = 'mpclip';
const entries = new Map<string, ClipEntry>();
let counter = 0;
let installed = false;

/** Registers a clipped view of a source and returns its tile URL template. */
export function registerClip(provider: ImageryProvider, region: ClipRegion, imagePx: number): { key: string; url: string } {
  install();
  const key = `c${++counter}`;
  entries.set(key, { provider, region });
  return { key, url: `${PROTOCOL}://${key}/${imagePx}/{z}/{x}/{y}` };
}

export function unregisterClip(key: string): void {
  entries.delete(key);
}

function install(): void {
  if (installed) return;
  installed = true;
  maplibregl.addProtocol(PROTOCOL, (params, abort) => loadClipped(params.url, abort));
}

let emptyTile: Promise<ImageBitmap> | null = null;
function transparent(): Promise<ImageBitmap> {
  emptyTile ??= createImageBitmap(new ImageData(1, 1));
  return emptyTile;
}

async function loadClipped(url: string, abort: AbortController): Promise<{ data: ArrayBuffer | ImageBitmap }> {
  const m = /^mpclip:\/\/(c\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  const entry = m ? entries.get(m[1]) : undefined;
  if (!m || !entry) throw new Error(`unknown clipped tile ${url}`);
  const px = Number(m[2]);
  const tile: TileCoord = { z: Number(m[3]), x: Number(m[4]), y: Number(m[5]) };
  const rel = tileRelation(tile, entry.region);
  if (rel === 'outside') return { data: await transparent() };
  const res = await fetch(tileUrl(templateFor(entry.provider, px), tile), { signal: abort.signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const bytes = await res.arrayBuffer();
  if (rel === 'inside') return { data: bytes };
  const image = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: bytes };
  clipTo(ctx, tile, entry.region, image.width);
  ctx.drawImage(image, 0, 0);
  image.close();
  return { data: canvas.transferToImageBitmap() };
}

/** Sets the canvas clip to the region, in the pixels of a `size` px tile. */
function clipTo(ctx: OffscreenCanvasRenderingContext2D, tile: TileCoord, region: ClipRegion, size: number): void {
  const k = size / 256;
  const ox = tile.x * 256;
  const oy = tile.y * 256;
  ctx.beginPath();
  for (const ring of region.rings) {
    ring.forEach(([lon, lat], i) => {
      const x = (lonToWorldX(lon, tile.z) - ox) * k;
      const y = (latToWorldY(lat, tile.z) - oy) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.clip();
  const cells = region.cells;
  if (!cells || tile.z >= cells.zoom) return;
  const s = cells.zoom - tile.z;
  const n = 1 << s;
  const side = size / n;
  ctx.beginPath();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (cells.keys.has(`${(tile.x << s) + i},${(tile.y << s) + j}`)) ctx.rect(i * side, j * side, side, side);
    }
  }
  ctx.clip();
}
