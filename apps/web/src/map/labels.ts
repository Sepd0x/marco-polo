import type * as maplibregl from 'maplibre-gl';
import { LABEL_ORIGIN } from './csp.js';

/**
 * Place, street, water and house number labels from OpenFreeMap vector
 * tiles, drawn over the imagery. Text is white with a dark halo so it reads
 * on any ground.
 */

export const LABEL_SOURCE = 'ofm';
export const GLYPHS_URL = `${LABEL_ORIGIN}/fonts/{fontstack}/{range}.pbf`;
export const LABEL_TILEJSON = `${LABEL_ORIGIN}/planet`;
/** As the OpenFreeMap TileJSON gives it. */
export const LABEL_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

export const FONT_REGULAR = ['Noto Sans Regular'];

const NAME: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

const TEXT_PAINT = {
  'text-color': '#ffffff',
  'text-halo-color': 'rgba(8, 11, 15, 0.85)',
  'text-halo-width': 1.4,
  'text-halo-blur': 0.4,
};

export function labelSource(): maplibregl.VectorSourceSpecification {
  return { type: 'vector', url: LABEL_TILEJSON, attribution: LABEL_ATTRIBUTION };
}

export function labelLayers(): maplibregl.LayerSpecification[] {
  return [
    {
      id: 'lbl-water',
      type: 'symbol',
      source: LABEL_SOURCE,
      'source-layer': 'water_name',
      minzoom: 9,
      layout: {
        'text-field': NAME,
        'text-font': FONT_REGULAR,
        'text-size': 12,
        'text-max-width': 8,
      },
      paint: { ...TEXT_PAINT, 'text-color': '#d6ecff' },
    },
    {
      id: 'lbl-street',
      type: 'symbol',
      source: LABEL_SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 15,
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': FONT_REGULAR,
        'text-size': 12,
        'text-letter-spacing': 0.02,
        'text-transform': 'none',
      },
      paint: TEXT_PAINT,
    },
    {
      id: 'lbl-housenumber',
      type: 'symbol',
      source: LABEL_SOURCE,
      'source-layer': 'housenumber',
      minzoom: 18,
      layout: {
        'text-field': ['get', 'housenumber'],
        'text-font': FONT_REGULAR,
        'text-size': 12,
      },
      paint: { ...TEXT_PAINT, 'text-color': '#e8edf2' },
    },
    {
      id: 'lbl-place',
      type: 'symbol',
      source: LABEL_SOURCE,
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet']]],
      layout: {
        'text-field': NAME,
        // Quiet beside the interface type: one weight, 13 px at most, as written.
        'text-font': FONT_REGULAR,
        'text-size': ['match', ['get', 'class'], ['city', 'town'], 13, 12],
        'text-transform': 'none',
        'text-max-width': 8,
        'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 'village', 2, 'suburb', 3, 4],
      },
      paint: TEXT_PAINT,
    },
  ];
}

export const LABEL_LAYER_IDS = labelLayers().map((l) => l.id);

export function setLabelsVisible(map: Pick<maplibregl.Map, 'getLayer' | 'setLayoutProperty'>, on: boolean): void {
  for (const id of LABEL_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
