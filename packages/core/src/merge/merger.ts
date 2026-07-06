import type { BBox, Detection, DetectionKind, TileCoord, TileDetection } from '../types.js';
import { metersPerPixel } from '../geo/mercator.js';
import { bboxesIntersect, expandBBoxMeters, unionBBox } from '../geo/polygon.js';
import { scoreConfidence } from '../detect/detector.js';

export interface MergerOptions {
  /** Final emission floor, m². Edge fragments smaller than this wait for a merge. */
  minAreaM2: number;
  /** Final ceiling, m². Clusters that grow beyond it are reclassified as open water. */
  maxAreaM2: number;
  /** Area at or below which a detection is a hot tub rather than a pool, m². */
  hotTubMaxM2: number;
  /** Merge adjacency tolerance, in pixels at the scan zoom. */
  adjacencyPx: number;
}

export const DEFAULT_MERGER_OPTIONS: MergerOptions = {
  minAreaM2: 8,
  maxAreaM2: 2000,
  hotTubMaxM2: 10,
  adjacencyPx: 2.5,
};

export type MergerEvent =
  | { type: 'add'; detection: Detection }
  | { type: 'update'; detection: Detection }
  | { type: 'remove'; id: string };

interface Cluster {
  id: string;
  fragments: TileDetection[];
  bbox: BBox;
  emitted: boolean;
  /** True when the cluster outgrew maxAreaM2 and is treated as natural water. */
  suppressed: boolean;
  cached: Detection | null;
}

const tileKey = (t: TileCoord) => `${t.x},${t.y}`;

/**
 * Deduplicates detections across tile boundaries.
 *
 * A pool that straddles two (or four) tiles is detected as separate fragments,
 * each touching its tile's edge. The merger keeps a spatial index of clusters,
 * joins fragments whose geographic bounds meet within a couple of pixels across
 * facing edges, and re-emits the merged detection. It also tracks which tiles
 * have been processed, so a shape is only marked `truncated` while its
 * continuation is genuinely unknown (unscanned neighbour or outside the plan).
 */
export class DetectionMerger {
  private opts: MergerOptions;
  private clusters = new Set<Cluster>();
  private byTile = new Map<string, Set<Cluster>>();
  private processed = new Set<string>();
  private planTiles: Set<string> | null;
  private seq = 0;
  /** Count of clusters discarded for outgrowing the plausible pool size. */
  waterBodiesFiltered = 0;

  constructor(options: Partial<MergerOptions> = {}, planTiles?: Iterable<TileCoord>) {
    this.opts = { ...DEFAULT_MERGER_OPTIONS, ...options };
    this.planTiles = planTiles ? new Set(Array.from(planTiles, tileKey)) : null;
  }

  /**
   * Ingest the detections of one completed tile (call with an empty array for
   * tiles with no detections — completion itself resolves neighbours' edges).
   */
  addTileDetections(tile: TileCoord, detections: TileDetection[]): MergerEvent[] {
    const events: MergerEvent[] = [];
    this.processed.add(tileKey(tile));

    for (const frag of detections) {
      const target = this.placeFragment(frag, events);
      this.reemit(target, events);
    }

    // Completing this tile may settle the `truncated` state of neighbours that
    // were waiting on it, even if this tile contributed nothing.
    const neighbours = this.clustersAround(tile);
    for (const c of neighbours) {
      if (!c.emitted || c.suppressed) continue;
      const before = c.cached;
      const after = this.build(c);
      if (before && (before.truncated !== after.truncated || before.confidence !== after.confidence)) {
        c.cached = after;
        events.push({ type: 'update', detection: after });
      }
    }
    return events;
  }

  /** Emitted detections in their current state. */
  getAll(): Detection[] {
    const out: Detection[] = [];
    for (const c of this.clusters) {
      if (c.emitted && !c.suppressed && c.cached) out.push(c.cached);
    }
    return out;
  }

  /** Call once after the last tile: settles every remaining truncated flag. */
  finalize(): MergerEvent[] {
    const events: MergerEvent[] = [];
    for (const c of this.clusters) {
      if (!c.emitted || c.suppressed) continue;
      const after = this.build(c);
      if (c.cached && (c.cached.truncated !== after.truncated || c.cached.confidence !== after.confidence)) {
        c.cached = after;
        events.push({ type: 'update', detection: after });
      }
    }
    return events;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private placeFragment(frag: TileDetection, events: MergerEvent[]): Cluster {
    const touchesEdge = frag.touches.n || frag.touches.e || frag.touches.s || frag.touches.w;
    let matches: Cluster[] = [];

    if (touchesEdge) {
      const eps = this.opts.adjacencyPx * metersPerPixel(frag.center.lat, frag.tile.z);
      const probe = expandBBoxMeters(frag.bbox, eps);
      const candidates = this.clustersAround(frag.tile);
      for (const c of candidates) {
        if (bboxesIntersect(probe, c.bbox) && this.hasEdgeFragment(c)) matches.push(c);
      }
    }

    let target: Cluster;
    if (matches.length === 0) {
      target = {
        id: `p${++this.seq}`,
        fragments: [frag],
        bbox: frag.bbox,
        emitted: false,
        suppressed: false,
        cached: null,
      };
      this.clusters.add(target);
    } else {
      target = matches[0];
      for (const other of matches.slice(1)) {
        target.fragments.push(...other.fragments);
        target.bbox = unionBBox(target.bbox, other.bbox);
        if (other.emitted && !other.suppressed) events.push({ type: 'remove', id: other.id });
        this.clusters.delete(other);
        for (const set of this.byTile.values()) set.delete(other);
      }
      target.fragments.push(frag);
      target.bbox = unionBBox(target.bbox, frag.bbox);
    }
    this.indexCluster(target, frag.tile);
    return target;
  }

  private reemit(c: Cluster, events: MergerEvent[]): void {
    const areaM2 = c.fragments.reduce((s, f) => s + f.areaM2, 0);
    if (areaM2 > this.opts.maxAreaM2) {
      if (c.emitted && !c.suppressed) {
        events.push({ type: 'remove', id: c.id });
      }
      if (!c.suppressed) this.waterBodiesFiltered++;
      c.suppressed = true;
      c.cached = null;
      return;
    }
    if (areaM2 < this.opts.minAreaM2) return; // wait for more fragments (or never emit)
    const detection = this.build(c);
    c.cached = detection;
    if (c.emitted) {
      events.push({ type: 'update', detection });
    } else {
      c.emitted = true;
      events.push({ type: 'add', detection });
    }
  }

  private build(c: Cluster): Detection {
    let pixelCount = 0;
    let areaM2 = 0;
    let lon = 0, lat = 0, h = 0, s = 0, v = 0, strict = 0, fill = 0, tex = 0;
    let bbox = c.fragments[0].bbox;
    let primary = c.fragments[0];
    const tiles: TileCoord[] = [];
    const seen = new Set<string>();
    for (const f of c.fragments) {
      if (f.pixelCount > primary.pixelCount) primary = f;
      pixelCount += f.pixelCount;
      areaM2 += f.areaM2;
      lon += f.center.lon * f.pixelCount;
      lat += f.center.lat * f.pixelCount;
      h += f.meanHue * f.pixelCount;
      s += f.meanSat * f.pixelCount;
      v += f.meanVal * f.pixelCount;
      strict += f.strictRatio * f.pixelCount;
      fill += f.fillRatio * f.pixelCount;
      tex += f.texture * f.pixelCount;
      bbox = unionBBox(bbox, f.bbox);
      const k = tileKey(f.tile);
      if (!seen.has(k)) {
        seen.add(k);
        tiles.push(f.tile);
      }
    }
    const truncated = this.isTruncated(c);
    const meanHue = h / pixelCount;
    const meanSat = s / pixelCount;
    const strictRatio = strict / pixelCount;
    const fillRatio = fill / pixelCount;
    const texture = tex / pixelCount;
    const kind: DetectionKind = areaM2 <= this.opts.hotTubMaxM2 ? 'hot_tub' : 'pool';
    return {
      id: c.id,
      kind,
      center: { lon: lon / pixelCount, lat: lat / pixelCount },
      bbox,
      outline: c.fragments.map((f) => f.outline),
      areaM2,
      confidence: scoreConfidence({ meanHue, meanSat, strictRatio, fillRatio, texture, areaM2, truncated }),
      pixelCount,
      tiles,
      truncated,
      primary: { tile: primary.tile, bboxPx: primary.bboxPx },
      meanHue,
      meanSat,
      meanVal: v / pixelCount,
      strictRatio,
      fillRatio,
      texture,
    };
  }

  /** A cluster is truncated while any touched edge borders a tile we haven't seen. */
  private isTruncated(c: Cluster): boolean {
    for (const f of c.fragments) {
      const { x, y } = f.tile;
      const sides: Array<[boolean, number, number]> = [
        [f.touches.n, x, y - 1],
        [f.touches.s, x, y + 1],
        [f.touches.w, x - 1, y],
        [f.touches.e, x + 1, y],
      ];
      for (const [touching, nx, ny] of sides) {
        if (!touching) continue;
        const key = `${nx},${ny}`;
        if (this.planTiles && !this.planTiles.has(key)) return true; // beyond scan area
        if (!this.processed.has(key)) return true; // neighbour pending
      }
    }
    return false;
  }

  private hasEdgeFragment(c: Cluster): boolean {
    return c.fragments.some((f) => f.touches.n || f.touches.e || f.touches.s || f.touches.w);
  }

  private clustersAround(tile: TileCoord): Set<Cluster> {
    const out = new Set<Cluster>();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const set = this.byTile.get(`${tile.x + dx},${tile.y + dy}`);
        if (set) for (const c of set) out.add(c);
      }
    }
    return out;
  }

  private indexCluster(c: Cluster, tile: TileCoord): void {
    const key = tileKey(tile);
    let set = this.byTile.get(key);
    if (!set) {
      set = new Set();
      this.byTile.set(key, set);
    }
    set.add(c);
  }
}
