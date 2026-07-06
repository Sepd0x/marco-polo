import type { DetectorOptions, TileCoord } from '@marco-polo/core';
import type { DetectResponse } from './detect.worker.js';

interface Pending {
  resolve: (r: DetectResponse) => void;
  reject: (e: unknown) => void;
}

/** Round-robin pool of detection workers sized to the machine. */
export class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;
  private next = 0;

  constructor(size = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<DetectResponse>) => {
        const p = this.pending.get(e.data.id);
        if (p) {
          this.pending.delete(e.data.id);
          p.resolve(e.data);
        }
      };
      w.onerror = (e) => {
        // A worker crash rejects everything in flight; tiles will be retried/failed upstream.
        for (const [id, p] of this.pending) {
          p.reject(e);
          this.pending.delete(id);
        }
      };
      this.workers.push(w);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  detect(tile: TileCoord, bitmap: ImageBitmap, options: Partial<DetectorOptions>): Promise<DetectResponse> {
    const id = ++this.seq;
    const worker = this.workers[this.next];
    this.next = (this.next + 1) % this.workers.length;
    return new Promise<DetectResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, tile, bitmap, options }, [bitmap]);
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }
}
