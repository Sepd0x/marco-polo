import type { ImageryProvider, LonLat } from '../types.js';
import { EARTH_RADIUS, latToWorldY, lonLatToTile, lonToWorldX, TILE_SIZE } from '../geo/mercator.js';

/**
 * When and how sharp the imagery under a point was captured. `date` is an ISO
 * date, a month (`2022-07`), or a range (`2025-03-31/2025-07-26`); null means
 * not measured.
 */
export interface CaptureInfo {
  date: string | null;
  /** Ground sample distance at the point, metres, when the source says. */
  resolutionM: number | null;
  /** Sensor or camera when the source says (`WV02`, `UltraCam Falcon F100`). */
  sensor: string | null;
  /** Where the answer came from. */
  basis: string;
}

/** A metadata request to make for a point: try the URLs in order, parse each body. */
export interface CaptureLookup {
  urls: string[];
  parse(body: string): CaptureInfo | null;
}

const DEG = Math.PI / 180;

/**
 * Forward transverse Mercator on GRS80 for PT-TM06/ETRS89 (EPSG:3763):
 * origin 39°40'05.73"N 8°07'59.19"W, k0 = 1, no false origin. Returns
 * [M, P] (easting, northing) in metres. Series from Snyder (1987), p. 61.
 */
export function toPtTm06(lon: number, lat: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat0 = 39.66825833333333 * DEG;
  const lon0 = -8.133108333333333 * DEG;
  const phi = lat * DEG;
  const meridian = (p: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * p -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p) +
      ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = (lon * DEG - lon0) * cos;
  const x =
    N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    meridian(phi) -
    meridian(lat0) +
    N * tan * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720);
  return [x, y];
}

/**
 * Ortos2025 flight lots, north to south, by PT-TM06 northing (P). From the
 * dataset description at
 * https://dados.gov.pt/datasets/ortofotos-25-cm-portugal-continental-2025
 * (read 7 Oct 2026).
 */
export const ORTOS2025_LOTS: readonly { lot: number; minP: number; dates: string; camera: string }[] = [
  { lot: 1, minP: 133_000, dates: '2025-03-31/2025-07-26', camera: 'Vexcel UltraCam Eagle M4 f90' },
  { lot: 2, minP: -6_000, dates: '2025-03-29/2025-07-26', camera: 'Vexcel UltraCam Eagle M4 f90' },
  { lot: 3, minP: -120_000, dates: '2025-04-26/2025-07-15', camera: 'UltraCam Falcon F100' },
  { lot: 4, minP: -Infinity, dates: '2025-05-24/2025-07-25', camera: 'Vexcel UltraCam Eagle M4 f90' },
];

/**
 * Capture information that needs no request: tables published with the
 * dataset. Null when the source has no such table.
 */
export function staticCaptureInfo(provider: ImageryProvider, point: LonLat): CaptureInfo | null {
  if (provider.id === 'dgt-ortos2025') {
    const [, p] = toPtTm06(point.lon, point.lat);
    const lot = ORTOS2025_LOTS.find((l) => p >= l.minP)!;
    return { date: lot.dates, resolutionM: 0.25, sensor: lot.camera, basis: `dados.gov.pt, Ortos2025 lot ${lot.lot}` };
  }
  if (provider.id === 'dgt-ortosat2023') {
    // "obtidas da constelação de satélites Pleiades-Neo (3 & 4) durante o período de abril a outubro de 2023"
    return { date: '2023-04/2023-10', resolutionM: 0.3, sensor: 'Pleiades Neo', basis: 'dados.gov.pt, OrtoSat2023' };
  }
  return null;
}

const ESRI_METADATA =
  'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer';

/**
 * Metadata request for a point, for sources that publish capture dates per
 * place: Esri (metadata layers), PNOA (OI.MosaicElement) and IGN France
 * (BD ORTHO mosaic graph). Null for sources without one.
 */
export function captureLookup(provider: ImageryProvider, point: LonLat, zoom: number): CaptureLookup | null {
  const { lon, lat } = point;
  if (provider.id === 'esri-world-imagery') {
    // Layer 9 holds the 30 cm records, layer 10 the 60 cm ones; a z19 record
    // can sit in either, so both are tried and MinMapLevel/MaxMapLevel decide.
    const q =
      `query?geometry=${lon.toFixed(6)}%2C${lat.toFixed(6)}&geometryType=esriGeometryPoint&inSR=4326` +
      '&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE2%2CSRC_RES%2CSRC_DESC%2CMinMapLevel%2CMaxMapLevel' +
      '&returnGeometry=false&f=json';
    return {
      urls: [`${ESRI_METADATA}/9/${q}`, `${ESRI_METADATA}/10/${q}`],
      parse: (body) => parseEsriMetadata(body, zoom),
    };
  }
  if (provider.id === 'pnoa') {
    const [x, y] = toMercator(lon, lat);
    const h = 50;
    const url =
      'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo' +
      '&LAYERS=OI.MosaicElement&QUERY_LAYERS=OI.MosaicElement&STYLES=&CRS=EPSG:3857' +
      `&BBOX=${(x - h).toFixed(2)},${(y - h).toFixed(2)},${(x + h).toFixed(2)},${(y + h).toFixed(2)}` +
      '&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=application/json';
    return { urls: [url], parse: parsePnoaFeatureInfo };
  }
  if (provider.id === 'ign-orthophotos') {
    const z = Math.min(zoom, provider.maxZoom);
    const t = lonLatToTile(lon, lat, z);
    const i = Math.floor(lonToWorldX(lon, z) - t.x * TILE_SIZE);
    const j = Math.floor(latToWorldY(lat, z) - t.y * TILE_SIZE);
    const url =
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetFeatureInfo&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
      `&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${t.y}&TILECOL=${t.x}` +
      `&I=${i}&J=${j}&INFOFORMAT=application/json`;
    return { urls: [url], parse: parseIgnFeatureInfo };
  }
  return null;
}

function toMercator(lon: number, lat: number): [number, number] {
  return [lon * DEG * EARTH_RADIUS, Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) * EARTH_RADIUS];
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Esri metadata layer query: the record whose level range holds `zoom`. */
export function parseEsriMetadata(body: string, zoom: number): CaptureInfo | null {
  const json = safeJson(body) as { features?: { attributes?: Record<string, unknown> }[] } | null;
  for (const f of json?.features ?? []) {
    const a = f.attributes ?? {};
    const min = num(a.MinMapLevel);
    const max = num(a.MaxMapLevel);
    if (min === null || max === null || zoom < min || zoom > max) continue;
    const ms = num(a.SRC_DATE2);
    if (ms === null) continue;
    return {
      date: new Date(ms).toISOString().slice(0, 10),
      resolutionM: num(a.SRC_RES),
      sensor: typeof a.SRC_DESC === 'string' ? a.SRC_DESC : null,
      basis: 'Esri World Imagery metadata',
    };
  }
  return null;
}

/** PNOA GetFeatureInfo on OI.MosaicElement: `Fecha` is year and month. */
export function parsePnoaFeatureInfo(body: string): CaptureInfo | null {
  const json = safeJson(body) as { features?: { properties?: Record<string, unknown> }[] } | null;
  const p = json?.features?.[0]?.properties;
  if (!p) return null;
  const fecha = typeof p.Fecha === 'string' && /^\d{4}(-\d{2}){0,2}$/.test(p.Fecha) ? p.Fecha : null;
  if (!fecha) return null;
  return { date: fecha, resolutionM: num(p.Resolucion), sensor: null, basis: 'PNOA OI.MosaicElement' };
}

/** IGN BD ORTHO mosaic graph: `date_vol` is the flight day, `res` is in cm. */
export function parseIgnFeatureInfo(body: string): CaptureInfo | null {
  const json = safeJson(body) as { features?: { properties?: Record<string, unknown> }[] } | null;
  const p = json?.features?.[0]?.properties;
  if (!p) return null;
  const m = typeof p.date_vol === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(p.date_vol) : null;
  if (!m) return null;
  const res = num(p.res);
  return { date: m[1], resolutionM: res === null ? null : res / 100, sensor: null, basis: 'IGN BD ORTHO mosaic graph' };
}

/** Hosts the metadata lookups talk to, for a Content Security Policy. */
export const CAPTURE_LOOKUP_HOSTS: readonly string[] = [
  'https://services.arcgisonline.com',
  'https://www.ign.es',
  'https://data.geopf.fr',
];
