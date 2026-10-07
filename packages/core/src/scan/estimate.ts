import type { ImagerySetting, Ring } from '../types.js';
import { lonLatToTile } from '../geo/mercator.js';
import { ringAreaM2, ringBBox } from '../geo/polygon.js';
import { haloRing, splitPlanBySource } from './parts.js';

/**
 * Area limits, in z19-equivalent tiles (one 256 px tile at z19, about 0.3 m
 * per pixel). A product choice, not a measurement: 2 000 tiles is about
 * 7 min at 5 tiles/s, 10 000 about 33 min.
 */
export const PLAN_LIMITS = { warnTiles: 2_000, blockTiles: 10_000 } as const;

export type PlanLevel = 'ok' | 'warn' | 'block';

export interface PartEstimate {
  providerId: string;
  zoom: number;
  /** Tile requests for the part itself. */
  requests: number;
  /** Extra neighbour requests an XYZ halo needs (WMS grows each request instead). */
  haloRequests: number;
  z19Tiles: number;
  /** At the source's own rate. */
  seconds: number;
}

export interface PlanEstimate {
  level: PlanLevel;
  /** True when the area was too large to split tile by tile; counts are scaled from the bbox. */
  approximate: boolean;
  areaKm2: number;
  z19Tiles: number;
  requests: number;
  haloRequests: number;
  seconds: number;
  parts: PartEstimate[];
}

export function planLevel(z19Tiles: number): PlanLevel {
  if (z19Tiles > PLAN_LIMITS.blockTiles) return 'block';
  if (z19Tiles >= PLAN_LIMITS.warnTiles) return 'warn';
  return 'ok';
}

/**
 * What scanning an area would cost, per source and in total, and whether it
 * passes the limits. Areas whose bbox holds more than four times the block
 * limit are not split (that would take seconds on a phone); they come back
 * approximate and blocked.
 */
export function estimatePlan(
  area: Ring,
  setting: ImagerySetting = { mode: 'auto' },
  opts: { haloPx?: number } = {},
): PlanEstimate {
  const haloPx = opts.haloPx ?? 0;
  const areaM2 = ringAreaM2(area);
  const b = ringBBox(area);
  const nw = lonLatToTile(b.west, b.north, 19);
  const se = lonLatToTile(b.east, b.south, 19);
  const bboxTiles = (se.x - nw.x + 1) * (se.y - nw.y + 1);
  if (bboxTiles > 4 * PLAN_LIMITS.blockTiles) {
    const bboxM2 = ringAreaM2([
      [b.west, b.south],
      [b.east, b.south],
      [b.east, b.north],
      [b.west, b.north],
    ]);
    const z19Tiles = Math.round(bboxTiles * Math.min(1, areaM2 / Math.max(bboxM2, 1)));
    return {
      level: 'block',
      approximate: true,
      areaKm2: areaM2 / 1e6,
      z19Tiles,
      requests: z19Tiles,
      haloRequests: 0,
      seconds: z19Tiles / 5,
      parts: [],
    };
  }
  const split = splitPlanBySource(area, setting);
  const parts: PartEstimate[] = split.parts.map((p) => {
    const requests = p.plan.tiles.length;
    const haloRequests = haloPx > 0 && p.provider.kind === 'xyz' ? haloRing(p.plan.tiles.map((t) => t.tile)).length : 0;
    return {
      providerId: p.provider.id,
      zoom: p.plan.zoom,
      requests,
      haloRequests,
      z19Tiles: p.cells.length,
      seconds: (requests + haloRequests) / p.provider.rate.maxPerSec,
    };
  });
  const z19Tiles = parts.reduce((s, p) => s + p.z19Tiles, 0);
  return {
    level: planLevel(z19Tiles),
    approximate: false,
    areaKm2: areaM2 / 1e6,
    z19Tiles,
    requests: parts.reduce((s, p) => s + p.requests, 0),
    haloRequests: parts.reduce((s, p) => s + p.haloRequests, 0),
    seconds: parts.reduce((s, p) => s + p.seconds, 0),
    parts,
  };
}
