import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pointInRing, splitPlanBySource, tileRequest, DGT_ORTOS2025, ESRI_WORLD_IMAGERY, type TileCoord } from '@marco-polo/core';
import { ScanController, type ScanRequest } from '../../src/scan/controller.js';
import { useStore, visibleRanked } from '../../src/state/store.js';
import { maxInWindow, poolsOnEvenColumns, PT_AREA, resetStore, rig, square, tileBody, tileCalls, US_AREA } from './harness.js';
import { makeFragment } from '../../../../packages/core/test/helpers.js';

function request(area = US_AREA, over: Partial<ScanRequest> = {}): ScanRequest {
  return { area, setting: { mode: 'auto' }, order: 'serpentine', ratePerSec: 5, ...over };
}

function start(c: ScanController): Promise<void> {
  useStore.getState().setArea(c.request.area);
  return c.start();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scan controller', () => {
  it('scans every tile of an Esri area and archives the result', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    const s = useStore.getState();
    const tiles = splitPlanBySource(US_AREA).parts[0].plan.tiles.length;
    expect(s.phase).toBe('complete');
    expect(s.stats.tilesTotal).toBe(tiles);
    expect(s.stats.tilesDone).toBe(tiles);
    expect(s.stats.tilesFailed).toBe(0);
    expect(s.parts.map((p) => p.providerId)).toEqual(['esri-world-imagery']);
    expect(s.ranked.length).toBeGreaterThan(0);
    // Ids carry the scan and the part.
    for (const d of s.ranked) expect(d.id.startsWith(`${c.scanId}:p1:`)).toBe(true);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0].id).toBe(c.scanId);
    expect(r.saved[0].parts?.[0].providerName).toBe('Esri World Imagery');
    // The archive list counts what the panel lists, not every detection.
    expect(r.saved[0].listed).toBe(visibleRanked(useStore.getState()).length);
    expect(r.pools[0].disposed).toBe(true);
  });

  it('never stores Esri tiles in IndexedDB, and stores DGT tiles there', async () => {
    const r = rig();
    const esri = new ScanController(request(US_AREA), r.deps);
    const d1 = start(esri);
    await vi.advanceTimersByTimeAsync(60_000);
    await d1;
    expect(tileCalls(r.net).length).toBeGreaterThan(0);
    expect(r.persistent.set).not.toHaveBeenCalled();

    const dgt = new ScanController(request(PT_AREA), r.deps);
    const d2 = start(dgt);
    await vi.advanceTimersByTimeAsync(60_000);
    await d2;
    expect(useStore.getState().parts[0].providerId).toBe('dgt-ortos2025');
    expect(r.persistent.set).toHaveBeenCalled();
    for (const [url] of r.persistent.set.mock.calls) expect(String(url)).toContain('dgterritorio');
  });

  it('keeps request starts at or under the rate with cache hits, retries and halo neighbours mixed in', async () => {
    const r = rig({ halo: 48, detectorId: 'v2-test', latencyMs: 5, workMs: 1 });
    // Half the tiles are already in the session cache (memory); every third request fails twice first.
    const plan = splitPlanBySource(US_AREA).parts[0].plan.tiles;
    let i = 0;
    for (const t of plan) {
      if (i++ % 2 === 0) await r.cache.put('session', tileRequest(ESRI_WORLD_IMAGERY, t.tile).url, tileBody());
    }
    let n = 0;
    r.net.respond = (_url, attempt) => (n++ % 3 === 0 && attempt <= 2 ? { status: 503 } : { status: 200 });
    // Esri is an http-policy source; serve the cached half by pretending it is session-cached.
    const c = new ScanController(request(US_AREA, { ratePerSec: 5 }), {
      ...r.deps,
      cache: {
        get: (_p: string, url: string) => r.cache.get('session', url),
        put: async () => {},
        clear: async () => {},
      } as never,
    });
    const done = start(c);
    await vi.advanceTimersByTimeAsync(600_000);
    await done;
    const times = r.net.calls.map((x) => x.at);
    expect(times.length).toBeGreaterThan(plan.length / 2);
    expect(maxInWindow(times, 1000)).toBeLessThanOrEqual(5);
    // Starts are never closer than 1000 / rate.
    const sorted = [...times].sort((a, b) => a - b);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k] - sorted[k - 1]).toBeGreaterThanOrEqual(200);
    expect(useStore.getState().stats.tilesFailed).toBe(0);
  });

  it('holds the source ceiling below the asked rate (DGT 4/s)', async () => {
    const r = rig({ latencyMs: 1, workMs: 1 });
    const c = new ScanController(request(PT_AREA, { ratePerSec: 10 }), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(120_000);
    await done;
    expect(maxInWindow(tileCalls(r.net).map((x) => x.at))).toBeLessThanOrEqual(DGT_ORTOS2025.rate.maxPerSec);
  });

  it('pauses a rescan served from the cache', async () => {
    const r = rig({ workMs: 5 });
    // First pass fills the persistent cache (DGT is an open source).
    const area = square(41.5725, -8.378, 700);
    const first = new ScanController(request(area), r.deps);
    const d1 = start(first);
    await vi.advanceTimersByTimeAsync(120_000);
    await d1;
    const total = useStore.getState().stats.tilesTotal;
    expect(total).toBeGreaterThan(20);
    const requests = r.net.calls.length;

    const again = new ScanController(request(area), r.deps);
    const d2 = start(again);
    while (useStore.getState().stats.tilesDone < 5) await vi.advanceTimersByTimeAsync(1);
    again.pause();
    const atPause = useStore.getState().stats.tilesDone;
    await vi.advanceTimersByTimeAsync(30_000);
    const s = useStore.getState();
    expect(s.phase).toBe('paused');
    // Only work already handed to a worker may land after the pause.
    expect(s.stats.tilesDone).toBeLessThanOrEqual(atPause + 4);
    expect(s.stats.tilesDone).toBeLessThan(total);
    again.resume();
    await vi.advanceTimersByTimeAsync(30_000);
    await d2;
    expect(useStore.getState().stats.tilesDone).toBe(total);
    // The rescan made no network request.
    expect(r.net.calls.length).toBe(requests);
  });

  it('a paused scan asks the network for nothing', async () => {
    const r = rig();
    const c = new ScanController(request(), r.deps);
    void start(c);
    await vi.advanceTimersByTimeAsync(700);
    c.pause();
    await vi.advanceTimersByTimeAsync(100);
    const before = r.net.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.net.calls.length).toBe(before);
    c.dispose();
  });

  it('reports tiles without imagery as no coverage, not as failed or empty of pools', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const plan = splitPlanBySource(US_AREA).parts[0].plan.tiles;
    const missing = tileRequest(ESRI_WORLD_IMAGERY, plan[1].tile).url;
    const blank = tileRequest(ESRI_WORLD_IMAGERY, plan[2].tile).url;
    r.net.respond = (url) => (url === missing ? { status: 404 } : url === blank ? { status: 200, body: tileBody('blank') } : { status: 200 });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    const s = useStore.getState();
    expect(s.stats.tilesNoCoverage).toBe(2);
    expect(s.stats.tilesFailed).toBe(0);
    expect(s.noCoverageTiles.map((t) => t.index).sort()).toEqual([1, 2]);
    expect(s.parts[0].tilesNoCoverage).toBe(2);
  });

  it('lists failed tiles and scans only those again on retry', async () => {
    const r = rig({ fragments: () => [] });
    const plan = splitPlanBySource(US_AREA).parts[0].plan.tiles;
    const bad = tileRequest(ESRI_WORLD_IMAGERY, plan[3].tile).url;
    let broken = true;
    r.net.respond = (url) => (url === bad && broken ? { status: 500 } : { status: 200 });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(120_000);
    await done;
    let s = useStore.getState();
    expect(s.stats.tilesFailed).toBe(1);
    expect(s.failedTiles.map((t) => t.index)).toEqual([3]);
    // Four attempts, all through the bucket.
    expect(r.net.calls.filter((x) => x.url === bad)).toHaveLength(4);

    broken = false;
    const before = r.net.calls.length;
    const again = c.retryFailed();
    expect(useStore.getState().phase).toBe('scanning');
    await vi.advanceTimersByTimeAsync(10_000);
    await again;
    s = useStore.getState();
    expect(s.phase).toBe('complete');
    expect(s.stats.tilesFailed).toBe(0);
    expect(s.failedTiles).toEqual([]);
    expect(s.stats.tilesDone).toBe(plan.length);
    expect(r.net.calls.slice(before).map((x) => x.url)).toEqual([bad]);
    expect(r.saved).toHaveLength(2);
  });

  it('a 403 fails the tile at once, without retries', async () => {
    const r = rig();
    const plan = splitPlanBySource(US_AREA).parts[0].plan.tiles;
    const bad = tileRequest(ESRI_WORLD_IMAGERY, plan[0].tile).url;
    r.net.respond = (url) => (url === bad ? { status: 403 } : { status: 200 });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(r.net.calls.filter((x) => x.url === bad).length).toBeLessThanOrEqual(2); // once as probe at most, once as tile
    expect(useStore.getState().stats.tilesFailed).toBe(1);
  });

  it('moves a part to the next scan-allowed source when the probe finds no imagery', async () => {
    const r = rig();
    r.net.respond = (url) => (url.includes('dgterritorio') ? { status: 200, body: tileBody('blank') } : { status: 200 });
    const c = new ScanController(request(PT_AREA), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(120_000);
    await done;
    const part = useStore.getState().parts[0];
    // OrtoSat2023 is view-only, so the chain skips it.
    expect(part.providerId).toBe('esri-world-imagery');
    expect(part.fellBackFrom).toBe('DGT Ortos2025');
    expect(part.zoom).toBe(19);
    expect(tileCalls(r.net).filter((x) => x.url.includes('dgterritorio'))).toHaveLength(5);
  });

  it('keeps the source when its probe gets no answer, so the tiles can be retried there', async () => {
    const r = rig();
    r.net.respond = (url) => (url.includes('dgterritorio') ? { status: 500 } : { status: 200 });
    const c = new ScanController(request(PT_AREA), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(600_000);
    await done;
    const s = useStore.getState();
    expect(s.parts[0].providerId).toBe('dgt-ortos2025');
    expect(s.parts[0].fellBackFrom).toBeNull();
    expect(s.stats.tilesFailed).toBe(s.stats.tilesTotal);
  });

  it('lists only pools whose centre is inside the drawn area', async () => {
    const everywhere = (t: TileCoord) => [makeFragment(t, { x: 100, y: 100, w: 40, h: 20 })];
    const r = rig({ fragments: everywhere });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    const tiles = splitPlanBySource(US_AREA).parts[0].plan.tiles;
    const inside = tiles.filter((t) => {
      const ctr = everywhere(t.tile)[0].center;
      return pointInRing(ctr.lon, ctr.lat, US_AREA);
    });
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.length).toBeLessThan(tiles.length);
    const ranked = useStore.getState().ranked;
    expect(ranked).toHaveLength(inside.length);
    for (const d of ranked) expect(pointInRing(d.center.lon, d.center.lat, US_AREA)).toBe(true);
  });

  it('keeps a fixed source even when its sample is empty', async () => {
    const r = rig();
    r.net.respond = () => ({ status: 200, body: tileBody('blank') });
    const c = new ScanController(request(US_AREA, { setting: { mode: 'fixed', providerId: 'esri-world-imagery' } }), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    const s = useStore.getState();
    expect(s.parts[0].providerId).toBe('esri-world-imagery');
    expect(s.stats.tilesNoCoverage).toBe(s.stats.tilesTotal);
  });

  it('splits an area across a border into one part per source', async () => {
    const r = rig();
    const border = square(42.045, -8.645, 300);
    const split = splitPlanBySource(border);
    expect(split.parts.map((p) => p.provider.id).sort()).toEqual(['dgt-ortos2025', 'pnoa']);
    const c = new ScanController(request(border, { ratePerSec: 10 }), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(600_000);
    await done;
    const s = useStore.getState();
    expect(s.parts.map((p) => p.providerId).sort()).toEqual(['dgt-ortos2025', 'pnoa']);
    expect(s.parts.every((p) => p.status === 'done')).toBe(true);
    expect(s.stats.tilesDone).toBe(split.parts.reduce((n, p) => n + p.plan.tiles.length, 0));
  });

  it('refuses an area above the tile limit without a single request', async () => {
    const r = rig();
    const c = new ScanController(request(square(40.4, -3.7, 30_000)), r.deps);
    await start(c);
    const s = useStore.getState();
    expect(s.scanError).toMatch(/above the limit/);
    expect(s.phase).toBe('ready');
    expect(r.net.calls).toHaveLength(0);
    expect(c.state).toBe('disposed');
  });

  it('stop keeps the tiles done so far and archives them as stopped', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(2_500);
    c.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    const s = useStore.getState();
    expect(s.phase).toBe('complete');
    expect(s.stats.stopped).toBe(true);
    expect(s.stats.tilesDone).toBeLessThan(s.stats.tilesTotal);
    expect(r.saved).toHaveLength(1);
    const calls = r.net.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.net.calls.length).toBe(calls);
  });

  it('stop finishes even when the detection workers never answer', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const make = r.deps.makePool;
    // Workers that never load: their jobs neither resolve nor reject.
    r.deps.makePool = () => ({ ...make(), run: () => new Promise<never>(() => {}) });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(3_000);
    c.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    let settled = false;
    void done.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(useStore.getState().phase).toBe('complete');
    expect(useStore.getState().stats.stopped).toBe(true);
  });

  it('dispose stops all traffic and writes nothing more', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(1_500);
    const before = useStore.getState();
    c.dispose();
    const calls = r.net.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(r.net.calls.length).toBe(calls);
    expect(useStore.getState().stats).toBe(before.stats);
    expect(r.saved).toHaveLength(0);
    expect(r.pools[0].disposed).toBe(true);
  });

  it('sends thumbnails only for fragments that lead a detection', async () => {
    const r = rig({ fragments: poolsOnEvenColumns });
    const c = new ScanController(request(), r.deps);
    const done = start(c);
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    const s = useStore.getState();
    const keys = Object.keys(s.thumbBlobs);
    expect(keys.length).toBe(s.ranked.length);
    for (const d of s.ranked) {
      expect(keys).toContain(`${d.primary.tile.z}/${d.primary.tile.x}/${d.primary.tile.y}:${d.primary.bboxPx.minX},${d.primary.bboxPx.minY}`);
    }
  });

  it('ignores late answers once another scan owns the store', async () => {
    const r = rig({ fragments: poolsOnEvenColumns, workMs: 400 });
    const c = new ScanController(request(), r.deps);
    void start(c);
    await vi.advanceTimersByTimeAsync(900);
    // Another scan takes the store while jobs are in the workers.
    useStore.getState().beginScan('scan-other', { parts: [], areaM2: 0 });
    const snapshot = useStore.getState();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useStore.getState().stats).toBe(snapshot.stats);
    expect(useStore.getState().detections).toEqual({});
    c.dispose();
  });
});
