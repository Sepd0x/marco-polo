import type * as maplibregl from 'maplibre-gl';
import type { RankedDetection } from '@marco-polo/core';
import { OUTLINE_CASING, POOL_OUTLINE } from './outline.js';
import { EM_PX, ICON_PADDING, keepoutImages, levelAnchors, poolBox, TEXT_PADDING, type LabelSize } from './labelPlace.js';

export const MARKER_SOURCE = 'det-points';
export const MARKER_DOT = 'det-dot';
export const MARKER_RANK = 'det-rank';
/** Invisible box per pool, as large as the pool on screen: the numbers collide with it, so none lands on a pool. */
export const MARKER_KEEPOUT = 'det-keepout';

/**
 * Rank labels appear from this zoom. On a phone a finished scan is often
 * framed between 15 and 16; the keep-out boxes and the nearest-centre rule
 * make a number safe there, and MapLibre hides the ones with no room, lower
 * ranks first.
 */
export const RANK_MIN_ZOOM = 15;

/** Highest zoom level with its own anchor list; above it the last one holds. */
export const RANK_LEVEL_MAX = 22;

/** From this many pools the rank numbers lose their box and keep a halo, so the map stays readable. */
export const HALO_FROM = 30;

/**
 * Below this zoom every number is a bare number with a halo: a box there is
 * as large as a pool and could cover one. The outlines are also drawn above
 * the numbers, so no label can ever hide a pool.
 */
export const BOX_FROM_ZOOM = 17;

/** The dot goes once its pool is this wide on screen (px): the outline marks it, and the dot would hide its water. */
export const DOT_MAX_POOL_PX = 8;

/** No dot from this zoom, whatever the pool size. */
export const DOT_OFF_ZOOM = 17;

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

function setFont(ctx: CanvasRenderingContext2D): void {
  ctx.font = FONT;
  if (!ctx.font.includes('Martian')) ctx.font = FONT_PLAIN;
  if ('fontStretch' in ctx) ctx.fontStretch = 'condensed';
}

/** Size in px of a label as drawLabel makes it. */
function labelBox(ctx: CanvasRenderingContext2D | null, style: LabelStyle, text: string): LabelSize {
  let textW = text.length * 8;
  if (ctx) {
    setFont(ctx);
    textW = Math.ceil(ctx.measureText(text).width);
  }
  const boxed = style !== 'halo';
  return { width: textW + (boxed ? 8 : 6), height: boxed ? 16 : 15 };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Label size for placement, measured on a shared canvas. */
function measureLabel(style: LabelStyle, text: string): LabelSize {
  if (measureCtx === undefined) measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return labelBox(measureCtx, style, text);
}

/**
 * A rank label drawn on a canvas in the interface font, so the map needs no
 * glyph server for it and the numbers read the same as in the list.
 */
function drawLabel(style: LabelStyle, text: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width: w, height: h } = labelBox(ctx, style, text);
  const boxed = style !== 'halo';
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  ctx.scale(RATIO, RATIO);
  setFont(ctx);
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

/** A zoom curve that doubles each level from `get(prop)` at zoom 0: a pool size on screen. */
function doubling(prop: string): maplibregl.ExpressionSpecification {
  return ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', prop], 24, ['*', ['get', prop], 2 ** 24]];
}

const levels: number[] = [];
for (let z = Math.floor(RANK_MIN_ZOOM); z <= RANK_LEVEL_MAX; z++) levels.push(z);

/** The anchor list of the current zoom level, read from the feature (see labelPlace.ts). */
function anchorsByLevel(): maplibregl.ExpressionSpecification {
  const expr: unknown[] = ['step', ['zoom'], ['get', `a${levels[0]}`]];
  for (const z of levels.slice(1)) expr.push(z, ['get', `a${z}`]);
  return expr as maplibregl.ExpressionSpecification;
}

/**
 * Dot opacity: shown while its pool is narrower than DOT_MAX_POOL_PX on
 * screen, gone from DOT_OFF_ZOOM. Stops every half zoom, so it fades.
 */
function dotOpacity(): maplibregl.ExpressionSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (let z = 10; z <= DOT_OFF_ZOOM; z += 0.5) {
    expr.push(z, z >= DOT_OFF_ZOOM ? 0 : ['case', ['>=', ['*', ['get', 'ext'], 2 ** z], DOT_MAX_POOL_PX], 0, 1]);
  }
  return expr as maplibregl.ExpressionSpecification;
}

/**
 * Detection markers as GL layers: a small dot with a dark ring at the centre
 * of a pool too small to read, and the rank number beside the pool. Each pool
 * also carries an invisible keep-out box as large as the pool on screen; the
 * numbers collide with every box, their own included, so a number never
 * covers a pool and sits just outside its own. Per zoom level a number may
 * only take the sides where it stays nearer to its own pool than to any
 * other; with no such side it is hidden. The number is an image made on
 * demand by the missing image resolver. No DOM elements, so there is no cap
 * on how many are shown.
 */
export class DetectionMarkers {
  private map: maplibregl.Map;

  /** `beforeId`: the pool outline layers, which go above the dots and numbers. */
  constructor(map: maplibregl.Map, onSelect: (id: string) => void, beforeId?: string) {
    this.map = map;
    this.onSelect = onSelect;
    if (!map.getSource(MARKER_SOURCE)) {
      map.addSource(MARKER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    map.setMissingStyleImageResolver(this.resolve);
    for (const img of keepoutImages()) {
      if (!map.hasImage(img.id)) map.addImage(img.id, { width: img.width, height: img.height, data: new Uint8Array(img.width * img.height * 4) });
    }
    const selected: maplibregl.ExpressionSpecification = ['==', ['get', 'style'], 'open'];
    if (!map.getLayer(MARKER_DOT)) {
      const opacity = dotOpacity();
      map.addLayer({
        id: MARKER_DOT,
        type: 'circle',
        source: MARKER_SOURCE,
        layout: { 'circle-sort-key': ['case', selected, 1, 0] },
        paint: {
          'circle-color': POOL_OUTLINE,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 3, 15, 2.5],
          'circle-stroke-color': OUTLINE_CASING,
          'circle-stroke-width': ['case', selected, 2.5, 1.5],
          'circle-opacity': opacity,
          'circle-stroke-opacity': opacity,
        },
      }, beforeId);
    }
    if (!map.getLayer(MARKER_RANK)) {
      map.addLayer({
        id: MARKER_RANK,
        type: 'symbol',
        source: MARKER_SOURCE,
        minzoom: RANK_MIN_ZOOM,
        layout: {
          // The label is an image inside the text, so it keeps the variable placement of text.
          'text-field': [
            'step',
            ['zoom'],
            ['format', ['image', ['get', 'small']]],
            BOX_FROM_ZOOM,
            ['format', ['image', ['get', 'label']]],
          ],
          'text-size': EM_PX,
          'text-variable-anchor-offset': anchorsByLevel(),
          'text-padding': TEXT_PADDING,
          'text-allow-overlap': false,
          'symbol-sort-key': ['case', selected, -1, ['get', 'rank']],
        },
      }, beforeId);
    }
    // Above the numbers: MapLibre places the top layer first, so the boxes are there when the numbers look for room.
    if (!map.getLayer(MARKER_KEEPOUT)) {
      map.addLayer({
        id: MARKER_KEEPOUT,
        type: 'symbol',
        source: MARKER_SOURCE,
        layout: {
          'icon-image': ['get', 'ko'],
          'icon-size': doubling('ks'),
          'icon-padding': ICON_PADDING,
          'icon-allow-overlap': true,
          'icon-ignore-placement': false,
        },
        paint: { 'icon-opacity': 0 },
      }, beforeId);
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
    const styles = list.map((d) => labelStyle(list.length, d.id === selectedId));
    const boxes = list.map((d) => poolBox(d.center, d.bbox));
    const small = list.map((d) => measureLabel('halo', String(d.rank)));
    const full = list.map((d, i) => measureLabel(styles[i], String(d.rank)));
    const anchors = levels.map((z) => levelAnchors(boxes, z < BOX_FROM_ZOOM ? small : full, z));
    (this.map.getSource(MARKER_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: list.map((d, i) => {
        const style = styles[i];
        const b = boxes[i];
        const properties: Record<string, unknown> = {
          id: d.id,
          rank: d.rank,
          kind: d.kind,
          style,
          label: labelImageId(style, d.rank),
          small: labelImageId('halo', d.rank),
          ko: b.image,
          ks: b.size0,
          ext: b.extent0,
        };
        levels.forEach((z, k) => {
          properties[`a${z}`] = anchors[k][i];
        });
        return {
          type: 'Feature',
          properties,
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
