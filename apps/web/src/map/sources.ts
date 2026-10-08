import type { ImageryProvider } from '@marco-polo/core';

/**
 * How imagery is put on the map. MapLibre picks the tile zoom for a raster
 * source as round(Z + log2(512 / tileSize)) and draws a 256 px image over
 * `tileSize` CSS px, so the sharpness on screen depends only on tileSize and
 * the device pixel ratio. These functions are kept pure so the rules in the
 * plan (sharpness, which tiles load near the top, the zoom ceiling) can be
 * tested without a browser.
 */

export interface DisplayOptions {
  devicePixelRatio: number;
  /** `navigator.connection.saveData`: fewer, coarser requests. */
  saveData: boolean;
}

/** Ceiling on device pixels per image pixel below the zoom where a source runs out of detail. */
export const MAX_DEVICE_PX_PER_IMAGE_PX = 1.42;

/** Image pixels of an XYZ tile. */
const IMAGE_PX = 256;

/** Largest WMS image asked for one map tile. */
const MAX_WMS_PX = 512;

/**
 * From this many zoom levels under the source's top level, only top-level
 * tiles are loaded, so what is on screen near the top is the same imagery
 * the scan reads.
 */
export const TOP_LEVEL_BAND = 2.5;

/** Map zoom ceiling under the source's top level. */
export const OVERZOOM_ALLOWANCE = 0.5;

function clampDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.min(3, Math.max(1, dpr));
}

/**
 * CSS size of one tile. 256 / DPR puts one image pixel on about one device
 * pixel (128 at DPR 2). Data saver keeps 256: a quarter of the requests.
 */
export function displayTileSize(o: DisplayOptions): number {
  if (o.saveData) return 256;
  return Math.round(IMAGE_PX / clampDpr(o.devicePixelRatio));
}

/** Pixels per side of a WMS request for a tile of `tileSize` CSS px. */
export function wmsRequestPx(tileSize: number, o: DisplayOptions): number {
  return Math.min(MAX_WMS_PX, Math.round(tileSize * clampDpr(o.devicePixelRatio)));
}

/** Image pixels per tile for a source shown at `tileSize`. */
export function imagePxPerTile(provider: ImageryProvider, tileSize: number, o: DisplayOptions): number {
  return provider.kind === 'wms' ? wmsRequestPx(tileSize, o) : IMAGE_PX;
}

/** Tile zoom MapLibre requests for a raster source at map zoom `zoom`. */
export function requestedTileZoom(zoom: number, tileSize: number, maxzoom: number): number {
  return Math.min(maxzoom, Math.max(0, Math.round(zoom + Math.log2(512 / tileSize))));
}

/** Device pixels covering one image pixel at map zoom `zoom`. */
export function devicePxPerImagePx(
  zoom: number,
  tileSize: number,
  imagePx: number,
  maxzoom: number,
  o: DisplayOptions,
): number {
  const tz = requestedTileZoom(zoom, tileSize, maxzoom);
  const cssPerTile = tileSize * 2 ** (zoom + Math.log2(512 / tileSize) - tz);
  return (cssPerTile * clampDpr(o.devicePixelRatio)) / imagePx;
}

/** Map zoom ceiling for a source. */
export function mapMaxZoom(provider: ImageryProvider): number {
  return provider.maxZoom - OVERZOOM_ALLOWANCE;
}

/**
 * A tileSize loads only top-level tiles from `maxzoom - TOP_LEVEL_BAND` up
 * when round(maxzoom - 2.5 + log2(512 / ts)) >= maxzoom, that is ts <= 128.
 */
const TOP_BAND_TILE_SIZE = 128;

export interface RasterPiece {
  sourceId: string;
  source: {
    type: 'raster';
    tiles: string[];
    tileSize: number;
    minzoom: number;
    maxzoom: number;
    bounds?: [number, number, number, number];
    attribution: string;
  };
  layer: {
    id: string;
    type: 'raster';
    source: string;
    minzoom?: number;
    maxzoom?: number;
    paint: Record<string, unknown>;
  };
}

export interface PieceOptions {
  /** Turns a filled-in provider template into the URL MapLibre requests. */
  url?: (template: string, imagePx: number) => string;
  /** Limits requests to this box (west, south, east, north). */
  bounds?: [number, number, number, number];
}

/** XYZ template as is; a WMS GetMap with its WIDTH and HEIGHT set to `px`. */
export function templateFor(provider: ImageryProvider, px: number): string {
  if (provider.kind !== 'wms') return provider.template;
  return provider.template.replace(/([?&])WIDTH=\d+/i, `$1WIDTH=${px}`).replace(/([?&])HEIGHT=\d+/i, `$1HEIGHT=${px}`);
}

/** Source bounds: the coverage box, clipped to `bounds` when given. */
function boundsFor(provider: ImageryProvider, extra?: [number, number, number, number]): [number, number, number, number] | undefined {
  const c = provider.coverage?.bbox;
  if (!c && !extra) return undefined;
  if (!c) return extra;
  const own: [number, number, number, number] = [c.west, c.south, c.east, c.north];
  if (!extra) return own;
  return [Math.max(own[0], extra[0]), Math.max(own[1], extra[1]), Math.min(own[2], extra[2]), Math.min(own[3], extra[3])];
}

/**
 * Sources and layers that show one provider. One piece when the tile size
 * already keeps the top band on top-level tiles; otherwise a second piece at
 * 128 px takes over from `maxzoom - TOP_LEVEL_BAND`. The top piece starts
 * half a level early so it has tiles in hand when the lower one hides.
 */
export function rasterPieces(prefix: string, provider: ImageryProvider, o: DisplayOptions, opts: PieceOptions = {}): RasterPiece[] {
  const ts = displayTileSize(o);
  const bounds = boundsFor(provider, opts.bounds);
  const make = (suffix: string, tileSize: number, zoomRange: { minzoom?: number; maxzoom?: number }): RasterPiece => {
    const px = imagePxPerTile(provider, tileSize, o);
    const template = templateFor(provider, px);
    const sourceId = `${prefix}${suffix}`;
    return {
      sourceId,
      source: {
        type: 'raster',
        tiles: [opts.url ? opts.url(template, px) : template],
        tileSize,
        minzoom: provider.minZoom,
        maxzoom: provider.maxZoom,
        ...(bounds ? { bounds } : {}),
        attribution: provider.attribution,
      },
      layer: {
        id: sourceId,
        type: 'raster',
        source: sourceId,
        ...zoomRange,
        paint: { 'raster-fade-duration': 120 },
      },
    };
  };
  if (ts <= TOP_BAND_TILE_SIZE) return [make('', ts, {})];
  const from = provider.maxZoom - TOP_LEVEL_BAND;
  return [make('', ts, { maxzoom: from }), make('-top', TOP_BAND_TILE_SIZE, { minzoom: from - 0.5 })];
}

/** Current display options of this browser. */
export function browserDisplay(): DisplayOptions {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }) : null;
  return {
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    saveData: nav?.connection?.saveData === true,
  };
}
