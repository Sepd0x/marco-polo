/**
 * One reading of a finished scan's tile counts, shared by the summary and the
 * screen reader, so what is seen and what is heard cannot disagree.
 */
export interface TileTotals {
  total: number;
  done: number;
  failed: number;
  noCoverage: number;
}

/** Every tile that was read failed (offline, say): nothing was scanned, and the scan is not "complete". */
export function allTilesFailed(t: TileTotals): boolean {
  const stopped = t.done < t.total;
  const ok = Math.max(0, t.done - t.failed - t.noCoverage);
  return !stopped && t.total > 0 && t.failed > 0 && ok <= 0;
}

/** The sentence under a failed scan: the cause and what to do. */
export function failureHint(offline: boolean): string {
  return offline
    ? 'Your device is offline. The scan resumes when you are back online, or retry now.'
    : 'No tile could be loaded. Check your connection, then retry.';
}
