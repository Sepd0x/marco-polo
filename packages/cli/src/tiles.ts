import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { decodeJpeg, JpegUnsupported } from './jpeg.js';
import { MirrorChoice, tileUrl, type CachePolicy, type TileCoord } from '@marco-polo/core';

export interface DecodedTile {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export const USER_AGENT = 'marco-polo-scanner/0.2 (open-source pool scanner; github.com/Sepd0x/marco-polo)';

/**
 * Decode a JPEG or PNG buffer by magic bytes. JPEGs go through `decodeJpeg`,
 * which gives the browsers' pixels; jpeg-js only takes the variants it does
 * not handle (progressive, unusual sampling), which none of the sources serve.
 */
export function decodeImage(buf: Uint8Array): DecodedTile {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    try {
      return decodeJpeg(buf);
    } catch (err) {
      if (!(err instanceof JpegUnsupported)) throw err;
    }
    const { data, width, height } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height };
  }
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
    return {
      rgba: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
      width: png.width,
      height: png.height,
    };
  }
  throw new Error(`Unrecognised image format (first bytes: ${Buffer.from(buf.subarray(0, 4)).toString('hex')})`);
}

export function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
  return PNG.sync.write(png);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Spaces request starts at least `1000 / perSecond` ms apart. Every network
 * request goes through it, retries included; cache hits do not.
 */
export class Pacer {
  private next = 0;
  constructor(
    readonly perSecond: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    if (!(perSecond > 0)) throw new RangeError(`rate must be positive, got ${perSecond}`);
  }

  async take(): Promise<void> {
    const t = this.now();
    const at = Math.max(t, this.next);
    this.next = at + 1000 / this.perSecond;
    if (at > t) await this.wait(at - t);
  }
}

/** A tile as received: status and body, decoded when it is an image. */
export interface FetchedTile {
  status: number;
  bytes: Uint8Array;
  image: DecodedTile | null;
  cached: boolean;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface TileFetcherOptions {
  pacer: Pacer;
  /** Where tiles may be kept, from the source's licence. */
  cachePolicy: CachePolicy;
  /** Directory for `persistent` sources; nothing is written for the others. */
  cacheDir?: string | null;
  retries?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Fetches tiles for one source. Only persistent (open licence) sources are
 * kept, on disk; the others are never stored. A 404 or 204 comes back as a result
 * (it means "no imagery here"); 429 and 5xx are retried with backoff.
 */
export class TileFetcher {
  private readonly opts: Required<Omit<TileFetcherOptions, 'cacheDir'>> & { cacheDir: string | null };
  private readonly mirror = new MirrorChoice();
  requests = 0;

  constructor(opts: TileFetcherOptions) {
    this.opts = {
      pacer: opts.pacer,
      cachePolicy: opts.cachePolicy,
      cacheDir: opts.cacheDir ?? null,
      retries: opts.retries ?? 3,
      timeoutMs: opts.timeoutMs ?? 20_000,
      // Called unbound: the platform fetch refuses any other `this`.
      fetch: opts.fetch ?? ((url, init) => globalThis.fetch(url, init)),
      wait: opts.wait ?? sleep,
    };
  }

  /**
   * `mirrorUrl`: the same tile from the provider's mirror. Attempts alternate
   * between the two, the one that last answered first; the cache keeps `url`.
   */
  async get(url: string, mirrorUrl?: string): Promise<FetchedTile> {
    const hit = await this.fromCache(url);
    if (hit) return { status: 200, bytes: hit, image: tryDecode(hit), cached: true };

    const urls = this.mirror.order(url, mirrorUrl);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      const asked = urls[attempt % urls.length];
      await this.opts.pacer.take();
      this.requests++;
      try {
        const doFetch = this.opts.fetch;
        const res = await doFetch(asked, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        this.mirror.answered(asked, mirrorUrl);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (res.status === 404 || res.status === 204) return { status: res.status, bytes, image: null, cached: false };
        if (res.status < 200 || res.status >= 300) return { status: res.status, bytes, image: null, cached: false };
        const image = tryDecode(bytes);
        if (image) await this.toCache(url, bytes);
        return { status: res.status, bytes, image, cached: false };
      } catch (err) {
        lastError = err;
        // Straight to the other server when there is one; back off only between rounds.
        if (attempt < this.opts.retries && (attempt + 1) % urls.length === 0) await this.opts.wait(500 * 2 ** attempt);
      }
    }
    throw new Error(`tile request failed after ${this.opts.retries + 1} attempts: ${String(lastError)}`);
  }

  private path(url: string): string {
    return join(this.opts.cacheDir!, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.bin`);
  }

  private async fromCache(url: string): Promise<Uint8Array | null> {
    if (this.opts.cachePolicy !== 'persistent' || !this.opts.cacheDir) return null;
    try {
      return new Uint8Array(await readFile(this.path(url)));
    } catch {
      return null;
    }
  }

  private async toCache(url: string, bytes: Uint8Array): Promise<void> {
    if (this.opts.cachePolicy !== 'persistent' || !this.opts.cacheDir) return;
    await mkdir(this.opts.cacheDir, { recursive: true });
    await writeFile(this.path(url), bytes);
  }
}

function tryDecode(bytes: Uint8Array): DecodedTile | null {
  try {
    return decodeImage(bytes);
  } catch {
    return null;
  }
}

/** Fetch and decode one XYZ tile, uncached. For dev scripts. */
export async function fetchTile(template: string, tile: TileCoord): Promise<DecodedTile> {
  const f = new TileFetcher({ pacer: new Pacer(5), cachePolicy: 'http' });
  const r = await f.get(tileUrl(template, tile));
  if (!r.image) throw new Error(`no image for ${tile.z}/${tile.x}/${tile.y} (HTTP ${r.status})`);
  return r.image;
}
