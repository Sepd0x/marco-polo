import type { BBox, Coverage, ImageryProvider, ImagerySetting, LonLat, Ring } from '../types.js';
import { ESRI_WORLD_IMAGERY, findProvider, IMAGERY_PROVIDERS } from '../providers.js';
import { pointInRing, ringBBox } from '../geo/polygon.js';

const ringBoxes = new WeakMap<Ring, BBox>();

function boxOf(ring: Ring): BBox {
  let b = ringBoxes.get(ring);
  if (!b) {
    b = ringBBox(ring);
    ringBoxes.set(ring, b);
  }
  return b;
}

function inBox(b: BBox, lon: number, lat: number): boolean {
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

/** True if a point lies inside a coverage. A null coverage is global. */
export function coverageContains(coverage: Coverage | null, lon: number, lat: number): boolean {
  if (!coverage) return true;
  if (!inBox(coverage.bbox, lon, lat)) return false;
  for (const ring of coverage.polygons) {
    if (inBox(boxOf(ring), lon, lat) && pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

/** Scan-allowed sources in `auto` preference order. Ends with the global source. */
export function autoChain(): ImageryProvider[] {
  return IMAGERY_PROVIDERS.filter((p) => p.scanAllowed);
}

/**
 * The source to scan at a point. `auto` takes the first scan-allowed source
 * whose coverage polygon holds the point (never the HTTP answer); a fixed
 * choice is returned as is when it exists and may be scanned.
 */
export function pickProvider(point: LonLat, setting: ImagerySetting = { mode: 'auto' }): ImageryProvider {
  if (setting.mode === 'fixed') {
    const p = findProvider(setting.providerId);
    if (!p) throw new Error(`unknown imagery source: ${setting.providerId}`);
    if (!p.scanAllowed) throw new Error(`${p.name} can be viewed but not scanned`);
    return p;
  }
  for (const p of autoChain()) {
    if (coverageContains(p.coverage, point.lon, point.lat)) return p;
  }
  return ESRI_WORLD_IMAGERY;
}

/** True when every vertex of the area lies inside the source's coverage. */
export function coversArea(provider: ImageryProvider, area: Ring): boolean {
  if (!provider.coverage) return true;
  return area.every(([lon, lat]) => coverageContains(provider.coverage, lon, lat));
}

/** Scan-allowed sources a user may fix for this area. */
export function providersCovering(area: Ring): ImageryProvider[] {
  return autoChain().filter((p) => coversArea(p, area));
}

/**
 * The next scan-allowed source after `provider` in its fallback chain, for a
 * plan part whose source has no data there. Sources that may only be viewed
 * are skipped. Null when the chain ends.
 */
export function nextScanProvider(provider: ImageryProvider): ImageryProvider | null {
  const seen = new Set<string>([provider.id]);
  let id = provider.fallback;
  while (id && !seen.has(id)) {
    seen.add(id);
    const p = findProvider(id);
    if (!p) return null;
    if (p.scanAllowed) return p;
    id = p.fallback;
  }
  return null;
}
