/**
 * Blind label review: a zone is cut into windows of clean imagery, with
 * nothing drawn on the pixels (no detections, no OSM, no earlier labels) and
 * only a coordinate ruler around the edge. A reviewer writes, per window, a
 * box for every pool seen:
 *
 *   { "w-00-01": [[x0, y0, x1, y1, "p"], [x0, y0, x1, y1, "u"]], "w-00-02": [] }
 *
 * in window pixels (0 to WINDOW - 1); "p" is a pool, "u" unsure (it becomes an
 * ignore label). Every window must be present, empty or not.
 *
 * A second, independent pass covers 20% of the windows, picked by hash, and
 * never sees the first. Their agreement is the F1 between the two box sets.
 * OSM is merged only after the first pass: every OSM pool the reviewer did not
 * box is shown on its own crop and judged pool, absent or unsure.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expandBBoxMeters, latToWorldY, lonToWorldX, worldXToLon, worldYToLat, type BBox, type LonLat, type Ring } from '@marco-polo/core';
import { encodePng } from '../../cli/src/tiles.js';
import { Raster, type RGB } from './draw.js';
import { bboxIoU, closeRing } from './geom.js';
import type { TileSource } from './imagery.js';
import type { LabelFeature } from './overpass.js';
import type { Zone } from './zones.js';

export const Z = 19;
export const WINDOW = 1024;
export const OVERLAP = 64;
export const RULER = 40;
export const MARGIN_M = 25;
export const SECOND_PASS_SHARE = 0.2;

export interface WindowDef {
  id: string;
  /** World pixel of the window's top-left corner at z19. */
  x0: number;
  y0: number;
  size: number;
}

export type Box = [number, number, number, number, 'p' | 'u'];
export type PassFile = Record<string, Box[]>;

export function zoneWindows(zone: Pick<Zone, 'bbox'>): WindowDef[] {
  const b = expandBBoxMeters(zone.bbox, MARGIN_M);
  const X0 = Math.floor(lonToWorldX(b.west, Z)), X1 = Math.ceil(lonToWorldX(b.east, Z));
  const Y0 = Math.floor(latToWorldY(b.north, Z)), Y1 = Math.ceil(latToWorldY(b.south, Z));
  const step = WINDOW - OVERLAP;
  const nx = Math.max(1, Math.ceil((X1 - X0 - OVERLAP) / step));
  const ny = Math.max(1, Math.ceil((Y1 - Y0 - OVERLAP) / step));
  const out: WindowDef[] = [];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      out.push({ id: `w-${String(r).padStart(2, '0')}-${String(c).padStart(2, '0')}`, x0: X0 + c * step, y0: Y0 + r * step, size: WINDOW });
    }
  }
  return out;
}

/**
 * Whether a box lies on the ground a set of windows shows. `centre`: its
 * centre falls in one of them. `touches`: any part of it does. The second
 * pass only sees its own windows, so all its boxes lie inside them; a first
 * pass box of a pool cut by a window edge can have its centre in the
 * neighbouring window while the second pass boxed the part it saw.
 */
export function seenInWindows(b: BBox, windows: WindowDef[], mode: 'centre' | 'touches'): boolean {
  const x0 = lonToWorldX(b.west, Z), x1 = lonToWorldX(b.east, Z);
  const y0 = latToWorldY(b.north, Z), y1 = latToWorldY(b.south, Z);
  if (mode === 'centre') {
    const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
    return windows.some((w) => x >= w.x0 && x < w.x0 + w.size && y >= w.y0 && y < w.y0 + w.size);
  }
  return windows.some((w) => x1 > w.x0 && x0 < w.x0 + w.size && y1 > w.y0 && y0 < w.y0 + w.size);
}

/** Share of a box inside a set of windows, from a 10 x 10 grid of sample points. */
export function shareInWindows(b: BBox, windows: WindowDef[]): number {
  const x0 = lonToWorldX(b.west, Z), x1 = lonToWorldX(b.east, Z);
  const y0 = latToWorldY(b.north, Z), y1 = latToWorldY(b.south, Z);
  let n = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const x = x0 + ((i + 0.5) / 10) * (x1 - x0), y = y0 + ((j + 0.5) / 10) * (y1 - y0);
      if (windows.some((w) => x >= w.x0 && x < w.x0 + w.size && y >= w.y0 && y < w.y0 + w.size)) n++;
    }
  }
  return n / 100;
}

/** The windows of the second pass: the first 20% by sha256 of zone and window id. */
export function secondPassWindows(zone: string, windows: WindowDef[], share = SECOND_PASS_SHARE): string[] {
  const k = Math.ceil(windows.length * share);
  return windows
    .map((w) => ({ id: w.id, h: createHash('sha256').update(`${zone}:${w.id}:second-pass`).digest('hex') }))
    .sort((a, b) => a.h.localeCompare(b.h))
    .slice(0, k)
    .map((w) => w.id)
    .sort();
}

const RULER_BG: RGB = [24, 24, 24];
const TICK: RGB = [230, 230, 230];

/** Window image: clean pixels, faint dotted lines every 128 px, a numbered ruler outside the pixels. */
export function renderWindow(rgba: Uint8ClampedArray, size: number): Buffer {
  const W = size + 2 * RULER;
  const r = new Raster(W, W, RULER_BG);
  r.blit(rgba, size, size, RULER, RULER, size, size);
  for (let v = 0; v <= size; v += 128) {
    // Dotted guides: one pixel in eight, light enough to read through.
    for (let t = 0; t < size; t += 8) {
      r.set(RULER + v, RULER + t, [255, 255, 255]);
      r.set(RULER + t, RULER + v, [255, 255, 255]);
    }
    r.line(RULER + v, RULER - 10, RULER + v, RULER - 1, TICK);
    r.line(RULER - 10, RULER + v, RULER - 1, RULER + v, TICK);
    r.line(RULER + v, RULER + size, RULER + v, RULER + size + 9, TICK);
    r.line(RULER + size, RULER + v, RULER + size + 9, RULER + v, TICK);
    const label = String(v);
    r.text(RULER + v - label.length * 4, 4, label, TICK, 2);
    r.text(2, RULER + v - 7, label, TICK, 2);
  }
  return encodePng(r.data, W, W);
}

export async function renderZoneWindows(zone: Zone, src: TileSource, outDir: string, only?: string[]): Promise<WindowDef[]> {
  const windows = zoneWindows(zone);
  await mkdir(outDir, { recursive: true });
  for (const w of windows) {
    if (only && !only.includes(w.id)) continue;
    const px = await src.crop(Z, w.x0, w.y0, w.size, w.size);
    await writeFile(join(outDir, `${w.id}.png`), renderWindow(px, w.size));
  }
  await writeFile(join(outDir, 'windows.json'), JSON.stringify({ zone: zone.id, z: Z, source: src.provider.id, windows }, null, 1));
  return windows;
}

/** A window box to lon/lat. */
export function boxToBBox(w: WindowDef, b: Box | [number, number, number, number]): BBox {
  const [x0, y0, x1, y1] = b;
  return {
    west: worldXToLon(w.x0 + Math.min(x0, x1), Z),
    east: worldXToLon(w.x0 + Math.max(x0, x1) + 1, Z),
    north: worldYToLat(w.y0 + Math.min(y0, y1), Z),
    south: worldYToLat(w.y0 + Math.max(y0, y1) + 1, Z),
  };
}

export interface GeoBox {
  window: string;
  bbox: BBox;
  kind: 'p' | 'u';
}

export function passToGeo(pass: PassFile, windows: WindowDef[]): GeoBox[] {
  const byId = new Map(windows.map((w) => [w.id, w]));
  const out: GeoBox[] = [];
  for (const [id, boxes] of Object.entries(pass)) {
    const w = byId.get(id);
    if (!w) throw new Error(`unknown window ${id}`);
    for (const b of boxes) {
      if (b.length !== 5 || (b[4] !== 'p' && b[4] !== 'u')) throw new Error(`${id}: bad box ${JSON.stringify(b)}`);
      if (b.slice(0, 4).some((v) => typeof v !== 'number' || v < -2 || v > w.size + 2)) throw new Error(`${id}: box outside window ${JSON.stringify(b)}`);
      out.push({ window: id, bbox: boxToBBox(w, b), kind: b[4] });
    }
  }
  return out;
}

/** Every window must be answered, even with an empty list. */
export function missingWindows(pass: PassFile, ids: string[]): string[] {
  return ids.filter((id) => !(id in pass));
}

const center = (b: BBox): LonLat => ({ lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 });
const inside = (p: LonLat, b: BBox) => p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north;

/** Same object: either centre inside the other box, or IoU at least 0.3 (the benchmark's own hit test). */
export function sameObject(a: BBox, b: BBox): boolean {
  return inside(center(a), b) || inside(center(b), a) || bboxIoU(a, b) >= 0.3;
}

/**
 * Boxes from overlapping windows describing one pool collapse into one.
 * A pool box wins over an unsure one; between equals, the larger box is kept.
 */
export function dedupeBoxes(boxes: GeoBox[]): GeoBox[] {
  const area = (b: BBox) => (b.east - b.west) * (b.north - b.south);
  const sorted = boxes.slice().sort((a, b) => (a.kind === b.kind ? area(b.bbox) - area(a.bbox) : a.kind === 'p' ? -1 : 1));
  const kept: GeoBox[] = [];
  for (const b of sorted) if (!kept.some((k) => sameObject(k.bbox, b.bbox))) kept.push(b);
  return kept;
}

/**
 * Agreement of two passes over the same windows. Unsure boxes on either side
 * are "don't care": a pool box that meets one is left out of both counts.
 */
export function agreement(a: GeoBox[], b: GeoBox[], countOnlyA: (x: GeoBox) => boolean = () => true): { matched: number; onlyA: number; onlyB: number; f1: number | null } {
  const pa = a.filter((x) => x.kind === 'p' && !b.some((y) => y.kind === 'u' && sameObject(x.bbox, y.bbox)));
  const pb = b.filter((x) => x.kind === 'p' && !a.some((y) => y.kind === 'u' && sameObject(x.bbox, y.bbox)));
  const used = new Set<number>();
  let matched = 0;
  let onlyA = 0;
  for (const x of pa) {
    const j = pb.findIndex((y, k) => !used.has(k) && sameObject(x.bbox, y.bbox));
    if (j >= 0) {
      used.add(j);
      matched++;
    } else if (countOnlyA(x)) {
      onlyA++;
    }
  }
  const onlyB = pb.length - matched;
  const n = 2 * matched + onlyA + onlyB;
  return { matched, onlyA, onlyB, f1: n ? (2 * matched) / n : null };
}

export function boxFeature(b: BBox, id: string, role: 'pool' | 'ignore', props: Partial<LabelFeature['properties']> = {}): LabelFeature {
  const ring: Ring = [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
  ];
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: [[closeRing(ring)]] },
    properties: { id, source: 'visual', role, ...props },
  };
}
