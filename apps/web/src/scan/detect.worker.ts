/// <reference lib="webworker" />
/**
 * Detection worker: receives a decoded tile bitmap, runs the computer-vision
 * pipeline off the main thread, and returns geo-referenced detections plus
 * raw RGBA crops for result thumbnails.
 */
import { detectTile, type DetectorOptions, type TileCoord, type TileDetection } from '@marco-polo/core';
import { fragKey } from '../lib/fragKey.js';

export interface DetectRequest {
  id: number;
  tile: TileCoord;
  bitmap: ImageBitmap;
  options: Partial<DetectorOptions>;
}

export interface ThumbCrop {
  key: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

export interface DetectResponse {
  id: number;
  detections: TileDetection[];
  thumbs: ThumbCrop[];
  error?: string;
}

const THUMB_PAD = 6;
const THUMB_MAX = 120;

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const { id, tile, bitmap, options } = e.data;
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, w, h);

    const detections = detectTile(img.data, w, h, tile, options);

    const thumbs: ThumbCrop[] = [];
    for (const d of detections) {
      const x0 = Math.max(0, d.bboxPx.minX - THUMB_PAD);
      const y0 = Math.max(0, d.bboxPx.minY - THUMB_PAD);
      const x1 = Math.min(w, d.bboxPx.maxX + 1 + THUMB_PAD);
      const y1 = Math.min(h, d.bboxPx.maxY + 1 + THUMB_PAD);
      const cw = Math.min(THUMB_MAX, x1 - x0);
      const ch = Math.min(THUMB_MAX, y1 - y0);
      if (cw <= 0 || ch <= 0) continue;
      const crop = ctx.getImageData(x0, y0, cw, ch);
      thumbs.push({
        key: fragKey(tile, d.bboxPx),
        width: cw,
        height: ch,
        buffer: crop.data.buffer,
      });
    }

    const response: DetectResponse = { id, detections, thumbs };
    (self as unknown as Worker).postMessage(response, thumbs.map((t) => t.buffer));
  } catch (err) {
    const response: DetectResponse = {
      id,
      detections: [],
      thumbs: [],
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
