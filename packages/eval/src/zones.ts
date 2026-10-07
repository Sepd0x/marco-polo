import type { BBox } from '@marco-polo/core';

export interface Zone {
  id: string;
  name: string;
  /** dev: allowed for tuning. test: held out, look at the numbers only. */
  split: 'dev' | 'test';
  bbox: BBox;
  areaKm2: number;
  /** Why this area is in the set. */
  why: string;
  /**
   * Shift applied to OSM labels, metres [east, north], so they sit on this
   * imagery. OSM is traced from other imagery and can be off by a few metres,
   * which is a whole small pool. Measured with `npm run eval -- offset`.
   */
  osmShiftM: [number, number];
  /** How thoroughly the labels were checked by eye. */
  review: 'full' | 'candidates';
}

/**
 * Label review depth:
 *   full        every window looked at by eye; missed pools boxed by hand
 *   candidates  every unlabelled colour candidate looked at, plus a sample of
 *               windows; pools no colour rule fires on may still be unlabelled
 */

/** A box of w × h km centred on a point. */
function box(lat: number, lon: number, wKm: number, hKm: number): { bbox: BBox; areaKm2: number } {
  const dLat = hKm / 110.574 / 2;
  const dLon = wKm / (111.32 * Math.cos((lat * Math.PI) / 180)) / 2;
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return {
    bbox: { west: r(lon - dLon), south: r(lat - dLat), east: r(lon + dLon), north: r(lat + dLat) },
    areaKm2: wKm * hKm,
  };
}

const z = (
  id: string,
  name: string,
  split: Zone['split'],
  lat: number,
  lon: number,
  wKm: number,
  hKm: number,
  why: string,
  osmShiftM: [number, number] = [0, 0],
  review: Zone['review'] = 'full',
): Zone => ({ id, name, split, ...box(lat, lon, wKm, hKm), why, osmShiftM, review });

export const ZONES: Zone[] = [
  // DEV: tune on these.
  z('vilamoura', 'Vilamoura, PT', 'dev', 37.0745, -8.1155, 1.0, 1.0,
    'resort villas, golf, marina; the reference area of the original tuning', [-0.1, 2.0]),
  z('scottsdale', 'Scottsdale, AZ, US', 'dev', 33.594, -111.926, 0.75, 0.75,
    'desert suburb, a pool in most back yards, sharp imagery'),
  z('odemira', 'Odemira greenhouses, Alentejo, PT', 'dev', 37.5435, -8.7766, 1.0, 1.0,
    'farmland: plastic greenhouses, irrigation tanks and reservoirs, few houses; mostly a false-positive test'),
  z('aix', 'Puyricard, Aix-en-Provence, FR', 'dev', 43.57, 5.42, 1.0, 1.0,
    'Provence countryside villas, sharp summer imagery, dense OSM pool mapping', [0.2, 2.2]),
  z('balma', 'Balma, Toulouse, FR', 'dev', 43.61, 1.5, 1.0, 1.0,
    'inland suburb, lawns and trees, dense OSM pool mapping', [-0.4, 1.6]),
  // TEST: held out. Never tune on these.
  z('marbella', 'Marbella, ES', 'test', 36.4899, -4.9587, 1.0, 1.0,
    'dense villas on slopes, vegetation, rooftop solar; OSM pools mostly mapped as points', [-1.2, 1.0], 'candidates'),
  z('cascais', 'Birre, Cascais, PT', 'test', 38.718, -9.443, 0.75, 0.75,
    'Atlantic suburb, villas and gardens', [0.7, 1.0]),
  z('algarve', 'Santa Barbara de Nexe, Algarve interior, PT', 'test', 37.105, -7.965, 1.0, 1.0,
    'scattered rural villas, orchards, farm water tanks'),
  z('castelnau', 'Castelnau-le-Lez, Montpellier, FR', 'test', 43.635, 3.905, 1.0, 1.0,
    'hillside suburb, trees and low sun, very dense OSM pool mapping', [0.3, 0.8], 'candidates'),
  z('arcadia', 'Arcadia, Phoenix, AZ, US', 'test', 33.50, -111.97, 1.0, 1.0,
    'desert suburb with large lots; OSM pools mapped as points', [0, 0], 'candidates'),
];

export function zoneById(id: string): Zone {
  const zone = ZONES.find((z) => z.id === id);
  if (!zone) throw new Error(`unknown area ${id} (known: ${ZONES.map((z) => z.id).join(', ')})`);
  return zone;
}

export function selectZones(spec: string): Zone[] {
  if (spec === 'all') return ZONES;
  if (spec === 'dev' || spec === 'test') return ZONES.filter((z) => z.split === spec);
  return spec.split(',').map((s) => zoneById(s.trim()));
}

export { z as defineZone };
