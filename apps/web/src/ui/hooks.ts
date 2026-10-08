import { useEffect, useMemo, useState } from 'react';
import { on } from '../lib/bus.js';
import { useStore } from '../state/store.js';
import { resolveImagery } from '../lib/imagery.js';
import { areaFacts, newestId, scannedSources, splitByScore, type AreaFacts, type SourceFacts } from './model.js';
import { provenanceOf, type RankedDetection, type ScanPartSummary } from '@marco-polo/core';

export const PHONE_QUERY = '(max-width: 700px)';

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
  newest: string | null;
}

/** The single list every count in the interface comes from. */
export function usePools(): PoolsView {
  const ranked = useStore((s) => s.ranked);
  const minScore = useStore((s) => s.settings.minConfidence);
  const showHotTubs = useStore((s) => s.settings.showHotTubs);
  const phase = useStore((s) => s.phase);
  const planTiles = useStore((s) => s.planTiles);
  return useMemo(() => {
    const { shown, below, lowestBelow } = splitByScore(ranked, minScore, showHotTubs);
    const live = phase === 'scanning' || phase === 'paused';
    return { shown, below, lowestBelow, newest: live ? newestId(shown, planTiles) : null };
  }, [ranked, minScore, showHotTubs, phase, planTiles]);
}

/**
 * Sources the current scan used. A scan that reports its parts is read from
 * them; otherwise it is the single source the scan was started on.
 */
export function useScanSources(): SourceFacts[] {
  const parts = useStore((s) => (s as { parts?: ScanPartSummary[] }).parts);
  const planTiles = useStore((s) => s.planTiles);
  const imagery = useStore((s) => s.settings.imagery);
  const rate = useStore((s) => s.settings.ratePerSec);
  return useMemo(() => {
    if (parts && parts.length) return scannedSources(parts, rate);
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
