import type { WorkJob, WorkResult } from './tileWork.js';
import { abortError } from './pacer.js';

interface Pending {
  worker: number;
  resolve: (r: WorkResult) => void;
  reject: (e: unknown) => void;
}

export type RunJob = (job: Omit<WorkJob, 'id'>, transfer?: Transferable[]) => Promise<WorkResult>;

/** Detection workers sized to the machine; each job goes to the least busy live one. */
export class WorkerPool {
  private workers: Worker[] = [];
  private load: number[] = [];
  /**
   * Workers that reported an error: a script that failed to load (a tab left
   * open across a redeploy asks for a worker file that is gone) or threw while
   * starting. They get no more jobs; when none is left, every job fails at once.
   */
  private dead: boolean[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor(
    size = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
    make: () => Worker = () => new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    for (let i = 0; i < size; i++) {
      const w = make();
      w.onmessage = (e: MessageEvent<WorkResult>) => this.settle(e.data.id, (p) => p.resolve(e.data));
      w.onerror = (e) => {
        // A crashed worker fails only its own jobs (their bytes went to it); those tiles are reported as failed.
        e.preventDefault?.();
        this.dead[i] = true;
        w.terminate();
        for (const [id, p] of this.pending) {
          if (p.worker === i) this.settle(id, (q) => q.reject(new Error(e.message || 'worker error')));
        }
      };
      this.workers.push(w);
      this.load.push(0);
      this.dead.push(false);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  private settle(id: number, fn: (p: Pending) => void): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.load[p.worker] = Math.max(0, this.load[p.worker] - 1);
    fn(p);
  }

  run: RunJob = (job, transfer = []) => {
    if (this.workers.length === 0) return Promise.reject(abortError());
    let best = -1;
    for (let i = 0; i < this.load.length; i++) {
      if (!this.dead[i] && (best < 0 || this.load[i] < this.load[best])) best = i;
    }
    if (best < 0) return Promise.reject(new Error('no detection worker could start'));
    const id = ++this.seq;
    this.load[best]++;
    return new Promise<WorkResult>((resolve, reject) => {
      this.pending.set(id, { worker: best, resolve, reject });
      this.workers[best].postMessage({ ...job, id }, transfer);
    });
  };

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    const err = abortError();
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }
}
