import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import {
  ESRI_WORLD_IMAGERY,
  estimateTileCount,
  ringBBox,
  type RankedDetection,
  type Ring,
} from '@marco-polo/core';
import { useStore, visibleRanked } from '../state/store.js';
import { emit, on } from '../lib/bus.js';
import { DrawTool } from './DrawTool.js';
import { ScanOverlay } from './overlay.js';
import { DetectionMarkers } from './markers.js';

const LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!container.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          sat: {
            type: 'raster',
            tiles: [ESRI_WORLD_IMAGERY.urlTemplate],
            tileSize: 256,
            maxzoom: 19,
            attribution: ESRI_WORLD_IMAGERY.attribution,
          },
          labels: {
            type: 'raster',
            tiles: [LABELS_URL],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#000000' } },
          { id: 'sat', type: 'raster', source: 'sat' },
          { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
        ],
      },
      center: [-8.0, 37.2],
      zoom: 5.2,
      attributionControl: { compact: true },
      maxZoom: 20,
      fadeDuration: 120,
    });
    mapRef.current = map;

    const unsubs: Array<() => void> = [];

    map.on('load', () => {
      const overlay = new ScanOverlay(map);
      const markers = new DetectionMarkers(map, (id) => useStore.getState().select(id));
      overlay.setAccent(useStore.getState().settings.accent);

      const draw = new DrawTool(map, (ring: Ring) => {
        const { settings } = useStore.getState();
        const estimate = estimateTileCount(ring, settings.zoom);
        useStore.getState().setArea(ring, estimate);
      });

      // ── store → map subscriptions ────────────────────────────────
      const sub = useStore.subscribe;

      unsubs.push(
        sub(
          (s) => s.drawMode,
          (mode) => draw.setMode(mode),
        ),
        sub(
          (s) => s.area,
          (area) => {
            overlay.setArea(area);
            if (area) {
              const b = ringBBox(area);
              map.fitBounds(
                [
                  [b.west, b.south],
                  [b.east, b.north],
                ],
                { padding: 90, duration: 900, maxZoom: 17 },
              );
            }
          },
        ),
        sub(
          (s) => s.planTiles,
          (tiles) => overlay.setPlan(tiles),
        ),
        sub(
          (s) => s.lastCompleted,
          (tile) => {
            if (tile) overlay.markScanned(tile);
          },
        ),
        sub(
          (s) => s.currentTile,
          (tile) => {
            overlay.setCurrent(tile);
            followCamera(map, tile);
          },
        ),
        sub(
          (s) => ({ ranked: s.ranked, settings: s.settings, selectedId: s.selectedId }),
          ({ selectedId, ...rest }) => {
            const visible = visibleRanked(rest);
            overlay.setDetections(visible, selectedId);
            markers.sync(visible, selectedId);
          },
          { equalityFn: shallowish },
        ),
        sub(
          (s) => s.selectedId,
          (id) => {
            if (!id) return;
            const det = useStore.getState().detections[id];
            if (det) {
              map.flyTo({
                center: [det.center.lon, det.center.lat],
                zoom: Math.max(map.getZoom(), 17.5),
                duration: 1100,
              });
            }
          },
        ),
        sub(
          (s) => s.settings.labels,
          (on) => {
            if (map.getLayer('labels')) {
              map.setLayoutProperty('labels', 'visibility', on ? 'visible' : 'none');
            }
          },
        ),
        sub(
          (s) => s.settings.accent,
          (accent) => overlay.setAccent(accent),
        ),
      );

      // Detection polygon click → select.
      map.on('click', 'det-fill', (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) useStore.getState().select(String(f.properties.id));
      });
      map.on('mouseenter', 'det-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'det-fill', () => {
        map.getCanvas().style.cursor = '';
      });

      // UI → map commands.
      unsubs.push(
        on('flyto', (e) => {
          if (e.bbox) {
            map.fitBounds(
              [
                [e.bbox[0], e.bbox[1]],
                [e.bbox[2], e.bbox[3]],
              ],
              { padding: 80, duration: 1500, maxZoom: 16 },
            );
          } else if (e.center) {
            map.flyTo({ center: e.center, zoom: e.zoom ?? 15, duration: 1500 });
          }
        }),
      );
      map.on('mousemove', (e) => emit('cursor', { lon: e.lngLat.lng, lat: e.lngLat.lat }));

      // Manual pan while following disables follow — the user takes the wheel.
      map.on('dragstart', () => {
        const s = useStore.getState();
        if (s.phase === 'scanning' && s.settings.follow) s.updateSettings({ follow: false });
      });

      unsubs.push(() => {
        draw.dispose();
        overlay.dispose();
        markers.clear();
      });
    });

    return () => {
      for (const u of unsubs) u();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div id="map" ref={container} />;
}

let lastFollow = 0;

function followCamera(map: maplibregl.Map, tile: { bbox: { west: number; east: number; north: number; south: number } } | null): void {
  if (!tile) return;
  const s = useStore.getState();
  if (s.phase !== 'scanning' || !s.settings.follow) return;
  const now = Date.now();
  if (now - lastFollow < 1200) return;
  const center: [number, number] = [
    (tile.bbox.west + tile.bbox.east) / 2,
    (tile.bbox.north + tile.bbox.south) / 2,
  ];
  const p = map.project(center);
  const c = map.getContainer();
  const mx = c.clientWidth * 0.28;
  const my = c.clientHeight * 0.28;
  const inside =
    p.x > mx && p.x < c.clientWidth - mx && p.y > my && p.y < c.clientHeight - my;
  if (!inside) {
    lastFollow = now;
    map.easeTo({ center, duration: 950, easing: (t) => 1 - (1 - t) ** 2 });
  }
}

function shallowish(
  a: { ranked: RankedDetection[]; settings: unknown; selectedId: string | null },
  b: { ranked: RankedDetection[]; settings: unknown; selectedId: string | null },
): boolean {
  return a.ranked === b.ranked && a.settings === b.settings && a.selectedId === b.selectedId;
}
