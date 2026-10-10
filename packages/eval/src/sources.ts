/**
 * Imagery sources the benchmark can read, in the shape of the shared
 * `ImageryProvider` contract. The app's own registry lives in packages/core;
 * these entries only need what the harness uses: how to request a tile, how
 * to recognise "no imagery here", and what to write in the report.
 *
 * Licences and attributions are the ones read on 7 Oct 2026
 * (C:/dev/mp-research/licencas/TABELA.md).
 */
import { ESRI_WORLD_IMAGERY, type ImageryProvider, type TileCoord } from '@marco-polo/core';
import type { SourceId } from './candidates.js';

const ORIGIN_SHIFT = 20037508.342789244;

/** EPSG:3857 bounds of a tile, metres: [minx, miny, maxx, maxy]. */
export function tileBounds3857(t: TileCoord): [number, number, number, number] {
  const size = (2 * ORIGIN_SHIFT) / 2 ** t.z;
  const minx = -ORIGIN_SHIFT + t.x * size;
  const maxy = ORIGIN_SHIFT - t.y * size;
  return [minx, maxy - size, minx + size, maxy];
}

/** Fill `{bbox-epsg-3857}` with a tile grown by `marginFrac` of its side on every side. */
export function wmsUrl(template: string, t: TileCoord, px: number, marginFrac = 0): string {
  const [minx, miny, maxx, maxy] = tileBounds3857(t);
  const m = (maxx - minx) * marginFrac;
  const bbox = [minx - m, miny - m, maxx + m, maxy + m].map((v) => v.toFixed(3)).join(',');
  return template
    .replace('{bbox-epsg-3857}', bbox)
    .replace(/WIDTH=\d+/i, `WIDTH=${px}`)
    .replace(/HEIGHT=\d+/i, `HEIGHT=${px}`);
}

const DGT_ORTOS2025: ImageryProvider = {
  id: 'dgt-ortos2025',
  name: 'DGT Ortos2025',
  kind: 'wms',
  template:
    'https://cartografia.dgterritorio.gov.pt/wms/ortos2025?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Ortos2025-RGB&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg',
  layer: 'Ortos2025-RGB',
  tileSize: 256,
  requestPx: 512,
  minZoom: 12,
  maxZoom: 20,
  nativeResM: 0.25,
  date: '2025',
  coverage: null,
  attribution: 'Informação geográfica cedida pela Direção-Geral do Território, Ortos2025, CC BY 4.0',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://snig.dgterritorio.gov.pt/rndg/srv/por/catalog.search#/metadata/96d83932-f957-40d6-a2ea-3a25751c4b2d',
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 4, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

const PNOA: ImageryProvider = {
  id: 'pnoa',
  name: 'PNOA (IGN Spain)',
  kind: 'xyz',
  template:
    'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=image/jpeg',
  // Same bytes as the WMTS (checked on the Pozuelo fixture); the cache and the manifest keep the WMTS URL.
  mirror: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
  tileSize: 256,
  requestPx: 256,
  minZoom: 0,
  maxZoom: 20,
  nativeResM: 0.25,
  date: null,
  coverage: null,
  attribution: 'CC BY 4.0 scne.es',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 4, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

const IGN_FR: ImageryProvider = {
  id: 'ign-orthophotos',
  name: 'IGN Geoplateforme ORTHOIMAGERY.ORTHOPHOTOS',
  kind: 'xyz',
  template:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
  layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
  tileSize: 256,
  requestPx: 256,
  minZoom: 0,
  maxZoom: 19,
  nativeResM: 0.2,
  date: null,
  coverage: null,
  attribution: 'IGN, BD ORTHO (Géoplateforme), Licence Ouverte 2.0',
  licence: 'Licence Ouverte Etalab 2.0',
  licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 4, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

export const SOURCES: Record<SourceId, ImageryProvider> = {
  esri: ESRI_WORLD_IMAGERY,
  dgt: DGT_ORTOS2025,
  pnoa: PNOA,
  ign: IGN_FR,
};

export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

export function isSourceId(s: string): s is SourceId {
  return (SOURCE_IDS as string[]).includes(s);
}

/** Whether a source's tiles may be copied into the repo (CI fixture). Esri's terms only allow viewing. */
export function redistributable(id: SourceId): boolean {
  return id !== 'esri';
}

/** Byte length of the Esri "Map data not yet available" placeholder (z20 and beyond). */
export const ESRI_PLACEHOLDER_BYTES = 2521;

/**
 * "No imagery here" from the decoded pixels: the DGT answers pure white
 * outside its coverage, PNOA a near-flat JPEG. Real imagery is never this flat
 * over a whole tile.
 */
export function isBlankTile(rgba: ArrayLike<number>): boolean {
  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < rgba.length; i += 16) {
    const v = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    sum += v;
    sum2 += v * v;
    n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean < 4;
}
