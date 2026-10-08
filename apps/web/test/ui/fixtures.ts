import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { lonLatToTile, rankDetections, type Detection, type RankedDetection, type ScanTile } from '@marco-polo/core';
import { useStore, DEFAULT_SETTINGS } from '../../src/state/store.js';
import { useUi } from '../../src/ui/uiState.js';
import { rectRing } from '../../src/lib/demoAreas.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const VILAMOURA = { lat: 37.0745, lon: -8.1155 };
export const AREA = rectRing(VILAMOURA.lat, VILAMOURA.lon, 600, 450);

/** A rectangular pool `l` by `w` metres, `east` and `south` metres from the centre of the area. */
export function pool(id: string, l: number, w: number, east: number, south: number, confidence: number, extra: Partial<Detection> = {}): Detection {
  const kx = 111_320 * Math.cos((VILAMOURA.lat * Math.PI) / 180);
  const ky = 110_574;
  const lon = VILAMOURA.lon + east / kx;
  const lat = VILAMOURA.lat - south / ky;
  const dx = l / 2 / kx;
  const dy = w / 2 / ky;
  const tile = lonLatToTile(lon, lat, 19);
  return {
    id,
    kind: 'pool',
    center: { lon, lat },
    bbox: { west: lon - dx, east: lon + dx, south: lat - dy, north: lat + dy },
    outline: [
      [
        [lon - dx, lat - dy],
        [lon + dx, lat - dy],
        [lon + dx, lat + dy],
        [lon - dx, lat + dy],
      ],
    ],
    areaM2: l * w,
    confidence,
    pixelCount: Math.round((l * w) / 0.09),
    tiles: [tile],
    truncated: false,
    primary: { tile, bboxPx: { minX: 100, minY: 100, maxX: 130, maxY: 120 } },
    meanHue: 190,
    meanSat: 0.5,
    meanVal: 0.7,
    strictRatio: 0.8,
    fillRatio: 0.9,
    texture: 0.02,
    ...extra,
  };
}

export const POOLS: Detection[] = [
  pool('a', 10, 5, -100, -50, 0.91),
  pool('b', 8, 4, 20, 30, 0.62),
  pool('c', 12, 6, 80, 10, 0.4),
  pool('d', 6, 3, -40, 90, 0.77, { truncated: true }),
  pool('e', 3, 2.5, 10, -80, 0.7, { kind: 'hot_tub' }),
];

export function ranked(): RankedDetection[] {
  return rankDetections(POOLS);
}

export function planTiles(n: number): ScanTile[] {
  const t0 = lonLatToTile(VILAMOURA.lon, VILAMOURA.lat, 19);
  return Array.from({ length: n }, (_, i) => ({
    tile: { z: 19, x: t0.x + (i % 8), y: t0.y + Math.floor(i / 8) },
    bbox: { west: 0, east: 0, north: 0, south: 0 },
    index: i,
  }));
}

export type Phase = 'idle' | 'ready' | 'scanning' | 'paused' | 'complete';

/** Put the store in a phase the way a real session would leave it. */
export function seed(phase: Phase, extra: Record<string, unknown> = {}) {
  const tiles = planTiles(40);
  const base = {
    phase,
    drawMode: null,
    area: phase === 'idle' ? null : AREA,
    areaEstimate: null,
    settings: { ...DEFAULT_SETTINGS },
    detections: {},
    ranked: [] as RankedDetection[],
    thumbs: {},
    planTiles: phase === 'idle' || phase === 'ready' ? null : tiles,
    currentTile: phase === 'scanning' ? tiles[27] : null,
    lastCompleted: null,
    selectedId: null,
    archive: [],
    stats: {
      tilesTotal: phase === 'idle' || phase === 'ready' ? 0 : 40,
      tilesDone: phase === 'complete' ? 40 : phase === 'idle' || phase === 'ready' ? 0 : 26,
      tilesFailed: 0,
      startedAt: Date.now() - 9000,
      elapsedMs: 9000,
      etaMs: phase === 'scanning' ? 3000 : null,
      areaM2: 270_000,
      scannedAreaM2: 0,
      waterFiltered: 0,
    },
  };
  if (phase === 'scanning' || phase === 'paused' || phase === 'complete') base.ranked = ranked();
  useStore.setState({ ...base, ...extra } as never);
  useUi.setState({ sort: 'largest', settingsOpen: false, sourcePickerOpen: false, sheetList: false });
}

export interface Mounted {
  root: Root;
  host: HTMLDivElement;
  unmount(): void;
}

export function mount(node: ReactNode): Mounted {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    root,
    host,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Make `(max-width: 700px)` match, as on a phone. */
export function asPhone(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('max-width: 700px'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

/** Every piece of text a person can read or hear: content, labels, placeholders, titles. */
export function readableText(root: ParentNode): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    if (t) out.push(t);
  }
  for (const el of (root as Element).querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
    for (const a of ['aria-label', 'placeholder', 'title', 'alt']) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
  }
  return out;
}
