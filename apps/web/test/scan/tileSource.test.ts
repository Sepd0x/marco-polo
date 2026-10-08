import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../../src/scan/pacer.js';
import { fetchTile, looksLikeImage, TileCache } from '../../src/scan/tileSource.js';
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
