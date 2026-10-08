/**
 * Tile fetching and caching, by the licence of each source:
 * - `persistent` (DGT, PNOA, IGN, open licences): IndexedDB, survives reloads.
 * - `session`: memory, gone when the page closes.
 * - `http` (Esri): no app copy at all; the browser HTTP cache keeps tiles for
 *   the max-age the server sends.
 * Network requests go through the scan's token bucket, one token per attempt.
 */
import { createStore, clear as idbClear, get as idbGet, set as idbSet, type UseStore } from 'idb-keyval';
import type { CachePolicy } from '@marco-polo/core';
import { abortError, delay, isAbort, type TokenBucket } from './pacer.js';

/** The Cache API store of older builds; it held Esri and keyed-provider tiles. */
const LEGACY_CACHE = 'marco-polo-tiles-v1';

export interface PersistentTileStore {
  get(url: string): Promise<Uint8Array | undefined>;
  set(url: string, bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

let idb: UseStore | null = null;

/** IndexedDB store for open-licence tiles. */
export function idbTileStore(): PersistentTileStore {
  const db = () => (idb ??= createStore('marco-polo-tiles', 'tiles'));
  return {
    async get(url) {
      const v = await idbGet<ArrayBuffer | Uint8Array>(url, db());
      if (!v) return undefined;
      return v instanceof Uint8Array ? v : new Uint8Array(v);
    },
    async set(url, bytes) {
      await idbSet(url, bytes, db());
    },
    async clear() {
      await idbClear(db());
    },
  };
}

/** Memory limit for `session` tiles, bytes. */
const SESSION_BUDGET = 64 * 1024 * 1024;

export class TileCache {
  private session = new Map<string, Uint8Array>();
  private sessionBytes = 0;

  constructor(private readonly persistent: PersistentTileStore | null) {}

  async get(policy: CachePolicy, url: string): Promise<Uint8Array | null> {
    if (policy === 'persistent') {
      if (!this.persistent) return null;
      try {
        return (await this.persistent.get(url)) ?? null;
      } catch {
        return null;
      }
    }
    if (policy === 'session') {
      const hit = this.session.get(url);
      if (!hit) return null;
      // Refresh recency.
      this.session.delete(url);
      this.session.set(url, hit);
      return hit;
    }
    return null;
  }

  async put(policy: CachePolicy, url: string, bytes: Uint8Array): Promise<void> {
    if (policy === 'persistent') {
      if (!this.persistent) return;
      try {
        await this.persistent.set(url, bytes);
      } catch {
        // Quota or a private window: carry on uncached.
      }
      return;
    }
    if (policy === 'session') {
      if (this.session.has(url)) return;
      this.session.set(url, bytes);
      this.sessionBytes += bytes.byteLength;
      for (const [k, v] of this.session) {
        if (this.sessionBytes <= SESSION_BUDGET) break;
        this.session.delete(k);
        this.sessionBytes -= v.byteLength;
      }
    }
    // 'http': nothing is kept by the app.
  }

  async clear(): Promise<void> {
    this.session.clear();
    this.sessionBytes = 0;
    await this.persistent?.clear().catch(() => {});
  }
}

let shared: TileCache | null = null;

/** The page-wide cache: IndexedDB when available, memory only otherwise. */
export function sharedTileCache(): TileCache {
  if (!shared) shared = new TileCache(typeof indexedDB !== 'undefined' ? idbTileStore() : null);
  return shared;
}

export type FetchFn = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export const browserFetch: FetchFn = (url, init) =>
  fetch(url, { signal: init.signal, mode: 'cors', credentials: 'omit' });

export interface TileBytes {
  status: number;
  bytes: Uint8Array;
  /** True when no network request was made. */
  cached: boolean;
  /** Network attempts this answer cost (0 for a cache hit). */
  attempts: number;
}

export interface FetchTileOptions {
  bucket: TokenBucket;
  fetch: FetchFn;
  cache?: TileCache | null;
  policy?: CachePolicy;
  signal?: AbortSignal;
  /** Retries after the first attempt, for network errors, 429 and 5xx. */
  retries?: number;
  timeoutMs?: number;
}

export class TileHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'TileHttpError';
  }
}

/**
 * One tile: from the cache when the policy allows, otherwise from the
 * network, paced and retried. 404 and 204 come back as answers (they mean
 * "no imagery here"); other 4xx throw at once; 429, 5xx and network errors
 * are retried with backoff, each attempt taking a fresh token.
 */
export async function fetchTile(url: string, o: FetchTileOptions): Promise<TileBytes> {
  const policy = o.policy ?? 'http';
  const hit = o.cache ? await o.cache.get(policy, url) : null;
  if (hit) return { status: 200, bytes: hit, cached: true, attempts: 0 };

  const retries = o.retries ?? 3;
  const timeoutMs = o.timeoutMs ?? 20_000;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await o.bucket.take(o.signal);
    const ac = new AbortController();
    const onAbort = () => ac.abort(abortError(o.signal));
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const res = await o.fetch(url, { signal: ac.signal });
      if (res.status === 429 || res.status >= 500) throw new TileHttpError(res.status);
      if (res.status === 404 || res.status === 204) {
        return { status: res.status, bytes: new Uint8Array(0), cached: false, attempts: attempt + 1 };
      }
      if (res.status < 200 || res.status >= 300) {
        const err = new TileHttpError(res.status);
        err.name = 'TileFatalError';
        throw err;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (o.cache && looksLikeImage(bytes)) await o.cache.put(policy, url, bytes);
      return { status: res.status, bytes, cached: false, attempts: attempt + 1 };
    } catch (err) {
      if (o.signal?.aborted) throw abortError(o.signal);
      if (err instanceof Error && err.name === 'TileFatalError') throw err;
      if (isAbort(err) && !ac.signal.aborted) throw err;
      lastError = err;
      if (attempt < retries) await delay(500 * 2 ** attempt, o.signal);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** JPEG, PNG or WebP by magic bytes; anything else (an error page) is never cached. */
export function looksLikeImage(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45;
}

/** Remove the tile store of older builds, which also held Esri tiles. Safe to call often. */
export async function dropLegacyCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(LEGACY_CACHE);
  } catch {
    // Cache API missing or blocked.
  }
}

/** Settings "clear cache": every stored tile, old and new. */
export async function clearTileCache(): Promise<void> {
  await dropLegacyCache();
  await sharedTileCache().clear();
}
