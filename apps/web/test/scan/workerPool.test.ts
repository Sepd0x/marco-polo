import { describe, expect, it } from 'vitest';
import { WorkerPool } from '../../src/scan/workerPool.js';
import type { WorkJob, WorkResult } from '../../src/scan/tileWork.js';

/** A stand-in for a module worker: answers each job, or fails to load. */
class FakeWorker {
  onmessage: ((e: MessageEvent<WorkResult>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: WorkJob[] = [];
  terminated = false;
  constructor(private readonly answers: boolean) {}
  postMessage(job: WorkJob): void {
    this.posted.push(job);
    if (!this.answers) return;
    queueMicrotask(() => this.onmessage?.({ data: { id: job.id, scanId: job.scanId, noData: null, pieces: [], thumbs: [], ms: 1 } } as unknown as MessageEvent<WorkResult>));
  }
  fail(): void {
    this.onerror?.({ message: 'failed to load', preventDefault() {} } as unknown as ErrorEvent);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const job = (): Omit<WorkJob, 'id'> => ({ scanId: 's', providerId: 'esri', tile: { z: 1, x: 0, y: 0 }, tilePx: 256, halo: 0, bytes: new ArrayBuffer(4) });

describe('worker pool', () => {
  it('fails at once, never hangs, when its workers cannot load', async () => {
    const made: FakeWorker[] = [];
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker(false);
      made.push(w);
      return w as unknown as Worker;
    });
    const early = pool.run(job());
    for (const w of made) w.fail();
    await expect(early).rejects.toThrow('failed to load');
    // A job posted after the error must settle too.
    await expect(pool.run(job())).rejects.toThrow('no detection worker could start');
    expect(made.every((w) => w.terminated)).toBe(true);
  });

  it('sends later jobs to the workers that still run', async () => {
    const made: FakeWorker[] = [];
    let n = 0;
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker(n++ === 1);
      made.push(w);
      return w as unknown as Worker;
    });
    made[0].fail();
    const results = await Promise.all([pool.run(job()), pool.run(job()), pool.run(job())]);
    expect(results.map((r) => r.ms)).toEqual([1, 1, 1]);
    expect(made[0].posted).toHaveLength(0);
    expect(made[1].posted).toHaveLength(3);
  });
});
