// @vitest-environment jsdom
/**
 * A CLI scan and a scan in the web app of the same area list the same pools.
 *
 * Both run here on the open fixture tiles (packages/eval/fixtures/open): the
 * CLI through `runScan`, the app through its real `ScanController` with a
 * pool that runs the app's own `runJob` and the shipped v2 detector. Both are
 * given one fake network that serves the fixture bytes, and decode with the
 * CLI's decoder, so what is compared is everything around the pixels: plan,
 * source choice, probe and fallback, WMS halo, XYZ halo from neighbours,
 * windows, merger, ownership of pools between parts, per-source thresholds
 * and ranking.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DGT_ORTOS2025,
  IGN_ORTHOPHOTOS,
  PNOA,
  pickProvider,
  tileBBox,
  tileRequest,
  type ImageryProvider,
  type Ring,
  type TileCoord,
} from '@marco-polo/core';
import { ScanController, type Pool, type ScanRequest } from '../../../apps/web/src/scan/controller.js';
import { productDetector } from '../../../apps/web/src/scan/productDetector.js';
import { PRODUCT_DETECTOR_ID, runJob, V2_HALO_PX, type WorkJob } from '../../../apps/web/src/scan/tileWork.js';
import { recommendedFor as appRecommendedFor } from '../../../apps/web/src/lib/score.js';
import { useStore, visibleRanked } from '../../../apps/web/src/state/store.js';
import { INITIAL } from '../../../apps/web/test/scan/harness.js';
import { DEFAULT_RATE, runScan, type ScanArgs } from '../src/commands/scan.js';
import { makeDetector } from '../src/detector.js';
import { recommendedFor } from '../src/threshold.js';
import { decodeImage, encodePng, type FetchLike } from '../src/tiles.js';

const FIXTURE = join(__dirname, '../../eval/fixtures/open');

/** Sources of the fixture blocks, with their first tile and size (see manifest.json). */
const BLOCKS = {
  dgt: { provider: DGT_ORTOS2025, x0: 249940, y0: 195457, cols: 5, rows: 5 },
  pnoa: { provider: PNOA, x0: 256571, y0: 197648, cols: 4, rows: 4 },
  ign: { provider: IGN_ORTHOPHOTOS, x0: 270035, y0: 191506, cols: 4, rows: 4 },
} as const;
type Block = keyof typeof BLOCKS;

const WEB_MERCATOR_HALF = 20037508.342789244;

/** A ring over a rectangle of z19 tiles of a block, a little inside it. */
function over(block: Block, col: number, row: number, cols: number, rows: number): Ring {
  const b = BLOCKS[block];
  const nw = tileBBox({ z: 19, x: b.x0 + col, y: b.y0 + row });
  const se = tileBBox({ z: 19, x: b.x0 + col + cols - 1, y: b.y0 + row + rows - 1 });
  const ex = (se.east - nw.west) * 1e-3;
  const ey = (nw.north - se.south) * 1e-3;
  return [[nw.west + ex, se.south + ey], [se.east - ex, se.south + ey], [se.east - ex, nw.north - ey], [nw.west + ex, nw.north - ey]];
}

const tileFile = new Map<string, Uint8Array>();

/** URL (and mirror URL) of every fixture tile on its own provider, to its bytes. */
function indexFixture(): void {
  for (const [name, b] of Object.entries(BLOCKS)) {
    if (b.provider.kind === 'wms') continue;
    for (let dx = 0; dx < b.cols; dx++) {
      for (let dy = 0; dy < b.rows; dy++) {
        const t: TileCoord = { z: 19, x: b.x0 + dx, y: b.y0 + dy };
        const bytes = new Uint8Array(readFileSync(join(FIXTURE, 'tiles', name, `19-${t.x}-${t.y}.jpg`)));
        const req = tileRequest(b.provider, t);
        tileFile.set(req.url, bytes);
        if (req.mirrorUrl) tileFile.set(req.mirrorUrl, bytes);
      }
    }
  }
}

/** RGBA of the DGT block as one image, with its top-left z19 pixel. */
let dgtMosaic: { rgba: Uint8ClampedArray; width: number; height: number; px0: number; py0: number } | null = null;

function dgt(): NonNullable<typeof dgtMosaic> {
  if (dgtMosaic) return dgtMosaic;
  const b = BLOCKS.dgt;
  const width = b.cols * 256;
  const height = b.rows * 256;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let cx = 0; cx < b.cols; cx++) {
    for (let cy = 0; cy < b.rows; cy++) {
      const img = decodeImage(new Uint8Array(readFileSync(join(FIXTURE, 'tiles/dgt', `19-${b.x0 + cx}-${b.y0 + cy}.jpg`))));
      for (let y = 0; y < 256; y++) rgba.set(img.rgba.subarray(y * 256 * 4, (y + 1) * 256 * 4), ((cy * 256 + y) * width + cx * 256) * 4);
    }
  }
  return (dgtMosaic = { rgba, width, height, px0: b.x0 * 256, py0: b.y0 * 256 });
}

/**
 * A WMS GetMap answer made from the z19 tiles: one z19 pixel per output
 * pixel, as the real service answers at this scale. What the block does not
 * hold is transparent.
 */
function wmsImage(url: string): Uint8Array {
  const q = new URL(url).searchParams;
  const [minx, miny, maxx, maxy] = q.get('BBOX')!.split(',').map(Number);
  const w = Number(q.get('WIDTH'));
  const h = Number(q.get('HEIGHT'));
  const worldPx = 256 * 2 ** 19;
  const m = dgt();
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const wy = Math.floor(((WEB_MERCATOR_HALF - (maxy - ((j + 0.5) * (maxy - miny)) / h)) / (2 * WEB_MERCATOR_HALF)) * worldPx) - m.py0;
    for (let i = 0; i < w; i++) {
      const wx = Math.floor(((minx + ((i + 0.5) * (maxx - minx)) / w + WEB_MERCATOR_HALF) / (2 * WEB_MERCATOR_HALF)) * worldPx) - m.px0;
      if (wx < 0 || wy < 0 || wx >= m.width || wy >= m.height) continue;
      out.set(m.rgba.subarray((wy * m.width + wx) * 4, (wy * m.width + wx) * 4 + 4), (j * w + i) * 4);
    }
  }
  return new Uint8Array(encodePng(out, w, h));
}

/** A small area over the Portugal-Spain border near Elvas, found from the coverage the app uses. */
function aroundBorder(): Ring {
  const lat = 38.85;
  let lon = -7.3;
  const first = pickProvider({ lon, lat }, { mode: 'auto' }).id;
  while (pickProvider({ lon, lat }, { mode: 'auto' }).id === first && lon < -6.7) lon += 0.0005;
  const dLat = 120 / 111_320;
  const dLon = 200 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat]];
}

type Answer = { status: number; body: Uint8Array };

/** The one network both paths talk to. */
function serve(url: string): Answer {
  if (url.includes('cartografia.dgterritorio.gov.pt')) return { status: 200, body: wmsImage(url) };
  const bytes = tileFile.get(url);
  return bytes ? { status: 200, body: bytes } : { status: 404, body: new Uint8Array(0) };
}

interface Net {
  fetch: FetchLike;
  calls: string[];
}

function net(answer: (url: string) => Answer = serve): Net {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const a = answer(url);
      return { status: a.status, arrayBuffer: async () => a.body.slice().buffer };
    },
  };
}

function cliArgs(over: Partial<ScanArgs> = {}): ScanArgs {
  return {
    setting: { mode: 'auto' },
    out: './scans/parity',
    rate: 10,
    order: 'serpentine',
    threshold: null,
    detector: 'v2',
    // A fresh disk cache each time, so every request goes to the fake network.
    cacheDir: mkdtempSync(join(tmpdir(), 'mp-parity-')),
    allowLarge: false,
    dates: false,
    quiet: true,
    ...over,
  };
}

/** What a detection is, for comparing: ids differ between the two paths, nothing else may. */
function summary(d: { center: { lat: number; lon: number }; areaM2: number; confidence: number; kind: string; truncated?: boolean; outline: unknown }) {
  return {
    lat: Number(d.center.lat.toFixed(7)),
    lon: Number(d.center.lon.toFixed(7)),
    areaM2: Number(d.areaM2.toFixed(3)),
    confidence: Number(d.confidence.toFixed(5)),
    kind: d.kind,
    truncated: d.truncated ?? false,
    outline: JSON.stringify(d.outline),
  };
}

interface AppRun {
  detections: ReturnType<typeof summary>[];
  parts: { providerId: string; tiles: number; tilesNoCoverage: number; tilesFailed: number }[];
  requests: number;
}

/** The web app's scan of an area, with its real controller and detector. */
async function appScan(area: Ring, n: Net, over: Partial<ScanRequest> = {}): Promise<AppRun> {
  useStore.setState({ ...INITIAL, settings: { ...INITIAL.settings } }, true);
  const detector = productDetector();
  const pool: Pool = {
    size: 2,
    run: (job: Omit<WorkJob, 'id'>) =>
      runJob(
        { ...job, id: 0 },
        { decode: async (b) => { const i = decodeImage(b); return { pixels: i.rgba, width: i.width, height: i.height }; }, encodeThumb: async () => new Blob(['t']), detector },
      ),
    dispose() {},
  };
  const c = new ScanController(
    { area, setting: { mode: 'auto' }, order: 'serpentine', ratePerSec: 10, ...over },
    {
      makePool: () => pool,
      fetch: (url) => n.fetch(url, { headers: {}, signal: new AbortController().signal }),
      cache: null,
      halo: V2_HALO_PX,
      detectorId: PRODUCT_DETECTOR_ID,
      dates: false,
    },
  );
  useStore.getState().setArea(area);
  const done = c.start();
  await vi.advanceTimersByTimeAsync(600_000);
  await done;
  const s = useStore.getState();
  expect(s.phase).toBe('complete');
  return {
    detections: visibleRanked(s).map(summary),
    parts: s.parts.map((p) => ({ providerId: p.providerId, tiles: p.tiles.length, tilesNoCoverage: p.tilesNoCoverage, tilesFailed: p.tilesFailed })),
    requests: n.calls.length,
  };
}

async function cliScan(area: Ring, n: Net, over: Partial<ScanArgs> = {}) {
  const r = await runScan(area, cliArgs(over), { fetch: n.fetch, wait: async () => {} });
  return {
    detections: r.detections.map(summary),
    parts: r.parts.map((p) => ({ providerId: p.provenance.providerId, tiles: p.tiles, tilesNoCoverage: p.tilesNoCoverage })),
    result: r,
  };
}

beforeEach(() => {
  indexFixture();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the CLI scan and the app scan of an area', () => {
  const cases: { name: string; block: Block; area: Ring; provider: string }[] = [
    // XYZ sources: the halo is read from the eight neighbours, all in the block for the inner tiles.
    { name: 'PNOA, inner tiles', block: 'pnoa', area: over('pnoa', 1, 1, 2, 2), provider: 'pnoa' },
    // The whole block: the edge tiles miss neighbours, which the window leaves empty.
    { name: 'PNOA, whole block', block: 'pnoa', area: over('pnoa', 0, 0, 4, 4), provider: 'pnoa' },
    { name: 'IGN, whole block', block: 'ign', area: over('ign', 0, 0, 4, 4), provider: 'ign-orthophotos' },
    // WMS: one request holds the halo; the z18 grid sticks out of the block.
    { name: 'DGT, inner tiles', block: 'dgt', area: over('dgt', 1, 1, 3, 3), provider: 'dgt-ortos2025' },
  ];

  for (const c of cases) {
    it(`lists the same pools: ${c.name}`, async () => {
      const cli = await cliScan(c.area, net());
      vi.useFakeTimers();
      const app = await appScan(c.area, net());
      expect(cli.parts.map((p) => p.providerId)).toEqual([c.provider]);
      expect(app.parts.map((p) => p.providerId)).toEqual([c.provider]);
      expect(cli.parts.map((p) => [p.tiles, p.tilesNoCoverage])).toEqual(app.parts.map((p) => [p.tiles, p.tilesNoCoverage]));
      // The comparison means something only when pools were found.
      expect(app.detections.length).toBeGreaterThan(0);
      expect(cli.detections).toEqual(app.detections);
    }, 120_000);
  }

  it('asks for the same requests, a tile once', async () => {
    const area = over('pnoa', 1, 1, 2, 2);
    const a = net();
    await cliScan(area, a);
    vi.useFakeTimers();
    const b = net();
    await appScan(area, b);
    const unique = (n: Net) => [...new Set(n.calls)].sort();
    expect(unique(a)).toEqual(unique(b));
    // No tile is requested twice by the CLI: the five probe tiles and the halo neighbours are shared.
    expect(new Set(a.calls).size).toBe(a.calls.length);
  }, 120_000);

  it('holds each source to its own threshold, and one value when asked', async () => {
    const area = over('dgt', 1, 1, 3, 3);
    const calibrated = await cliScan(area, net());
    const strict = await cliScan(area, net(), { threshold: 0.95 });
    expect(calibrated.result.threshold).toBe(recommendedFor('dgt-ortos2025'));
    expect(strict.result.threshold).toBe(0.95);
    expect(strict.detections.length).toBeLessThanOrEqual(calibrated.detections.length);
    for (const d of calibrated.result.detections) expect(d.confidence).toBeGreaterThanOrEqual(recommendedFor('dgt-ortos2025'));
    for (const d of strict.result.detections) expect(d.confidence).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it('moves to the same fallback source when the first has no imagery', async () => {
    const area = over('dgt', 1, 1, 2, 2);
    const white = new Uint8Array(encodePng(new Uint8ClampedArray(704 * 704 * 4).fill(255), 704, 704));
    const grey = new Uint8Array(encodePng(new Uint8ClampedArray(256 * 256 * 4).fill(128).map((v, i) => (i % 4 === 3 ? 255 : v + (i % 7))), 256, 256));
    const answer = (url: string): Answer =>
      url.includes('dgterritorio') ? { status: 200, body: white } : { status: 200, body: grey };
    const cli = await cliScan(area, net(answer));
    vi.useFakeTimers();
    const app = await appScan(area, net(answer));
    expect(cli.parts.map((p) => p.providerId)).toEqual(['esri-world-imagery']);
    expect(app.parts.map((p) => p.providerId)).toEqual(['esri-world-imagery']);
    expect(cli.detections).toEqual(app.detections);
  }, 120_000);

  it('splits an area across the border like the app, with each pool in one part', async () => {
    const area = aroundBorder();
    const grey = new Uint8Array(encodePng(new Uint8ClampedArray(256 * 256 * 4).fill(120).map((v, i) => (i % 4 === 3 ? 255 : v + (i % 5))), 256, 256));
    const wms = new Uint8Array(encodePng(new Uint8ClampedArray(704 * 704 * 4).fill(120).map((v, i) => (i % 4 === 3 ? 255 : v + (i % 5))), 704, 704));
    const answer = (url: string): Answer => ({ status: 200, body: url.includes('dgterritorio') ? wms : grey });
    const cli = await cliScan(area, net(answer));
    vi.useFakeTimers();
    const app = await appScan(area, net(answer));
    expect(cli.parts.map((p) => p.providerId)).toEqual(app.parts.map((p) => p.providerId));
    expect(new Set(cli.parts.map((p) => p.providerId)).size).toBeGreaterThan(1);
    expect(cli.parts.map((p) => p.tiles)).toEqual(app.parts.map((p) => p.tiles));
    expect(cli.detections).toEqual(app.detections);
  }, 240_000);
});

describe('what the CLI shares with the app', () => {
  it('uses the app detector, halo and per-source thresholds', () => {
    expect(makeDetector('v2').id).toBe(PRODUCT_DETECTOR_ID);
    expect(productDetector().version).toBe(makeDetector('v2').version);
    const providers: (ImageryProvider | null)[] = [DGT_ORTOS2025, PNOA, IGN_ORTHOPHOTOS, null];
    for (const p of providers) expect(recommendedFor(p?.id)).toBe(appRecommendedFor(p?.id));
    expect(DEFAULT_RATE).toBe(5);
  });
});
