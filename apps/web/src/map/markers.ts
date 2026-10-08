import type * as maplibregl from 'maplibre-gl';
import type { RankedDetection } from '@marco-polo/core';
import { FONT_BOLD } from './labels.js';
import { OUTLINE_CASING, POOL_OUTLINE } from './outline.js';

export const MARKER_SOURCE = 'det-points';
export const MARKER_DOT = 'det-dot';
export const MARKER_RANK = 'det-rank';

/** Rank labels appear from this zoom; below it they would only collide. */
export const RANK_MIN_ZOOM = 17;

/**
 * Detection markers as GL layers: a small dot with a dark ring at the pool
 * centre and a "#N" label that MapLibre places without overlaps, lower
 * ranks first. No DOM elements, so there is no cap on how many are shown.
 */
export class DetectionMarkers {
  private map: maplibregl.Map;

  constructor(map: maplibregl.Map, onSelect: (id: string) => void) {
    this.map = map;
    this.onSelect = onSelect;
    if (!map.getSource(MARKER_SOURCE)) {
      map.addSource(MARKER_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    const selected: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], 1];
    // Close in, the outline itself marks the pool; the dot would hide its water.
    const fadeClose: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 17.5, 1, 18.5, ['case', selected, 1, 0]];
    if (!map.getLayer(MARKER_DOT)) {
      map.addLayer({
        id: MARKER_DOT,
        type: 'circle',
        source: MARKER_SOURCE,
        layout: { 'circle-sort-key': ['get', 'selected'] },
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
          'text-field': ['concat', '#', ['to-string', ['get', 'rank']]],
          'text-font': FONT_BOLD,
          'text-size': 12,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.9,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': OUTLINE_CASING,
          'text-halo-width': 1.6,
        },
      });
    }
    map.on('click', MARKER_DOT, this.onClick);
    map.on('mouseenter', MARKER_DOT, this.onEnter);
    map.on('mouseleave', MARKER_DOT, this.onLeave);
  }

  private onSelect: (id: string) => void;

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
      features: list.map((d) => ({
        type: 'Feature',
        properties: { id: d.id, rank: d.rank, kind: d.kind, selected: d.id === selectedId ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [d.center.lon, d.center.lat] },
      })),
    });
  }

  clear(): void {
    this.map.off('click', MARKER_DOT, this.onClick);
    this.map.off('mouseenter', MARKER_DOT, this.onEnter);
    this.map.off('mouseleave', MARKER_DOT, this.onLeave);
  }
}
