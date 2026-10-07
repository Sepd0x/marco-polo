/** A geographic coordinate in degrees (WGS84). */
export interface LonLat {
  lon: number;
  lat: number;
}

/** A slippy-map tile address (Web Mercator). */
export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** A geographic bounding box in degrees. */
export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A polygon ring as [lon, lat] pairs. Not required to be explicitly closed. */
export type Ring = [number, number][];

export type TraversalOrder = 'serpentine' | 'spiral';

/** One tile inside a scan plan, in traversal order. */
export interface ScanTile {
  tile: TileCoord;
  bbox: BBox;
  /** Position in the traversal sequence, 0-based. */
  index: number;
}

export interface ScanPlan {
  zoom: number;
  order: TraversalOrder;
  tiles: ScanTile[];
  /** Full tile range of the plan's bounding box (inclusive). */
  range: { minX: number; minY: number; maxX: number; maxY: number };
  /** Geodesic area of the drawn polygon, m². */
  areaM2: number;
  polygon: Ring;
}

export type DetectionKind = 'pool' | 'hot_tub';

/** Sides of a tile a component touches: the shape may continue in a neighbour tile. */
export interface EdgeTouch {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/** A candidate found inside a single tile, before cross-tile merging. */
export interface TileDetection {
  tile: TileCoord;
  pixelCount: number;
  /** Pixel-space bbox within the tile (inclusive). */
  bboxPx: { minX: number; minY: number; maxX: number; maxY: number };
  /** Geographic bbox. */
  bbox: BBox;
  center: LonLat;
  /** Traced outline in geographic coordinates. */
  outline: Ring;
  areaM2: number;
  meanHue: number;
  meanSat: number;
  meanVal: number;
  /** Fraction of pixels inside the strict "unmistakably pool" colour band. */
  strictRatio: number;
  /** pixelCount / bbox pixel area: how much of its bbox the shape fills. */
  fillRatio: number;
  /**
   * Mean local brightness gradient over the shape's interior (roughly 0 to 1).
   * Water is glassy-smooth; vegetation and photovoltaic arrays are textured.
   */
  texture: number;
  touches: EdgeTouch;
}

/** A merged, deduplicated detection: the unit the product ranks and displays. */
export interface Detection {
  id: string;
  kind: DetectionKind;
  center: LonLat;
  bbox: BBox;
  /** One or more outline rings (a shape merged across tiles keeps each traced part). */
  outline: Ring[];
  areaM2: number;
  confidence: number;
  pixelCount: number;
  /** Tiles that contributed fragments. */
  tiles: TileCoord[];
  /** True while (or if) the shape may extend beyond scanned/available imagery. */
  truncated: boolean;
  /** Largest contributing fragment, so a UI can crop a representative thumbnail. */
  primary: { tile: TileCoord; bboxPx: { minX: number; minY: number; maxX: number; maxY: number } };
  meanHue: number;
  meanSat: number;
  meanVal: number;
  strictRatio: number;
  fillRatio: number;
  texture: number;
}

export interface RankedDetection extends Detection {
  rank: number;
}

/*
 * Shared contracts for v2. Imagery sources, the detector seam and the result
 * format are fixed here so the web app, the CLI, the eval harness and the
 * training tools agree on one shape. Changes go through a dedicated commit.
 */

/** How a source is requested: a tile template or an OGC WMS GetMap URL. */
export type ImageryKind = 'xyz' | 'wms';

/**
 * Where tiles of a source may be kept.
 * - `persistent`: IndexedDB across sessions (open licences only).
 * - `session`: memory for the current session only.
 * - `http`: no app cache; the browser HTTP cache applies, honouring max-age.
 */
export type CachePolicy = 'persistent' | 'session' | 'http';

/** Area a source covers. `bbox` is a quick reject; `polygons` (lon/lat rings) decide. */
export interface Coverage {
  bbox: BBox;
  polygons: Ring[];
}

/** Request pacing for a source. `published` means the provider states the limit. */
export interface RateLimit {
  maxPerSec: number;
  basis: 'published' | 'chosen';
}

/** One imagery source the app can show and, if allowed, scan. */
export interface ImageryProvider {
  id: string;
  name: string;
  kind: ImageryKind;
  /**
   * URL template. XYZ: `{z}`, `{x}`, `{y}`. WMS: a GetMap URL with
   * `{bbox-epsg-3857}` and the width and height already set to `requestPx`.
   */
  template: string;
  /** WMS layer name, for provenance. */
  layer?: string;
  /** Logical tile size on the map grid, px. */
  tileSize: number;
  /** Pixels per side actually requested for one tile (512 for the DGT WMS). */
  requestPx: number;
  minZoom: number;
  maxZoom: number;
  /** Published ground sample distance, metres, or null when not published. */
  nativeResM: number | null;
  /** Capture date or year as published (`2025`, `2023-07`), or null. */
  date: string | null;
  /** null = global. */
  coverage: Coverage | null;
  /** Exact attribution text to display and export. */
  attribution: string;
  licence: string;
  licenceUrl: string;
  /** False when the licence only allows viewing: the source can be shown, never scanned. */
  scanAllowed: boolean;
  cachePolicy: CachePolicy;
  rate: RateLimit;
  /** Next source to try for a plan part when this one has no data there. */
  fallback?: string;
}

/** User choice of imagery. `auto` picks a source per area by coverage. */
export type ImagerySetting = { mode: 'auto' } | { mode: 'fixed'; providerId: string };

/**
 * Pixels handed to a detector: one central tile plus a halo of `halo` px
 * taken from its neighbours on every side. Row-major RGBA.
 */
export interface TileWindow {
  /** The central tile. Only components whose centroid falls inside it are reported. */
  tile: TileCoord;
  /** Side of the central tile in px (256 for XYZ, `requestPx` for WMS). */
  tilePx: number;
  /** Margin on each side, px. 0 means no halo. */
  halo: number;
  /** tilePx + 2 * halo. */
  width: number;
  height: number;
  pixels: Uint8ClampedArray | Uint8Array;
  /** Ground metres per pixel at the window centre, from the real bitmap width. */
  mPerPx: number;
}

export interface DetectContext {
  /** Source the pixels came from; detectors may calibrate per source. */
  providerId: string;
}

/** The seam between the scan pipeline and a detection method. */
export interface Detector {
  readonly id: string;
  /** Changes whenever the code or model behind the detector changes. */
  readonly version: string;
  detectTile(window: TileWindow, ctx: DetectContext): TileDetection[];
}

/** Where a detection's pixels came from. */
export interface Provenance {
  providerId: string;
  providerName: string;
  layer: string | null;
  /** Capture date or year, or null when unknown. */
  date: string | null;
  /** Zoom of the scan grid. */
  zoom: number;
  /** Published ground sample distance, metres, or null. */
  nativeResM: number | null;
  /** Plan part the detection belongs to (a plan split by source has one part per source). */
  partId: string;
}

/** Length and width from the minimum-area rectangle around the outline. */
export interface OrientedDims {
  lengthM: number;
  widthM: number;
  /** Heading of the long side, degrees clockwise from north, 0 to 180. */
  angleDeg: number;
}

/** A ranked detection as exported and shown in results. */
export interface ResultDetection extends RankedDetection {
  /** null = not measured (no reliable outline). */
  dims: OrientedDims | null;
  provenance: Provenance;
}

/** One part of a scan plan, scanned on a single source. */
export interface ScanPartSummary {
  id: string;
  provenance: Provenance;
  tiles: number;
  /** Tiles the source answered with no imagery (placeholder, blank, 404). */
  tilesNoCoverage: number;
  areaM2: number;
}

/** Result of one scan, the shape exports and the archive are built from. */
export interface ScanResult {
  formatVersion: 2;
  /** ISO timestamp. */
  createdAt: string;
  area: Ring;
  threshold: number;
  parts: ScanPartSummary[];
  /** Detections at or above the threshold, ranked. */
  detections: ResultDetection[];
  /** Detections found below the threshold, counted but not listed. */
  belowThreshold: number;
}
