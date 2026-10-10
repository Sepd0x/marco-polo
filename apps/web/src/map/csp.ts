// Relative imports: vite.config.ts loads this file, and the config bundler
// leaves workspace packages to Node, which cannot run the core's TypeScript.
import { IMAGERY_PROVIDERS } from '../../../../packages/core/src/providers.js';
import { CAPTURE_LOOKUP_HOSTS } from '../../../../packages/core/src/imagery/dates.js';

/** Vector labels, their TileJSON and glyphs. */
export const LABEL_ORIGIN = 'https://tiles.openfreemap.org';

/** Place search. */
export const SEARCH_ORIGIN = 'https://nominatim.openstreetmap.org';

/** Origins the imagery sources are fetched from, from the source registry. */
export function imageryOrigins(): string[] {
  const templates = IMAGERY_PROVIDERS.flatMap((p) => (p.mirror ? [p.template, p.mirror] : [p.template]));
  return [...new Set(templates.map((t) => new URL(t.replace(/\{[^}]*\}/g, '0')).origin))];
}

/** Every origin the app talks to. */
export function externalOrigins(): string[] {
  return [...new Set([...imageryOrigins(), ...CAPTURE_LOOKUP_HOSTS, LABEL_ORIGIN, SEARCH_ORIGIN])].sort();
}

/**
 * Content Security Policy for production builds. Tiles are fetched (MapLibre
 * uses fetch, the scan worker too) and sometimes loaded as images, so the
 * imagery origins go in both connect-src and img-src.
 */
export function buildCsp(): string {
  const all = externalOrigins();
  const imagery = imageryOrigins();
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${imagery.join(' ')}`,
    `connect-src 'self' ${all.join(' ')}`,
    "worker-src 'self' blob:",
    // MapLibre ships a fallback glyph font as a data URI.
    "font-src 'self' data:",
    "base-uri 'self'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}
