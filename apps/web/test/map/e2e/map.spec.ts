import { expect, test, type Page } from '@playwright/test';
import { pickProvider, type Ring } from '../../../../../packages/core/src/index.js';
import { COLOURS, recordImagery, serveTiles, type SourceKey } from './tiles.js';

const HIDE_UI = `body * { visibility: hidden !important; } #map, #map * { visibility: visible !important; }
.maplibregl-control-container, .maplibregl-control-container * { visibility: hidden !important; }`;

type Settings = Record<string, unknown>;
type MapHandle = {
  loaded(): boolean;
  jumpTo(o: unknown): void;
  areTilesLoaded(): boolean;
  project(c: [number, number]): { x: number; y: number };
  getMaxZoom(): number;
  getCanvas(): HTMLCanvasElement;
};

function permalink(ring: Ring): string {
  return `#aoi=${Buffer.from(JSON.stringify([19, ring])).toString('base64url')}`;
}

async function open(page: Page, opts: { hash?: string; settings?: Settings } = {}): Promise<void> {
  await serveTiles(page);
  await page.addInitScript((settings) => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    localStorage.setItem('marco-polo:intro-seen', '1');
    if (settings) localStorage.setItem('marco-polo:settings', JSON.stringify(settings));
  }, opts.settings ?? null);
  await page.goto(`./?map-debug${opts.hash ?? ''}`);
  await page.waitForFunction(() => {
    const m = (window as unknown as { __mpMap?: MapHandle }).__mpMap;
    return !!m && m.loaded();
  });
  await page.addStyleTag({ content: HIDE_UI });
}

/** Waits until two checks 250 ms apart find every tile loaded. */
async function settle(page: Page): Promise<void> {
  for (let calm = 0, i = 0; calm < 2 && i < 80; i++) {
    await page.waitForTimeout(250);
    const done = await page.evaluate(() => (window as unknown as { __mpMap: MapHandle }).__mpMap.areTilesLoaded());
    calm = done ? calm + 1 : 0;
  }
  await page.waitForTimeout(300);
}

async function jump(page: Page, lon: number, lat: number, zoom: number): Promise<void> {
  await page.evaluate(([lon, lat, zoom]) => {
    (window as unknown as { __mpMap: MapHandle }).__mpMap.jumpTo({ center: [lon, lat], zoom });
  }, [lon, lat, zoom]);
  await settle(page);
}

/** Pixel at a place, moved by (dx, dy) CSS px. */
async function pixelAt(page: Page, lon: number, lat: number, dx = 0, dy = 0): Promise<number[]> {
  const p = await page.evaluate(([lon, lat, dx, dy]) => {
    const pt = (window as unknown as { __mpMap: MapHandle }).__mpMap.project([lon, lat]);
    return { x: Math.round(pt.x + dx), y: Math.round(pt.y + dy) };
  }, [lon, lat, dx, dy]);
  const png = await page.screenshot({ clip: { x: p.x, y: p.y, width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString('base64'));
}

function expectSource(rgb: number[], source: SourceKey, where: string): void {
  const want = COLOURS[source];
  const off = Math.max(...rgb.map((v, i) => Math.abs(v - want[i])));
  expect(off, `${where}: got rgb(${rgb.join(',')}), want ${source} rgb(${want.join(',')})`).toBeLessThanOrEqual(14);
}

async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

const PLACES: { name: string; lon: number; lat: number; source: SourceKey }[] = [
  { name: 'Braga', lon: -8.3783, lat: 41.5724, source: 'dgt' },
  { name: 'Marbella', lon: -4.9587, lat: 36.4899, source: 'pnoa' },
  { name: 'Aix', lon: 5.4197, lat: 43.5704, source: 'ign' },
  { name: 'Scottsdale', lon: -111.926, lat: 33.594, source: 'esri' },
];

for (const dpr of [1, 2, 3]) {
  test.describe(`DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 800 } });

    test('from maxzoom - 2.5 only top-level tiles load, from the source of the place', async ({ page }) => {
      const rec = recordImagery(page);
      await open(page);
      for (const place of PLACES) {
        for (const zoom of [16.5, 17, 17.75, 18.5]) {
          rec.list.length = 0;
          await jump(page, place.lon, place.lat, zoom);
          // Zooming in on the same spot reuses the tiles already loaded.
          if (zoom === 16.5) {
            const own = rec.list.filter((r) => r.source === place.source);
            expect(own.length, `${place.name} z${zoom}: no ${place.source} tiles`).toBeGreaterThan(0);
          }
          for (const r of rec.list) {
            expect(r.z, `${place.name} z${zoom}: ${r.url}`).not.toBeNull();
            expect(Math.round(r.z! * 1000) / 1000, `${place.name} z${zoom}: ${r.url}`).toBe(19);
          }
        }
      }
      expect(await page.evaluate(() => (window as unknown as { __mpMap: MapHandle }).__mpMap.getMaxZoom())).toBe(18.5);
      expect(await cspViolations(page)).toEqual([]);
    });
  });
}

test.describe('inside the drawn area the map shows the scanned source', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

  test('a fixed Esri scan in Braga: Esri inside, DGT outside', async ({ page }) => {
    const ring: Ring = [
      [-8.3798, 41.5713],
      [-8.3764, 41.5713],
      [-8.3764, 41.5738],
      [-8.3798, 41.5738],
    ];
    await open(page, {
      hash: permalink(ring),
      settings: { imagery: { mode: 'fixed', providerId: 'esri-world-imagery' } },
    });
    await jump(page, -8.3781, 41.57255, 16.5);
    expectSource(await pixelAt(page, -8.3781, 41.57255), 'esri', 'centre of the area');
    expectSource(await pixelAt(page, -8.379, 41.572), 'esri', 'inside, south-west');
    // A few pixels either side of the edges: the edge tiles are cut, not shown whole.
    expectSource(await pixelAt(page, -8.3798, 41.57255, 6, 0), 'esri', 'just inside the west edge');
    expectSource(await pixelAt(page, -8.3798, 41.57255, -6, 0), 'dgt', 'just outside the west edge');
    expectSource(await pixelAt(page, -8.3781, 41.5738, 0, -6), 'dgt', 'just outside the north edge');
    expectSource(await pixelAt(page, -8.3764, 41.5713, 6, 6), 'dgt', 'just outside the south-east corner');
    expectSource(await pixelAt(page, -8.3806, 41.5744), 'dgt', 'north-west of the area');
    await jump(page, -8.3781, 41.57255, 18);
    expectSource(await pixelAt(page, -8.3781, 41.57255), 'esri', 'centre at z18');
    expect(await cspViolations(page)).toEqual([]);
  });

  test('an area across the Minho: each side in its own source', async ({ page }) => {
    const [w, s, e, n] = [-8.65, 42.035, -8.64, 42.042];
    const ring: Ring = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ];
    // A point well inside one side: its source and that of its neighbours 25 m away agree.
    const side = (id: string) => {
      for (let i = 1; i < 20; i++) {
        for (let j = 1; j < 20; j++) {
          const lon = w + ((e - w) * i) / 20;
          const lat = s + ((n - s) * j) / 20;
          const d = 0.0003;
          const near = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].map(([a, b]) => pickProvider({ lon: lon + a, lat: lat + b }).id);
          if (near.every((p) => p === id)) return { lon, lat };
        }
      }
      throw new Error(`no point on the ${id} side`);
    };
    const pt = side('dgt-ortos2025');
    const es = side('pnoa');
    await open(page, { hash: permalink(ring) });
    await jump(page, (w + e) / 2, (s + n) / 2, 16);
    expectSource(await pixelAt(page, pt.lon, pt.lat), 'dgt', 'Portuguese side');
    expectSource(await pixelAt(page, es.lon, es.lat), 'pnoa', 'Spanish side');
    expect(await cspViolations(page)).toEqual([]);
  });
});

test('a lost WebGL context is shown, and cleared when it comes back', async ({ page }) => {
  await open(page);
  await page.addStyleTag({ content: '.map-context-lost, .map-context-lost * { visibility: visible !important; }' });
  await page.evaluate(() => {
    const canvas = (window as unknown as { __mpMap: MapHandle }).__mpMap.getCanvas();
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __ext: WEBGL_lose_context }).__ext = ext;
    ext.loseContext();
  });
  await expect(page.locator('.map-context-lost')).toBeVisible();
  await expect(page.locator('.map-context-lost')).toHaveAttribute('role', 'status');
  await page.evaluate(() => (window as unknown as { __ext: WEBGL_lose_context }).__ext.restoreContext());
  await expect(page.locator('.map-context-lost')).toHaveCount(0);
});
