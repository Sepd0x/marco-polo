import maplibregl from 'maplibre-gl';
import type { RankedDetection, Ring, ScanTile } from '@marco-polo/core';
import { lighten } from '../lib/theme.js';

const HOT_TUB_COLOR = '#ffc866';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Max plan size for which individual tile grid lines are drawn. */
const GRID_LIMIT = 6000;

/**
 * Owns every scan-related layer on the map: the drawn area, the tile grid of
 * the plan, scanned coverage, the pulsing current tile, and detection shapes.
 */
export class ScanOverlay {
  private map: maplibregl.Map;
  private scannedCoords: GeoJSON.Position[][][] = [];
  private scannedFlush: number | null = null;
  private pulseFrame: number | null = null;
  private pulseOn = false;

  constructor(map: maplibregl.Map) {
    this.map = map;
    this.installSourcesAndLayers();
  }

  private installSourcesAndLayers(): void {
    const map = this.map;
    const addSrc = (id: string) => {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
    };
    for (const id of ['scanned', 'plangrid', 'area', 'current', 'detections', 'draft']) addSrc(id);

    const layers: maplibregl.LayerSpecification[] = [
      {
        id: 'scanned-fill',
        type: 'fill',
        source: 'scanned',
        paint: { 'fill-color': '#35e0ff', 'fill-opacity': 0.05 },
      },
      {
        id: 'plangrid-line',
        type: 'line',
        source: 'plangrid',
        paint: { 'line-color': '#35e0ff', 'line-opacity': 0.14, 'line-width': 0.7 },
      },
      {
        id: 'area-fill',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': '#35e0ff', 'fill-opacity': 0.03 },
      },
      {
        id: 'area-line',
        type: 'line',
        source: 'area',
        paint: {
          'line-color': '#35e0ff',
          'line-opacity': 0.8,
          'line-width': 1.4,
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'current-fill',
        type: 'fill',
        source: 'current',
        paint: { 'fill-color': '#35e0ff', 'fill-opacity': 0.16 },
      },
      {
        id: 'current-line',
        type: 'line',
        source: 'current',
        paint: { 'line-color': '#7ef0ff', 'line-opacity': 0.95, 'line-width': 1.6 },
      },
      {
        id: 'det-fill',
        type: 'fill',
        source: 'detections',
        paint: {
          'fill-color': ['case', ['==', ['get', 'kind'], 'hot_tub'], '#ffc866', '#35e0ff'],
          'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.4, 0.18],
        },
      },
      {
        id: 'det-line',
        type: 'line',
        source: 'detections',
        paint: {
          'line-color': ['case', ['==', ['get', 'kind'], 'hot_tub'], '#ffc866', '#35e0ff'],
          'line-opacity': 0.95,
          'line-width': ['case', ['==', ['get', 'selected'], 1], 2.4, 1.1],
        },
      },
      {
        id: 'draft-fill',
        type: 'fill',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#35e0ff', 'fill-opacity': 0.08 },
      },
      {
        id: 'draft-line',
        type: 'line',
        source: 'draft',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: {
          'line-color': '#7ef0ff',
          'line-width': 1.5,
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'draft-vertex',
        type: 'circle',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 3.5,
          'circle-color': '#06090d',
          'circle-stroke-color': '#7ef0ff',
          'circle-stroke-width': 1.5,
        },
      },
    ];
    for (const layer of layers) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    }
  }

  setArea(ring: Ring | null): void {
    const src = this.map.getSource('area') as maplibregl.GeoJSONSource;
    if (!ring) {
      src.setData(EMPTY);
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        },
      ],
    });
  }

  setPlan(tiles: ScanTile[] | null): void {
    const src = this.map.getSource('plangrid') as maplibregl.GeoJSONSource;
    this.scannedCoords = [];
    (this.map.getSource('scanned') as maplibregl.GeoJSONSource).setData(EMPTY);
    if (!tiles || tiles.length === 0 || tiles.length > GRID_LIMIT) {
      src.setData(EMPTY);
      return;
    }
    // One MultiLineString of every tile's outline — cheap to render, one feature.
    const lines: GeoJSON.Position[][] = tiles.map((t) => [
      [t.bbox.west, t.bbox.north],
      [t.bbox.east, t.bbox.north],
      [t.bbox.east, t.bbox.south],
      [t.bbox.west, t.bbox.south],
      [t.bbox.west, t.bbox.north],
    ]);
    src.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } },
      ],
    });
  }

  markScanned(tile: ScanTile): void {
    this.scannedCoords.push([
      [
        [tile.bbox.west, tile.bbox.north],
        [tile.bbox.east, tile.bbox.north],
        [tile.bbox.east, tile.bbox.south],
        [tile.bbox.west, tile.bbox.south],
        [tile.bbox.west, tile.bbox.north],
      ],
    ]);
    if (this.scannedFlush === null) {
      this.scannedFlush = window.setTimeout(() => {
        this.scannedFlush = null;
        (this.map.getSource('scanned') as maplibregl.GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'MultiPolygon', coordinates: this.scannedCoords },
            },
          ],
        });
      }, 180);
    }
  }

  setCurrent(tile: ScanTile | null): void {
    const src = this.map.getSource('current') as maplibregl.GeoJSONSource;
    if (!tile) {
      src.setData(EMPTY);
      this.stopPulse();
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [tile.bbox.west, tile.bbox.north],
                [tile.bbox.east, tile.bbox.north],
                [tile.bbox.east, tile.bbox.south],
                [tile.bbox.west, tile.bbox.south],
                [tile.bbox.west, tile.bbox.north],
              ],
            ],
          },
        },
      ],
    });
    this.startPulse();
  }

  private startPulse(): void {
    if (this.pulseOn) return;
    this.pulseOn = true;
    const step = (t: number) => {
      if (!this.pulseOn) return;
      const phase = (Math.sin(t / 260) + 1) / 2;
      if (this.map.getLayer('current-fill')) {
        this.map.setPaintProperty('current-fill', 'fill-opacity', 0.08 + phase * 0.2);
        this.map.setPaintProperty('current-line', 'line-opacity', 0.55 + phase * 0.45);
      }
      this.pulseFrame = requestAnimationFrame(step);
    };
    this.pulseFrame = requestAnimationFrame(step);
  }

  private stopPulse(): void {
    this.pulseOn = false;
    if (this.pulseFrame !== null) cancelAnimationFrame(this.pulseFrame);
    this.pulseFrame = null;
  }

  setDetections(list: RankedDetection[], selectedId: string | null): void {
    const src = this.map.getSource('detections') as maplibregl.GeoJSONSource;
    src.setData({
      type: 'FeatureCollection',
      features: list.map((d) => ({
        type: 'Feature',
        properties: {
          id: d.id,
          kind: d.kind,
          rank: d.rank,
          selected: d.id === selectedId ? 1 : 0,
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: d.outline.map((ring) => [[...ring, ring[0]]]),
        },
      })),
    });
  }

  /** Re-colour every scan layer to the configured accent. */
  setAccent(hex: string): void {
    const bright = lighten(hex, 0.4);
    const set = (layer: string, prop: string, value: unknown) => {
      if (this.map.getLayer(layer)) {
        this.map.setPaintProperty(layer, prop, value as never);
      }
    };
    set('scanned-fill', 'fill-color', hex);
    set('plangrid-line', 'line-color', hex);
    set('area-fill', 'fill-color', hex);
    set('area-line', 'line-color', hex);
    set('current-fill', 'fill-color', hex);
    set('current-line', 'line-color', bright);
    set('det-fill', 'fill-color', ['case', ['==', ['get', 'kind'], 'hot_tub'], HOT_TUB_COLOR, hex]);
    set('det-line', 'line-color', ['case', ['==', ['get', 'kind'], 'hot_tub'], HOT_TUB_COLOR, hex]);
    set('draft-fill', 'fill-color', hex);
    set('draft-line', 'line-color', bright);
    set('draft-vertex', 'circle-stroke-color', bright);
  }

  dispose(): void {
    this.stopPulse();
    if (this.scannedFlush !== null) clearTimeout(this.scannedFlush);
  }
}
