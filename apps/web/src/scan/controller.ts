import {
  buildScanPlan,
  DetectionMerger,
  ESRI_WORLD_IMAGERY,
  metersPerPixel,
  tileUrl,
  type Ring,
  type ScanPlan,
  type ScanTile,
} from '@marco-polo/core';
import { useStore, type Settings } from '../state/store.js';
import { fetchTileBlob } from './tileSource.js';
import { WorkerPool } from './workerPool.js';
import { saveScan } from './persist.js';
import { formatArea } from '../lib/format.js';
import type { ThumbCrop } from './detect.worker.js';

/**
 * Orchestrates one scan: paces tile requests (token per timer tick — the
 * configured rate is a hard ceiling on imagery traffic), fans decoded tiles
 * out to the worker pool, feeds results through the cross-tile merger, and
 * streams progress into the store.
 */
export class ScanController {
  readonly plan: ScanPlan;
  private pool: WorkerPool | null = null;
  private merger: DetectionMerger;
  private aborters = new Set<AbortController>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private idx = 0;
  private inflight = 0;
  private stopped = false;
  private completed = false;
  private template: string;
  private scanId: string;

  constructor(area: Ring, settings: Settings) {
    this.plan = buildScanPlan(area, settings.zoom, settings.order);
    this.template = validTemplate(settings.providerTemplate) ?? ESRI_WORLD_IMAGERY.urlTemplate;
    this.merger = new DetectionMerger({}, this.plan.tiles.map((t) => t.tile));
    this.scanId = `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  start(): void {
    const store = useStore.getState();
    store.beginScan(this.scanId, this.plan.tiles, this.plan.areaM2);
    this.pool = new WorkerPool();
    const rate = Math.min(10, Math.max(1, useStore.getState().settings.ratePerSec));
    this.timer = setInterval(() => this.pump(), Math.round(1000 / rate));
    this.ticker = setInterval(() => useStore.getState().tickElapsed(), 1000);
    this.pump();
  }

  pause(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    useStore.getState().setPhase('paused');
  }

  resume(): void {
    if (this.stopped || this.completed) return;
    const rate = Math.min(10, Math.max(1, useStore.getState().settings.ratePerSec));
    this.timer = setInterval(() => this.pump(), Math.round(1000 / rate));
    useStore.getState().setPhase('scanning');
    this.pump();
  }

  cancel(): void {
    this.stopped = true;
    for (const a of this.aborters) a.abort();
    this.aborters.clear();
    void this.complete();
  }

  dispose(): void {
    this.stopped = true;
    for (const a of this.aborters) a.abort();
    if (this.timer) clearInterval(this.timer);
    if (this.ticker) clearInterval(this.ticker);
    this.pool?.dispose();
  }

  private maxConcurrency(): number {
    return (this.pool?.size ?? 2) + 2;
  }

  private pump(): void {
    if (this.stopped || this.completed) return;
    if (this.idx >= this.plan.tiles.length) {
      if (this.inflight === 0) void this.complete();
      return;
    }
    if (this.inflight >= this.maxConcurrency()) return;
    const tile = this.plan.tiles[this.idx++];
    void this.processTile(tile);
  }

  private async processTile(scanTile: ScanTile): Promise<void> {
    const store = useStore.getState;
    this.inflight++;
    store().setCurrentTile(scanTile);
    const ac = new AbortController();
    this.aborters.add(ac);
    let failed = false;

    try {
      const url = tileUrl(this.template, scanTile.tile);
      const { blob, cached } = await fetchTileBlob(url, ac.signal);
      // Cache hits cost the imagery provider nothing — skip the rate limiter
      // and pull the next tile immediately. Cached re-scans run at CPU speed.
      if (cached && !this.stopped) queueMicrotask(() => this.pump());
      const bitmap = await createImageBitmap(blob);
      const res = await this.pool!.detect(scanTile.tile, bitmap, {});
      if (res.error) throw new Error(res.error);
      if (this.stopped) return;

      const events = this.merger.addTileDetections(scanTile.tile, res.detections);
      const thumbs = renderThumbs(res.thumbs);
      store().applyMergerEvents(events, thumbs);

      for (const e of events) {
        if (e.type === 'add') {
          store().pushEvent(
            `POLO — ${e.detection.kind === 'hot_tub' ? 'hot tub' : 'pool'} · ${formatArea(e.detection.areaM2)} · ${e.detection.center.lat.toFixed(5)}, ${e.detection.center.lon.toFixed(5)}`,
          );
        }
      }
    } catch {
      if (this.stopped) return;
      failed = true;
    } finally {
      this.aborters.delete(ac);
      this.inflight--;
      if (!this.stopped) {
        const midLat = (scanTile.bbox.north + scanTile.bbox.south) / 2;
        const side = 256 * metersPerPixel(midLat, scanTile.tile.z);
        const s = store().stats;
        const done = s.tilesDone + 1;
        const remaining = this.plan.tiles.length - done;
        const elapsed = Date.now() - s.startedAt;
        const etaMs = done > 3 ? (elapsed / done) * remaining : null;
        store().tileFinished({
          tile: scanTile,
          failed,
          scannedAreaM2: side * side,
          etaMs,
          waterFiltered: this.merger.waterBodiesFiltered,
        });
        if (this.idx >= this.plan.tiles.length && this.inflight === 0) void this.complete();
      }
    }
  }

  private async complete(): Promise<void> {
    if (this.completed) return;
    this.completed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.ticker) clearInterval(this.ticker);
    this.timer = null;
    this.ticker = null;

    const store = useStore.getState;
    store().applyMergerEvents(this.merger.finalize());
    store().finishScan();
    this.pool?.dispose();
    this.pool = null;

    // Persist to the archive.
    const s = store();
    const name =
      s.scanName.trim() ||
      `Scan · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    if (s.area && s.ranked.length >= 0) {
      const archive = await saveScan({
        id: this.scanId,
        savedAt: Date.now(),
        name,
        area: s.area,
        zoom: this.plan.zoom,
        stats: s.stats,
        detections: Object.values(s.detections),
        thumbs: s.thumbs,
      });
      store().setArchive(archive);
    }
  }
}

/** Accept only https XYZ templates with all three placeholders. */
export function validTemplate(template: string): string | null {
  const t = template.trim();
  if (!t) return null;
  if (!/^https:\/\//i.test(t)) return null;
  if (!t.includes('{z}') || !t.includes('{x}') || !t.includes('{y}')) return null;
  return t;
}

/** Convert raw RGBA crops from the worker into data-URL thumbnails. */
function renderThumbs(crops: ThumbCrop[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (crops.length === 0) return out;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;
  for (const c of crops) {
    try {
      canvas.width = c.width;
      canvas.height = c.height;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(c.buffer), c.width, c.height), 0, 0);
      out[c.key] = canvas.toDataURL('image/png');
    } catch {
      // skip broken crop
    }
  }
  return out;
}
