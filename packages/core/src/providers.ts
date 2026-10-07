import type { ImageryProvider } from './types.js';

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

/** Every source the app knows, in order of preference for `auto`. */
export const IMAGERY_PROVIDERS: readonly ImageryProvider[] = [ESRI_WORLD_IMAGERY];

export function findProvider(id: string): ImageryProvider | undefined {
  return IMAGERY_PROVIDERS.find((p) => p.id === id);
}
