import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  rankDetections,
  type Detection,
  type MergerEvent,
  type RankedDetection,
  type Ring,
  type ScanTile,
  type TraversalOrder,
} from '@marco-polo/core';

export type Phase = 'idle' | 'ready' | 'scanning' | 'paused' | 'complete';
export type DrawMode = 'rect' | 'polygon' | null;

export interface Settings {
  zoom: number;
  order: TraversalOrder;
  ratePerSec: number;
  follow: boolean;
  minConfidence: number;
  showHotTubs: boolean;
  labels: boolean;
  /** Accent colour over the OLED-black base, hex. */
  accent: string;
  /** Empty = default Esri World Imagery. */
  providerTemplate: string;
}

export const DEFAULT_SETTINGS: Settings = {
  zoom: 19,
  order: 'serpentine',
  ratePerSec: 5,
  follow: true,
  minConfidence: 0.45,
  showHotTubs: true,
  labels: true,
  accent: '#35e0ff',
  providerTemplate: '',
};

const SETTINGS_KEY = 'marco-polo:settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — settings stay session-local
  }
}

export interface ScanStats {
  tilesTotal: number;
  tilesDone: number;
  tilesFailed: number;
  startedAt: number;
  elapsedMs: number;
  etaMs: number | null;
  areaM2: number;
  scannedAreaM2: number;
  waterFiltered: number;
}

const EMPTY_STATS: ScanStats = {
  tilesTotal: 0,
  tilesDone: 0,
  tilesFailed: 0,
  startedAt: 0,
  elapsedMs: 0,
  etaMs: null,
  areaM2: 0,
  scannedAreaM2: 0,
  waterFiltered: 0,
};

export interface ArchiveSummary {
  id: string;
  savedAt: number;
  name: string;
  pools: number;
  areaM2: number;
  zoom: number;
}

interface AppState {
  phase: Phase;
  drawMode: DrawMode;
  area: Ring | null;
  areaEstimate: { count: number; approximate: boolean } | null;
  settings: Settings;
  detections: Record<string, Detection>;
  ranked: RankedDetection[];
  thumbs: Record<string, string>;
  stats: ScanStats;
  planTiles: ScanTile[] | null;
  currentTile: ScanTile | null;
  lastCompleted: ScanTile | null;
  lastEvent: string | null;
  selectedId: string | null;
  archive: ArchiveSummary[];
  scanId: string | null;
  scanName: string;

  setPhase(phase: Phase): void;
  setDrawMode(mode: DrawMode): void;
  setArea(area: Ring | null, estimate?: { count: number; approximate: boolean } | null): void;
  updateSettings(patch: Partial<Settings>): void;
  select(id: string | null): void;
  setScanName(name: string): void;

  beginScan(scanId: string, planTiles: ScanTile[], areaM2: number): void;
  applyMergerEvents(events: MergerEvent[], thumbs?: Record<string, string>): void;
  tileFinished(update: {
    tile: ScanTile;
    failed: boolean;
    scannedAreaM2: number;
    etaMs: number | null;
    waterFiltered: number;
  }): void;
  setCurrentTile(tile: ScanTile | null): void;
  tickElapsed(): void;
  pushEvent(text: string): void;
  finishScan(): void;
  resetScan(): void;
  setArchive(list: ArchiveSummary[]): void;
  loadArchived(payload: {
    id: string;
    name: string;
    area: Ring;
    detections: Detection[];
    thumbs: Record<string, string>;
    stats: ScanStats;
  }): void;
}

export const useStore = create<AppState>()(subscribeWithSelector((set, get) => ({
  phase: 'idle',
  drawMode: null,
  area: null,
  areaEstimate: null,
  settings: loadSettings(),
  detections: {},
  ranked: [],
  thumbs: {},
  stats: EMPTY_STATS,
  planTiles: null,
  currentTile: null,
  lastCompleted: null,
  lastEvent: null,
  selectedId: null,
  archive: [],
  scanId: null,
  scanName: '',

  setPhase: (phase) => set({ phase }),
  setDrawMode: (drawMode) => set({ drawMode }),
  setArea: (area, estimate = null) =>
    set({
      area,
      areaEstimate: estimate,
      phase: area ? 'ready' : 'idle',
      drawMode: null,
    }),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      persistSettings(settings);
      return { settings };
    }),
  select: (selectedId) => set({ selectedId }),
  setScanName: (scanName) => set({ scanName }),

  beginScan: (scanId, planTiles, areaM2) =>
    set({
      phase: 'scanning',
      scanId,
      planTiles,
      detections: {},
      ranked: [],
      thumbs: {},
      selectedId: null,
      lastEvent: null,
      lastCompleted: null,
      stats: { ...EMPTY_STATS, tilesTotal: planTiles.length, areaM2, startedAt: Date.now() },
    }),

  applyMergerEvents: (events, thumbs) =>
    set((s) => {
      if (events.length === 0 && !thumbs) return {};
      const detections = { ...s.detections };
      for (const e of events) {
        if (e.type === 'remove') delete detections[e.id];
        else detections[e.detection.id] = e.detection;
      }
      return {
        detections,
        ranked: rankDetections(Object.values(detections)),
        thumbs: thumbs ? { ...s.thumbs, ...thumbs } : s.thumbs,
      };
    }),

  tileFinished: ({ tile, failed, scannedAreaM2, etaMs, waterFiltered }) =>
    set((s) => ({
      lastCompleted: tile,
      stats: {
        ...s.stats,
        tilesDone: s.stats.tilesDone + 1,
        tilesFailed: s.stats.tilesFailed + (failed ? 1 : 0),
        scannedAreaM2: s.stats.scannedAreaM2 + scannedAreaM2,
        etaMs,
        waterFiltered,
        elapsedMs: Date.now() - s.stats.startedAt,
      },
    })),

  setCurrentTile: (currentTile) => set({ currentTile }),

  tickElapsed: () =>
    set((s) =>
      s.phase === 'scanning' ? { stats: { ...s.stats, elapsedMs: Date.now() - s.stats.startedAt } } : {},
    ),

  pushEvent: (lastEvent) => set({ lastEvent }),

  finishScan: () => {
    const { stats } = get();
    set({
      phase: 'complete',
      currentTile: null,
      stats: { ...stats, elapsedMs: stats.startedAt ? Date.now() - stats.startedAt : stats.elapsedMs, etaMs: null },
    });
  },

  resetScan: () =>
    set({
      phase: 'idle',
      area: null,
      areaEstimate: null,
      detections: {},
      ranked: [],
      thumbs: {},
      stats: EMPTY_STATS,
      planTiles: null,
      currentTile: null,
      lastCompleted: null,
      lastEvent: null,
      selectedId: null,
      scanId: null,
      scanName: '',
    }),

  setArchive: (archive) => set({ archive }),

  loadArchived: ({ id, name, area, detections, thumbs, stats }) => {
    const map: Record<string, Detection> = {};
    for (const d of detections) map[d.id] = d;
    set({
      phase: 'complete',
      scanId: id,
      scanName: name,
      area,
      areaEstimate: null,
      detections: map,
      ranked: rankDetections(detections),
      thumbs,
      stats,
      planTiles: null,
      currentTile: null,
      lastCompleted: null,
      selectedId: null,
      lastEvent: null,
    });
  },
})));

/** Detections that pass the display filters, re-ranked so the list reads 1, 2, 3… */
export function visibleRanked(s: {
  ranked: RankedDetection[];
  settings: Settings;
}): RankedDetection[] {
  return rankDetections(
    s.ranked.filter(
      (d) =>
        d.confidence >= s.settings.minConfidence && (s.settings.showHotTubs || d.kind !== 'hot_tub'),
    ),
  );
}
