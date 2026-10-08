import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../../src/scan/pacer.js';

/** Largest number of grants inside any window of `ms` (half open). */
function maxInWindow(times: number[], ms = 1000): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[i] - t[j] >= ms) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function grantTimes(bucket: TokenBucket, n: number, signal?: AbortSignal): number[] {
  const times: number[] = [];
  for (let i = 0; i < n; i++) void bucket.take(signal).then(() => times.push(Date.now()), () => {});
  return times;
}

describe('token bucket', () => {
  it('spaces grants at least 1000 / rate apart', async () => {
    const b = new TokenBucket(5);
    const times = grantTimes(b, 20);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(times).toHaveLength(20);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(200);
    expect(maxInWindow(times)).toBeLessThanOrEqual(5);
  });

  it('does not save up tokens while idle', async () => {
    const b = new TokenBucket(5);
    await vi.advanceTimersByTimeAsync(60_000);
    const times = grantTimes(b, 6);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(maxInWindow(times)).toBeLessThanOrEqual(5);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(200);
  });

  it('releases no burst after a throttled background tab', async () => {
    const b = new TokenBucket(5);
    const times = grantTimes(b, 10);
    await vi.advanceTimersByTimeAsync(250);
    // The tab goes to the background: the clock runs on, the pending timer fires late.
    vi.setSystemTime(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(times).toHaveLength(10);
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(200);
  });

  it('grants nothing while paused and resumes at the same pace', async () => {
    const b = new TokenBucket(4);
    const times = grantTimes(b, 6);
    await vi.advanceTimersByTimeAsync(300);
    const before = times.length;
    b.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(times.length).toBe(before);
    b.resume();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(times).toHaveLength(6);
    const after = times.slice(before);
    for (let i = 1; i < after.length; i++) expect(after[i] - after[i - 1]).toBeGreaterThanOrEqual(250);
  });

  it('rejects a waiter whose signal aborts, and close rejects the rest', async () => {
    const b = new TokenBucket(1);
    await b.take();
    const ac = new AbortController();
    const a = b.take(ac.signal);
    const c = b.take();
    ac.abort();
    await expect(a).rejects.toThrow();
    b.close(new Error('closed'));
    await expect(c).rejects.toThrow('closed');
  });

  it('follows a rate change at once', async () => {
    const b = new TokenBucket(2);
    const times = grantTimes(b, 5);
    await vi.advanceTimersByTimeAsync(600);
    b.setRate(10);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(times).toHaveLength(5);
    expect(times[4] - times[3]).toBeGreaterThanOrEqual(100);
    expect(times[4] - times[3]).toBeLessThan(500);
  });
});
