/**
 * Shareable AOI permalinks: the drawn area (and zoom) round-trips through the
 * URL hash, so a link reproduces the exact search area on any machine.
 * Format: #aoi=<base64url of JSON [zoom, [[lon,lat], …]]>
 */
import type { Ring } from '@marco-polo/core';

export function encodeAoi(ring: Ring, zoom: number): string {
  const compact = [zoom, ring.map(([lon, lat]) => [round6(lon), round6(lat)])];
  const b64 = btoa(JSON.stringify(compact)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `#aoi=${b64}`;
}

export function decodeAoi(hash: string): { ring: Ring; zoom: number } | null {
  const m = /#aoi=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const json = atob(m[1].replaceAll('-', '+').replaceAll('_', '/'));
    const [zoom, coords] = JSON.parse(json) as [number, [number, number][]];
    if (!Array.isArray(coords) || coords.length < 3 || coords.length > 200) return null;
    if (typeof zoom !== 'number' || zoom < 10 || zoom > 20) return null;
    for (const c of coords) {
      if (!Array.isArray(c) || c.length !== 2) return null;
      const [lon, lat] = c;
      if (typeof lon !== 'number' || typeof lat !== 'number') return null;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 85.06) return null;
    }
    return { ring: coords as Ring, zoom };
  } catch {
    return null;
  }
}

export function writeAoiToUrl(ring: Ring | null, zoom: number): void {
  const url = new URL(window.location.href);
  url.hash = ring ? encodeAoi(ring, zoom) : '';
  history.replaceState(null, '', url);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
