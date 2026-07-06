import type { BBox, LonLat, TileCoord } from '../types.js';

export const TILE_SIZE = 256;
export const EARTH_RADIUS = 6378137;
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS; // ≈ 40,075,016.686 m
/** Web Mercator latitude limit. */
export const MAX_LATITUDE = 85.05112877980659;

const DEG = Math.PI / 180;

export function clampLatitude(lat: number): number {
  return Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, lat));
}

/** Longitude → world pixel X at zoom z (0 .. 2^z·256). */
export function lonToWorldX(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** z;
}

/** Latitude → world pixel Y at zoom z (0 at north edge). */
export function latToWorldY(lat: number, z: number): number {
  const phi = clampLatitude(lat) * DEG;
  const y = (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2;
  return y * TILE_SIZE * 2 ** z;
}

export function worldXToLon(x: number, z: number): number {
  return (x / (TILE_SIZE * 2 ** z)) * 360 - 180;
}

export function worldYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / (TILE_SIZE * 2 ** z));
  return Math.atan(Math.sinh(n)) / DEG;
}

/** The tile containing a coordinate. */
export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const max = 2 ** z - 1;
  const x = Math.min(max, Math.max(0, Math.floor(lonToWorldX(lon, z) / TILE_SIZE)));
  const y = Math.min(max, Math.max(0, Math.floor(latToWorldY(lat, z) / TILE_SIZE)));
  return { z, x, y };
}

/** Geographic bounds of a tile. */
export function tileBBox(tile: TileCoord): BBox {
  const { z, x, y } = tile;
  return {
    west: worldXToLon(x * TILE_SIZE, z),
    east: worldXToLon((x + 1) * TILE_SIZE, z),
    north: worldYToLat(y * TILE_SIZE, z),
    south: worldYToLat((y + 1) * TILE_SIZE, z),
  };
}

/** Convert a pixel position inside a tile to a geographic coordinate. */
export function tilePixelToLonLat(tile: TileCoord, px: number, py: number): LonLat {
  return {
    lon: worldXToLon(tile.x * TILE_SIZE + px, tile.z),
    lat: worldYToLat(tile.y * TILE_SIZE + py, tile.z),
  };
}

/**
 * Ground resolution in metres per pixel at a given latitude and zoom.
 * Derived from the Web Mercator scale factor: m/px = cos(lat)·C / (256·2^z).
 */
export function metersPerPixel(lat: number, z: number): number {
  return (Math.cos(clampLatitude(lat) * DEG) * EARTH_CIRCUMFERENCE) / (TILE_SIZE * 2 ** z);
}

/** Fill a `{z}/{x}/{y}` URL template. */
export function tileUrl(template: string, tile: TileCoord): string {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
}
