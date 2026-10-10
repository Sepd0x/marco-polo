import type { ImageryProvider } from './types.js';
import { FRANCE_METROPOLITAN, PORTUGAL_MAINLAND, SPAIN } from './imagery/coverage-data.js';
import { ringBBox } from './geo/polygon.js';
import type { BBox, Coverage, Ring } from './types.js';

/*
 * The imagery sources the app knows. Licences, attribution and limits come
 * from the licence review of 7 Oct 2026; each entry names the pages it was
 * read from. A source is scan-allowed only when its licence was found in
 * writing, and only open licences get a persistent cache.
 */

function coverageOf(polygons: Ring[]): Coverage {
  let bbox: BBox = ringBBox(polygons[0]);
  for (const ring of polygons.slice(1)) {
    const b = ringBBox(ring);
    bbox = {
      west: Math.min(bbox.west, b.west),
      south: Math.min(bbox.south, b.south),
      east: Math.max(bbox.east, b.east),
      north: Math.max(bbox.north, b.north),
    };
  }
  return { bbox, polygons };
}

const DGT_ATTRIBUTION = 'Informação geográfica cedida pela Direção-Geral do Território';
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

/**
 * DGT Ortos2025: aerial, 25 cm, mainland Portugal, flown 29 Mar to 26 Jul 2025.
 * CC BY 4.0 in SNIG record 96d83932-f957-40d6-a2ea-3a25751c4b2d and at
 * https://dados.gov.pt/datasets/ortofotos-25-cm-portugal-continental-2025.
 * WMS in EPSG:3857; 512 px per request gives about 25 cm per pixel on a z18
 * grid. No published rate limit; no Cache-Control on GetMap (measured).
 */
export const DGT_ORTOS2025: ImageryProvider = {
  id: 'dgt-ortos2025',
  name: 'DGT Ortos2025',
  kind: 'wms',
  template:
    'https://cartografia.dgterritorio.gov.pt/wms/ortos2025?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
    '&LAYERS=Ortos2025-RGB&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg',
  layer: 'Ortos2025-RGB',
  tileSize: 256,
  requestPx: 512,
  minZoom: 6,
  maxZoom: 19,
  nativeResM: 0.25,
  date: '2025',
  coverage: coverageOf(PORTUGAL_MAINLAND),
  attribution: `${DGT_ATTRIBUTION} (Ortos2025, CC BY 4.0)`,
  licence: 'CC BY 4.0',
  licenceUrl: CC_BY_4,
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 4, basis: 'chosen' },
  fallback: 'dgt-ortosat2023',
};

/**
 * DGT OrtoSat2023: Pleiades Neo satellite mosaic, 30 cm, April to October 2023.
 * The SNIG record (b2a1ca02-779b-4189-b895-85d10fff610f) and dados.gov.pt give
 * no licence: viewing is unrestricted, the image files are not open. So it can
 * be shown but never scanned, and the scan fallback chain skips it.
 */
export const DGT_ORTOSAT2023: ImageryProvider = {
  id: 'dgt-ortosat2023',
  name: 'DGT OrtoSat2023',
  kind: 'wms',
  template:
    'https://ortos.dgterritorio.gov.pt/wms/ortosat2023?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
    '&LAYERS=ortoSat2023-CorVerdadeira&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg',
  layer: 'ortoSat2023-CorVerdadeira',
  tileSize: 256,
  requestPx: 512,
  minZoom: 6,
  maxZoom: 19,
  nativeResM: 0.3,
  date: '2023',
  coverage: coverageOf(PORTUGAL_MAINLAND),
  attribution: `${DGT_ATTRIBUTION} (OrtoSat2023)`,
  licence: 'Not specified (view only)',
  licenceUrl: 'https://dados.gov.pt/datasets/ortosat-30-cm-portugal-continental-2023',
  scanAllowed: false,
  cachePolicy: 'http',
  rate: { maxPerSec: 4, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

/**
 * PNOA maximum currency mosaic (IGN Spain), 25 cm in most of Spain. CC BY 4.0
 * (Orden FOM/2807/2015; AccessConstraints in https://www.ign.es/wmts/pnoa-ma
 * capabilities). Tiles exist up to level 19. Melilla is Pleiades Neo
 * (Airbus DS) and is left out of the coverage. Tiles carry max-age=31536000.
 */
export const PNOA: ImageryProvider = {
  id: 'pnoa',
  name: 'PNOA (IGN Spain)',
  kind: 'xyz',
  template:
    'https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&version=1.0.0&layer=OI.OrthoimageCoverage' +
    '&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=image/jpeg',
  // The IGN TMS of the same mosaic: byte-identical tiles (checked 10 Oct 2026 on the Pozuelo fixture), up when the WMTS is not.
  mirror: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
  layer: 'OI.OrthoimageCoverage',
  tileSize: 256,
  requestPx: 256,
  minZoom: 0,
  maxZoom: 19,
  nativeResM: 0.25,
  date: null,
  coverage: coverageOf(SPAIN),
  attribution: 'CC BY 4.0 scne.es',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf',
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 5, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

/**
 * IGN France ORTHOIMAGERY.ORTHOPHOTOS (BD ORTHO, 20 cm) on the Géoplateforme
 * WMTS, metropolitan France and Corsica. Licence Ouverte 2.0 (metadata
 * IGNF_BD-ORTHO; https://cartes.gouv.fr/cgu). The CGU (art. 3.2) put no usage
 * limit on the WMTS. Answers 404 outside its data and white near some borders.
 */
export const IGN_ORTHOPHOTOS: ImageryProvider = {
  id: 'ign-orthophotos',
  name: 'IGN BD ORTHO',
  kind: 'xyz',
  template:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
    '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
  layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
  tileSize: 256,
  requestPx: 256,
  minZoom: 0,
  maxZoom: 19,
  nativeResM: 0.2,
  date: null,
  coverage: coverageOf(FRANCE_METROPOLITAN),
  attribution: 'IGN, BD ORTHO (Géoplateforme)',
  licence: 'Licence Ouverte 2.0 (Etalab)',
  licenceUrl: 'https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf',
  scanAllowed: true,
  cachePolicy: 'persistent',
  rate: { maxPerSec: 5, basis: 'chosen' },
  fallback: 'esri-world-imagery',
};

/**
 * Esri World Imagery. Global and keyless. Its terms (read 7 Oct 2026) only
 * cover viewing; scanning on it outside the open national sources is a
 * standing product decision, so it stays scan-allowed until that changes.
 * No app cache: the browser keeps tiles for the max-age Esri sends.
 */
export const ESRI_WORLD_IMAGERY: ImageryProvider = {
  id: 'esri-world-imagery',
  name: 'Esri World Imagery',
  kind: 'xyz',
  template:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  tileSize: 256,
  requestPx: 256,
  minZoom: 0,
  maxZoom: 19,
  nativeResM: null,
  date: null,
  coverage: null,
  attribution: 'Powered by Esri. Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  licence: 'Esri Master License Agreement',
  licenceUrl: 'https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf',
  scanAllowed: true,
  cachePolicy: 'http',
  rate: { maxPerSec: 5, basis: 'chosen' },
};

/**
 * Every source the app knows, in order of preference for `auto`. Order also
 * settles borders: where two coverages overlap, the earlier source wins.
 */
export const IMAGERY_PROVIDERS: readonly ImageryProvider[] = [
  DGT_ORTOS2025,
  PNOA,
  IGN_ORTHOPHOTOS,
  DGT_ORTOSAT2023,
  ESRI_WORLD_IMAGERY,
];

/**
 * DGT Ortos2018 (25 cm, CC BY 4.0 in SNIG record
 * daf5479d-29c8-4e0c-b7b8-0e1791891186). For training and fixtures only, so
 * it is not offered in the app.
 */
export const DGT_ORTOS2018: ImageryProvider = {
  ...DGT_ORTOS2025,
  id: 'dgt-ortos2018',
  name: 'DGT Ortos2018',
  template: DGT_ORTOS2025.template.replace('/ortos2025?', '/ortos2018?').replace('Ortos2025-RGB', 'Ortos2018-RGB'),
  layer: 'Ortos2018-RGB',
  date: '2018',
  attribution: `${DGT_ATTRIBUTION} (Ortos2018, CC BY 4.0)`,
  fallback: undefined,
};

/** Sources used only by training and evaluation tools. */
export const TRAINING_PROVIDERS: readonly ImageryProvider[] = [DGT_ORTOS2018];

export function findProvider(id: string): ImageryProvider | undefined {
  return IMAGERY_PROVIDERS.find((p) => p.id === id);
}

/** Like findProvider, but also knows the training-only sources. */
export function findAnyProvider(id: string): ImageryProvider | undefined {
  return findProvider(id) ?? TRAINING_PROVIDERS.find((p) => p.id === id);
}
