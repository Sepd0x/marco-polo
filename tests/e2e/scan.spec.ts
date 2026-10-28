import { expect, test } from './net.ts';
import * as ui from './ui.ts';

/** Licensor of the PNOA fixture block (packages/eval/fixtures/open/ATTRIBUTION.md). */
const LICENSOR = 'scne.es';

/** The big count, the list and the map markers, read together. */
async function counts(page: Parameters<typeof ui.poolCount>[0]) {
  return { big: await ui.poolCount(page), rows: await ui.listRows(page).count(), map: await ui.mapPoolCount(page) };
}

/** Wait until the three counts agree, and return that number. */
async function agreedCount(page: Parameters<typeof ui.poolCount>[0]): Promise<number> {
  await expect.poll(async () => {
    const c = await counts(page);
    return c.big === c.rows && c.rows === c.map;
  }).toBe(true);
  return ui.poolCount(page);
}

test('a scan of a fixture area lists the same pools everywhere', async ({ page, net }) => {
  await ui.scanArea(page);
  const n = await agreedCount(page);
  expect(n).toBeGreaterThan(0);
  // The result view frames the pools with their numbers, as in the list.
  await ui.waitForMapStill(page);
  await expect.poll(() => ui.mapLabelCount(page)).toBeGreaterThan(0);
  await expect(ui.noTilesMissing(page)).toBeVisible();
  await expect(ui.summaryAlerts(page)).toHaveCount(0);
  expect(net.fixture.length).toBeGreaterThan(0);
});

test('the minimum score slider changes the count', async ({ page }) => {
  await ui.scanArea(page);
  const start = await agreedCount(page);

  await ui.setMinScore(page, 0);
  const low = await agreedCount(page);
  await ui.setMinScore(page, 0.95);
  const high = await agreedCount(page);

  expect(low).toBeGreaterThanOrEqual(start);
  expect(high).toBeLessThanOrEqual(start);
  expect(low).toBeGreaterThan(high);
});

test('CSV and GeoJSON exports hold one entry per pool', async ({ page }) => {
  await ui.scanArea(page);
  const n = await agreedCount(page);
  expect(n).toBeGreaterThan(0);

  const geo = await ui.exportGeoJson(page);
  expect(geo.name).toMatch(/\.geojson$/);
  const doc = JSON.parse(geo.text) as { type: string; attribution: string[]; features: { type: string }[] };
  expect(doc.type).toBe('FeatureCollection');
  expect(doc.features).toHaveLength(n);
  for (const f of doc.features) expect(f.type).toBe('Feature');
  // One credit line for the one source; the fixture block's licensor is named in it.
  expect(doc.attribution).toHaveLength(1);
  expect(doc.attribution[0]).toContain(LICENSOR);

  const csv = await ui.exportCsv(page);
  expect(csv.name).toMatch(/\.csv$/);
  const lines = csv.text.trimEnd().split('\n');
  const header = lines[0].split(',');
  expect(header).toEqual(expect.arrayContaining(['rank', 'lat', 'lon', 'area_m2', 'confidence', 'source', 'attribution']));
  expect(header.at(-1)).toBe('attribution');
  expect(lines).toHaveLength(n + 1);
  for (const line of lines.slice(1)) expect(line.endsWith(`,${doc.attribution[0]}`)).toBe(true);
});

test('an offline scan fails within seconds, says so aloud, and finishes once the connection is back', async ({ page, context }) => {
  await ui.openArea(page);
  // Routed requests never reach the emulated network, so cut them off here too.
  const cut = (url: URL) => url.hostname !== 'localhost';
  const refuse = (route: { abort(reason: string): Promise<void> }) => route.abort('internetdisconnected');
  await context.route(cut, refuse);
  await context.setOffline(true);
  const started = Date.now();
  await ui.startScan(page);
  const failed = page.getByRole('region', { name: 'Scan failed' });
  await expect(failed).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(failed.getByRole('alert')).toContainText('offline');
  await expect(failed.getByRole('button', { name: 'Retry failed' })).toBeVisible();
  // The screen reader hears the failure, not "Scan complete".
  const spoken = page.locator('.scan-announcer');
  await expect(spoken).toHaveText(/^Scan failed\. Your device is offline/);

  // Back online: the failed tiles are scanned again without a click.
  await context.unroute(cut, refuse);
  await context.setOffline(false);
  await ui.waitForResult(page);
  await expect(spoken).toHaveText(/^Scan complete/);
  await expect(ui.noTilesMissing(page)).toBeVisible();
});
