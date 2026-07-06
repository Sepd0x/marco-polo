import type { RankedDetection, Ring } from '@marco-polo/core';
import { googleMapsUrl } from './links.js';

function closeRing(ring: Ring): [number, number][] {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring as [number, number][];
  return [...ring, first] as [number, number][];
}

export function toGeoJSON(detections: RankedDetection[], meta: Record<string, unknown> = {}): string {
  const collection = {
    type: 'FeatureCollection',
    ...meta,
    features: detections.map((d) => ({
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: d.outline.map((ring) => [closeRing(ring)]),
      },
      properties: {
        id: d.id,
        rank: d.rank,
        kind: d.kind,
        area_m2: Number(d.areaM2.toFixed(1)),
        confidence: d.confidence,
        lat: Number(d.center.lat.toFixed(6)),
        lon: Number(d.center.lon.toFixed(6)),
        truncated: d.truncated,
        google_maps: googleMapsUrl(d.center.lat, d.center.lon),
      },
    })),
  };
  return JSON.stringify(collection, null, 2);
}

export function toCSV(detections: RankedDetection[]): string {
  const header = 'rank,id,kind,lat,lon,area_m2,confidence,truncated,google_maps';
  const rows = detections.map((d) =>
    [
      d.rank,
      d.id,
      d.kind,
      d.center.lat.toFixed(6),
      d.center.lon.toFixed(6),
      d.areaM2.toFixed(1),
      d.confidence,
      d.truncated,
      `"${googleMapsUrl(d.center.lat, d.center.lon)}"`,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
