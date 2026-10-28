import { ScanController, type ControllerDeps } from './controller.js';
import { scanSetting, useStore } from '../state/store.js';
import { browserFetch, dropLegacyCache, sharedTileCache } from './tileSource.js';
import { WorkerPool } from './workerPool.js';
import { loadScan, partFromSaved, saveScan } from './persist.js';
import { PRODUCT_DETECTOR_ID, V2_HALO_PX } from './tileWork.js';
import { startAnnouncer } from './announce.js';

/**
 * The page's one scan. Opening an archived scan, resetting or drawing a new
 * scan changes the store's scanId; the running controller sees that and is
 * disposed, so it can never write into, or archive over, another scan.
 */
let controller: ScanController | null = null;
let watching = false;

function defaultDeps(): ControllerDeps {
  return {
    makePool: () => new WorkerPool(),
    fetch: browserFetch,
    cache: sharedTileCache(),
    save: saveScan,
    halo: V2_HALO_PX,
    detectorId: PRODUCT_DETECTOR_ID,
  };
}

let depsFactory: () => ControllerDeps = defaultDeps;

/** Swap the browser dependencies (tests). */
export function setScanDeps(make: (() => ControllerDeps) | null): void {
  depsFactory = make ?? defaultDeps;
}

function watchStore(): void {
  if (watching) return;
  watching = true;
  useStore.subscribe(
    (s) => s.scanId,
    (scanId) => {
      if (controller && controller.scanId !== scanId) {
        controller.dispose();
        controller = null;
      }
      void hydrateArchived(scanId);
    },
  );
}

/** An archived scan opened without its parts gets them from the record, for the summary and exports. */
async function hydrateArchived(scanId: string | null): Promise<void> {
  if (!scanId) return;
  const s = useStore.getState();
  if (s.phase !== 'complete' || s.parts.length > 0 || controller?.scanId === scanId) return;
  const rec = await loadScan(scanId);
  if (!rec?.parts?.length) return;
  const now = useStore.getState();
  if (now.scanId !== scanId || now.parts.length > 0) return;
  useStore.setState({ parts: rec.parts.map(partFromSaved) });
}

/**
 * Once at app start. The tile store of older builds held request URLs with
 * visitors' MapTiler and Mapbox keys in them; the settings forget those keys
 * at boot, so the store goes at boot too, not only when a scan starts.
 */
export function bootScan(): Promise<void> {
  return dropLegacyCache();
}

export function currentScan(): ScanController | null {
  return controller;
}

export function startScan(): Promise<void> {
  const s = useStore.getState();
  if (!s.area) return Promise.resolve();
  watchStore();
  startAnnouncer();
  void dropLegacyCache();
  controller?.dispose();
  controller = new ScanController(
    {
      area: s.area,
      setting: scanSetting(s),
      order: s.settings.order,
      ratePerSec: s.settings.ratePerSec,
      name: s.scanName,
    },
    depsFactory(),
  );
  return controller.start();
}

export function pauseScan(): void {
  controller?.pause();
}

export function resumeScan(): void {
  controller?.resume();
}

/** Stop early; what was scanned is kept and archived. */
export function cancelScan(): void {
  controller?.stop();
}

export function retryFailed(): Promise<void> {
  return controller?.retryFailed() ?? Promise.resolve();
}

/** Open an archived scan; any running scan is disposed first. */
export async function openArchived(id: string): Promise<boolean> {
  const rec = await loadScan(id);
  if (!rec) return false;
  controller?.dispose();
  controller = null;
  useStore.getState().loadArchived({
    id: rec.id,
    name: rec.name,
    area: rec.area,
    detections: rec.detections,
    thumbs: rec.thumbs,
    stats: rec.stats,
    parts: rec.parts?.map(partFromSaved),
  });
  return true;
}
