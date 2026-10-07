import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TILE_SIZE, tileUrl, type TileCoord } from '@marco-polo/core';
import { decodeImage, sleep, type DecodedTile } from '../../cli/src/tiles.js';

const UA = 'marco-polo-eval/0.1 (pool detection benchmark; github.com/Sepd0x/marco-polo)';

export interface TileSourceOptions {
  /** XYZ template with {z}/{x}/{y}. */
  template: string;
  /** On-disk cache directory, keyed by URL hash: switching template never mixes sources. */
  cacheDir: string;
  /** Network requests per second (cache hits are free). */
  ratePerSec: number;
  /** Refuse network access: fail on a cache miss. */
  offline?: boolean;
}

/**
 * Tile reader for the benchmark: disk cache first, then a slow, single-stream
 * network fetch. Same cache layout as the CLI so the two can share a folder.
 */
export class TileSource {
  readonly opts: TileSourceOptions;
  private last = 0;
  private mem = new Map<string, DecodedTile | null>();
  fetched = 0;
  cacheHits = 0;
  failures = 0;

  constructor(opts: TileSourceOptions) {
    this.opts = opts;
  }

  /** Decoded tile, or null when the provider has nothing (HTTP 404 or a failure). */
  async get(tile: TileCoord): Promise<DecodedTile | null> {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (this.mem.has(key)) return this.mem.get(key)!;
    const result = await this.load(tile);
    if (this.mem.size > 4000) this.mem.clear();
    this.mem.set(key, result);
    return result;
  }

  private async load(tile: TileCoord): Promise<DecodedTile | null> {
    const url = tileUrl(this.opts.template, tile);
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 24);
    const path = join(this.opts.cacheDir, `${tile.z}-${tile.x}-${tile.y}-${hash}.bin`);
    try {
      const buf = await readFile(path);
      this.cacheHits++;
      return buf.length ? decodeImage(buf) : null;
    } catch {
      // miss
    }
    if (this.opts.offline) throw new Error(`offline and not cached: ${url}`);

    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.last + 1000 / this.opts.ratePerSec - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (res.status === 404) {
          await mkdir(this.opts.cacheDir, { recursive: true });
          await writeFile(path, Buffer.alloc(0));
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(this.opts.cacheDir, { recursive: true });
        await writeFile(path, buf);
        this.fetched++;
        return decodeImage(buf);
      } catch {
        await sleep(1000 * 2 ** attempt);
      }
    }
    this.failures++;
    return null;
  }

  /**
   * RGBA crop in world-pixel coordinates at zoom z, stitched from tiles.
   * Pixels without imagery come back mid-grey.
   */
  async crop(z: number, x0: number, y0: number, w: number, h: number): Promise<Uint8ClampedArray> {
    const out = new Uint8ClampedArray(w * h * 4).fill(96);
    const tx0 = Math.floor(x0 / TILE_SIZE), tx1 = Math.floor((x0 + w - 1) / TILE_SIZE);
    const ty0 = Math.floor(y0 / TILE_SIZE), ty1 = Math.floor((y0 + h - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = await this.get({ z, x: tx, y: ty });
        if (!t) continue;
        const ox = tx * TILE_SIZE, oy = ty * TILE_SIZE;
        const sx0 = Math.max(x0, ox), sx1 = Math.min(x0 + w, ox + t.width);
        const sy0 = Math.max(y0, oy), sy1 = Math.min(y0 + h, oy + t.height);
        for (let y = sy0; y < sy1; y++) {
          for (let x = sx0; x < sx1; x++) {
            const s = ((y - oy) * t.width + (x - ox)) * 4;
            const d = ((y - y0) * w + (x - x0)) * 4;
            out[d] = t.rgba[s];
            out[d + 1] = t.rgba[s + 1];
            out[d + 2] = t.rgba[s + 2];
            out[d + 3] = 255;
          }
        }
      }
    }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  }
}
