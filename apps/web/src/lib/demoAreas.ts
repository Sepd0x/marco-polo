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
  hint: string;
  center: [number, number]; // lat, lon
  ring: Ring;
}

/** Pool-dense places that make a compelling first scan (~1–3 minutes each). */
export const DEMO_AREAS: DemoArea[] = [
  {
    name: 'Vilamoura · PT',
    hint: 'Algarve resort quarter',
    center: [37.0745, -8.1155],
    ring: rectRing(37.0745, -8.1155, 900, 700),
  },
  {
    name: 'Scottsdale · US',
    hint: 'Arizona backyard-pool suburbia',
    center: [33.594, -111.926],
    ring: rectRing(33.594, -111.926, 900, 700),
  },
  {
    name: 'Marbella · ES',
    hint: 'Costa del Sol villas',
    center: [36.4899, -4.9587],
    ring: rectRing(36.4899, -4.9587, 900, 700),
  },
  {
    name: 'Palm Springs · US',
    hint: 'Desert modernism, wall-to-wall pools',
    center: [33.8303, -116.5453],
    ring: rectRing(33.8303, -116.5453, 900, 700),
  },
];
