/**
 * Token bucket for imagery requests. Every network request takes one token,
 * retries and halo neighbours included; cache hits take none.
 *
 * The bucket holds at most `capacity` tokens (1 by default), so after an idle
 * spell, a paused scan or a throttled background tab it never releases a
 * burst: request starts stay at least 1000 / rate ms apart. Refill is computed
 * from the clock, not counted in timer ticks, so a late timer cannot add
 * tokens that were not earned.
 */

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'ScanCancelled');
}

export class TokenBucket {
  private tokens: number;
  private stamp: number;
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  /** Tokens handed out so far. */
  granted = 0;

  constructor(
    private rate: number,
    private readonly capacity = 1,
  ) {
    TokenBucket.check(rate);
    if (!(capacity >= 1)) throw new RangeError(`capacity must be at least 1, got ${capacity}`);
    this.tokens = capacity;
    this.stamp = Date.now();
  }

  private static check(rate: number): void {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError(`rate must be a positive number, got ${rate}`);
  }

  get perSecond(): number {
    return this.rate;
  }

  get waiting(): number {
    return this.queue.length;
  }

  setRate(rate: number): void {
    TokenBucket.check(rate);
    this.refill();
    this.rate = rate;
    this.drain();
  }

  /** Resolves when a token is granted; rejects if `signal` aborts first. */
  take(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise<void>((resolve, reject) => {
      const w: Waiter = { resolve, reject, signal };
      if (signal) {
        w.onAbort = () => {
          const i = this.queue.indexOf(w);
          if (i >= 0) this.queue.splice(i, 1);
          reject(abortError(signal));
          this.drain();
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.queue.push(w);
      this.drain();
    });
  }

  /** Stop granting tokens; waiters stay queued. */
  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    this.paused = false;
    this.drain();
  }

  /** Reject every waiter and stop. */
  close(err: unknown = abortError()): void {
    this.clearTimer();
    const q = this.queue;
    this.queue = [];
    for (const w of q) {
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      w.reject(err);
    }
  }

  private refill(): void {
    const t = Date.now();
    if (t > this.stamp) {
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.stamp) * this.rate) / 1000);
    }
    this.stamp = t;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private drain(): void {
    this.clearTimer();
    if (this.paused) return;
    this.refill();
    // A hair of tolerance so 5 x 200 ms of float maths still yields a whole token.
    while (this.queue.length > 0 && this.tokens >= 1 - 1e-9) {
      this.tokens = Math.max(0, this.tokens - 1);
      const w = this.queue.shift()!;
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      this.granted++;
      w.resolve();
    }
    if (this.queue.length > 0) {
      const ms = Math.max(1, Math.ceil(((1 - this.tokens) * 1000) / this.rate));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, ms);
    }
  }
}

/** setTimeout as a promise that an AbortSignal can cut short. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
