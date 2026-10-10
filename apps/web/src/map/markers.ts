import type * as maplibregl from 'maplibre-gl';
import type { RankedDetection } from '@marco-polo/core';
import { OUTLINE_CASING, POOL_OUTLINE } from './outline.js';

export const MARKER_SOURCE = 'det-points';
export const MARKER_DOT = 'det-dot';
export const MARKER_RANK = 'det-rank';

/**
 * Rank labels appear from this zoom. A finished scan is framed whole and
 * often lands just under 17, so the numbers start at 16; MapLibre's
 * placement hides the ones that would collide, lower ranks first.
 */
export const RANK_MIN_ZOOM = 16;

/** From this many pools the rank numbers lose their box and keep a halo, so the map stays readable. */
export const HALO_FROM = 30;

export type LabelStyle = 'open' | 'box' | 'halo';

/** The label of a pool: boxed below HALO_FROM pools, a bare number with a halo above; the open pool is always boxed in the accent. */
export function labelStyle(count: number, selected: boolean): LabelStyle {
  if (selected) return 'open';
  return count < HALO_FROM ? 'box' : 'halo';
}

const LABEL_PREFIX = 'rank:';

export const labelImageId = (style: LabelStyle, rank: number) => `${LABEL_PREFIX}${style}:${rank}`;

const FAMILY = '"Martian Mono", ui-monospace, monospace';
/** The width goes in the shorthand too, for browsers without `fontStretch` on the canvas. */
const FONT = `600 condensed 12px ${FAMILY}`;
const FONT_PLAIN = `600 12px ${FAMILY}`;
const RATIO = 2;

/**
 * A rank label drawn on a canvas in the interface font, so the map needs no
 * glyph server for it and the numbers read the same as in the list.
 */
function drawLabel(style: LabelStyle, text: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const setFont = () => {
    ctx.font = FONT;
    if (!ctx.font.includes('Martian')) ctx.font = FONT_PLAIN;
    if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';
  };
  setFont();
  const textW = Math.ceil(ctx.measureText(text).width);
  const boxed = style !== 'halo';
  const w = textW + (boxed ? 8 : 6);
  const h = boxed ? 16 : 15;
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  ctx.scale(RATIO, RATIO);
  setFont();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const x = w / 2;
  const y = h / 2 + 0.5;
  if (boxed) {
    ctx.fillStyle = style === 'open' ? POOL_OUTLINE : OUTLINE_CASING;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = style === 'open' ? OUTLINE_CASING : '#ffffff';
    ctx.fillText(text, x, y);
  } else {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE_CASING;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * Detection markers as GL layers: a small dot with a dark ring at the pool
 * centre for the overview, and the rank number, which MapLibre places beside
 * the pool without overlaps, lower ranks first. The number is an image made
 * on demand by the missing image resolver. No DOM elements, so there is no cap on how
 * many are shown.
 */
export class DetectionMarkers {
  private map: maplibregl.Map;

  constructor(map: maplibregl.Map, onSelect: (id: string) => void) {
    this.map = map;
    this.onSelect = onSelect;
    if (!map.getSource(MARKER_SOURCE)) {
      map.addSource(MARKER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    map.setMissingStyleImageResolver(this.resolve);
    const selected: maplibregl.ExpressionSpecification = ['==', ['get', 'style'], 'open'];
    // Close in, the outline and the number mark the pool; the dot would hide its water.
    const fadeClose: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], RANK_MIN_ZOOM - 0.5, 1, RANK_MIN_ZOOM + 0.5, 0];
    if (!map.getLayer(MARKER_DOT)) {
      map.addLayer({
        id: MARKER_DOT,
        type: 'circle',
        source: MARKER_SOURCE,
        layout: { 'circle-sort-key': ['case', selected, 1, 0] },
        paint: {
          'circle-color': POOL_OUTLINE,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 4, 18, 4.5],
          'circle-stroke-color': OUTLINE_CASING,
          'circle-stroke-width': ['case', selected, 2.5, 1.5],
          'circle-opacity': fadeClose,
          'circle-stroke-opacity': fadeClose,
        },
      });
    }
    if (!map.getLayer(MARKER_RANK)) {
      map.addLayer({
        id: MARKER_RANK,
        type: 'symbol',
        source: MARKER_SOURCE,
        minzoom: RANK_MIN_ZOOM,
        layout: {
          // The label is an image inside the text, so it keeps the variable placement of text.
          'text-field': ['format', ['image', ['get', 'label']]],
          'text-size': 12,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
          'text-radial-offset': 0.9,
          'text-allow-overlap': false,
          'symbol-sort-key': ['case', selected, -1, ['get', 'rank']],
        },
      });
    }
    map.on('click', MARKER_DOT, this.onClick);
    map.on('mouseenter', MARKER_DOT, this.onEnter);
    map.on('mouseleave', MARKER_DOT, this.onLeave);
  }

  private onSelect: (id: string) => void;

  /**
   * Draws a missing rank label. It waits for the interface font, so a label
   * is never cached with a fallback face (MapLibre awaits the promise).
   */
  private resolve = async (id: string): Promise<void> => {
    if (!id.startsWith(LABEL_PREFIX) || this.map.hasImage(id)) return;
    try {
      await document.fonts?.load(FONT_PLAIN);
    } catch {
      // the fallback face is better than no number
    }
    if (this.map.hasImage(id)) return;
    const [style, rank] = id.slice(LABEL_PREFIX.length).split(':');
    const img = drawLabel(style as LabelStyle, rank);
    if (img) this.map.addImage(id, img, { pixelRatio: RATIO });
  };

  private onClick = (e: maplibregl.MapLayerMouseEvent): void => {
    const id = e.features?.[0]?.properties?.id;
    if (id) this.onSelect(String(id));
  };

  private onEnter = (): void => {
    this.map.getCanvas().style.cursor = 'pointer';
  };

  private onLeave = (): void => {
    this.map.getCanvas().style.cursor = '';
  };

  sync(list: RankedDetection[], selectedId: string | null): void {
    (this.map.getSource(MARKER_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: list.map((d) => {
        const style = labelStyle(list.length, d.id === selectedId);
        return {
          type: 'Feature',
          properties: { id: d.id, rank: d.rank, kind: d.kind, style, label: labelImageId(style, d.rank) },
          geometry: { type: 'Point', coordinates: [d.center.lon, d.center.lat] },
        };
      }),
    });
  }

  clear(): void {
    this.map.setMissingStyleImageResolver(null);
    this.map.off('click', MARKER_DOT, this.onClick);
    this.map.off('mouseenter', MARKER_DOT, this.onEnter);
    this.map.off('mouseleave', MARKER_DOT, this.onLeave);
  }
}
