import { orientedDims } from '../geo/obb.js';
import { ringAreaM2 } from '../geo/polygon.js';
import type { Detection, OrientedDims } from '../types.js';

/**
 * Below this share of its minimum-area rectangle a shape is too irregular
 * for a length and a width to describe it. On DEV the outlines below it got
 * the length wrong by about a third, the others by about an eighth.
 */
export const MIN_RECT_FILL = 0.6;

/**
 * Length and width of a detection from the minimum-area rectangle of its
 * outline, or null ("not measured") when the outline cannot be trusted for
 * that: the shape is cut by the edge of the scanned imagery, it was joined
 * from several traced parts, or it fills too little of its rectangle.
 */
export function measuredDims(d: Pick<Detection, 'outline' | 'truncated'>): OrientedDims | null {
  if (d.truncated || d.outline.length !== 1) return null;
  const dims = orientedDims(d.outline);
  if (!dims) return null;
  return ringAreaM2(d.outline[0]) / (dims.lengthM * dims.widthM) >= MIN_RECT_FILL ? dims : null;
}
