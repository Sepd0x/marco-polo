import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { AREA, permalinkHash, type Ring } from './net.ts';

/*
 * Every way the tests reach the app's UI. Locators use roles, accessible
 * names and stable text only, so a redesign changes this file and not the
 * specs. The map is read through the instance `?map-debug` exposes.
 */

const SCAN_TIMEOUT = 60_000;

/** Open the app on an area link and wait until the area is ready to scan. */
export async function openArea(page: Page, ring: Ring = AREA): Promise<void> {
  await page.goto(`./?map-debug${permalinkHash(ring)}`);
  await expect(areaPanel(page)).toBeVisible();
}

/** The panel describing the area before a scan. */
export function areaPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Your area' });
}

export async function startScan(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start scan' }).click();
}

/** The scan summary shown once a scan ends. */
export function summary(page: Page): Locator {
  return page.getByRole('region', { name: 'Scan complete' });
}

export async function waitForResult(page: Page): Promise<void> {
  await expect(summary(page)).toBeVisible({ timeout: SCAN_TIMEOUT });
}

/** Scan and wait for the summary. */
export async function scanArea(page: Page, ring: Ring = AREA): Promise<void> {
  await openArea(page, ring);
  await startScan(page);
  await waitForResult(page);
}

/** The large pool count in the summary. */
export async function poolCount(page: Page): Promise<number> {
  const text = await summary(page).locator('[aria-live]').innerText();
  const m = /\d[\d,]*/.exec(text);
  if (!m) throw new Error(`no count in "${text}"`);
  return Number(m[0].replaceAll(',', ''));
}

/** Rows of the pool list. */
export function listRows(page: Page): Locator {
  return page.getByRole('listbox', { name: 'Pools' }).getByRole('option');
}

/** The summary line that says no tile failed or lacked imagery. */
export function noTilesMissing(page: Page): Locator {
  return summary(page).getByText('none missing');
}

/** Alerts in the summary (failed tiles, empty imagery). */
export function summaryAlerts(page: Page): Locator {
  return summary(page).getByRole('alert');
}

export function scoreSlider(page: Page): Locator {
  return page.getByRole('slider', { name: 'Minimum score' });
}

export async function setMinScore(page: Page, value: number): Promise<void> {
  await scoreSlider(page).fill(String(value));
}

async function download(page: Page, button: string): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), summary(page).getByRole('button', { name: button }).click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), text: readFileSync(path, 'utf8') };
}

export function exportCsv(page: Page): Promise<{ name: string; text: string }> {
  return download(page, 'CSV');
}

export function exportGeoJson(page: Page): Promise<{ name: string; text: string }> {
  return download(page, 'GeoJSON');
}

/** The light or dark theme switch, named for the theme it turns on. */
export function themeToggle(page: Page): Locator {
  return page.getByRole('button', { name: /^(Dark|Light) theme$/ });
}

/** The theme written on the root element, or null when the page follows the system. */
export function rootTheme(page: Page): Promise<string | null> {
  return page.locator('html').getAttribute('data-theme');
}

/** Phone: the button at the top edge of the bottom sheet. */
export function sheetHandle(page: Page): Locator {
  return page.getByRole('button', { name: /^(Hide|Show) the panel$/ });
}

/* Map, through the instance exposed by ?map-debug. */

type MapLike = {
  getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: unknown } }[] }> } | undefined;
  project(p: [number, number]): { x: number; y: number };
  getContainer(): HTMLElement;
  isMoving(): boolean;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  queryRenderedFeatures(opts: { layers: string[] }): unknown[];
  getStyle(): { layers: { id: string }[] };
  listImages(): string[];
};

/** Pools drawn on the map (one marker each). */
export function mapPoolCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const map = (window as unknown as { __mpMap: MapLike }).__mpMap;
    const data = await map.getSource('det-points')!.getData();
    return data.features.length;
  });
}

/** Pool numbers the map has drawn on screen. */
export function mapLabelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as unknown as { __mpMap: MapLike }).__mpMap;
    return map.queryRenderedFeatures({ layers: ['det-rank'] }).length;
  });
}

/**
 * How the map draws the pools: outlines on screen (one per pool), whether the
 * outlines lie above the numbers, the zoom, and boxed label images in use.
 */
export function mapPoolDrawing(page: Page): Promise<{ outlines: number; outlinesOnTop: boolean; zoom: number; boxes: number }> {
  return page.evaluate(() => {
    const map = (window as unknown as { __mpMap: MapLike }).__mpMap;
    const feats = map.queryRenderedFeatures({ layers: ['det-line'] }) as { properties: { id: string } }[];
    const order = map.getStyle().layers.map((l) => l.id);
    return {
      outlines: new Set(feats.map((f) => f.properties.id)).size,
      outlinesOnTop: order.indexOf('det-line') > order.indexOf('det-rank'),
      zoom: map.getZoom(),
      boxes: map.listImages().filter((i) => i.startsWith('rank:box:')).length,
    };
  });
}

/** The ring of the area drawn on the map, without the closing point, or null. */
export function mapArea(page: Page): Promise<Ring | null> {
  return page.evaluate(async () => {
    const map = (window as unknown as { __mpMap?: MapLike }).__mpMap;
    const src = map?.getSource('area');
    if (!src) return null;
    const data = await src.getData();
    const f = data.features[0];
    if (!f) return null;
    const ring = (f.geometry.coordinates as [number, number][][])[0];
    return ring.slice(0, -1);
  });
}

/** Wait until the map camera stops moving. */
export async function waitForMapStill(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const map = (window as unknown as { __mpMap: MapLike }).__mpMap;
          const c = map.getCenter();
          return JSON.stringify([map.isMoving(), c.lng.toFixed(7), c.lat.toFixed(7), map.getZoom().toFixed(4)]);
        });
        const still = now === last && !JSON.parse(now)[0];
        last = now;
        return still;
      },
      { intervals: [250] },
    )
    .toBe(true);
}

/** Box of the drawn area on screen, page px. */
export function areaScreenBox(page: Page, ring: Ring): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((r) => {
    const map = (window as unknown as { __mpMap: MapLike }).__mpMap;
    const box = map.getContainer().getBoundingClientRect();
    const pts = r.map((p) => map.project(p));
    const xs = pts.map((p) => p.x + box.left);
    const ys = pts.map((p) => p.y + box.top);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }, ring);
}
