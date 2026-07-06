import type { TileCoord } from '@marco-polo/core';

/** Stable key for one detection fragment — links worker thumbnails to merged detections. */
export function fragKey(tile: TileCoord, bboxPx: { minX: number; minY: number }): string {
  return `${tile.z}/${tile.x}/${tile.y}:${bboxPx.minX},${bboxPx.minY}`;
}
