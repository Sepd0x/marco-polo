import { describe, expect, it } from 'vitest';
import { progressMessage, startAnnouncer } from '../../src/scan/announce.js';
import { INITIAL, resetStore } from './harness.js';
import { useStore } from '../../src/state/store.js';

const stats = (done: number, total = 100, extra = {}) => ({ ...INITIAL.stats, tilesDone: done, tilesTotal: total, ...extra });

describe('progress announcements', () => {
  it('speaks at the start, each quarter, pause, resume and the end', () => {
    const m = (prev: Parameters<typeof progressMessage>[0], next: Parameters<typeof progressMessage>[1]) => progressMessage(prev, next);
    expect(m({ phase: 'ready', stats: stats(0) }, { phase: 'scanning', stats: stats(0), pools: 0, sources: ['DGT Ortos2025'] })).toBe(
      'Scan started: 100 tiles on DGT Ortos2025.',
    );
    expect(m({ phase: 'scanning', stats: stats(24) }, { phase: 'scanning', stats: stats(25), pools: 3, sources: [] })).toBe('25% scanned, 3 pools so far.');
    expect(m({ phase: 'scanning', stats: stats(25) }, { phase: 'scanning', stats: stats(26), pools: 3, sources: [] })).toBeNull();
    expect(m({ phase: 'scanning', stats: stats(40) }, { phase: 'paused', stats: stats(40), pools: 3, sources: [] })).toBe('Scan paused at 40%.');
    expect(m({ phase: 'paused', stats: stats(40) }, { phase: 'scanning', stats: stats(40), pools: 3, sources: [] })).toBe('Scan resumed.');
    expect(
      m({ phase: 'scanning', stats: stats(99) }, { phase: 'complete', stats: stats(100, 100, { tilesFailed: 2, tilesNoCoverage: 1 }), pools: 1, sources: [] }),
    ).toBe('Scan complete: 1 pool found, 2 tiles failed, 1 tile without imagery.');
  });

  it('says "Scan failed" with the retry hint when every tile failed, not "Scan complete"', () => {
    const m = progressMessage;
    const all = stats(6, 6, { tilesFailed: 6 });
    const failed = m({ phase: 'scanning', stats: stats(5, 6, { tilesFailed: 5 }) }, { phase: 'complete', stats: all, pools: 0, sources: [] });
    expect(failed).toBe('Scan failed. No tile could be loaded. Check your connection, then retry.');
    expect(failed).not.toMatch(/complete/i);
    // Tiles the source had no imagery for do not make a failed scan complete either.
    expect(
      m({ phase: 'scanning', stats: stats(5, 6) }, { phase: 'complete', stats: stats(6, 6, { tilesFailed: 4, tilesNoCoverage: 2 }), pools: 0, sources: [], noCoverage: 2 }),
    ).toMatch(/^Scan failed/);
    // Offline: the cause and the way out.
    expect(m({ phase: 'scanning', stats: stats(5, 6) }, { phase: 'complete', stats: all, pools: 0, sources: [], offline: true })).toBe(
      'Scan failed. Your device is offline. The scan resumes when you are back online, or retry now.',
    );
    // A scan with some tiles read is complete, with the failures counted.
    expect(m({ phase: 'scanning', stats: stats(5, 6) }, { phase: 'complete', stats: stats(6, 6, { tilesFailed: 5 }), pools: 0, sources: [] })).toBe(
      'Scan complete: 0 pools found, 5 tiles failed.',
    );
    // A stopped scan is stopped, whatever failed.
    expect(m({ phase: 'scanning', stats: stats(3, 6, { tilesFailed: 3 }) }, { phase: 'complete', stats: stats(3, 6, { tilesFailed: 3, stopped: true }), pools: 0, sources: [] })).toMatch(
      /^Scan stopped/,
    );
  });

  it('reads a failed scan from the store the way the summary shows it', () => {
    resetStore();
    const stop = startAnnouncer();
    const region = document.querySelector('[role="status"]')!;
    const s = useStore.getState();
    s.beginScan('scan-f', { parts: [], areaM2: 0 });
    useStore.setState({ stats: { ...useStore.getState().stats, tilesTotal: 4, tilesDone: 4, tilesFailed: 4 } });
    useStore.getState().finishScan('scan-f', { offline: true });
    expect(region.textContent).toMatch(/^Scan failed\. Your device is offline/);
    stop();
  });

  it('mounts one polite status region and fills it from the store', () => {
    resetStore();
    const stop = startAnnouncer();
    expect(startAnnouncer()).toBe(stop);
    const region = document.querySelector('[role="status"][aria-live="polite"]')!;
    expect(region).not.toBeNull();
    useStore.getState().beginScan('scan-a', { parts: [], areaM2: 0 });
    expect(region.textContent).toMatch(/^Scan started/);
    stop();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
