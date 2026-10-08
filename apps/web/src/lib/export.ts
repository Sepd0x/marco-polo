/**
 * Exports of the scan on screen, through the core writers: every row carries
 * its source, layer, capture date and plan part, and nothing that looks like
 * a URL template or a key goes out.
 */
import {
  findAnyProvider,
  partSummary,
  provenanceOf,
  toCSV as coreCSV,
  toGeoJSON as coreGeoJSON,
  toResultDetection,
  type Provenance,
  type RankedDetection,
  type ScanResult,
} from '@marco-polo/core';
import { useStore, type PartView } from '../state/store.js';
import { partOfDetection } from '../scan/ids.js';
import { cutoffsInUse } from './score.js';

/** Provenance of detections from scans saved before sources were recorded. */
const UNKNOWN: Provenance = {
  providerId: 'unknown',
  providerName: 'Not recorded (scan saved by an older version)',
  layer: null,
  date: null,
  zoom: 19,
  nativeResM: null,
  partId: 'p0',
};

export function partProvenance(p: PartView): Provenance {
  const provider = findAnyProvider(p.providerId);
  if (!provider) return { ...UNKNOWN, providerId: p.providerId, providerName: p.providerName, zoom: p.zoom, partId: p.id };
  return provenanceOf(provider, p.id, p.zoom, p.date);
}

interface ResultInput {
  area: [number, number][] | null;
  parts: PartView[];
  ranked: RankedDetection[];
  settings: { minConfidence: number; recommendedScore?: boolean };
}

/**
 * The scan as a ScanResult. `listed` is what the user chose to export (the
 * filtered list); everything else found counts as below the threshold.
 */
export function scanResult(s: ResultInput, listed: RankedDetection[] = s.ranked, now = new Date()): ScanResult {
  const byPart = new Map(s.parts.map((p) => [p.id, partProvenance(p)]));
  const fallback = s.parts.length === 1 ? byPart.get(s.parts[0].id)! : UNKNOWN;
  const detections = listed.map((d) => {
    const part = partOfDetection(d.id);
    return toResultDetection(d, (part && byPart.get(part)) || fallback);
  });
  return {
    formatVersion: 2,
    createdAt: now.toISOString(),
    area: s.area ?? [],
    // With a minimum per source, the lowest one: every listed row passed at least that.
    threshold: cutoffsInUse({ minConfidence: s.settings.minConfidence, recommendedScore: s.settings.recommendedScore ?? false }, s.parts)[0],
    parts: s.parts.map((p) => partSummary(p.id, byPart.get(p.id)!, p.tiles.length || p.tilesDone, p.tilesNoCoverage, p.areaM2)),
    detections,
    belowThreshold: Math.max(0, s.ranked.length - listed.length),
  };
}

/** GeoJSON of the listed detections of the scan on screen. */
export function toGeoJSON(listed: RankedDetection[], state: ResultInput = useStore.getState()): string {
  return coreGeoJSON(scanResult(state, listed));
}

/** CSV of the listed detections of the scan on screen. */
export function toCSV(listed: RankedDetection[], state: ResultInput = useStore.getState()): string {
  return coreCSV(scanResult(state, listed));
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
