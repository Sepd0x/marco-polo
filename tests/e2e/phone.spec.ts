import { AREA, expect, test } from './net.ts';
import * as ui from './ui.ts';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test('on a phone the bottom sheet leaves the area in view', async ({ page }) => {
  await ui.scanArea(page);
  await ui.waitForMapStill(page);

  const area = await ui.areaScreenBox(page, AREA);
  const sheet = await ui.sheetHandle(page).boundingBox();
  expect(sheet).not.toBeNull();
  expect(area.width).toBeGreaterThan(0);
  expect(area.x).toBeGreaterThanOrEqual(0);
  expect(area.x + area.width).toBeLessThanOrEqual(375);
  expect(area.y).toBeGreaterThanOrEqual(0);
  expect(area.y + area.height, 'area bottom above the sheet top').toBeLessThanOrEqual(sheet!.y);
});
