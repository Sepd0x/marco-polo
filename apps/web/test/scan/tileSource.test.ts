import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MirrorChoice } from '@marco-polo/core';
import { TokenBucket } from '../../src/scan/pacer.js';
import { NetworkWatch, TileOfflineError } from '../../src/scan/network.js';
import { fetchTile, looksLikeImage, TileCache, TileHttpError } from '../../src/scan/tileSource.js';
import { fakeNet, memoryStore, tileBody } from './harness.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tile fetching', () => {
  it('takes a token for every attempt, retries included', async () => {
    const net = fakeNet(5);
    net.respond = (_u, attempt) => (attempt < 3 ? { status: 503 } : { status: 200 });
    const bucket = new TokenBucket(5);
    const p = fetchTile('https://x/1', { bucket, fetch: net.fetch });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.attempts).toBe(3);
    expect(bucket.granted).toBe(3);
    expect(net.calls).toHaveLength(3);
  });

  it('falls back to the mirror when the main server fails, caches under the main URL, then asks the mirror first', async () => {
    const net = fakeNet(5);
    net.respond = (u) => (u.startsWith('https://main/') ? { status: 504 } : { status: 200 });
    const bucket = new TokenBucket(10);
    const cache = new TileCache(memoryStore());
    const mirror = new MirrorChoice();
    const p = fetchTile('https://main/1', { bucket, fetch: net.fetch, cache, policy: 'persistent', mirrorUrl: 'https://mirror/1', mirror });
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await p;
    expect(r.status).toBe(200);
    expect(net.calls.map((c) => c.url)).toEqual(['https://main/1', 'https://mirror/1']);
    expect(await cache.get('persistent', 'https://main/1')).not.toBeNull();
    const q = fetchTile('https://main/2', { bucket, fetch: net.fetch, mirrorUrl: 'https://mirror/2', mirror });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await q).attempts).toBe(1);
    expect(net.calls.at(-1)!.url).toBe('https://mirror/2');
  });

  it('answers 404 as a result (no imagery), and fails a 403 at once', async () => {
    const net = fakeNet(5);
    net.respond = (u) => (u.endsWith('404') ? { status: 404 } : { status: 403 });
    const bucket = new TokenBucket(10);
    const a = fetchTile('https://x/404', { bucket, fetch: net.fetch });
    await vi.advanceTimersByTimeAsync(100);
    expect((await a).status).toBe(404);
    const b = fetchTile('https://x/403', { bucket, fetch: net.fetch }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await b)).toContain('403');
    expect(net.calls.filter((c) => c.url.endsWith('403'))).toHaveLength(1);
  });

  describe('offline', () => {
    const down = { status: 0, networkError: true };

    it('gives up after one attempt, without backoff, while the browser says offline', async () => {
      const net = fakeNet(5);
      net.respond = () => down;
      const watch = new NetworkWatch({ online: () => false });
      const t0 = Date.now();
      const p = fetchTile('https://x/1', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await p).toBeInstanceOf(TileOfflineError);
      expect(net.calls).toHaveLength(1);
      expect(Date.now() - t0).toBeLessThan(1_001);
      // The network is closed for a spell: the next tile does not even ask.
      const q = fetchTile('https://x/2', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100);
      expect(await q).toBeInstanceOf(TileOfflineError);
      expect(net.calls).toHaveLength(1);
      // After the spell one request tests the connection again.
      await vi.advanceTimersByTimeAsync(6_000);
      const r = fetchTile('https://x/3', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await r).toBeInstanceOf(TileOfflineError);
      expect(net.calls).toHaveLength(2);
    });

    it('treats a few requests in a row with no answer as offline even when the browser says online', async () => {
      const net = fakeNet(5);
      net.respond = () => down;
      const watch = new NetworkWatch({ online: () => true });
      const t0 = Date.now();
      const p = fetchTile('https://x/1', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await p).toBeInstanceOf(TileOfflineError);
      expect(net.calls).toHaveLength(3);
      expect(Date.now() - t0).toBeLessThan(10_001);
    });

    it('rides out one dropped request, and any answer opens the network again', async () => {
      const net = fakeNet(5);
      net.respond = (_u, attempt) => (attempt === 1 ? down : { status: 200 });
      const watch = new NetworkWatch({ online: () => true });
      const p = fetchTile('https://x/1', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await p).attempts).toBe(2);
      expect(watch.blocked).toBe(false);
      // Two failures, then a 404 (an answer): the count starts again.
      watch.noAnswer();
      watch.noAnswer();
      net.respond = () => ({ status: 404 });
      const q = fetchTile('https://x/2', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch });
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await q).status).toBe(404);
      watch.noAnswer();
      expect(watch.blocked).toBe(false);
    });

    it('keeps the retries and backoff for server errors', async () => {
      const net = fakeNet(5);
      net.respond = () => ({ status: 503 });
      const watch = new NetworkWatch({ online: () => true });
      const t0 = Date.now();
      const p = fetchTile('https://x/1', { bucket: new TokenBucket(5), fetch: net.fetch, net: watch }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await p).toBeInstanceOf(TileHttpError);
      expect(net.calls).toHaveLength(4);
      expect(watch.blocked).toBe(false);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(3_500);
    });
  });

  it('serves cache hits without a token or a request', async () => {
    const net = fakeNet(5);
    const store = memoryStore();
    const cache = new TileCache(store);
    const bucket = new TokenBucket(5);
    const p1 = fetchTile('https://x/a', { bucket, fetch: net.fetch, cache, policy: 'persistent' });
    await vi.advanceTimersByTimeAsync(100);
    await p1;
    const hit = await fetchTile('https://x/a', { bucket, fetch: net.fetch, cache, policy: 'persistent' });
    expect(hit.cached).toBe(true);
    expect(bucket.granted).toBe(1);
    expect(net.calls).toHaveLength(1);
  });

  it('keeps tiles by the source licence: disk for persistent, memory for session, nothing for http', async () => {
    const store = memoryStore();
    const cache = new TileCache(store);
    await cache.put('persistent', 'p', tileBody());
    await cache.put('session', 's', tileBody());
    await cache.put('http', 'h', tileBody());
    expect([...store.data.keys()]).toEqual(['p']);
    expect(await cache.get('session', 's')).not.toBeNull();
    expect(await cache.get('http', 'h')).toBeNull();
    expect(await cache.get('persistent', 's')).toBeNull();
  });

  it('never caches a body that is not an image', async () => {
    const net = fakeNet(5);
    net.respond = () => ({ status: 200, body: new TextEncoder().encode('<html>error page</html>') });
    const store = memoryStore();
    const p = fetchTile('https://x/e', { bucket: new TokenBucket(5), fetch: net.fetch, cache: new TileCache(store), policy: 'persistent' });
    await vi.advanceTimersByTimeAsync(100);
    await p;
    expect(store.set).not.toHaveBeenCalled();
    expect(looksLikeImage(tileBody())).toBe(true);
  });

  it('gives up after the retries and stops at once when aborted', async () => {
    const net = fakeNet(5);
    net.respond = () => ({ status: 500 });
    const bucket = new TokenBucket(10);
    const p = fetchTile('https://x/down', { bucket, fetch: net.fetch, retries: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(String(await p)).toContain('500');
    expect(net.calls).toHaveLength(3);

    const ac = new AbortController();
    const q = fetchTile('https://x/down', { bucket, fetch: net.fetch, signal: ac.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(50);
    ac.abort();
    const err = await q;
    expect(err).toBeInstanceOf(Error);
    const calls = net.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(net.calls.length).toBe(calls);
  });
});
