/// <reference lib="webworker" />
/**
 * Detection worker. Decoding happens here, the same way the parity test
 * decodes in Chromium and Firefox (createImageBitmap without colour space
 * conversion or premultiplied alpha, then a 2D canvas), so the pixels the
 * product scores are the pixels that were measured.
 */
import { productDetector, runJob, sniffType, type DecodedImage, type WorkJob } from './tileWork.js';

const detector = productDetector();

const DECODE_OPTIONS: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };

async function decode(bytes: Uint8Array): Promise<DecodedImage> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: sniffType(bytes) }), DECODE_OPTIONS);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { pixels: img.data, width: img.width, height: img.height };
  } finally {
    bmp.close();
  }
}

async function encodeThumb(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e: MessageEvent<WorkJob>) => {
  const result = await runJob(e.data, { decode, encodeThumb, detector });
  (self as unknown as Worker).postMessage(result);
};
