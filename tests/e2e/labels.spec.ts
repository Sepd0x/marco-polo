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

/** Every number on screen lies wholly inside the map, clear of the frame's neat line. */
async function checkInside(page: Page): Promise<number> {
  const { labels, zoom } = await ui.mapLabelPlacement(page);
  const size = await page.evaluate(() => {
    const el = (window as unknown as { __mpMap: { getContainer(): HTMLElement } }).__mpMap.getContainer();
    return { w: el.clientWidth, h: el.clientHeight };
  });
  for (const l of labels) {
    const at = `number of ${l.id} at zoom ${zoom.toFixed(2)}: ${JSON.stringify(l.box)} in ${size.w}x${size.h}`;
    expect(l.box.x0, at).toBeGreaterThanOrEqual(1);
    expect(l.box.y0, at).toBeGreaterThanOrEqual(1);
    expect(l.box.x1, at).toBeLessThanOrEqual(size.w - 1);
    expect(l.box.y1, at).toBeLessThanOrEqual(size.h - 1);
  }
  return labels.length;
}

/** Pans the map so the pool nearest the centre lands `px` inside an edge. */
async function poolToEdge(page: Page, edge: 'left' | 'right' | 'top' | 'bottom', px: number): Promise<void> {
  await page.evaluate(
    async ({ edge, px }) => {
      type M = {
        getContainer(): HTMLElement;
        getSource(id: string): { getData(): Promise<{ features: { geometry: { coordinates: [number, number] } }[] }> };
        project(p: [number, number]): { x: number; y: number };
        panBy(o: [number, number], a: { animate: boolean }): void;
      };
      const map = (window as unknown as { __mpMap: M }).__mpMap;
      const el = map.getContainer();
      const w = el.clientWidth;
      const h = el.clientHeight;
      const pts = (await map.getSource('det-points').getData()).features.map((f) => map.project(f.geometry.coordinates));
      const c = pts.reduce((a, p) => (Math.hypot(p.x - w / 2, p.y - h / 2) < Math.hypot(a.x - w / 2, a.y - h / 2) ? p : a));
      const to = { left: [px, c.y], right: [w - px, c.y], top: [c.x, px], bottom: [c.x, h - px] }[edge];
      map.panBy([c.x - to[0], c.y - to[1]], { animate: false });
    },
    { edge, px },
  );
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

  test('a pool at the edge of the map keeps its number whole, inside the frame', async ({ page }) => {
    await ui.scanArea(page);
    await settle(page);
    await ui.jumpToZoom(page, 18.2);
    await settle(page);
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      await poolToEdge(page, edge, 6);
      await settle(page);
      await checkInside(page);
      await checkLabels(page);
    }
  });
});
