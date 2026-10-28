/**
 * The work done for one tile inside a detection worker, written without any
 * worker or DOM API so it runs in tests: decode, tell "no imagery" from
 * imagery, build the detector window, detect, crop thumbnails.
 */
import {
  buildTileWindow,
  metersPerPixelOfBitmap,
  noDataReason,
  windowFromBitmap,
  type Detector,
  type NoDataReason,
  type TileCoord,
  type TileDetection,
  type TileWindow,
} from '@marco-polo/core';
import { fragKey } from '../lib/fragKey.js';

export interface DecodedImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Decode = (bytes: Uint8Array) => Promise<DecodedImage>;
export type EncodeThumb = (pixels: Uint8ClampedArray, width: number, height: number) => Promise<Blob>;

export interface WorkJob {
  id: number;
  scanId: string;
  providerId: string;
  /** Tile of the scan grid. */
  tile: TileCoord;
  /** Side of the central tile in the decoded bitmap, px (256, or 512 for the DGT WMS). */
  tilePx: number;
  /** Halo already inside `bytes` (WMS) or to assemble from `neighbours` (XYZ). */
  halo: number;
  bytes: ArrayBuffer;
  /** XYZ halo: the eight neighbours row by row (see NEIGHBOUR_OFFSETS), null when missing. */
  neighbours?: (ArrayBuffer | null)[];
  /** Only answer whether the tile holds imagery. */
  probe?: boolean;
  /** Crop thumbnails for the detections. */
  thumbs?: boolean;
}

export interface WorkPiece {
  /** Tile the detections belong to (a z+1 child when a 512 px tile is cut for v1). */
  tile: TileCoord;
  detections: TileDetection[];
}

export interface WorkThumb {
  key: string;
  blob: Blob;
}

export interface WorkResult {
  id: number;
  scanId: string;
  noData: NoDataReason | null;
  pieces: WorkPiece[];
  thumbs: WorkThumb[];
  /** Time spent on this job inside the worker, ms. */
  ms: number;
  /** Where `ms` went: decoding (centre and neighbours), the no-data check, detection, thumbnails. */
  stages?: { decode: number; noData: number; detect: number; thumbs: number };
  error?: string;
}

/** Id of the detector the product runs (the worker builds it with the shipped model). */
export const PRODUCT_DETECTOR_ID = 'v2';

/** Halo the v2 detector reads, px of a 256 px tile; a larger bitmap gets it in proportion. */
export const V2_HALO_PX = 48;

/** Halo, in px of the bitmap a source answers with, for a detector. v1 reads none. */
export function haloFor(detectorId: string, requestPx: number): number {
  return detectorId === 'v1' ? 0 : (V2_HALO_PX * requestPx) / 256;
}

/**
 * Tiles the merger of a part sees for one scan tile. v1 reads bare 256 px
 * tiles, so a 512 px tile goes in as its four z+1 children (same ground).
 */
export function pieceTiles(tile: TileCoord, tilePx: number, detectorId: string): TileCoord[] {
  if (detectorId !== 'v1' || tilePx === 256) return [tile];
  const k = tilePx / 256;
  if (!Number.isInteger(k) || (k & (k - 1)) !== 0) throw new Error(`cannot cut a ${tilePx} px tile for v1`);
  const dz = Math.log2(k);
  const out: TileCoord[] = [];
  for (let qy = 0; qy < k; qy++) {
    for (let qx = 0; qx < k; qx++) out.push({ z: tile.z + dz, x: tile.x * k + qx, y: tile.y * k + qy });
  }
  return out;
}

function crop(src: Uint8ClampedArray, srcW: number, x0: number, y0: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * srcW + x0) * 4;
    out.set(src.subarray(from, from + w * 4), y * w * 4);
  }
  return out;
}

/** Thumbnail crop: margin around the shape and largest side, px of the bitmap. */
export const THUMB_PAD = 6;
export const THUMB_MAX = 160;
/** Ground a thumbnail tries to cover, so the pool is seen with its surroundings. */
export const THUMB_VIEW_M = 30.5;

export interface PxBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The square cut for a thumbnail, in px of the central tile (negative or past
 * `tilePx` inside the halo): centred on the shape, wide enough for the shape
 * and THUMB_VIEW_M of ground, never wider than THUMB_MAX or the window.
 */
export function thumbRect(b: PxBox, tilePx: number, halo: number, mPerPx: number): { x0: number; y0: number; x1: number; y1: number } {
  const want = Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1) + 2 * THUMB_PAD;
  const side = Math.min(THUMB_MAX, tilePx + 2 * halo, Math.max(want, Math.ceil(THUMB_VIEW_M / mPerPx)));
  const place = (lo: number, hi: number) => {
    const start = Math.round((lo + hi + 1) / 2 - side / 2);
    return Math.min(Math.max(start, -halo), tilePx + halo - side);
  };
  const x0 = place(b.minX, b.maxX);
  const y0 = place(b.minY, b.maxY);
  return { x0, y0, x1: x0 + side, y1: y0 + side };
}

/** Windows handed to the detector and the pixels thumbnails are cut from. */
function windows(
  detector: Detector,
  job: WorkJob,
  centre: DecodedImage,
  neighbours: (DecodedImage | null)[] | null,
): { window: TileWindow; offset: number }[] {
  if (detector.id === 'v1') {
    // v1: no halo, 256 px pieces.
    const side = job.tilePx;
    const inner = job.halo;
    const pieces = pieceTiles(job.tile, side, 'v1');
    const k = side / 256;
    return pieces.map((tile, i) => {
      const qx = i % k;
      const qy = Math.floor(i / k);
      const px = crop(centre.pixels, centre.width, inner + qx * 256, inner + qy * 256, 256, 256);
      return {
        window: { tile, tilePx: 256, halo: 0, width: 256, height: 256, pixels: px, mPerPx: metersPerPixelOfBitmap(tile, 256) },
        offset: 0,
      };
    });
  }
  if (neighbours) {
    const at = (dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return centre.pixels;
      const i = (dy + 1) * 3 + (dx + 1);
      return neighbours[i > 4 ? i - 1 : i]?.pixels ?? null;
    };
    return [{ window: buildTileWindow(job.tile, job.tilePx, job.halo, at), offset: job.halo }];
  }
  return [{ window: windowFromBitmap(job.tile, centre.pixels, centre.width, centre.height, job.halo), offset: job.halo }];
}

/** Run one job. Never throws: errors come back in `error`. */
export async function runJob(
  job: WorkJob,
  deps: { decode: Decode; encodeThumb: EncodeThumb; detector: Detector; now?: () => number },
): Promise<WorkResult> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const base = { id: job.id, scanId: job.scanId };
  const stages = { decode: 0, noData: 0, detect: 0, thumbs: 0 };
  let mark = t0;
  const lap = (k: keyof typeof stages) => {
    const t = now();
    stages[k] += t - mark;
    mark = t;
  };
  try {
    const bytes = new Uint8Array(job.bytes);
    const centre = await deps.decode(bytes);
    lap('decode');
    // An XYZ centre comes bare (its halo is in the neighbours); a WMS bitmap holds its halo.
    const expected = job.neighbours ? job.tilePx : job.tilePx + 2 * job.halo;
    if (centre.width !== expected || centre.height !== expected) {
      throw new Error(`tile decoded at ${centre.width}x${centre.height}, expected ${expected}x${expected}`);
    }
    const noData = noDataReason({ status: 200, bytes, pixels: centre.pixels, width: centre.width, height: centre.height });
    lap('noData');
    if (noData || job.probe) return { ...base, noData, pieces: [], thumbs: [], ms: now() - t0, stages };

    let neighbours: (DecodedImage | null)[] | null = null;
    if (job.neighbours && job.halo > 0 && deps.detector.id !== 'v1') {
      neighbours = await Promise.all(
        job.neighbours.map(async (b) => {
          if (!b) return null;
          try {
            const img = await deps.decode(new Uint8Array(b));
            return img.width === job.tilePx && img.height === job.tilePx ? img : null;
          } catch {
            return null;
          }
        }),
      );
      lap('decode');
    }

    const pieces: WorkPiece[] = [];
    const thumbs: WorkThumb[] = [];
    for (const { window, offset } of windows(deps.detector, job, centre, neighbours)) {
      const detections = deps.detector.detectTile(window, { providerId: job.providerId });
      pieces.push({ tile: window.tile, detections });
      lap('detect');
      if (!job.thumbs) continue;
      for (const d of detections) {
        const r = thumbRect(d.bboxPx, window.tilePx, offset, window.mPerPx);
        const x0 = r.x0 + offset;
        const y0 = r.y0 + offset;
        const w = r.x1 - r.x0;
        const h = r.y1 - r.y0;
        if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x0 + w > window.width || y0 + h > window.height) continue;
        try {
          const blob = await deps.encodeThumb(crop(window.pixels as Uint8ClampedArray, window.width, x0, y0, w, h), w, h);
          thumbs.push({ key: fragKey(window.tile, d.bboxPx), blob });
        } catch {
          // A thumbnail is optional.
        }
      }
      lap('thumbs');
    }
    return { ...base, noData: null, pieces, thumbs, ms: now() - t0, stages };
  } catch (err) {
    return { ...base, noData: null, pieces: [], thumbs: [], ms: now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** MIME type by magic bytes, so the decoder is told what it gets. */
export function sniffType(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'application/octet-stream';
}
