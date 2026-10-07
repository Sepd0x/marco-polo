import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latToWorldY, lonToWorldX, metersPerPixel, worldXToLon, worldYToLat, type BBox, type LonLat } from '@marco-polo/core';
import { encodePng } from '../../cli/src/tiles.js';
import { Raster, type RGB } from './draw.js';
import type { TileSource } from './imagery.js';
import type { EvalDetection, Label } from './types.js';

export interface GalleryItem {
  /** 1-based, stable for a given detector + labels (sorted north→south, west→east). */
  n: number;
  kind: 'fp' | 'fn';
  id: string;
  center: LonLat;
  bbox: BBox;
  areaM2: number;
  /** FP: its confidence. FN: confidence of the best sub-threshold detection on it, if any. */
  confidence: number | null;
  auto: string;
  /** For misses with no detection at all: the pipeline stage that lost it (core detectors only). */
  stage?: string;
}

const Z = 19;
const CELL = 200;
const GAP = 4;
const COLS = 6;
const ROWS = 6;

const GREEN: RGB = [40, 255, 90];
const YELLOW: RGB = [255, 230, 0];
const MAGENTA: RGB = [255, 40, 255];
const ORANGE: RGB = [255, 150, 0];

export interface GalleryContext {
  labels: Label[];
  /** Detections at or above the threshold. */
  shown: EvalDetection[];
  /** Detections below the threshold (drawn dashed, they explain many misses). */
  faint: EvalDetection[];
}

const wx = (lon: number) => lonToWorldX(lon, Z);
const wy = (lat: number) => latToWorldY(lat, Z);

/** One context crop around an item, outlines drawn on top. */
export async function renderCell(src: TileSource, item: GalleryItem, ctx: GalleryContext): Promise<Raster> {
  const x0w = wx(item.bbox.west), x1w = wx(item.bbox.east);
  const y0w = wy(item.bbox.north), y1w = wy(item.bbox.south);
  const side = Math.round(Math.min(360, Math.max(96, Math.max(x1w - x0w, y1w - y0w) * 2.5 + 40)));
  const cx = (x0w + x1w) / 2, cy = (y0w + y1w) / 2;
  const ox = Math.round(cx - side / 2), oy = Math.round(cy - side / 2);
  const rgba = await src.crop(Z, ox, oy, side, side);
  const r = new Raster(CELL, CELL);
  r.blit(rgba, side, side, 0, 0, CELL, CELL);
  const k = CELL / side;
  const P = (lon: number, lat: number): [number, number] => [(wx(lon) - ox) * k, (wy(lat) - oy) * k];
  const view: BBox = {
    west: worldToLon(ox), east: worldToLon(ox + side), north: worldToLat(oy), south: worldToLat(oy + side),
  };
  const near = (b: BBox) => b.west <= view.east && b.east >= view.west && b.south <= view.north && b.north >= view.south;

  for (const l of ctx.labels) {
    if (!near(l.bbox)) continue;
    const c = l.role === 'pool' ? GREEN : YELLOW;
    if (l.point) {
      const [px, py] = P(l.point.lon, l.point.lat);
      const rad = ((l.radiusM ?? 5) / metersPerWorldPx(l.point.lat)) * k;
      circle(r, px, py, rad, c, l.role === 'pool' ? 0 : 3);
      r.line(px - 3, py, px + 3, py, c);
      r.line(px, py - 3, px, py + 3, c);
      continue;
    }
    for (const poly of l.polygons) for (const ring of poly) r.ring(ring.map(([lo, la]) => P(lo, la)), c, 2, l.role === 'pool' ? 0 : 4);
  }
  for (const d of ctx.faint) {
    if (!near(d.bbox)) continue;
    for (const poly of d.outline) r.ring(poly[0].map(([lo, la]) => P(lo, la)), ORANGE, 1, 3);
  }
  for (const d of ctx.shown) {
    if (!near(d.bbox)) continue;
    for (const poly of d.outline) r.ring(poly[0].map(([lo, la]) => P(lo, la)), MAGENTA, 1);
  }
  r.text(2, 2, `${item.n}`, item.kind === 'fp' ? MAGENTA : GREEN);
  if (item.confidence !== null) r.text(2, CELL - 16, item.confidence.toFixed(2), item.kind === 'fp' ? MAGENTA : ORANGE);
  r.text(CELL - 4 * 2 * 3 - 6, CELL - 16, `${Math.round(side * metersPerWorldPx(item.center.lat))}M`, [200, 200, 200]);
  return r;
}

/** Contact sheets of 36 cells each: <dir>/<kind>-01.png … plus items.json. */
export async function writeGallery(dir: string, src: TileSource, items: GalleryItem[], ctx: GalleryContext): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const kind of ['fp', 'fn'] as const) {
    const list = items.filter((i) => i.kind === kind);
    const per = COLS * ROWS;
    for (let page = 0; page * per < list.length; page++) {
      const chunk = list.slice(page * per, (page + 1) * per);
      const rows = Math.ceil(chunk.length / COLS);
      const sheet = new Raster(COLS * (CELL + GAP) + GAP, rows * (CELL + GAP) + GAP, [40, 40, 40]);
      for (let i = 0; i < chunk.length; i++) {
        const cell = await renderCell(src, chunk[i], ctx);
        const sx = GAP + (i % COLS) * (CELL + GAP);
        const sy = GAP + Math.floor(i / COLS) * (CELL + GAP);
        for (let y = 0; y < CELL; y++) {
          sheet.data.set(cell.data.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((sy + y) * sheet.width + sx) * 4);
        }
      }
      const name = `${kind}-${String(page + 1).padStart(2, '0')}.png`;
      await writeFile(join(dir, name), encodePng(sheet.data, sheet.width, sheet.height));
      files.push(name);
    }
  }
  await writeFile(join(dir, 'items.json'), JSON.stringify(items, null, 1), 'utf8');
  return files;
}

function circle(r: Raster, cx: number, cy: number, rad: number, c: RGB, dash: number) {
  const n = Math.max(12, Math.round(rad * 3));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) pts.push([cx + rad * Math.cos((2 * Math.PI * i) / n), cy + rad * Math.sin((2 * Math.PI * i) / n)]);
  r.ring(pts, c, 1, dash);
}

const worldToLon = (x: number) => worldXToLon(x, Z);
const worldToLat = (y: number) => worldYToLat(y, Z);
const metersPerWorldPx = (lat: number) => metersPerPixel(lat, Z);
