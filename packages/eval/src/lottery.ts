/**
 * The TEST draw. Pure functions here (hashing, grid, eligibility); the
 * network part (boundaries, OSM features, Esri metadata) is in drawzones.ts.
 * The rules are the ones written in zones/test-candidates.json.
 */
import { createHash } from 'node:crypto';
import type { BBox, LonLat } from '@marco-polo/core';
import { pointInPolygons, type Polygon } from './geom.js';
import type { Candidate } from './candidates.js';
import { haversineKm, type ProtectedSite } from './registry.js';

export function hashIndex(key: string, n: number): number {
  if (n <= 0) throw new Error('hashIndex over an empty list');
  const hex = createHash('sha256').update(key, 'utf8').digest('hex');
  return Number(BigInt('0x' + hex) % BigInt(n));
}

export const municipalityKey = (listCommit: string, stratum: string) => `${listCommit}:${stratum}`;
export const cellKey = (listCommit: string, stratum: string, code: string) => `${listCommit}:${stratum}:cell:${code}`;

export function regionExcluded(stratum: string, c: Candidate, excluded: Record<string, string[]>): boolean {
  return (excluded[stratum] ?? []).includes(c.region);
}

/** A fixed minimum distance, or one per protected site (rules v2 relax some kinds of site in one stratum). */
export type MinKm = number | ((site: ProtectedSite) => number);
const limitOf = (minKm: MinKm, s: ProtectedSite) => (typeof minKm === 'number' ? minKm : minKm(s));
export const farEnough = (at: [number, number], sites: ProtectedSite[], minKm: MinKm) => sites.every((s) => haversineKm(at, s.center) >= limitOf(minKm, s));

export function eligibleMunicipalities(
  stratum: string,
  list: Candidate[],
  sites: ProtectedSite[],
  minKm: MinKm,
  excluded: Record<string, string[]>,
): Candidate[] {
  return list.filter((c) => !regionExcluded(stratum, c, excluded) && farEnough(c.center, sites, minKm));
}

/** Order in which municipalities are tried: the hashed start, then i + 1, i + 2, ... mod n. */
export function drawOrder(listCommit: string, stratum: string, n: number): number[] {
  const i0 = hashIndex(municipalityKey(listCommit, stratum), n);
  return Array.from({ length: n }, (_, k) => (i0 + k) % n);
}

export interface Cell {
  row: number;
  col: number;
  bbox: BBox;
  center: LonLat;
}

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Square cells of `sizeKm`, from the south-west corner, rows south to north, west to east inside a row. */
export function gridCells(bounds: BBox, sizeKm: number): Cell[] {
  const latC = (bounds.south + bounds.north) / 2;
  const dLat = sizeKm / KM_PER_DEG_LAT;
  const dLon = sizeKm / kmPerDegLon(latC);
  const rows = Math.ceil((bounds.north - bounds.south) / dLat);
  const cols = Math.ceil((bounds.east - bounds.west) / dLon);
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const south = bounds.south + row * dLat;
      const west = bounds.west + col * dLon;
      const bbox = { west, south, east: west + dLon, north: south + dLat };
      cells.push({ row, col, bbox, center: { lon: west + dLon / 2, lat: south + dLat / 2 } });
    }
  }
  return cells;
}

/** Share of a 21 x 21 lattice (corners and edges included) inside the features. */
export function featureShare(cell: BBox, features: Polygon[]): number {
  const near = features.filter((p) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [lon, lat] of p[0] ?? []) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    return w <= cell.east && e >= cell.west && s <= cell.north && n >= cell.south;
  });
  if (!near.length) return 0;
  let inside = 0;
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const p = { lon: cell.west + ((cell.east - cell.west) * i) / 20, lat: cell.south + ((cell.north - cell.south) * j) / 20 };
      if (pointInPolygons(p, near)) inside++;
    }
  }
  return inside / 441;
}

export function eligibleCells(
  cells: Cell[],
  boundary: Polygon[],
  features: Polygon[],
  sites: ProtectedSite[],
  minKm: MinKm,
  minShare: number,
): Array<Cell & { share: number }> {
  const out: Array<Cell & { share: number }> = [];
  for (const c of cells) {
    if (!pointInPolygons(c.center, boundary)) continue;
    const at: [number, number] = [c.center.lat, c.center.lon];
    if (!farEnough(at, sites, minKm)) continue;
    const share = featureShare(c.bbox, features);
    if (share >= minShare) out.push({ ...c, share });
  }
  return out;
}

/** Solar elevation at local solar noon, degrees (declination after Cooper, 1969). */
export function noonElevationDeg(lat: number, isoDate: string): number {
  const d = new Date(isoDate + 'T12:00:00Z');
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((d.getTime() - start) / 86_400_000) + 1;
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (284 + doy));
  return 90 - Math.abs(lat - decl);
}

/** The pre-registered "hard imagery" condition on an Esri capture date. */
export function isHardCapture(lat: number, isoDate: string): boolean {
  const month = Number(isoDate.slice(5, 7));
  return month >= 11 || month <= 2 || noonElevationDeg(lat, isoDate) < 35;
}
