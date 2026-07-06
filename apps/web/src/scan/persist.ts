/**
 * Scan persistence in IndexedDB — completed scans survive reloads and can be
 * reopened from the archive.
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { Detection, Ring } from '@marco-polo/core';
import type { ArchiveSummary, ScanStats } from '../state/store.js';

const idb = createStore('marco-polo', 'scans');

export interface SavedScan {
  id: string;
  savedAt: number;
  name: string;
  area: Ring;
  zoom: number;
  stats: ScanStats;
  detections: Detection[];
  thumbs: Record<string, string>;
}

const INDEX_KEY = 'index';

export async function listScans(): Promise<ArchiveSummary[]> {
  try {
    return ((await get(INDEX_KEY, idb)) as ArchiveSummary[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function saveScan(record: SavedScan): Promise<ArchiveSummary[]> {
  const summary: ArchiveSummary = {
    id: record.id,
    savedAt: record.savedAt,
    name: record.name,
    pools: record.detections.length,
    areaM2: record.stats.areaM2,
    zoom: record.zoom,
  };
  try {
    await set(`scan:${record.id}`, record, idb);
    const index = (await listScans()).filter((s) => s.id !== record.id);
    index.unshift(summary);
    const trimmed = index.slice(0, 30);
    await set(INDEX_KEY, trimmed, idb);
    return trimmed;
  } catch {
    return listScans();
  }
}

export async function loadScan(id: string): Promise<SavedScan | undefined> {
  try {
    return (await get(`scan:${id}`, idb)) as SavedScan | undefined;
  } catch {
    return undefined;
  }
}

export async function deleteScan(id: string): Promise<ArchiveSummary[]> {
  try {
    await del(`scan:${id}`, idb);
    const index = (await listScans()).filter((s) => s.id !== id);
    await set(INDEX_KEY, index, idb);
    return index;
  } catch {
    return listScans();
  }
}
