/**
 * The work done for one tile inside a detection worker, written without any
 * worker or DOM API so it runs in tests: decode, tell "no imagery" from
 * imagery, build the detector window, detect, crop thumbnails.
 */
import {
  buildTileWindow,
  createV1Detector,
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
  error?: string;
}

/** The detector the product runs. v1 until the learned detector lands. */
export function productDetector(): Detector {
  return createV1Detector();
}

/** Halo, in px of the central tile, the product detector reads. v1 reads none. */
export function detectorHalo(detector: Detector): number {
  return detector.id === 'v1' ? 0 : 48;
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

const THUMB_PAD = 6;
const THUMB_MAX = 120;

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
  try {
    const bytes = new Uint8Array(job.bytes);
    const centre = await deps.decode(bytes);
    const expected = job.tilePx + 2 * job.halo;
    if (centre.width !== expected || centre.height !== expected) {
      throw new Error(`tile decoded at ${centre.width}x${centre.height}, expected ${expected}x${expected}`);
    }
    const noData = noDataReason({ status: 200, bytes, pixels: centre.pixels, width: centre.width, height: centre.height });
    if (noData || job.probe) return { ...base, noData, pieces: [], thumbs: [], ms: now() - t0 };

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
    }

    const pieces: WorkPiece[] = [];
    const thumbs: WorkThumb[] = [];
    for (const { window, offset } of windows(deps.detector, job, centre, neighbours)) {
      const detections = deps.detector.detectTile(window, { providerId: job.providerId });
      pieces.push({ tile: window.tile, detections });
      if (!job.thumbs) continue;
      for (const d of detections) {
        const x0 = Math.max(0, d.bboxPx.minX + offset - THUMB_PAD);
        const y0 = Math.max(0, d.bboxPx.minY + offset - THUMB_PAD);
        const x1 = Math.min(window.width, d.bboxPx.maxX + offset + 1 + THUMB_PAD);
        const y1 = Math.min(window.height, d.bboxPx.maxY + offset + 1 + THUMB_PAD);
        const w = Math.min(THUMB_MAX, x1 - x0);
        const h = Math.min(THUMB_MAX, y1 - y0);
        if (w <= 0 || h <= 0) continue;
        try {
          const blob = await deps.encodeThumb(crop(window.pixels as Uint8ClampedArray, window.width, x0, y0, w, h), w, h);
          thumbs.push({ key: fragKey(window.tile, d.bboxPx), blob });
        } catch {
          // A thumbnail is optional.
        }
      }
    }
    return { ...base, noData: null, pieces, thumbs, ms: now() - t0 };
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
