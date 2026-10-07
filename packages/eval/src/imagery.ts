import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { metersPerPixel, TILE_SIZE, tileBBox, tileUrl, type ImageryProvider, type TileCoord, type TileWindow } from '@marco-polo/core';
import { decodeImage, sleep, type DecodedTile } from '../../cli/src/tiles.js';
import { UA } from './overpass.js';
import { ESRI_PLACEHOLDER_BYTES, isBlankTile, wmsUrl } from './sources.js';

export interface TileSourceOptions {
  provider: ImageryProvider;
  /** On-disk cache directory, keyed by URL hash: switching source never mixes tiles. */
  cacheDir: string;
  /** Network requests per second (cache hits are free). */
  ratePerSec: number;
  /** Refuse network access: fail on a cache miss. */
  offline?: boolean;
}

/**
 * Tile reader for the benchmark: disk cache first, then a slow, single-stream
 * network fetch. Same cache layout as the CLI so the two can share a folder.
 *
 * `get` always returns a 256 px tile on the z grid, the unit v1 reads. XYZ
 * sources are fetched as they are; WMS sources are asked for the tile's
 * EPSG:3857 box at 256 px. `window` adds a halo for detectors that read one.
 */
export class TileSource {
  readonly opts: TileSourceOptions;
  private last = 0;
  private mem = new Map<string, DecodedTile | null>();
  /** sha256 of every image read, by URL: the tile manifest of a run. */
  readonly manifest = new Map<string, string>();
  fetched = 0;
  cacheHits = 0;
  failures = 0;
  noData = 0;

  constructor(opts: TileSourceOptions) {
    this.opts = opts;
  }

  get provider(): ImageryProvider {
    return this.opts.provider;
  }

  urlFor(tile: TileCoord, px = TILE_SIZE, marginFrac = 0): string {
    const p = this.opts.provider;
    if (p.kind === 'wms') return wmsUrl(p.template, tile, px, marginFrac);
    if (px !== TILE_SIZE || marginFrac) throw new Error(`${p.id} is an XYZ source: only plain 256 px tiles`);
    return tileUrl(p.template, tile);
  }

  /** Decoded 256 px tile, or null when the source has nothing there (404, blank, placeholder or failure). */
  async get(tile: TileCoord): Promise<DecodedTile | null> {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (this.mem.has(key)) return this.mem.get(key)!;
    const result = await this.fetchImage(this.urlFor(tile), `${tile.z}-${tile.x}-${tile.y}`);
    if (this.mem.size > 4000) this.mem.clear();
    this.mem.set(key, result);
    return result;
  }

  /**
   * Central tile plus `halo` px on every side, as a detector window. WMS: one
   * request for the grown box. XYZ: the eight neighbours, stitched; a missing
   * neighbour leaves its part mid-grey.
   */
  async window(tile: TileCoord, halo: number, tilePx = TILE_SIZE): Promise<TileWindow | null> {
    const p = this.opts.provider;
    const width = tilePx + 2 * halo;
    const lat = (tileBBox(tile).north + tileBBox(tile).south) / 2;
    const mPerPx = (metersPerPixel(lat, tile.z) * TILE_SIZE) / tilePx;
    if (p.kind === 'wms') {
      const img = await this.fetchImage(this.urlFor(tile, width, halo / tilePx), `w${halo}-${tile.z}-${tile.x}-${tile.y}`);
      if (!img || img.width !== width || img.height !== width) return null;
      return { tile, tilePx, halo, width, height: width, pixels: img.rgba, mPerPx };
    }
    if (tilePx !== TILE_SIZE) throw new Error('XYZ windows are built from 256 px tiles');
    const center = await this.get(tile);
    if (!center) return null;
    const pixels = await this.crop(tile.z, tile.x * TILE_SIZE - halo, tile.y * TILE_SIZE - halo, width, width);
    return { tile, tilePx, halo, width, height: width, pixels, mPerPx };
  }

  private async fetchImage(url: string, name: string): Promise<DecodedTile | null> {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 24);
    const path = join(this.opts.cacheDir, `${name}-${hash}.bin`);
    let buf: Buffer | null = null;
    try {
      buf = await readFile(path);
      this.cacheHits++;
    } catch {
      // miss
    }
    if (!buf) {
      if (this.opts.offline) throw new Error(`offline and not cached: ${url}`);
      buf = await this.download(url, path);
      if (!buf) return null;
    }
    if (!buf.length) {
      this.noData++;
      return null;
    }
    this.manifest.set(url, createHash('sha256').update(buf).digest('hex'));
    const esri = this.opts.provider.id === 'esri-world-imagery';
    if (esri && buf.length === ESRI_PLACEHOLDER_BYTES) {
      this.noData++;
      return null;
    }
    const img = decodeImage(buf);
    // Esri has a real placeholder and no blank answers; open sea there must stay imagery.
    if (!esri && isBlankTile(img.rgba)) {
      this.noData++;
      return null;
    }
    return img;
  }

  private async download(url: string, path: string): Promise<Buffer | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.last + 1000 / this.opts.ratePerSec - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        if (res.status === 404) {
          await mkdir(this.opts.cacheDir, { recursive: true });
          await writeFile(path, Buffer.alloc(0));
          return Buffer.alloc(0);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        if (!/^image\//.test(type)) throw new Error(`not an image: ${type}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(this.opts.cacheDir, { recursive: true });
        await writeFile(path, buf);
        this.fetched++;
        return buf;
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

  /** One sha256 over the sorted manifest: identifies the exact pixels a run read. */
  manifestHash(): string {
    const lines = [...this.manifest].sort((a, b) => a[0].localeCompare(b[0])).map(([u, h]) => `${h} ${u}`);
    return createHash('sha256').update(lines.join('\n')).digest('hex');
  }
}
