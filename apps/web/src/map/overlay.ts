import type * as maplibregl from 'maplibre-gl';
import type { RankedDetection, Ring, ScanTile } from '@marco-polo/core';
import { chaikin, OUTLINE_CASING, POOL_OUTLINE } from './outline.js';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Plans larger than this draw no grid (it would be a grey smear anyway). */
const GRID_LIMIT = 6000;

const LINE = '#f4f6f8';

/** The whole world, for the darkened outside of the area. */
const WORLD: GeoJSON.Position[] = [
  [-180, -85.06],
  [180, -85.06],
  [180, 85.06],
  [-180, 85.06],
  [-180, -85.06],
];

function closed(ring: Ring): GeoJSON.Position[] {
  return [...ring, ring[0]];
}

/** The ring wound clockwise (lon east, lat north), opposite to WORLD, so MapLibre reads it as a hole. */
function asHole(ring: Ring): GeoJSON.Position[] {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  const c = closed(ring);
  return twice > 0 ? c.reverse() : c;
}

function tileRing(t: ScanTile): GeoJSON.Position[] {
  const b = t.bbox;
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
    [b.west, b.north],
  ];
}

/**
 * Every scan layer on the map: the drawn area, the plan grid (pending tiles
 * dashed under a light veil, scanned tiles clean), the tile being read, the
 * pool outlines and the drawing draft. Tile progress uses feature state, so
 * a finished tile costs no GeoJSON upload. Nothing here animates per frame.
 */
export class ScanOverlay {
  private map: maplibregl.Map;
  private tileIds = new Map<string, number>();
  private complete = false;

  constructor(map: maplibregl.Map, beforeId?: string) {
    this.map = map;
    this.install(beforeId);
  }

  private install(beforeId?: string): void {
    const map = this.map;
    for (const id of ['outside', 'area', 'current', 'detections', 'draft']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
    }
    if (!map.getSource('plan')) map.addSource('plan', { type: 'geojson', data: EMPTY });

    const done: maplibregl.ExpressionSpecification = ['boolean', ['feature-state', 'done'], false];
    const selected: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], 1];
    const layers: maplibregl.LayerSpecification[] = [
      {
        id: 'outside-fill',
        type: 'fill',
        source: 'outside',
        paint: { 'fill-color': '#05070a', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 400, delay: 0 } },
      },
      {
        id: 'plan-veil',
        type: 'fill',
        source: 'plan',
        paint: {
          'fill-color': '#0b0f14',
          'fill-opacity': ['case', done, 0, 0.32],
        },
      },
      {
        id: 'plan-line',
        type: 'line',
        source: 'plan',
        paint: {
          'line-color': LINE,
          'line-opacity': ['case', done, 0, 0.55],
          'line-width': 0.8,
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'area-casing',
        type: 'line',
        source: 'area',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': OUTLINE_CASING, 'line-opacity': 0.7, 'line-width': 3.5 },
      },
      {
        id: 'area-line',
        type: 'line',
        source: 'area',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': LINE, 'line-width': 1.5 },
      },
      {
        id: 'current-line',
        type: 'line',
        source: 'current',
        paint: { 'line-color': LINE, 'line-width': 2, 'line-opacity': 0.95 },
      },
      {
        id: 'det-fill',
        type: 'fill',
        source: 'detections',
        paint: { 'fill-color': POOL_OUTLINE, 'fill-opacity': ['case', selected, 0.25, 0] },
      },
      {
        id: 'det-casing',
        type: 'line',
        source: 'detections',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': OUTLINE_CASING,
          'line-opacity': 0.85,
          'line-width': ['case', selected, 5.5, 4],
        },
      },
      {
        id: 'det-line',
        type: 'line',
        source: 'detections',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': POOL_OUTLINE,
          'line-width': ['case', selected, 2.6, ['==', ['get', 'kind'], 'hot_tub'], 1.2, 1.7],
        },
      },
      {
        id: 'draft-fill',
        type: 'fill',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': LINE, 'fill-opacity': 0.08 },
      },
      {
        id: 'draft-line',
        type: 'line',
        source: 'draft',
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': LINE, 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'draft-vertex',
        type: 'circle',
        source: 'draft',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 3.5,
          'circle-color': OUTLINE_CASING,
          'circle-stroke-color': LINE,
          'circle-stroke-width': 1.5,
        },
      },
    ];
    for (const layer of layers) {
      if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
    }
  }

  private source(id: string): maplibregl.GeoJSONSource {
    return this.map.getSource(id) as maplibregl.GeoJSONSource;
  }

  setArea(ring: Ring | null): void {
    if (!ring) {
      this.source('area').setData(EMPTY);
      this.source('outside').setData(EMPTY);
      return;
    }
    const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [closed(ring)] };
    this.source('area').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: polygon }] });
    this.source('outside').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [WORLD, asHole(ring)] } }],
    });
  }

  setPlan(tiles: ScanTile[] | null): void {
    this.tileIds.clear();
    const src = this.source('plan');
    this.map.removeFeatureState({ source: 'plan' });
    if (!tiles || tiles.length === 0 || tiles.length > GRID_LIMIT) {
      src.setData(EMPTY);
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: tiles.map((t, i) => {
        this.tileIds.set(keyOf(t), i);
        return { type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [tileRing(t)] } };
      }),
    });
  }

  markScanned(tile: ScanTile): void {
    const id = this.tileIds.get(keyOf(tile));
    if (id !== undefined) this.map.setFeatureState({ source: 'plan', id }, { done: true });
  }

  setCurrent(tile: ScanTile | null): void {
    const src = this.source('current');
    if (!tile) {
      src.setData(EMPTY);
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [tileRing(tile)] } }],
    });
  }

  /**
   * End of a scan: the grid and the veil go, the outside of the area darkens.
   * Off again for a new area or scan.
   */
  setComplete(on: boolean): void {
    if (on === this.complete) return;
    this.complete = on;
    const vis = on ? 'none' : 'visible';
    for (const id of ['plan-veil', 'plan-line', 'current-line']) this.map.setLayoutProperty(id, 'visibility', vis);
    this.map.setPaintProperty('outside-fill', 'fill-opacity', on ? 0.45 : 0);
  }

  setDetections(list: RankedDetection[], selectedId: string | null): void {
    this.source('detections').setData({
      type: 'FeatureCollection',
      features: list.map((d) => ({
        type: 'Feature',
        properties: { id: d.id, kind: d.kind, rank: d.rank, selected: d.id === selectedId ? 1 : 0 },
        geometry: {
          type: 'MultiPolygon',
          coordinates: d.outline.map((ring) => {
            const smooth = chaikin(ring, 2);
            return [[...smooth, smooth[0]]];
          }),
        },
      })),
    });
  }

  dispose(): void {
    this.tileIds.clear();
  }
}

function keyOf(t: ScanTile): string {
  return `${t.tile.z}/${t.tile.x}/${t.tile.y}`;
}
