import { ScanController } from './controller.js';
import { useStore } from '../state/store.js';

let controller: ScanController | null = null;

export function startScan(): void {
  const { area, settings } = useStore.getState();
  if (!area) return;
  controller?.dispose();
  controller = new ScanController(area, settings);
  controller.start();
}

export function pauseScan(): void {
  controller?.pause();
}

export function resumeScan(): void {
  controller?.resume();
}

export function cancelScan(): void {
  controller?.cancel();
}
