import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { tileUrl, type TileCoord } from '@marco-polo/core';

export interface DecodedTile {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

const UA = 'marco-polo-scanner/0.1 (open-source pool scanner; github.com/Sepd0x/marco-polo)';

/** Decode a JPEG or PNG buffer by magic bytes. */
export function decodeImage(buf: Buffer): DecodedTile {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    const { data, width, height } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height };
  }
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return {
      rgba: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
      width: png.width,
      height: png.height,
    };
  }
  throw new Error(`Unrecognised image format (first bytes: ${buf.subarray(0, 4).toString('hex')})`);
}

export interface TileFetcherOptions {
  cacheDir?: string | null;
  retries?: number;
  timeoutMs?: number;
}

/** Fetch and decode one tile, with optional on-disk caching and retry/backoff. */
export async function fetchTile(
  template: string,
  tile: TileCoord,
  opts: TileFetcherOptions = {},
): Promise<DecodedTile> {
  const { cacheDir = null, retries = 3, timeoutMs = 20000 } = opts;
  const url = tileUrl(template, tile);

  let cachePath: string | null = null;
  if (cacheDir) {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 24);
    cachePath = join(cacheDir, `${tile.z}-${tile.x}-${tile.y}-${hash}.bin`);
    try {
      const cached = await readFile(cachePath);
      return decodeImage(cached);
    } catch {
      // cache miss
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new NoRetryError(`HTTP ${res.status} for ${url}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (cachePath) {
        await mkdir(cacheDir!, { recursive: true });
        await writeFile(cachePath, buf);
      }
      return decodeImage(buf);
    } catch (err) {
      if (err instanceof NoRetryError) throw err;
      lastError = err;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt + Math.random() * 250);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

class NoRetryError extends Error {}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
  return PNG.sync.write(png);
}
