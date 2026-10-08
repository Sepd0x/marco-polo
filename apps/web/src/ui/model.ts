/*
 * What the panels show, worked out from the store in plain functions so it
 * can be tested without a browser. Components only format and lay it out.
 */
import {
  estimatePlan,
  findAnyProvider,
  orientedDims,
  pickProvider,
  rankDetections,
  ringAreaM2,
  tileBBox,
  type BBox,
  type ImageryProvider,
  type ImagerySetting,
  type OrientedDims,
  type PlanLevel,
  type RankedDetection,
  type Ring,
  type ScanPartSummary,
  type ScanTile,
  type TileCoord,
} from '@marco-polo/core';
import { fragKey } from '../lib/fragKey.js';

/** Every list and inspector crop covers the same ground width, so sizes compare at a glance. */
export const THUMB_VIEW_M = 30.5;

export type SortKey = 'largest' | 'score';

/** How each source was captured. Esri mixes satellite and aerial depending on the place. */
const SOURCE_KIND: Record<string, string> = {
  'dgt-ortos2025': 'aerial',
  'dgt-ortosat2023': 'satellite',
  pnoa: 'aerial',
  'ign-orthophotos': 'aerial',
  'esri-world-imagery': 'satellite and aerial',
};

export function sourceKind(providerId: string): string | null {
  return SOURCE_KIND[providerId] ?? null;
}

type WithDims = RankedDetection & { dims?: OrientedDims | null };

/**
 * Length and width from the minimum-area rectangle of the outline. A shape
 * cut by the edge of the imagery is not measured. Never estimated from area.
 */
export function dimsOf(d: WithDims): OrientedDims | null {
  if (d.dims !== undefined) return d.dims;
  if (d.truncated) return null;
  return orientedDims(d.outline);
}

/** One count, explained: what passes the minimum score, and how many fell below it. */
export function splitByScore(
  ranked: RankedDetection[],
  minScore: number,
  showHotTubs: boolean,
): { shown: RankedDetection[]; below: number; lowestBelow: number | null } {
  const kept = ranked.filter((d) => showHotTubs || d.kind !== 'hot_tub');
  const above = kept.filter((d) => d.confidence >= minScore);
  const under = kept.filter((d) => d.confidence < minScore);
  const lowestBelow = under.length ? Math.min(...under.map((d) => d.confidence)) : null;
  return { shown: rankDetections(above), below: under.length, lowestBelow };
}

/** The slider value that brings every pool below the threshold into the list. */
export function thresholdToShowAll(lowest: number): number {
  return Math.max(0, Math.floor(lowest * 20) / 20);
}

export function sortPools(list: RankedDetection[], key: SortKey): RankedDetection[] {
  if (key === 'largest') return list;
  return list.slice().sort((a, b) => b.confidence - a.confidence || a.rank - b.rank);
}

const tileKey = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

/**
 * The pool found in the most recently scanned tile: the detection whose
 * latest contributing tile comes last in the scan order.
 */
export function newestId(list: RankedDetection[], planTiles: ScanTile[] | null): string | null {
  if (!planTiles || list.length === 0) return null;
  const order = new Map(planTiles.map((t) => [tileKey(t.tile), t.index]));
  let best: string | null = null;
  let bestIdx = -1;
  for (const d of list) {
    let idx = -1;
    for (const t of d.tiles) idx = Math.max(idx, order.get(tileKey(t)) ?? -1);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = d.id;
    }
  }
  return best;
}

export type CellState = 'done' | 'busy' | 'wait';

/**
 * Progress cells in scan order. Tiles finish roughly in order, so the first
 * `done` cells are full and the ones up to the tile being fetched are busy.
 */
export function cellStates(total: number, done: number, current: number | null, paused: boolean): CellState[] {
  const out: CellState[] = [];
  const busyEnd = paused ? done - 1 : Math.max(done, current ?? done);
  for (let i = 0; i < total; i++) out.push(i < done ? 'done' : i <= busyEnd ? 'busy' : 'wait');
  return out;
}

/** Above this many tiles the cells become one continuous bar. */
export const MAX_CELLS = 80;

export interface SourceFacts {
  id: string;
  name: string;
  kind: string | null;
  resM: number | null;
  date: string | null;
  tiles: number;
  zoom: number;
  /** Tiles the source answered without imagery; null when not counted. */
  noCoverage: number | null;
  rate: number;
}

export interface AreaFacts {
  areaM2: number;
  tiles: number;
  approximate: boolean;
  level: PlanLevel;
  /** At the chosen rate, capped by each source. */
  seconds: number;
  /** The slowest source sets the pace the panel quotes. */
  rate: number;
  sources: SourceFacts[];
}

function sourceFacts(p: ImageryProvider, tiles: number, zoom: number, ratePerSec: number, date?: string | null): SourceFacts {
  return {
    id: p.id,
    name: p.name,
    kind: sourceKind(p.id),
    resM: p.nativeResM,
    date: date === undefined ? p.date : date,
    tiles,
    zoom,
    noCoverage: null,
    rate: Math.min(ratePerSec, p.rate.maxPerSec),
  };
}

/** Size, tiles, sources and time for a drawn area, before scanning it. */
export function areaFacts(area: Ring, imagery: ImagerySetting, ratePerSec: number): AreaFacts {
  const est = estimatePlan(area, imagery);
  const sources: SourceFacts[] = [];
  let seconds = 0;
  for (const part of est.parts) {
    const p = findAnyProvider(part.providerId);
    if (!p) continue;
    const s = sourceFacts(p, part.requests, part.zoom, ratePerSec);
    seconds += (part.requests + part.haloRequests) / s.rate;
    sources.push(s);
  }
  const rate = sources.length ? Math.min(...sources.map((s) => s.rate)) : ratePerSec;
  if (est.approximate) seconds = est.requests / rate;
  return {
    areaM2: ringAreaM2(area),
    tiles: est.requests,
    approximate: est.approximate,
    level: est.level,
    seconds,
    rate,
    sources,
  };
}

/** Sources of a finished scan, from its parts when the scan reports them. */
export function scannedSources(parts: ScanPartSummary[], ratePerSec: number): SourceFacts[] {
  const out: SourceFacts[] = [];
  for (const part of parts) {
    const p = findAnyProvider(part.provenance.providerId);
    const base: SourceFacts = p
      ? sourceFacts(p, part.tiles, part.provenance.zoom, ratePerSec, part.provenance.date)
      : {
          id: part.provenance.providerId,
          name: part.provenance.providerName,
          kind: null,
          resM: part.provenance.nativeResM,
          date: part.provenance.date,
          tiles: part.tiles,
          zoom: part.provenance.zoom,
          noCoverage: null,
          rate: ratePerSec,
        };
    out.push({ ...base, noCoverage: part.tilesNoCoverage });
  }
  return out;
}

/** The source the imagery chip names: the fixed choice, or what `auto` picks at a point. */
export function chipSource(imagery: ImagerySetting, point: { lon: number; lat: number } | null): ImageryProvider | null {
  if (imagery.mode === 'fixed') return findAnyProvider(imagery.providerId) ?? null;
  return point ? pickProvider(point, imagery) : null;
}

export interface ThumbImage {
  url: string;
  /** Ground the image covers. */
  bbox: BBox;
}

const THUMB_PAD_PX = 6;

/**
 * The stored crop for a detection, with the ground it covers. Crops are cut
 * from the primary fragment's bitmap with a fixed margin; the bitmap is taken
 * as one 256 px tile unless the crop says otherwise.
 */
export function thumbFor(
  d: RankedDetection,
  thumbs: Record<string, string | ThumbImage>,
  tilePx = 256,
): ThumbImage | null {
  const v = thumbs[fragKey(d.primary.tile, d.primary.bboxPx)];
  if (!v) return null;
  if (typeof v !== 'string') return v;
  const b = tileBBox(d.primary.tile);
  const { minX, minY, maxX, maxY } = d.primary.bboxPx;
  const x0 = Math.max(0, minX - THUMB_PAD_PX);
  const y0 = Math.max(0, minY - THUMB_PAD_PX);
  const x1 = Math.min(tilePx, maxX + 1 + THUMB_PAD_PX);
  const y1 = Math.min(tilePx, maxY + 1 + THUMB_PAD_PX);
  const lon = (px: number) => b.west + (px / tilePx) * (b.east - b.west);
  // Latitude is not linear in pixels, but over a few metres the error is far below a pixel.
  const lat = (py: number) => b.north - (py / tilePx) * (b.north - b.south);
  return { url: v, bbox: { west: lon(x0), east: lon(x1), north: lat(y0), south: lat(y1) } };
}

/** Local metres east and south of a centre point; good to a few cm over 50 m. */
export function localMetres(center: { lon: number; lat: number }) {
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const ky = 110_574;
  return (lon: number, lat: number): [number, number] => [(lon - center.lon) * kx, (center.lat - lat) * ky];
}

/** Two passes of Chaikin's corner cutting, for drawing only; areas come from the mask. */
export function chaikin(points: [number, number][], iterations = 2): [number, number][] {
  let p = points;
  if (p.length > 1) {
    const a = p[0];
    const z = p[p.length - 1];
    if (a[0] === z[0] && a[1] === z[1]) p = p.slice(0, -1);
  }
  for (let k = 0; k < iterations && p.length > 2; k++) {
    const q: [number, number][] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

/** Bounding box of the map view as a ring, for "Scan this view". */
export function viewRing(bbox: [number, number, number, number], inset = 0.04): Ring {
  const [w, s, e, n] = bbox;
  const dx = (e - w) * inset;
  const dy = (n - s) * inset;
  return [
    [w + dx, s + dy],
    [e - dx, s + dy],
    [e - dx, n - dy],
    [w + dx, n - dy],
  ];
}
