import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionMerger, type ScanTile } from '@marco-polo/core';
import { scanSetting, thresholdCounts, useStore, visibleRanked } from '../../src/state/store.js';
import { PT_AREA, resetStore, square, US_AREA, US_TILE } from '../scan/harness.js';
import { makeFragment } from '../../../../packages/core/test/helpers.js';

beforeEach(() => {
  resetStore();
});

const tile = US_TILE;
const scanTile: ScanTile = { tile, bbox: { west: 0, south: 0, east: 1, north: 1 }, index: 0 };

function begin(id = 'scan-a') {
  useStore.getState().beginScan(id, {
    parts: [
      {
        id: 'p1', providerId: 'esri-world-imagery', providerName: 'Esri World Imagery', attribution: 'a', licence: 'l',
        date: null, zoom: 19, nativeResM: null, tiles: [scanTile], tilesDone: 0, tilesFailed: 0, tilesNoCoverage: 0,
        areaM2: 100, status: 'scanning', fellBackFrom: null,
      },
    ],
    areaM2: 100,
  });
}

function events() {
  const m = new DetectionMerger({}, [tile]);
  return m.addTileDetections(tile, [makeFragment(tile, { x: 100, y: 100, w: 40, h: 20 })]);
}

describe('store', () => {
  it('does not set state for a batch without events', () => {
    begin();
    const listener = vi.fn();
    const unsub = useStore.subscribe(listener);
    useStore.getState().applyMergerEvents('scan-a', []);
    useStore.getState().applyMergerEvents('scan-a', [], {});
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('a tile without events leaves detections and ranking untouched', () => {
    begin();
    useStore.getState().tileFinished('scan-a', {
      partId: 'p1', tile: scanTile, outcome: 'done', events: events(), scannedAreaM2: 10, etaMs: null, waterFiltered: 0,
    });
    const before = useStore.getState();
    const ranked = vi.fn();
    const unsub = useStore.subscribe((s) => s.ranked, ranked);
    useStore.getState().tileFinished('scan-a', {
      partId: 'p1', tile: scanTile, outcome: 'done', events: [], scannedAreaM2: 10, etaMs: null, waterFiltered: 0,
    });
    const after = useStore.getState();
    expect(ranked).not.toHaveBeenCalled();
    expect(after.ranked).toBe(before.ranked);
    expect(after.detections).toBe(before.detections);
    expect(after.thumbs).toBe(before.thumbs);
    expect(after.stats.tilesDone).toBe(2);
    unsub();
  });

  it('ignores writes for any scan but the current one', () => {
    begin('scan-a');
    const s0 = useStore.getState();
    useStore.getState().tileFinished('scan-b', {
      partId: 'p1', tile: scanTile, outcome: 'done', events: events(), scannedAreaM2: 10, etaMs: null, waterFiltered: 0,
    });
    useStore.getState().setScanPhase('scan-b', 'complete');
    useStore.getState().finishScan('scan-b');
    useStore.getState().tickElapsed('scan-b');
    expect(useStore.getState()).toBe(s0);
  });

  it('no clock tick when no scan is running', () => {
    const listener = vi.fn();
    const unsub = useStore.subscribe(listener);
    useStore.getState().tickElapsed('scan-x');
    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it('counts detections above and below the confidence filter', () => {
    begin();
    useStore.getState().applyMergerEvents('scan-a', events());
    const s = useStore.getState();
    const conf = s.ranked[0].confidence;
    expect(thresholdCounts({ ranked: s.ranked, settings: { ...s.settings, minConfidence: conf } })).toEqual({ above: 1, below: 0 });
    expect(thresholdCounts({ ranked: s.ranked, settings: { ...s.settings, minConfidence: conf + 0.01 } })).toEqual({ above: 0, below: 1 });
    expect(visibleRanked({ ranked: s.ranked, settings: { ...s.settings, minConfidence: 0 } })).toHaveLength(1);
  });

  it('measures a drawn area per source, ignoring the zoom setting', () => {
    useStore.getState().updateSettings({ zoom: 17 });
    useStore.getState().setArea(PT_AREA, { count: 1, approximate: false });
    const s = useStore.getState();
    expect(s.phase).toBe('ready');
    expect(s.planEstimate?.parts.map((p) => p.providerId)).toEqual(['dgt-ortos2025']);
    expect(s.areaEstimate?.count).toBe(s.planEstimate?.z19Tiles);
    expect(s.areaEstimate?.count).toBeGreaterThan(1);
  });

  it('flags an area over the limit as blocked', () => {
    useStore.getState().setArea(square(40.4, -3.7, 30_000));
    expect(useStore.getState().planEstimate?.level).toBe('block');
  });

  it('refuses a new area while a scan runs', () => {
    useStore.getState().setArea(US_AREA);
    begin();
    useStore.getState().setArea(PT_AREA);
    expect(useStore.getState().area).toBe(US_AREA);
    expect(useStore.getState().scanId).toBe('scan-a');
  });

  it('a link source applies to that area only and falls back to auto when it does not cover it', () => {
    useStore.getState().setArea(US_AREA, null, { source: 'pnoa' });
    expect(useStore.getState().areaSource).toBeNull();
    useStore.getState().setArea(PT_AREA, null, { source: 'esri-world-imagery' });
    const s = useStore.getState();
    expect(s.areaSource).toBe('esri-world-imagery');
    expect(scanSetting(s)).toEqual({ mode: 'fixed', providerId: 'esri-world-imagery' });
    expect(s.settings.imagery).toEqual({ mode: 'auto' });
  });

  it('opening an archived scan of an older build keeps its data URL thumbnails', () => {
    useStore.getState().loadArchived({
      id: 'scan-old', name: 'x', area: US_AREA, detections: [], thumbs: { k: 'data:image/png;base64,AAAA' }, stats: { tilesDone: 3 },
    });
    const s = useStore.getState();
    expect(s.thumbs.k).toBe('data:image/png;base64,AAAA');
    expect(s.stats.tilesDone).toBe(3);
    expect(s.stats.tilesFailed).toBe(0);
    expect(s.parts).toEqual([]);
  });
});
