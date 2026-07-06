/**
 * Imagery providers.
 *
 * Marco Polo analyses standard XYZ raster tiles, so any Web Mercator imagery
 * endpoint works. The default is Esri World Imagery, which serves high-resolution
 * aerial imagery with permissive CORS and requires attribution (shown on the map
 * and in exports). See docs/IMAGERY.md for terms, limits and alternatives.
 */

export interface ImageryProvider {
  id: string;
  name: string;
  /** XYZ template with {z}/{x}/{y} placeholders. */
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
  tileSize: 256;
}

export const ESRI_WORLD_IMAGERY: ImageryProvider = {
  id: 'esri-world-imagery',
  name: 'Esri World Imagery',
  urlTemplate:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  maxZoom: 19,
  tileSize: 256,
};

export function makeCustomProvider(urlTemplate: string, attribution = 'Custom imagery'): ImageryProvider {
  return {
    id: 'custom',
    name: 'Custom XYZ endpoint',
    urlTemplate,
    attribution,
    maxZoom: 21,
    tileSize: 256,
  };
}
