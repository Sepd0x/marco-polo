import type {
  ImageryProvider,
  Provenance,
  RankedDetection,
  ResultDetection,
  Ring,
  ScanPartSummary,
  ScanResult,
} from './types.js';
import { findAnyProvider } from './providers.js';
import { orientedDims } from './geo/obb.js';

/*
 * Export of a scan result as GeoJSON and CSV. Every row carries where its
 * pixels came from; no URL, template or credential ever goes out.
 */

/** Provenance for detections scanned on `provider` in plan part `partId`. */
export function provenanceOf(provider: ImageryProvider, partId: string, zoom: number, date: string | null): Provenance {
  return {
    providerId: provider.id,
    providerName: provider.name,
    layer: provider.layer ?? null,
    date: date ?? provider.date,
    zoom,
    nativeResM: provider.nativeResM,
    partId,
  };
}

/**
 * A ranked detection with its measured dimensions and provenance. Length and
 * width come from the minimum-area rectangle of the traced outline; a shape
 * cut by the edge of the scanned imagery is not measured.
 */
export function toResultDetection(d: RankedDetection, provenance: Provenance): ResultDetection {
  return { ...d, dims: d.truncated ? null : orientedDims(d.outline), provenance };
}

export function partSummary(
  id: string,
  provenance: Provenance,
  tiles: number,
  tilesNoCoverage: number,
  areaM2: number,
): ScanPartSummary {
  return { id, provenance, tiles, tilesNoCoverage, areaM2 };
}

/** Google Maps link for a point, in the documented Maps URLs format. */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

/** Credit line for data derived from a source, with the capture date when known. */
export function attributionFor(provenance: Provenance): string {
  const p = findAnyProvider(provenance.providerId);
  if (!p) return provenance.providerName;
  // The PNOA licence asks derived works to say so, with the date of the imagery.
  if (p.id === 'pnoa') {
    return provenance.date ? `Obra derivada de PNOA ${provenance.date} CC-BY 4.0 scne.es` : 'Obra derivada de PNOA CC-BY 4.0 scne.es';
  }
  if (p.id === 'ign-orthophotos' && provenance.date) return `${p.attribution}, ${provenance.date}, ${p.licence}`;
  return p.attribution;
}

/** One credit line per source used, in part order. */
export function attributionLines(result: ScanResult): string[] {
  const out: string[] = [];
  for (const part of result.parts) {
    const line = attributionFor(part.provenance);
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

const SECRET_KEY = /key|token|secret|password|signature|template|url/i;
const SECRET_VALUE = /([?&](?:api[_-]?key|key|access[_-]?token|token|sig|signature)=)[^&\s"]*/gi;

/**
 * Drop any field whose name suggests a credential or a request URL, and blank
 * credential parameters inside strings. The result types carry none today;
 * this keeps it that way if one slips in.
 */
export function stripSecrets<T>(value: T): T {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '$1') as T;
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}

function closeRing(r: Ring): Ring {
  if (r.length === 0) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}

const round = (v: number, d: number) => Number(v.toFixed(d));

function properties(d: ResultDetection) {
  return {
    id: d.id,
    rank: d.rank,
    kind: d.kind,
    area_m2: round(d.areaM2, 1),
    confidence: round(d.confidence, 3),
    lat: round(d.center.lat, 6),
    lon: round(d.center.lon, 6),
    truncated: d.truncated,
    length_m: d.dims ? round(d.dims.lengthM, 1) : null,
    width_m: d.dims ? round(d.dims.widthM, 1) : null,
    heading_deg: d.dims ? round(d.dims.angleDeg, 0) : null,
    source: d.provenance.providerId,
    source_name: d.provenance.providerName,
    layer: d.provenance.layer,
    capture_date: d.provenance.date,
    native_res_m: d.provenance.nativeResM,
    zoom: d.provenance.zoom,
    part: d.provenance.partId,
    google_maps: googleMapsUrl(d.center.lat, d.center.lon),
  };
}

export function toGeoJSON(result: ScanResult): string {
  const doc = {
    type: 'FeatureCollection',
    generator: 'marco-polo',
    formatVersion: result.formatVersion,
    createdAt: result.createdAt,
    threshold: result.threshold,
    belowThreshold: result.belowThreshold,
    attribution: attributionLines(result),
    parts: result.parts.map((p) => ({
      id: p.id,
      source: p.provenance.providerId,
      source_name: p.provenance.providerName,
      layer: p.provenance.layer,
      capture_date: p.provenance.date,
      zoom: p.provenance.zoom,
      tiles: p.tiles,
      tiles_no_coverage: p.tilesNoCoverage,
      area_m2: round(p.areaM2, 0),
      licence: findAnyProvider(p.provenance.providerId)?.licence ?? null,
    })),
    area: { type: 'Polygon', coordinates: [closeRing(result.area)] },
    features: result.detections.map((d) => ({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: d.outline.map((r) => [closeRing(r)]) },
      properties: properties(d),
    })),
  };
  return JSON.stringify(stripSecrets(doc), null, 2);
}

/** Quote a CSV cell when needed; neutralise text a spreadsheet would run as a formula. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const CSV_COLUMNS = [
  'rank', 'id', 'kind', 'lat', 'lon', 'area_m2', 'length_m', 'width_m', 'heading_deg', 'confidence',
  'truncated', 'source', 'capture_date', 'native_res_m', 'part', 'google_maps', 'attribution',
] as const;

export function toCSV(result: ScanResult): string {
  const rows = result.detections.map((d) => {
    const p = properties(d);
    const cells: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      rank: p.rank,
      id: p.id,
      kind: p.kind,
      lat: p.lat,
      lon: p.lon,
      area_m2: p.area_m2,
      length_m: p.length_m,
      width_m: p.width_m,
      heading_deg: p.heading_deg,
      confidence: p.confidence,
      truncated: p.truncated,
      source: p.source,
      capture_date: p.capture_date,
      native_res_m: p.native_res_m,
      part: p.part,
      google_maps: p.google_maps,
      attribution: attributionFor(d.provenance),
    };
    return CSV_COLUMNS.map((c) => csvCell(stripSecrets(cells[c]))).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
