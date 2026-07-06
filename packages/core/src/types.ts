/** A geographic coordinate in degrees (WGS84). */
export interface LonLat {
  lon: number;
  lat: number;
}

/** A slippy-map tile address (Web Mercator, 256px tiles). */
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

/** Sides of a tile a component touches — signals a shape may continue in a neighbour tile. */
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
  /** pixelCount / bbox pixel area — how much of its bbox the shape fills. */
  fillRatio: number;
  /**
   * Mean local brightness gradient over the shape's interior (0–1-ish).
   * Water is glassy-smooth; vegetation and photovoltaic arrays are textured.
   */
  texture: number;
  touches: EdgeTouch;
}

/** A merged, deduplicated detection — the unit the product ranks and displays. */
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
  /** Largest contributing fragment — lets a UI crop a representative thumbnail. */
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
