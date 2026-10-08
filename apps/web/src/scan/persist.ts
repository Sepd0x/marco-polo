/**
 * Scan archive in IndexedDB: finished scans survive reloads and can be opened
 * again. Thumbnails are kept as Blobs. Records of older builds (data URL
 * thumbnails, no parts) still open.
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { Detection, Ring } from '@marco-polo/core';
import type { ArchiveSummary, PartView, ScanStats } from '../state/store.js';

const idb = createStore('marco-polo', 'scans');

/** A part as archived: its view without the tile list. */
export type SavedPart = Omit<PartView, 'tiles'> & { tileCount: number };

export interface SavedScan {
  formatVersion?: 2;
  id: string;
  savedAt: number;
  name: string;
  area: Ring;
  /** Finest scan zoom among the parts (older records: the zoom picked by the user). */
  zoom: number;
  stats: Partial<ScanStats>;
  detections: Detection[];
  /** Blobs since v2; data URL strings in older records. */
  thumbs: Record<string, Blob | string>;
  parts?: SavedPart[];
  threshold?: number;
}

const INDEX_KEY = 'index';
const KEEP = 30;

export function savedPart(p: PartView): SavedPart {
  const { tiles, ...rest } = p;
  return { ...rest, tileCount: tiles.length };
}

/** A saved part back as a view; the tile list is not archived. */
export function partFromSaved(p: SavedPart): PartView {
  const { tileCount: _n, ...rest } = p;
  return { ...rest, tiles: [] };
}

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
    areaM2: record.stats.areaM2 ?? 0,
    zoom: record.zoom,
    sources: record.parts?.map((p) => p.providerName),
  };
  try {
    await set(`scan:${record.id}`, { ...record, formatVersion: 2 }, idb);
    const index = (await listScans()).filter((s) => s.id !== record.id);
    index.unshift(summary);
    const kept = index.slice(0, KEEP);
    for (const old of index.slice(KEEP)) await del(`scan:${old.id}`, idb).catch(() => {});
    await set(INDEX_KEY, kept, idb);
    return kept;
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
