import type { BBox, LonLat } from '@marco-polo/core';
import type { Polygon } from './geom.js';

/**
 * A ground-truth object.
 *
 * `pool` labels count for recall. `ignore` labels (indoor, covered, inside a
 * building, or tagged only as a point) are real pools the benchmark cannot judge
 * fairly: a detection on one is neither a hit nor a false positive.
 */
export interface Label {
  id: string;
  source: 'osm' | 'visual';
  role: 'pool' | 'ignore';
  reason?: string;
  polygons: Polygon[];
  /** Point labels (OSM nodes) have no polygon; they match within `radiusM`. */
  point?: LonLat;
  radiusM?: number;
  bbox: BBox;
  centroid: LonLat;
  areaM2: number;
}

/** What any detector under test must return, one entry per object. */
export interface EvalDetection {
  id: string;
  center: LonLat;
  bbox: BBox;
  outline: Polygon[];
  areaM2: number;
  confidence: number;
  kind?: string;
  truncated?: boolean;
  /**
   * Length and width as the detector reports them. Absent: measured here from
   * the outline. null: the detector says "not measured".
   */
  dims?: { lengthM: number; widthM: number } | null;
}
