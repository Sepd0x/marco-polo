import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  ESRI_WORLD_IMAGERY,
  estimateTileCount,
  ringBBox,
  type RankedDetection,
  type Ring,
} from '@marco-polo/core';
import { scanSetting, useStore, visibleRanked } from '../state/store.js';
import { emit, on } from '../lib/bus.js';
import { DrawTool } from './DrawTool.js';
import { ScanOverlay } from './overlay.js';
import { DetectionMarkers } from './markers.js';
import { glyphsUrl, LABEL_SOURCE, labelLayers, labelSource, setLabelsVisible } from './labels.js';
import { anchorLayers, BaseImagery, mapParts, ScannedImagery } from './sourceLayer.js';
import { browserDisplay, mapMaxZoom } from './sources.js';
import { watchContextLoss } from './contextLoss.js';
import { occluderPadding } from './padding.js';
import { FrameOverlay, type FrameStyle } from './frame.js';
import { PHONE_QUERY } from '../lib/media.js';

const isPhone = () => globalThis.matchMedia?.(PHONE_QUERY).matches ?? false;

/** Desktop frames carry coordinates in the margin; the phone keeps marks and crosses only. */
function frameStyle(): FrameStyle {
  return isPhone()
    ? { labels: false, fid: 6, gap: 3, cross: 3, labelEvery: 70 }
    : { labels: true, fid: 8, gap: 5, cross: 5, labelEvery: 110 };
}

/** The ground colour of the page theme, which the map uses for its veil. */
function veilColour(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--veil').trim() || '#efefec';
  } catch {
    return '#efefec';
  }
}

/** Calls `fn` whenever the page theme changes, by the toggle or by the system. */
function watchTheme(fn: () => void): () => void {
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', fn);
  return () => {
    mo.disconnect();
    mq?.removeEventListener?.('change', fn);
  };
}

// MapLibre 6 loads its worker as a separate module file; point it at the
// copy Vite emits so it resolves under any base path.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** `?map-debug` exposes the map instance for the end-to-end tests and the before/after captures. */
function exposeForTests(map: maplibregl.Map): void {
  if (new URLSearchParams(window.location.search).has('map-debug')) {
    (window as unknown as { __mpMap?: maplibregl.Map }).__mpMap = map;
  }
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;

    const display = browserDisplay();
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        glyphs: glyphsUrl(),
        sources: { [LABEL_SOURCE]: labelSource() },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#2b2b28' } },
          ...anchorLayers(),
          ...labelLayers(),
        ],
      },
      center: [-8.0, 37.2],
      zoom: 5.2,
      // North up and flat, always: the coordinates in the frame margin are only true then.
      bearing: 0,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      maxZoom: mapMaxZoom(ESRI_WORLD_IMAGERY),
      fadeDuration: 120,
    });
    exposeForTests(map);
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    const unsubs: Array<() => void> = [watchContextLoss(map)];
    let base: BaseImagery | null = null;
    let scanned: ScannedImagery | null = null;

    map.on('load', () => {
      const baseImagery = new BaseImagery(map, display);
      const scannedImagery = new ScannedImagery(map, display);
      base = baseImagery;
      scanned = scannedImagery;
      const refreshImagery = () => {
        baseImagery.update();
        scannedImagery.sync(baseImagery);
        // The data strip names the imagery the map really shows outside an area.
        emit('basesource', { id: baseImagery.atCentre.id });
      };
      refreshImagery();
      map.on('moveend', refreshImagery);

      // Scan layers go above the imagery and the street labels.
      const overlay = new ScanOverlay(map);
      overlay.setVeil(veilColour());
      unsubs.push(watchTheme(() => overlay.setVeil(veilColour())));
      const frame = new FrameOverlay(map, frameStyle);
      // Dots and numbers under the pool outlines: a label never hides a pool.
      const markers = new DetectionMarkers(map, (id) => useStore.getState().select(id), 'det-fill');
      setLabelsVisible(map, useStore.getState().settings.labels);

      const draw = new DrawTool(map, (ring: Ring) => {
        // The ring comes on the main world copy; the camera goes there too, so framing it is no pan round the globe.
        const c = map.getCenter();
        if (Math.abs(c.lng) > 180) map.jumpTo({ center: c.wrap() });
        const { settings } = useStore.getState();
        const estimate = estimateTileCount(ring, settings.zoom);
        useStore.getState().setArea(ring, estimate);
      });

      // Same key, same layers: a part that only counts tiles does not rebuild the imagery.
      let shownKey = '';
      const showScanned = () => {
        const s = useStore.getState();
        const parts = s.area ? mapParts(s.area, scanSetting(s), s.parts) : [];
        const key = JSON.stringify([s.area, parts.map((p) => [p.id, p.provider.id, p.cells?.zoom, p.cells?.tiles.length])]);
        if (key === shownKey) return;
        shownKey = key;
        scannedImagery.setParts(s.area, parts);
        scannedImagery.sync(baseImagery);
      };
      showScanned();
      overlay.setArea(useStore.getState().area);

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
            showScanned();
            if (area) {
              const b = ringBBox(area);
              map.fitBounds(
                [
                  [b.west, b.south],
                  [b.east, b.north],
                ],
                { padding: occluderPadding(map.getContainer(), 90), duration: 900, maxZoom: 17 },
              );
            }
          },
        ),
        sub(
          (s) => s.settings.imagery,
          () => showScanned(),
        ),
        sub(
          (s) => s.parts,
          () => showScanned(),
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
          (s) => s.phase,
          (phase) => {
            overlay.setComplete(phase === 'complete');
            if (phase === 'complete') fitResults(map);
          },
        ),
        sub(
          (s) => ({ ranked: s.ranked, settings: s.settings, parts: s.parts, selectedId: s.selectedId }),
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
            if (!det) return;
            // After the record has rendered; clear of the tools and keys on the map.
            requestAnimationFrame(() =>
              map.flyTo({
                center: [det.center.lon, det.center.lat],
                zoom: Math.max(map.getZoom(), 17.5),
                offset: clearOffset(map),
                duration: 1100,
              }),
            );
          },
        ),
        sub(
          (s) => s.settings.labels,
          (shown) => setLabelsVisible(map, shown),
        ),
      );

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

      unsubs.push(
        on('zoomby', ({ delta }) => map.easeTo({ zoom: map.getZoom() + delta, duration: 250 })),
        on('flyto', (e) => {
          if (e.bbox) {
            map.fitBounds(
              [
                [e.bbox[0], e.bbox[1]],
                [e.bbox[2], e.bbox[3]],
              ],
              { padding: occluderPadding(map.getContainer(), 80), duration: 1500, maxZoom: 16 },
            );
          } else if (e.center) {
            map.flyTo({ center: e.center, zoom: e.zoom ?? 15, duration: 1500 });
          }
        }),
      );
      map.on('mousemove', (e) => emit('cursor', { lon: e.lngLat.wrap().lng, lat: e.lngLat.lat }));
      map.on('mouseout', () => emit('cursor', null));
      let cameraFrame = 0;
      const shareCamera = () => {
        if (cameraFrame) return;
        cameraFrame = requestAnimationFrame(() => {
          cameraFrame = 0;
          emit('camera', { zoom: map.getZoom(), lat: map.getCenter().lat });
        });
      };
      map.on('move', shareCamera);
      shareCamera();
      const shareView = () => {
        const b = map.getBounds();
        emit('view', { bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom: map.getZoom() });
      };
      map.on('moveend', shareView);
      shareView();

      // Panning by hand during a scan turns following off: the user takes over.
      map.on('dragstart', () => {
        const s = useStore.getState();
        if (s.phase === 'scanning' && s.settings.follow) s.updateSettings({ follow: false });
      });

      // A display tile that fails (outside a source's coverage, offline) stays
      // empty; only other map errors are worth the console.
      map.on('error', (e: { error?: unknown; sourceId?: string; tile?: unknown }) => {
        if (e.sourceId || e.tile) return;
        console.error(e.error);
      });
      // The credits live in the data strip under the map. The control is made
      // once and its node follows the strip's slot when the layout changes.
      const attribution = new maplibregl.AttributionControl({ compact: false });
      const attribNode = attribution.onAdd(map);
      unsubs.push(
        on('attribslot', ({ el }) => {
          if (el && attribNode.parentElement !== el) el.appendChild(attribNode);
        }),
        () => attribution.onRemove(),
      );

      emit('mapready', {});

      unsubs.push(() => {
        draw.dispose();
        overlay.dispose();
        frame.dispose();
        markers.clear();
      });
    });

    return () => {
      for (const u of unsubs) u();
      scanned?.clear();
      base?.clear();
      map.remove();
    };
  }, []);

  return <div id="map" ref={container} />;
}

/** Margin around the framed result, px. A phone map is about 350 px wide, so it keeps a thin one. */
const RESULT_MARGIN = 60;
const RESULT_MARGIN_PHONE = 16;

/** After a scan: frame the pools found, clear of the panels; the area when there are none. */
function fitResults(map: maplibregl.Map): void {
  const { ranked, area } = useStore.getState();
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const d of ranked) {
    west = Math.min(west, d.bbox.west);
    south = Math.min(south, d.bbox.south);
    east = Math.max(east, d.bbox.east);
    north = Math.max(north, d.bbox.north);
  }
  if (!Number.isFinite(west)) {
    if (!area) return;
    ({ west, south, east, north } = ringBBox(area));
  }
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: occluderPadding(map.getContainer(), isPhone() ? RESULT_MARGIN_PHONE : RESULT_MARGIN), duration: 900, maxZoom: 18 },
  );
}

/** Offset from the container centre to the centre of the part of the map no panel covers. */
function clearOffset(map: maplibregl.Map): [number, number] {
  const pad = occluderPadding(map.getContainer(), 0);
  return [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
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
  const pad = occluderPadding(c, 0);
  const w = c.clientWidth - pad.left - pad.right;
  const h = c.clientHeight - pad.top - pad.bottom;
  const inside =
    p.x > pad.left + w * 0.28 && p.x < pad.left + w * 0.72 && p.y > pad.top + h * 0.28 && p.y < pad.top + h * 0.72;
  if (!inside) {
    lastFollow = now;
    map.easeTo({ center, offset: clearOffset(map), duration: 950, easing: (t) => 1 - (1 - t) ** 2 });
  }
}

function shallowish(
  a: { ranked: RankedDetection[]; settings: unknown; selectedId: string | null },
  b: { ranked: RankedDetection[]; settings: unknown; selectedId: string | null },
): boolean {
  return a.ranked === b.ranked && a.settings === b.settings && a.selectedId === b.selectedId;
}

