import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../src/state/store.js';
import { cancelScan, currentScan, pauseScan, resumeScan, retryFailed, setScanDeps, startScan } from '../../src/scan/session.js';
import { poolsOnEvenColumns, resetStore, rig, US_AREA, US_TILE, type Rig } from './harness.js';
import { makeFragment } from '../../../../packages/core/test/helpers.js';
import { DetectionMerger } from '@marco-polo/core';

let r: Rig;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  r = rig({ fragments: poolsOnEvenColumns });
  setScanDeps(() => r.deps);
  useStore.getState().setArea(US_AREA);
});

afterEach(() => {
  currentScan()?.dispose();
  setScanDeps(null);
  vi.useRealTimers();
});

function archived() {
  const tile = US_TILE;
  const m = new DetectionMerger({}, [tile]);
  m.addTileDetections(tile, [makeFragment(tile, { x: 100, y: 100, w: 40, h: 20 })]);
  return { id: 'scan-old', name: 'Old scan', area: US_AREA, detections: m.getAll(), thumbs: {}, stats: { tilesTotal: 1, tilesDone: 1 } };
}

describe('scan session', () => {
  it('opening the archive during a scan cancels it, and the archived scan stays intact', async () => {
    void startScan();
    await vi.advanceTimersByTimeAsync(2_000);
    const running = currentScan()!;
    expect(useStore.getState().phase).toBe('scanning');
    const old = archived();
    useStore.getState().loadArchived(old);
    expect(running.state).toBe('disposed');
    expect(currentScan()).toBeNull();
    const calls = r.net.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    const s = useStore.getState();
    expect(r.net.calls.length).toBe(calls);
    expect(s.scanId).toBe('scan-old');
    expect(s.phase).toBe('complete');
    expect(Object.keys(s.detections)).toEqual(old.detections.map((d) => d.id));
    expect(s.stats.tilesDone).toBe(1);
    // Nothing was archived over it.
    expect(r.saved).toHaveLength(0);
  });

  it('reset during a scan cancels it and leaves an empty store', async () => {
    void startScan();
    await vi.advanceTimersByTimeAsync(2_000);
    const running = currentScan()!;
    useStore.getState().resetScan();
    expect(running.state).toBe('disposed');
    const calls = r.net.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    const s = useStore.getState();
    expect(r.net.calls.length).toBe(calls);
    expect(s.phase).toBe('idle');
    expect(s.detections).toEqual({});
    expect(s.stats.tilesDone).toBe(0);
    expect(r.saved).toHaveLength(0);
  });

  it('a second start disposes the first scan', async () => {
    void startScan();
    await vi.advanceTimersByTimeAsync(1_000);
    const first = currentScan()!;
    // From the complete or ready state a new scan may start; here the store is forced back to ready.
    first.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    void startScan();
    expect(first.state === 'disposed' || first.state === 'done').toBe(true);
    expect(currentScan()).not.toBe(first);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useStore.getState().scanId).toBe(currentScan()!.scanId);
  });

  it('pause, resume, stop and retry go through the one controller', async () => {
    void startScan();
    await vi.advanceTimersByTimeAsync(800);
    pauseScan();
    expect(useStore.getState().phase).toBe('paused');
    resumeScan();
    expect(useStore.getState().phase).toBe('scanning');
    cancelScan();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useStore.getState().phase).toBe('complete');
    expect(useStore.getState().stats.stopped).toBe(true);
    // Nothing failed, so retry does nothing.
    await retryFailed();
    expect(useStore.getState().phase).toBe('complete');
  });
});
