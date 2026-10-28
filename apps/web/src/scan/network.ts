/**
 * What the scan knows about the connection. A request that fails with no
 * answer at all (no HTTP status) is a "no response"; a few in a row, or one
 * while the browser says it is offline, close the network for a short spell:
 * tiles then fail at once instead of backing off for seconds each, and one
 * request per spell tests whether the connection is back. Any answer, even a
 * 404 or a 503, proves the network works and opens it again. Server errors
 * keep their normal retries and backoff.
 */

export interface NetworkWatchOptions {
  /** Whether the browser thinks it is online; defaults to `navigator.onLine`. */
  online?: () => boolean;
  now?: () => number;
  /** No-response failures in a row that close the network. */
  threshold?: number;
  /** How long the network stays closed, ms. */
  blockMs?: number;
}

/** A tile that was not fetched, or gave up, because the device looks offline. */
export class TileOfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'TileOfflineError';
  }
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export class NetworkWatch {
  private noResponse = 0;
  private blockedUntil = 0;
  private readonly online: () => boolean;
  private readonly now: () => number;
  private readonly threshold: number;
  private readonly blockMs: number;

  constructor(o: NetworkWatchOptions = {}) {
    this.online = o.online ?? browserOnline;
    this.now = o.now ?? Date.now;
    this.threshold = o.threshold ?? 3;
    this.blockMs = o.blockMs ?? 5000;
  }

  /** True while requests should not be tried: the device looks offline. */
  get blocked(): boolean {
    return this.now() < this.blockedUntil;
  }

  /** Something answered: the network works. */
  responded(): void {
    this.noResponse = 0;
    this.blockedUntil = 0;
  }

  /** A request failed without any answer (not a timeout of our own). */
  noAnswer(): void {
    this.noResponse++;
    if (this.noResponse >= this.threshold || !this.online()) this.blockedUntil = this.now() + this.blockMs;
  }

  /** The browser says it is back online, or the user retries: forget the past failures. */
  reset(): void {
    this.noResponse = 0;
    this.blockedUntil = 0;
  }
}
