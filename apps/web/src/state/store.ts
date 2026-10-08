import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  coversArea,
  estimatePlan,
  findProvider,
  rankDetections,
  type Detection,
  type ImagerySetting,
  type MergerEvent,
  type PlanEstimate,
  type RankedDetection,
  type Ring,
  type ScanTile,
} from '@marco-polo/core';
import { loadSettings, persistSettings, type Settings } from './settings.js';
import { cutoffFn } from '../lib/score.js';

export type Phase = 'idle' | 'ready' | 'scanning' | 'paused' | 'complete';
export type DrawMode = 'rect' | 'polygon' | null;

export { DEFAULT_SETTINGS, persistSettings, type Settings } from './settings.js';

export interface ScanStats {
  tilesTotal: number;
  tilesDone: number;
  tilesFailed: number;
  /** Tiles the source answered without imagery (placeholder, blank, 404). Not "no pools". */
  tilesNoCoverage: number;
  startedAt: number;
  elapsedMs: number;
  etaMs: number | null;
  areaM2: number;
  scannedAreaM2: number;
  waterFiltered: number;
  /** True when the scan was stopped before its last tile. */
  stopped: boolean;
}

const EMPTY_STATS: ScanStats = {
  tilesTotal: 0,
  tilesDone: 0,
  tilesFailed: 0,
  tilesNoCoverage: 0,
  startedAt: 0,
  elapsedMs: 0,
  etaMs: null,
  areaM2: 0,
  scannedAreaM2: 0,
  waterFiltered: 0,
  stopped: false,
};

export interface ArchiveSummary {
  id: string;
  savedAt: number;
  name: string;
  pools: number;
  areaM2: number;
  /** Finest scan zoom among the parts. */
  zoom: number;
  /** Source names, one per part (absent in scans saved by older builds). */
  sources?: string[];
}

/** One part of the plan as the UI and the map see it: one source, one date. */
export interface PartView {
  id: string;
  providerId: string;
  providerName: string;
  attribution: string;
  licence: string;
  /** Capture date or range; null = not measured. */
  date: string | null;
  zoom: number;
  nativeResM: number | null;
  tiles: ScanTile[];
  tilesDone: number;
  tilesFailed: number;
  tilesNoCoverage: number;
  areaM2: number;
  status: 'waiting' | 'probing' | 'scanning' | 'done';
  /** Name of the source this part fell back from, when its sample had no imagery. */
  fellBackFrom: string | null;
}

export type TileOutcome = 'done' | 'failed' | 'nocoverage';

export interface TileUpdate {
  partId: string;
  tile: ScanTile;
  outcome: TileOutcome;
  events: MergerEvent[];
  /** Thumbnails for detections in `events`, by fragment key. */
  thumbs?: Record<string, Blob>;
  scannedAreaM2: number;
  etaMs: number | null;
  waterFiltered: number;
  lastEvent?: string | null;
}

interface AppState {
  phase: Phase;
  drawMode: DrawMode;
  area: Ring | null;
  /** z19-equivalent tile count of the drawn area, for the UI. */
  areaEstimate: { count: number; approximate: boolean } | null;
  /** Cost and limit check of the drawn area, per source. */
  planEstimate: PlanEstimate | null;
  /** Source fixed by an opened link, for this area only; settings stay untouched. */
  areaSource: string | null;
  settings: Settings;
  detections: Record<string, Detection>;
  ranked: RankedDetection[];
  /** Object URLs of thumbnails, by fragment key. */
  thumbs: Record<string, string>;
  /** The same thumbnails as Blobs, for the archive. */
  thumbBlobs: Record<string, Blob>;
  stats: ScanStats;
  parts: PartView[];
  planTiles: ScanTile[] | null;
  currentTile: ScanTile | null;
  lastCompleted: ScanTile | null;
  lastOutcome: TileOutcome | null;
  failedTiles: ScanTile[];
  noCoverageTiles: ScanTile[];
  lastEvent: string | null;
  scanError: string | null;
  selectedId: string | null;
  archive: ArchiveSummary[];
  scanId: string | null;
  scanName: string;

  setDrawMode(mode: DrawMode): void;
  /** The estimate argument of older callers is ignored; the store measures the area itself. */
  setArea(area: Ring | null, estimate?: unknown, opts?: { source?: string | null }): void;
  updateSettings(patch: Partial<Settings>): void;
  select(id: string | null): void;
  setScanName(name: string): void;

  beginScan(scanId: string, init: { parts: PartView[]; areaM2: number }): void;
  updatePart(scanId: string, partId: string, patch: Partial<PartView>): void;
  setScanPhase(scanId: string, phase: Phase): void;
  setCurrentTile(scanId: string, tile: ScanTile | null): void;
  tileFinished(scanId: string, update: TileUpdate): void;
  applyMergerEvents(scanId: string, events: MergerEvent[], thumbs?: Record<string, Blob>): void;
  retryStarted(scanId: string): void;
  finishScan(scanId: string, opts?: { stopped?: boolean }): void;
  failScan(scanId: string | null, message: string): void;
  /** Clock tick of a running scan; ignored for any other scan. */
  tickElapsed(scanId: string): void;
  resetScan(): void;
  setArchive(list: ArchiveSummary[]): void;
  loadArchived(payload: {
    id: string;
    name: string;
    area: Ring;
    detections: Detection[];
    thumbs: Record<string, Blob | string>;
    stats: Partial<ScanStats>;
    parts?: PartView[];
  }): void;
}

function objectUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

function revokeAll(urls: Record<string, string>): void {
  if (typeof URL.revokeObjectURL !== 'function') return;
  for (const u of Object.values(urls)) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
}

/** Scan setting for an area: a link's source, else the user's, else auto when it does not cover the area. */
export function scanSetting(s: { area: Ring | null; areaSource: string | null; settings: Settings }): ImagerySetting {
  const wanted: ImagerySetting = s.areaSource ? { mode: 'fixed', providerId: s.areaSource } : s.settings.imagery;
  if (wanted.mode === 'fixed') {
    const p = findProvider(wanted.providerId);
    if (!p?.scanAllowed || (s.area && !coversArea(p, s.area))) return { mode: 'auto' };
  }
  return wanted;
}

function measure(area: Ring | null, setting: ImagerySetting): Pick<AppState, 'planEstimate' | 'areaEstimate'> {
  if (!area) return { planEstimate: null, areaEstimate: null };
  try {
    const planEstimate = estimatePlan(area, setting);
    return { planEstimate, areaEstimate: { count: planEstimate.z19Tiles, approximate: planEstimate.approximate } };
  } catch {
    return { planEstimate: null, areaEstimate: null };
  }
}

const SCAN_RESET = {
  detections: {},
  ranked: [],
  thumbs: {},
  thumbBlobs: {},
  stats: EMPTY_STATS,
  parts: [],
  planTiles: null,
  currentTile: null,
  lastCompleted: null,
  lastOutcome: null,
  failedTiles: [],
  noCoverageTiles: [],
  lastEvent: null,
  scanError: null,
  selectedId: null,
} satisfies Partial<AppState>;

type Patch = Partial<AppState>;

/**
 * Detections and thumbnails after a batch of merger events, or null when the
 * batch changes nothing (then the caller leaves `ranked` and friends alone).
 */
function withEvents(s: AppState, events: MergerEvent[], blobs?: Record<string, Blob>): Patch | null {
  const blobKeys = blobs ? Object.keys(blobs) : [];
  if (events.length === 0 && blobKeys.length === 0) return null;
  const out: Patch = {};
  if (events.length > 0) {
    const detections = { ...s.detections };
    for (const e of events) {
      if (e.type === 'remove') delete detections[e.id];
      else detections[e.detection.id] = e.detection;
    }
    out.detections = detections;
    out.ranked = rankDetections(Object.values(detections));
    if (s.selectedId && !detections[s.selectedId]) out.selectedId = null;
  }
  if (blobs && blobKeys.length > 0) {
    const thumbs = { ...s.thumbs };
    const thumbBlobs = { ...s.thumbBlobs };
    for (const k of blobKeys) {
      if (thumbBlobs[k]) continue;
      thumbBlobs[k] = blobs[k];
      const url = objectUrl(blobs[k]);
      if (url) thumbs[k] = url;
    }
    out.thumbs = thumbs;
    out.thumbBlobs = thumbBlobs;
  }
  return out;
}

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => {
    /** Run `fn` only while `scanId` is the scan the store shows. */
    const forScan = (scanId: string, fn: (s: AppState) => Patch | null) => {
      const s = get();
      if (s.scanId !== scanId) return;
      const patch = fn(s);
      if (patch && Object.keys(patch).length > 0) set(patch);
    };

    return {
      phase: 'idle',
      drawMode: null,
      area: null,
      areaEstimate: null,
      planEstimate: null,
      areaSource: null,
      settings: loadSettings(),
      ...SCAN_RESET,
      archive: [],
      scanId: null,
      scanName: '',

      setDrawMode: (drawMode) => set({ drawMode }),

      setArea: (area, _estimate, opts) => {
        const s = get();
        if (s.phase === 'scanning' || s.phase === 'paused') return;
        const areaSource = opts?.source ?? null;
        const setting = scanSetting({ area, areaSource, settings: s.settings });
        revokeAll(s.thumbs);
        set({
          ...SCAN_RESET,
          scanId: null,
          area,
          areaSource: setting.mode === 'fixed' && areaSource ? areaSource : null,
          ...measure(area, setting),
          phase: area ? 'ready' : 'idle',
          drawMode: null,
        });
      },

      updateSettings: (patch) =>
        set((s) => {
          const settings = { ...s.settings, ...patch };
          persistSettings(settings);
          const out: Patch = { settings };
          if (patch.imagery !== undefined && s.area && s.phase === 'ready') {
            Object.assign(out, measure(s.area, scanSetting({ area: s.area, areaSource: s.areaSource, settings })));
          }
          return out;
        }),

      select: (selectedId) => {
        if (get().selectedId !== selectedId) set({ selectedId });
      },
      setScanName: (scanName) => set({ scanName }),

      beginScan: (scanId, { parts, areaM2 }) => {
        revokeAll(get().thumbs);
        set({
          ...SCAN_RESET,
          phase: 'scanning',
          scanId,
          parts,
          planTiles: parts.flatMap((p) => p.tiles),
          stats: {
            ...EMPTY_STATS,
            tilesTotal: parts.reduce((n, p) => n + p.tiles.length, 0),
            areaM2,
            startedAt: Date.now(),
          },
        });
      },

      updatePart: (scanId, partId, patch) =>
        forScan(scanId, (s) => {
          const i = s.parts.findIndex((p) => p.id === partId);
          if (i < 0) return null;
          const parts = s.parts.slice();
          parts[i] = { ...parts[i], ...patch };
          const out: Patch = { parts };
          if (patch.tiles) {
            out.planTiles = parts.flatMap((p) => p.tiles);
            out.stats = { ...s.stats, tilesTotal: parts.reduce((n, p) => n + p.tiles.length, 0) };
          }
          return out;
        }),

      setScanPhase: (scanId, phase) => forScan(scanId, (s) => (s.phase === phase ? null : { phase })),

      setCurrentTile: (scanId, currentTile) =>
        forScan(scanId, (s) => (s.currentTile === currentTile ? null : { currentTile })),

      tileFinished: (scanId, u) =>
        forScan(scanId, (s) => {
          const out: Patch = withEvents(s, u.events, u.thumbs) ?? {};
          const failed = u.outcome === 'failed';
          const empty = u.outcome === 'nocoverage';
          out.lastCompleted = u.tile;
          out.lastOutcome = u.outcome;
          if (failed) out.failedTiles = [...s.failedTiles, u.tile];
          if (empty) out.noCoverageTiles = [...s.noCoverageTiles, u.tile];
          if (u.lastEvent) out.lastEvent = u.lastEvent;
          const parts = s.parts.slice();
          const i = parts.findIndex((p) => p.id === u.partId);
          if (i >= 0) {
            const p = parts[i];
            parts[i] = {
              ...p,
              tilesDone: p.tilesDone + 1,
              tilesFailed: p.tilesFailed + (failed ? 1 : 0),
              tilesNoCoverage: p.tilesNoCoverage + (empty ? 1 : 0),
            };
            out.parts = parts;
          }
          out.stats = {
            ...s.stats,
            tilesDone: s.stats.tilesDone + 1,
            tilesFailed: s.stats.tilesFailed + (failed ? 1 : 0),
            tilesNoCoverage: s.stats.tilesNoCoverage + (empty ? 1 : 0),
            scannedAreaM2: s.stats.scannedAreaM2 + (u.outcome === 'done' ? u.scannedAreaM2 : 0),
            etaMs: u.etaMs,
            waterFiltered: u.waterFiltered,
            elapsedMs: Date.now() - s.stats.startedAt,
          };
          return out;
        }),

      applyMergerEvents: (scanId, events, thumbs) => forScan(scanId, (s) => withEvents(s, events, thumbs)),

      retryStarted: (scanId) =>
        forScan(scanId, (s) => {
          const retry = new Set(s.failedTiles);
          const parts = s.parts.map((p) => {
            const n = p.tiles.filter((t) => retry.has(t)).length;
            return n ? { ...p, tilesDone: p.tilesDone - n, tilesFailed: p.tilesFailed - n, status: 'scanning' as const } : p;
          });
          return {
            phase: 'scanning',
            failedTiles: [],
            parts,
            stats: {
              ...s.stats,
              tilesDone: s.stats.tilesDone - retry.size,
              tilesFailed: s.stats.tilesFailed - retry.size,
              stopped: false,
              etaMs: null,
            },
          };
        }),

      finishScan: (scanId, opts) =>
        forScan(scanId, (s) => ({
          phase: 'complete',
          currentTile: null,
          stats: {
            ...s.stats,
            elapsedMs: s.stats.startedAt ? Date.now() - s.stats.startedAt : s.stats.elapsedMs,
            etaMs: null,
            stopped: opts?.stopped ?? false,
          },
        })),

      failScan: (scanId, message) => {
        const s = get();
        if (scanId !== null && s.scanId !== scanId) return;
        set({ scanError: message, phase: s.area ? 'ready' : 'idle', scanId: null, currentTile: null });
      },

      tickElapsed: (scanId) => {
        const s = get();
        if (s.phase !== 'scanning' || s.scanId !== scanId) return;
        set({ stats: { ...s.stats, elapsedMs: Date.now() - s.stats.startedAt } });
      },

      resetScan: () => {
        revokeAll(get().thumbs);
        set({
          ...SCAN_RESET,
          phase: 'idle',
          area: null,
          areaEstimate: null,
          planEstimate: null,
          areaSource: null,
          scanId: null,
          scanName: '',
        });
      },

      setArchive: (archive) => set({ archive }),

      loadArchived: ({ id, name, area, detections, thumbs, stats, parts }) => {
        revokeAll(get().thumbs);
        const map: Record<string, Detection> = {};
        for (const d of detections) map[d.id] = d;
        const urls: Record<string, string> = {};
        const blobs: Record<string, Blob> = {};
        for (const [k, v] of Object.entries(thumbs)) {
          if (typeof v === 'string') urls[k] = v;
          else {
            blobs[k] = v;
            const u = objectUrl(v);
            if (u) urls[k] = u;
          }
        }
        set({
          ...SCAN_RESET,
          phase: 'complete',
          scanId: id,
          scanName: name,
          area,
          areaSource: null,
          areaEstimate: null,
          planEstimate: null,
          detections: map,
          ranked: rankDetections(detections),
          thumbs: urls,
          thumbBlobs: blobs,
          stats: { ...EMPTY_STATS, ...stats, etaMs: null },
          parts: parts ?? [],
        });
      },
    };
  }),
);

/** Detections that pass the display filters, re-ranked so the list reads 1, 2, 3... */
export function visibleRanked(s: { ranked: RankedDetection[]; settings: Settings; parts?: PartView[] }): RankedDetection[] {
  const cut = cutoffFn(s.settings, s.parts ?? []);
  return rankDetections(
    s.ranked.filter((d) => d.confidence >= cut(d) && (s.settings.showHotTubs || d.kind !== 'hot_tub')),
  );
}

/** Detections at or above the confidence filter, and below it (counted, not listed). */
export function thresholdCounts(s: { ranked: RankedDetection[]; settings: Settings; parts?: PartView[] }): { above: number; below: number } {
  const cut = cutoffFn(s.settings, s.parts ?? []);
  let above = 0;
  for (const d of s.ranked) if (d.confidence >= cut(d)) above++;
  return { above, below: s.ranked.length - above };
}

/** True while a scan holds the store (drawing a new area is refused then). */
export function scanBusy(s: { phase: Phase }): boolean {
  return s.phase === 'scanning' || s.phase === 'paused';
}
