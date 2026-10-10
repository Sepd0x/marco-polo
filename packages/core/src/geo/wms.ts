import type { ImageryProvider, TileCoord } from '../types.js';
import { formatMetres, tileBBox3857, tileUrl } from './mercator.js';

/** One HTTP request for a tile, with the bitmap size it should come back at. */
export interface TileRequest {
  url: string;
  /** Pixels per side the server is asked for (tile plus halo on both sides). */
  width: number;
  height: number;
  /** Halo included in the bitmap on every side, px. */
  halo: number;
  /** Same bytes from the provider's mirror, when it has one (XYZ only). */
  mirrorUrl?: string;
}

/**
 * URL for one tile of a WMS source, optionally grown by `haloPx` pixels on
 * every side. The bbox grows by the same ground distance, so the central
 * `requestPx` square keeps exactly the tile bounds.
 */
export function wmsTileRequest(provider: ImageryProvider, tile: TileCoord, haloPx = 0): TileRequest {
  if (provider.kind !== 'wms') throw new Error(`${provider.id} is not a WMS source`);
  if (!Number.isInteger(haloPx) || haloPx < 0) throw new RangeError(`halo must be a whole number of px, got ${haloPx}`);
  const [minX, minY, maxX, maxY] = tileBBox3857(tile);
  const grow = (haloPx * (maxX - minX)) / provider.requestPx;
  const bbox = [minX - grow, minY - grow, maxX + grow, maxY + grow].map(formatMetres).join(',');
  const side = provider.requestPx + 2 * haloPx;
  const url = provider.template
    .replaceAll('{bbox-epsg-3857}', bbox)
    .replace(/([?&]WIDTH=)\d+/i, `$1${side}`)
    .replace(/([?&]HEIGHT=)\d+/i, `$1${side}`);
  return { url, width: side, height: side, halo: haloPx };
}

/**
 * The request for a tile of any source. XYZ sources have no halo in one
 * request; their halo is assembled from neighbour tiles (`buildTileWindow`).
 */
export function tileRequest(provider: ImageryProvider, tile: TileCoord, haloPx = 0): TileRequest {
  if (provider.kind === 'wms') return wmsTileRequest(provider, tile, haloPx);
  const req: TileRequest = { url: tileUrl(provider.template, tile), width: provider.requestPx, height: provider.requestPx, halo: 0 };
  if (provider.mirror) req.mirrorUrl = tileUrl(provider.mirror, tile);
  return req;
}

/**
 * Which server a fetcher asks first, for a provider with a mirror. Both serve
 * the same bytes; once the main one fails and the mirror answers, the mirror
 * goes first for the rest of the session, so an outage costs one failed
 * request instead of one per tile. A mirror failure hands the lead back.
 */
export class MirrorChoice {
  private mirrorFirst = false;

  /** URLs to try, in order. */
  order(url: string, mirrorUrl?: string): string[] {
    if (!mirrorUrl) return [url];
    return this.mirrorFirst ? [mirrorUrl, url] : [url, mirrorUrl];
  }

  /** Record which URL answered. */
  answered(url: string, mirrorUrl?: string): void {
    if (!mirrorUrl) return;
    if (url === mirrorUrl) this.mirrorFirst = true;
    else this.mirrorFirst = false;
  }
}
