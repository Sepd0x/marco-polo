import { vi } from 'vitest';
import { lonLatToTile, type Ring, type TileCoord, type TileDetection } from '@marco-polo/core';
import { useStore } from '../../src/state/store.js';
import type { ControllerDeps, Pool } from '../../src/scan/controller.js';
import { TileCache, type FetchFn, type PersistentTileStore } from '../../src/scan/tileSource.js';
import { pieceTiles, type WorkJob, type WorkResult } from '../../src/scan/tileWork.js';
import type { SavedScan } from '../../src/scan/persist.js';
import { makeFragment } from '../../../../packages/core/test/helpers.js';

export const INITIAL = useStore.getState();

export function resetStore(): void {
  useStore.setState({ ...INITIAL, settings: { ...INITIAL.settings } }, true);
}

/** A square of `metres` per side around a point, as a ring. */
export function square(lat: number, lon: number, metres: number): Ring {
  const dLat = metres / 2 / 111_320;
  const dLon = metres / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [
    [r(lon - dLon), r(lat - dLat)],
    [r(lon + dLon), r(lat - dLat)],
    [r(lon + dLon), r(lat + dLat)],
    [r(lon - dLon), r(lat + dLat)],
  ];
}

/** A z19 tile in Scottsdale, where a 40 x 20 px fragment is a plausible pool. */
export const US_TILE = lonLatToTile(-111.926, 33.594, 19);

/** Scottsdale (US): Esri, no app cache. */
export const US_AREA = square(33.594, -111.926, 250);
/** Braga (PT): DGT, persistent cache, 512 px WMS on a z18 grid. */
export const PT_AREA = square(41.5725, -8.378, 250);

export type TileKind = 'data' | 'blank';

/** Fake tile body: JPEG magic, then a marker the fake pool reads. */
export function tileBody(kind: TileKind = 'data'): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = kind === 'data' ? 1 : 0;
  return b;
}

export interface FetchCall {
  url: string;
  at: number;
}

export interface FakeNet {
  fetch: FetchFn;
  calls: FetchCall[];
  /** Answer for a URL; default 200 with a data tile. */
  respond: (url: string, attempt: number) => { status: number; body?: Uint8Array };
  latencyMs: number;
}

export function fakeNet(latencyMs = 30): FakeNet {
  const attempts = new Map<string, number>();
  const net: FakeNet = {
    calls: [],
    latencyMs,
    respond: () => ({ status: 200 }),
    fetch: (url, init) => {
      net.calls.push({ url, at: Date.now() });
      const n = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, n);
      const answer = net.respond(url, n);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          const body = answer.body ?? (answer.status === 200 ? tileBody('data') : new Uint8Array(0));
          resolve({ status: answer.status, arrayBuffer: async () => body.slice().buffer });
        }, net.latencyMs);
        init.signal.addEventListener('abort', () => {
          clearTimeout(t);
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    },
  };
  return net;
}

export interface FakePool extends Pool {
  jobs: Omit<WorkJob, 'id'>[];
  disposed: boolean;
}

/**
 * Fragments to report per piece tile. A fragment fully inside its tile becomes
 * a detection as soon as that tile is merged.
 */
export function fakePool(fragments: (tile: TileCoord) => TileDetection[] = () => [], workMs = 10): () => FakePool {
  return () => {
    const pool: FakePool = {
      size: 2,
      jobs: [],
      disposed: false,
      run(job) {
        pool.jobs.push(job);
        return new Promise<WorkResult>((resolve, reject) => {
          setTimeout(() => {
            if (pool.disposed) {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
              return;
            }
            const marker = new Uint8Array(job.bytes)[2];
            const base = { id: 0, scanId: job.scanId, ms: workMs, thumbs: [] as WorkResult['thumbs'] };
            if (marker !== 1) {
              resolve({ ...base, noData: 'blank', pieces: [] });
              return;
            }
            if (job.probe) {
              resolve({ ...base, noData: null, pieces: [] });
              return;
            }
            const pieces = pieceTiles(job.tile, job.tilePx, 'v1').map((t) => ({ tile: t, detections: fragments(t) }));
            const thumbs = job.thumbs
              ? pieces.flatMap((p) =>
                  p.detections.map((d) => ({
                    key: `${d.tile.z}/${d.tile.x}/${d.tile.y}:${d.bboxPx.minX},${d.bboxPx.minY}`,
                    blob: new Blob(['thumb']),
                  })),
                )
              : [];
            resolve({ ...base, noData: null, pieces, thumbs });
          }, workMs);
        });
      },
      dispose() {
        pool.disposed = true;
      },
    };
    return pool;
  };
}

/** One pool-sized fragment in the middle of every tile whose x is even. */
export function poolsOnEvenColumns(tile: TileCoord): TileDetection[] {
  if (tile.x % 2 !== 0) return [];
  return [makeFragment(tile, { x: 100, y: 100, w: 40, h: 20 })];
}

export function memoryStore(): PersistentTileStore & { data: Map<string, Uint8Array>; set: ReturnType<typeof vi.fn> } {
  const data = new Map<string, Uint8Array>();
  const store = {
    data,
    get: vi.fn(async (url: string) => data.get(url)),
    set: vi.fn(async (url: string, bytes: Uint8Array) => {
      data.set(url, bytes);
    }),
    clear: vi.fn(async () => data.clear()),
  };
  return store;
}

export interface Rig {
  net: FakeNet;
  persistent: ReturnType<typeof memoryStore>;
  cache: TileCache;
  saved: SavedScan[];
  pools: FakePool[];
  deps: ControllerDeps;
}

export function rig(opts: { fragments?: (t: TileCoord) => TileDetection[]; latencyMs?: number; workMs?: number; halo?: number; detectorId?: string } = {}): Rig {
  const net = fakeNet(opts.latencyMs ?? 30);
  const persistent = memoryStore();
  const cache = new TileCache(persistent);
  const saved: SavedScan[] = [];
  const pools: FakePool[] = [];
  const make = fakePool(opts.fragments, opts.workMs ?? 10);
  return {
    net,
    persistent,
    cache,
    saved,
    pools,
    deps: {
      makePool: () => {
        const p = make();
        pools.push(p);
        return p;
      },
      fetch: net.fetch,
      cache,
      save: async (rec) => {
        saved.push(rec);
        return [{ id: rec.id, savedAt: rec.savedAt, name: rec.name, pools: rec.detections.length, areaM2: 0, zoom: rec.zoom }];
      },
      dates: false,
      halo: opts.halo ?? 0,
      detectorId: opts.detectorId ?? 'v1',
    },
  };
}

/** Largest number of request starts inside any window of `ms` (half open). */
export function maxInWindow(times: number[], ms = 1000): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[i] - t[j] >= ms) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

/** Network calls for imagery only (not capture-date lookups). */
export function tileCalls(net: FakeNet): FetchCall[] {
  return net.calls.filter((c) => !c.url.includes('/query?') && !c.url.includes('GetFeatureInfo'));
}
