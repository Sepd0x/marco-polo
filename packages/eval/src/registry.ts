import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BBox } from '@marco-polo/core';
import type { SourceId } from './candidates.js';

export const ZONES_DIR = fileURLToPath(new URL('../zones/', import.meta.url));

export type Role = 'DEV' | 'DEV-2' | 'GOLD' | 'TEST' | 'TRAIN';
export const ROLES: readonly Role[] = ['DEV', 'DEV-2', 'GOLD', 'TEST', 'TRAIN'];

/**
 * Review depth of a zone's labels:
 *   full        every window looked at by eye with the existing labels shown
 *   candidates  every unlabelled colour candidate plus a sample of windows
 *   blind       every window looked at on clean imagery, no detections and no
 *               OSM shown; OSM merged afterwards and checked point by point
 *   gold-union  phase 0 gold: union of the regions the methods proposed,
 *               checked by eye; pools no method proposed can be missing
 */
export type Review = 'full' | 'candidates' | 'blind' | 'gold-union';

export interface ZoneDef {
  id: string;
  name: string;
  role: Role;
  country: string;
  /** Source the product scans here (F1 of the plan). */
  productSource: SourceId;
  /** Source the hand labels were drawn on. */
  labelSource: SourceId;
  bbox: BBox;
  areaKm2: number;
  why: string;
  review: Review;
  /** OSM shift per source, metres [east, north], measured with `eval offset`. */
  osmShiftM?: Partial<Record<SourceId, [number, number]>>;
  /** Shift of the hand labels onto another source, metres [east, north]. */
  labelShiftM?: Partial<Record<SourceId, [number, number]>>;
  /** TEST strata and the hard/negative strata reported apart. */
  stratum?: string;
  reportedApart?: boolean;
}

export interface SeenSite {
  id: string;
  center: [number, number];
  from: string;
}

export interface Registry {
  about: string;
  minDistanceKm: number;
  zones: ZoneDef[];
  seen: SeenSite[];
  notSeen?: { reason: string; sites: string[] };
}

export function loadRegistry(dir = ZONES_DIR): Registry {
  return JSON.parse(readFileSync(`${dir}registry.json`, 'utf8')) as Registry;
}

export function zoneCenter(z: Pick<ZoneDef, 'bbox'>): [number, number] {
  return [(z.bbox.south + z.bbox.north) / 2, (z.bbox.west + z.bbox.east) / 2];
}

/** Great-circle distance, km. */
export function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface ProtectedSite {
  id: string;
  kind: Role | 'seen';
  center: [number, number];
}

/** Everything a TEST zone must keep its distance from. */
export function protectedSites(reg: Registry, exceptTestId?: string): ProtectedSite[] {
  return [
    ...reg.zones.filter((z) => z.id !== exceptTestId).map((z) => ({ id: z.id, kind: z.role, center: zoneCenter(z) })),
    ...reg.seen.map((s) => ({ id: s.id, kind: 'seen' as const, center: s.center })),
  ];
}

export function nearest(center: [number, number], sites: ProtectedSite[]): { site: ProtectedSite; km: number } | null {
  let best: { site: ProtectedSite; km: number } | null = null;
  for (const s of sites) {
    const km = haversineKm(center, s.center);
    if (!best || km < best.km) best = { site: s, km };
  }
  return best;
}

export interface CheckIssue {
  zone: string;
  problem: string;
}

/**
 * Registry rules: ids unique, roles known, and every TEST zone at least
 * `minDistanceKm` from every other zone (TEST included) and every seen site.
 * TRAIN zones added later are caught by the same rule seen from the TEST side.
 */
export function checkRegistry(reg: Registry): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const ids = new Set<string>();
  for (const z of reg.zones) {
    if (ids.has(z.id)) issues.push({ zone: z.id, problem: 'duplicate id' });
    ids.add(z.id);
    if (!ROLES.includes(z.role)) issues.push({ zone: z.id, problem: `unknown role ${z.role}` });
    const b = z.bbox;
    if (!(b.west < b.east && b.south < b.north)) issues.push({ zone: z.id, problem: 'empty bbox' });
    if (z.role === 'TEST' && !z.stratum) issues.push({ zone: z.id, problem: 'TEST zone without a stratum' });
  }
  for (const t of reg.zones.filter((z) => z.role === 'TEST')) {
    for (const s of protectedSites(reg, t.id)) {
      const km = haversineKm(zoneCenter(t), s.center);
      if (km < reg.minDistanceKm) {
        issues.push({ zone: t.id, problem: `${km.toFixed(1)} km from ${s.kind} ${s.id} (minimum ${reg.minDistanceKm} km)` });
      }
    }
  }
  return issues;
}
