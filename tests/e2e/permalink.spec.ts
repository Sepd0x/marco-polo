import { AREA, expect, permalinkHash, test } from './net.ts';
import * as ui from './ui.ts';

test('the area in the link is the area drawn, also after a reload', async ({ page }) => {
  const hash = permalinkHash(AREA);
  await ui.openArea(page, AREA);
  await expect.poll(() => ui.mapArea(page)).toEqual(AREA);
  expect(new URL(page.url()).hash).toBe(hash);

  await page.reload();
  await expect(ui.areaPanel(page)).toBeVisible();
  await expect.poll(() => ui.mapArea(page)).toEqual(AREA);
  expect(new URL(page.url()).hash).toBe(hash);
});
