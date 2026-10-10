import { expect, test } from './net.ts';
import * as ui from './ui.ts';

type Page = Parameters<typeof ui.scanArea>[0];

const overlaps = (a: ui.ScreenBox, b: ui.ScreenBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Every pool number on screen lies nearer to its own pool centre than to any
 * other, and covers no pool outline. Returns how many numbers were checked.
 */
async function checkLabels(page: Page): Promise<number> {
  const { labels, pools, zoom } = await ui.mapLabelPlacement(page);
  const at = `zoom ${zoom.toFixed(2)}`;
  for (const l of labels) {
    let nearest = pools[0];
    for (const p of pools) if (Math.hypot(p.x - l.x, p.y - l.y) < Math.hypot(nearest.x - l.x, nearest.y - l.y)) nearest = p;
    expect(nearest.id, `number of ${l.id} at ${at} lies nearest to pool ${nearest.id}`).toBe(l.id);
    // Hit testing finds the box to the whole px: 1 px in from each side is inside the label.
    const inner = { x0: l.box.x0 + 1, y0: l.box.y0 + 1, x1: l.box.x1 - 1, y1: l.box.y1 - 1 };
    for (const p of pools) expect(overlaps(inner, p.box), `number of ${l.id} at ${at} over pool ${p.id}`).toBe(false);
  }
  return labels.length;
}

/** Wait for the map to finish rendering after a camera change, and for placement to settle. */
async function settle(page: Page): Promise<void> {
  await ui.waitForMapStill(page);
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const map = (window as unknown as { __mpMap: { once(e: string, f: () => void): void; triggerRepaint(): void } }).__mpMap;
        map.once('idle', () => done());
        map.triggerRepaint();
      }),
  );
  await page.waitForTimeout(300);
}

async function scanAndCheck(page: Page): Promise<void> {
  await ui.scanArea(page);
  await settle(page);
  await expect.poll(() => ui.mapLabelCount(page), { message: 'numbers on the framed result' }).toBeGreaterThan(0);
  expect(await checkLabels(page)).toBeGreaterThan(0);
  // Closer in, across a level change and the switch to boxed numbers.
  for (const zoom of [16.5, 17.2, 18.6]) {
    await ui.jumpToZoom(page, zoom);
    await settle(page);
    await checkLabels(page);
  }
}

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('each pool number sits by its own pool, never on another', async ({ page }) => {
    await scanAndCheck(page);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('each pool number sits by its own pool, never on another', async ({ page }) => {
    await scanAndCheck(page);
  });
});
