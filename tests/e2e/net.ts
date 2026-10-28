import { readFileSync } from 'node:fs';
import { test as base, type BrowserContext, type Route } from '@playwright/test';

/*
 * Network for the tests. Every request to a host other than the preview
 * server is routed here:
 * - imagery URLs listed in the open fixture manifest get the fixture bytes;
 * - the OpenFreeMap TileJSON gets a document with no layers, its tiles
 *   glyphs come from the preview server, so the map loads without labels;
 * - Nominatim gets an empty result list;
 * - anything else (imagery outside the fixture, capture date lookups) gets
 *   204, which the app reads as "no imagery here".
 */

const FIXTURE = new URL('../../packages/eval/fixtures/open/', import.meta.url);

interface Manifest {
  blocks: { id: string; source: string; x0: number; y0: number; cols: number; rows: number; attribution: string }[];
  tiles: { block: string; url: string; file: string }[];
}

export const manifest = JSON.parse(readFileSync(new URL('manifest.json', FIXTURE), 'utf8')) as Manifest;

const tileBytes = new Map<string, Buffer>();
for (const t of manifest.tiles) tileBytes.set(t.url, readFileSync(new URL(t.file, FIXTURE)));

const CORS = { 'access-control-allow-origin': '*' };

const LABEL_HOST = 'tiles.openfreemap.org';
const SEARCH_HOST = 'nominatim.openstreetmap.org';
/** Source layers the label style reads (apps/web/src/map/labels.ts). */
const LABEL_LAYERS = ['water_name', 'transportation_name', 'housenumber', 'place'];

export interface NetLog {
  /** Fixture tiles served. */
  fixture: string[];
  /** Requests answered empty. */
  empty: string[];
}

function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

async function answer(route: Route, log: NetLog): Promise<void> {
  const url = route.request().url();
  const bytes = tileBytes.get(url);
  if (bytes) {
    log.fixture.push(url);
    return route.fulfill({ status: 200, headers: CORS, contentType: 'image/jpeg', body: bytes });
  }
  const u = new URL(url);
  if (u.hostname === LABEL_HOST && u.pathname === '/planet') {
    const tilejson = { tilejson: '3.0.0', tiles: [`https://${LABEL_HOST}/planet/e2e/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14, vector_layers: LABEL_LAYERS.map((id) => ({ id, fields: {} })) };
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(tilejson) });
  }
  if (u.hostname === SEARCH_HOST) {
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' });
  }
  log.empty.push(url);
  return route.fulfill({ status: 204, headers: CORS, body: '' });
}

export async function routeNetwork(context: BrowserContext): Promise<NetLog> {
  const log: NetLog = { fixture: [], empty: [] };
  await context.route((url) => !isLocal(url), (route) => answer(route, log));
  return log;
}

/** Page problems seen during a test: console errors, uncaught errors, CSP violations. */
export interface Problems {
  console: string[];
  errors: string[];
  csp: string[];
}

export const test = base.extend<{ net: NetLog; problems: Problems }>({
  net: [
    async ({ context }, use) => {
      await use(await routeNetwork(context));
    },
    { auto: true },
  ],
  problems: [
    async ({ page }, use) => {
      const p: Problems = { console: [], errors: [], csp: [] };
      page.on('console', (m) => {
        const text = m.text();
        if (m.type() === 'error') p.console.push(text);
        if (/Content Security Policy/i.test(text) && m.type() !== 'error') p.csp.push(text);
      });
      page.on('pageerror', (e) => p.errors.push(e.message));
      await page.exposeFunction('__e2eCsp', (v: string) => p.csp.push(v));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as unknown as { __e2eCsp: (v: string) => void }).__e2eCsp(`${e.violatedDirective} blocked ${e.blockedURI}`);
        });
      });
      await use(p);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

export type Ring = [number, number][];

function lonOf(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function latOf(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * An area inside a fixture block: the block less its outer ring of tiles,
 * pulled in by a tenth of a tile. Every tile the scan reads, and every
 * neighbour it reads for the halo, is then a fixture tile.
 */
export function fixtureArea(blockId: string): Ring {
  const b = manifest.blocks.find((k) => k.id === blockId);
  if (!b) throw new Error(`no fixture block ${blockId}`);
  const z = 19;
  const x0 = b.x0 + 1.1;
  const x1 = b.x0 + b.cols - 1.1;
  const y0 = b.y0 + 1.1;
  const y1 = b.y0 + b.rows - 1.1;
  const w = round6(lonOf(x0, z));
  const e = round6(lonOf(x1, z));
  const n = round6(latOf(y0, z));
  const s = round6(latOf(y1, z));
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
}

/** The PNOA block: its source is a 256 px XYZ grid at z19, the same requests the app makes. */
export const AREA = fixtureArea('pnoa-pozuelo');

/** `#aoi=` link for a ring, in the app's version 2 format (apps/web/src/lib/permalink.ts). */
export function permalinkHash(ring: Ring): string {
  const json = JSON.stringify({ v: 2, r: ring });
  return `#aoi=${Buffer.from(json, 'utf8').toString('base64url')}`;
}
