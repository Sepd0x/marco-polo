import { useEffect, useMemo, useState } from 'react';
import { on } from '../lib/bus.js';
import { useStore } from '../state/store.js';
import { resolveImagery } from '../lib/imagery.js';
import { areaFacts, newestId, scannedSources, splitByScore, type AreaFacts, type SourceFacts } from './model.js';
import { partSummary, provenanceOf, type RankedDetection } from '@marco-polo/core';
import { partProvenance } from '../lib/export.js';
import { cutoffFn } from '../lib/score.js';

import { PHONE_QUERY } from '../lib/media.js';

export { PHONE_QUERY };

function matches(query: string): boolean {
  try {
    return globalThis.matchMedia?.(query).matches ?? false;
  } catch {
    return false;
  }
}

export function useMedia(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try {
      mq = globalThis.matchMedia?.(query);
    } catch {
      return;
    }
    if (!mq) return;
    const onChange = () => setValue(mq!.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq!.removeEventListener?.('change', onChange);
  }, [query]);
  return value;
}

export const useIsPhone = () => useMedia(PHONE_QUERY);

export type MapViewState = { bbox: [number, number, number, number]; zoom: number } | null;

let lastView: MapViewState = null;
on('view', (v) => {
  lastView = v;
});

/** The settled map view, shared by the map through the bus. */
export function useMapView(): MapViewState {
  const [view, setView] = useState<MapViewState>(lastView);
  useEffect(() => on('view', setView), []);
  return view;
}

export interface PoolsView {
  /** Pools at or above the minimum score, ranked largest first. */
  shown: RankedDetection[];
  below: number;
  lowestBelow: number | null;
  /** Pools below the minimum, for the histogram; never listed. */
  under: RankedDetection[];
  newest: string | null;
}

/** The single list every count in the interface comes from. */
export function usePools(): PoolsView {
  const ranked = useStore((s) => s.ranked);
  const minScore = useStore((s) => s.settings.minConfidence);
  const recommended = useStore((s) => s.settings.recommendedScore);
  const showHotTubs = useStore((s) => s.settings.showHotTubs);
  const parts = useStore((s) => s.parts);
  const phase = useStore((s) => s.phase);
  const planTiles = useStore((s) => s.planTiles);
  return useMemo(() => {
    const cut = cutoffFn({ minConfidence: minScore, recommendedScore: recommended }, parts);
    const { shown, below, lowestBelow, under } = splitByScore(ranked, cut, showHotTubs);
    const live = phase === 'scanning' || phase === 'paused';
    return { shown, below, lowestBelow, under, newest: live ? newestId(shown, planTiles) : null };
  }, [ranked, minScore, recommended, showHotTubs, parts, phase, planTiles]);
}

/**
 * Sources the current scan used. A scan that reports its parts is read from
 * them; otherwise it is the single source the scan was started on.
 */
export function useScanSources(): SourceFacts[] {
  const parts = useStore((s) => s.parts);
  const planTiles = useStore((s) => s.planTiles);
  const imagery = useStore((s) => s.settings.imagery);
  const rate = useStore((s) => s.settings.ratePerSec);
  return useMemo(() => {
    if (parts.length) {
      return scannedSources(
        parts.map((p) =>
          // Archived parts keep counts, not their tile list.
          partSummary(p.id, partProvenance(p), p.tiles.length || p.tilesDone + p.tilesFailed + p.tilesNoCoverage, p.tilesNoCoverage, p.areaM2),
        ),
        rate,
      );
    }
    const p = resolveImagery(imagery);
    const zoom = planTiles?.[0]?.tile.z ?? p.maxZoom;
    return scannedSources(
      [
        {
          id: 'main',
          provenance: provenanceOf(p, 'main', zoom, null),
          tiles: planTiles?.length ?? 0,
          tilesNoCoverage: Number.NaN,
          areaM2: 0,
        },
      ],
      rate,
    ).map((s) => ({ ...s, noCoverage: null }));
  }, [parts, planTiles, imagery, rate]);
}

/** Facts about the drawn area, before and during a scan. */
export function useAreaFacts(): AreaFacts | null {
  const area = useStore((s) => s.area);
  const imagery = useStore((s) => s.settings.imagery);
  const rate = useStore((s) => s.settings.ratePerSec);
  return useMemo(() => (area ? areaFacts(area, imagery, rate) : null), [area, imagery, rate]);
}

export interface TileCounts {
  total: number;
  done: number;
  failed: number;
  /** Tiles the imagery had nothing for. */
  noCoverage: number;
  /** Tiles read with imagery: done less failed and empty ones. */
  ok: number;
  missing: number;
  stopped: boolean;
}

/** A scan stopped before its first tile: nothing to filter or list. */
export function useNothingScanned(): boolean {
  const phase = useStore((s) => s.phase);
  const t = useTileCounts();
  return phase === 'complete' && t.stopped && t.done === 0;
}

/** Tile counts of the scan, the one source of every tile number in the interface. */
export function useTileCounts(): TileCounts {
  const stats = useStore((s) => s.stats);
  const sources = useScanSources();
  return useMemo(() => {
    const noCoverage = sources.reduce((a, s) => a + (s.noCoverage ?? 0), 0);
    const missing = stats.tilesFailed + noCoverage;
    return {
      total: stats.tilesTotal,
      done: stats.tilesDone,
      failed: stats.tilesFailed,
      noCoverage,
      ok: Math.max(0, stats.tilesDone - missing),
      missing,
      stopped: stats.tilesTotal > 0 && stats.tilesDone < stats.tilesTotal,
    };
  }, [stats, sources]);
}
