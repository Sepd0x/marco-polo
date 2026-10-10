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

  // Every pool in the list is drawn, and no number lies over an outline.
  const rows = await ui.listRows(page).count();
  const drawn = await ui.mapPoolDrawing(page);
  expect(drawn.outlines, 'one outline on screen per row of the list').toBe(rows);
  expect(drawn.outlinesOnTop, 'outlines above the numbers').toBe(true);
  if (drawn.zoom < 17) expect(drawn.boxes, 'no boxed numbers below zoom 17').toBe(0);
});
