/**
 * Detection ids carry the scan and the plan part: merger ids restart in every
 * part and every scan, and a late answer from an old scan must never be
 * mistaken for one of the current scan.
 */

export function newScanId(): string {
  return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function detectionId(scanId: string, partId: string, localId: string): string {
  return `${scanId}:${partId}:${localId}`;
}

/** The plan part of a detection id, or null for ids of older archived scans. */
export function partOfDetection(id: string): string | null {
  const parts = id.split(':');
  return parts.length === 3 ? parts[1] : null;
}
