/*
 * What the panels show, worked out from the store in plain functions so it
 * can be tested without a browser. Components only format and lay it out.
 */
import {
  estimatePlan,
  findAnyProvider,
  measuredDims,
  metersPerPixelOfBitmap,
  pickProvider,
  PLAN_LIMITS,
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
import { partOfDetection } from '../scan/ids.js';
import { haloFor, PRODUCT_DETECTOR_ID, THUMB_PAD, thumbRect } from '../scan/tileWork.js';

/** Every list and inspector crop covers the same ground width, so sizes compare at a glance. */
export { THUMB_VIEW_M } from '../scan/tileWork.js';

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
 * Length and width from the minimum-area rectangle of the outline, by the
 * same rule as the export (`measuredDims`): a shape cut by the edge of the
 * imagery, joined from parts or too irregular is not measured. Never
 * estimated from area.
 */
export function dimsOf(d: WithDims): OrientedDims | null {
  if (d.dims !== undefined) return d.dims;
  return measuredDims(d);
}

/** One count, explained: what passes the minimum score, and how many fell below it. */
export function splitByScore(
  ranked: RankedDetection[],
  minScore: number | ((d: RankedDetection) => number),
  showHotTubs: boolean,
): { shown: RankedDetection[]; below: number; lowestBelow: number | null } {
  const cut = typeof minScore === 'number' ? () => minScore : minScore;
  const kept = ranked.filter((d) => showHotTubs || d.kind !== 'hot_tub');
  const above = kept.filter((d) => d.confidence >= cut(d));
  const under = kept.filter((d) => d.confidence < cut(d));
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
  /** About the largest area that can be scanned here, m² (the limit counts z19 tiles). */
  maxAreaM2: number;
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
  const areaM2 = ringAreaM2(area);
  return {
    areaM2,
    maxAreaM2: est.z19Tiles > 0 ? (areaM2 * PLAN_LIMITS.blockTiles) / est.z19Tiles : Infinity,
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

/** Where a detection's thumbnail was cut from: the bitmap of its primary tile and the halo around it. */
export interface ThumbFrame {
  tilePx: number;
  halo: number;
  legacy?: boolean;
}

/** Crops of scans saved before the v2 detector: shape plus margin, cut to the 256 px tile. */
const V1_FRAME: ThumbFrame = { tilePx: 256, halo: 0, legacy: true };

/**
 * The frame a detection's crop was cut in. A detection on the part's own
 * grid came from the v2 window (the part's bitmap plus its halo); one a zoom
 * level deeper is a v1 piece of a 512 px tile, from an older archive.
 */
export function thumbFrame(d: RankedDetection, parts: readonly { id: string; providerId: string; zoom: number }[]): ThumbFrame {
  const partId = partOfDetection(d.id);
  const part = partId ? parts.find((p) => p.id === partId) : undefined;
  if (!part || d.primary.tile.z !== part.zoom) return V1_FRAME;
  const tilePx = findAnyProvider(part.providerId)?.requestPx ?? 256;
  return { tilePx, halo: haloFor(PRODUCT_DETECTOR_ID, tilePx) };
}

/**
 * The stored crop for a detection, with the ground it covers. The worker
 * cuts it from the primary fragment's window with a fixed margin and a size
 * cap; this works out the same rectangle.
 */
export function thumbFor(
  d: RankedDetection,
  thumbs: Record<string, string | ThumbImage>,
  frame: ThumbFrame = V1_FRAME,
): ThumbImage | null {
  const v = thumbs[fragKey(d.primary.tile, d.primary.bboxPx)];
  if (!v) return null;
  if (typeof v !== 'string') return v;
  const { tilePx, halo } = frame;
  const b = tileBBox(d.primary.tile);
  const box = d.primary.bboxPx;
  let x0: number, y0: number, x1: number, y1: number;
  if (frame.legacy) {
    x0 = Math.max(0, box.minX - THUMB_PAD);
    y0 = Math.max(0, box.minY - THUMB_PAD);
    x1 = Math.min(x0 + 120, tilePx, box.maxX + 1 + THUMB_PAD);
    y1 = Math.min(y0 + 120, tilePx, box.maxY + 1 + THUMB_PAD);
  } else {
    ({ x0, y0, x1, y1 } = thumbRect(box, tilePx, halo, metersPerPixelOfBitmap(d.primary.tile, tilePx)));
  }
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
