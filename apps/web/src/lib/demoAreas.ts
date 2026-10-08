import type { Ring } from '@marco-polo/core';

/** Rectangle ring centred on a coordinate, sized in metres. */
export function rectRing(lat: number, lon: number, widthM: number, heightM: number): Ring {
  const dLat = heightM / 2 / 111_320;
  const dLon = widthM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ];
}

export interface DemoArea {
  name: string;
  /** For tight spaces. */
  short: string;
  /** What the example shows, including the imagery it runs on. */
  hint: string;
  center: [number, number]; // lat, lon
  ring: Ring;
}

/**
 * One small area per open source plus one on Esri. Each is about 600 by
 * 450 m, a short scan at the source's own rate.
 */
export const DEMO_AREAS: DemoArea[] = [
  {
    name: 'Vilamoura, Portugal',
    short: 'Vilamoura',
    hint: 'Villas with gardens, DGT aerial imagery',
    center: [37.0745, -8.1155],
    ring: rectRing(37.0745, -8.1155, 600, 450),
  },
  {
    name: 'Pozuelo de Alarcón, Spain',
    short: 'Pozuelo',
    hint: 'Detached houses, PNOA aerial imagery',
    center: [40.4375, -3.8253],
    ring: rectRing(40.4375, -3.8253, 600, 450),
  },
  {
    name: 'Aix-en-Provence, France',
    short: 'Aix-en-Provence',
    hint: 'Hillside houses, IGN aerial imagery',
    center: [43.5704, 5.4197],
    ring: rectRing(43.5704, 5.4197, 600, 450),
  },
  {
    name: 'Scottsdale, United States',
    short: 'Scottsdale',
    hint: 'Backyard pools, Esri imagery',
    center: [33.594, -111.926],
    ring: rectRing(33.594, -111.926, 600, 450),
  },
];
