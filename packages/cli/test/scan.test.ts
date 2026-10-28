import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lonLatToTile, tileBBox, type Ring } from '@marco-polo/core';
import { parseFlags, UsageError } from '../src/args.js';
import { parseBBox, parseScanArgs, runScan, SCAN_HELP, splitForV1, writeOutputs, type ScanArgs } from '../src/commands/scan.js';
import { HELP, main } from '../src/index.js';
import { encodePng, Pacer, TileFetcher, type FetchLike } from '../src/tiles.js';

const POOL: [number, number, number] = [45, 170, 190];
const GREY: [number, number, number] = [120, 118, 115];

function tilePng(size: number, pool: { x: number; y: number; w: number; h: number } | null, bg = GREY): Uint8Array {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba.set([bg[0] + (i % 3), bg[1], bg[2], 255], i * 4);
  }
  if (pool) {
    for (let y = pool.y; y < pool.y + pool.h; y++) {
      for (let x = pool.x; x < pool.x + pool.w; x++) rgba.set([...POOL, 255], (y * size + x) * 4);
    }
  }
  return new Uint8Array(encodePng(rgba, size, size));
}

/** A fetch stand-in: answers by URL pattern and records every call. */
function fakeFetch(answer: (url: string) => { status: number; body: Uint8Array | string }) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const a = answer(url);
    const body = typeof a.body === 'string' ? new TextEncoder().encode(a.body) : a.body;
    return { status: a.status, arrayBuffer: async () => body.slice().buffer };
  };
  return { fetch, calls };
}

const noWait = async () => {};

function args(over: Partial<ScanArgs> = {}): ScanArgs {
  return {
    setting: { mode: 'auto' },
    out: './scans/test',
    rate: 10,
    order: 'serpentine',
    threshold: 0.55,
    detector: 'v1',
    cacheDir: mkdtempSync(join(tmpdir(), 'mp-cache-')),
    allowLarge: false,
    dates: true,
    quiet: true,
    ...over,
  };
}

/** A ring just inside a block of tiles. */
function overTiles(z: number, x0: number, y0: number, cols: number, rows: number): Ring {
  const nw = tileBBox({ z, x: x0, y: y0 });
  const se = tileBBox({ z, x: x0 + cols - 1, y: y0 + rows - 1 });
  const ex = (se.east - nw.west) * 1e-3;
  const ey = (nw.north - se.south) * 1e-3;
  return [[nw.west + ex, se.south + ey], [se.east - ex, se.south + ey], [se.east - ex, nw.north - ey], [nw.west + ex, nw.north - ey]];
}

afterEach(() => vi.restoreAllMocks());

describe('flags', () => {
  const spec = { rate: { kind: 'number', min: 1, max: 10 }, q: { kind: 'flag' }, o: { kind: 'string', choices: ['a', 'b'] } } as const;

  it('rejects a rate that is not a number or out of range', () => {
    expect(() => parseFlags(['--rate', 'abc'], spec)).toThrow(/must be a number/);
    expect(() => parseFlags(['--rate', '0'], spec)).toThrow(/between 1 and 10/);
    expect(() => parseFlags(['--rate', ''], spec)).toThrow(/must be a number/);
    expect(parseFlags(['--rate=7'], spec).values.rate).toBe(7);
  });

  it('rejects unknown flags, missing values and bad choices', () => {
    expect(() => parseFlags(['--nope'], spec)).toThrow(/unknown option --nope/);
    expect(() => parseFlags(['--rate'], spec)).toThrow(/needs a value/);
    expect(() => parseFlags(['--o', 'c'], spec)).toThrow(/one of: a, b/);
    expect(() => parseFlags(['loose'], spec)).toThrow(UsageError);
    expect(() => parseFlags(['--q=1'], spec)).toThrow(/no value/);
  });

  it('explains removed flags', () => {
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--zoom', '18'])).toThrow(/--zoom was removed/);
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--template', 'https://x/{z}/{x}/{y}'])).toThrow(/--template was removed/);
  });
});

describe('scan arguments', () => {
  it('maps short source names to sources', () => {
    const a = parseScanArgs(['--bbox', '41.5,-8.5,41.6,-8.4', '--source', 'dgt']);
    expect(a !== 'help' && a.setting).toEqual({ mode: 'fixed', providerId: 'dgt-ortos2025' });
    const b = parseScanArgs(['--bbox', '41.5,-8.5,41.6,-8.4']);
    expect(b !== 'help' && b.setting).toEqual({ mode: 'auto' });
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--source', 'mapbox'])).toThrow(/must be one of/);
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--source', 'dgt-ortosat2023'])).toThrow(/must be one of/);
  });

  it('needs exactly one area and checks the bbox', () => {
    expect(() => parseScanArgs([])).toThrow(/--bbox or --area/);
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--area', 'a.json'])).toThrow(/not both/);
    expect(() => parseBBox('1,2,3')).toThrow(/south,west,north,east/);
    expect(() => parseBBox('42,-8,41,-7')).toThrow(/south < north/);
    expect(() => parseBBox('1,190,2,191')).toThrow(/outside/);
    expect(parseBBox('41,-8,42,-7')).toEqual([[-8, 41], [-7, 41], [-7, 42], [-8, 42]]);
  });

  it('documents what the command accepts', () => {
    for (const flag of ['--bbox', '--area', '--source', '--out', '--rate', '--order', '--threshold', '--detector', '--cache-dir', '--allow-large', '--no-dates', '--quiet']) {
      expect(SCAN_HELP).toContain(flag);
    }
    expect(SCAN_HELP).not.toMatch(/--zoom|--template|mapbox|maptiler/i);
  });
});

describe('tiles', () => {
  it('cuts a 512 px tile into its four z+1 children', () => {
    const rgba = new Uint8ClampedArray(512 * 512 * 4);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) rgba[(y * 512 + x) * 4] = (x >= 256 ? 1 : 0) + (y >= 256 ? 2 : 0);
    const pieces = splitForV1({ z: 18, x: 10, y: 20 }, { rgba, width: 512, height: 512 });
    expect(pieces.map((p) => p.tile)).toEqual([
      { z: 19, x: 20, y: 40 },
      { z: 19, x: 21, y: 40 },
      { z: 19, x: 20, y: 41 },
      { z: 19, x: 21, y: 41 },
    ]);
    pieces.forEach((p, i) => expect(p.pixels[0]).toBe(i));
  });

  it('spaces request starts by the rate', async () => {
    let t = 0;
    const waits: number[] = [];
    const pacer = new Pacer(4, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    for (let i = 0; i < 4; i++) await pacer.take();
    expect(waits).toEqual([250, 250, 250]);
  });

  it('sends retries through the pacer and reads a 404 as an answer', async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('404') ? { status: 404, body: 'none' } : n++ < 2 ? { status: 503, body: '' } : { status: 200, body: tilePng(8, null) }));
    let takes = 0;
    const pacer = new Pacer(100, Date.now, noWait);
    const take = pacer.take.bind(pacer);
    pacer.take = async () => {
      takes++;
      return take();
    };
    const f = new TileFetcher({ pacer, cachePolicy: 'http', fetch, wait: noWait });
    const ok = await f.get('https://x.test/a');
    expect(ok.image?.width).toBe(8);
    expect(takes).toBe(3);
    const missing = await f.get('https://x.test/404');
    expect(missing.status).toBe(404);
    expect(calls).toHaveLength(4);
  });

  it('calls the platform fetch unbound when none is given', async () => {
    const png = tilePng(8, null);
    vi.stubGlobal('fetch', function (this: unknown) {
      // The real fetch throws "Illegal invocation" for any other receiver.
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve({ status: 200, arrayBuffer: async () => png.slice().buffer });
    });
    const f = new TileFetcher({ pacer: new Pacer(100), cachePolicy: 'http', fetch: undefined, wait: noWait });
    expect((await f.get('https://x.test/t')).image?.width).toBe(8);
    vi.unstubAllGlobals();
  });

  it('writes only open-licence tiles to disk', async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, body: tilePng(8, null) }));
    const dir = mkdtempSync(join(tmpdir(), 'mp-disk-'));
    const esri = new TileFetcher({ pacer: new Pacer(100), cachePolicy: 'http', cacheDir: dir, fetch });
    await esri.get('https://x.test/esri');
    expect(readdirSync(dir)).toHaveLength(0);
    const open = new TileFetcher({ pacer: new Pacer(100), cachePolicy: 'persistent', cacheDir: dir, fetch });
    await open.get('https://x.test/dgt');
    expect(readdirSync(dir)).toHaveLength(1);
    const again = await open.get('https://x.test/dgt');
    expect(again.cached).toBe(true);
  });
});

describe('scan run', () => {
  // Four z19 tiles in Scottsdale (Esri).
  const sc = lonLatToTile(-111.926, 33.594, 19);
  const scottsdale = overTiles(19, sc.x, sc.y, 2, 2);

  it('finds a pool on Esri, counts empty tiles and dates the part', async () => {
    const poolTile = `/tile/19/${sc.y}/${sc.x}`;
    const emptyTile = `/tile/19/${sc.y + 1}/${sc.x + 1}`;
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('/MapServer/9/query')) {
        return { status: 200, body: JSON.stringify({ features: [{ attributes: { SRC_DATE2: 1773878400000, MinMapLevel: 12, MaxMapLevel: 19 } }] }) };
      }
      if (url.endsWith(emptyTile)) return { status: 404, body: '' };
      return { status: 200, body: tilePng(256, url.endsWith(poolTile) ? { x: 100, y: 80, w: 30, h: 16 } : null) };
    });
    const result = await runScan(scottsdale, args(), { fetch, wait: noWait });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].provenance.providerId).toBe('esri-world-imagery');
    expect(result.parts[0].provenance.date).toBe('2026-03-19');
    expect(result.parts[0].tiles).toBe(4);
    expect(result.parts[0].tilesNoCoverage).toBe(1);
    expect(result.detections).toHaveLength(1);
    const d = result.detections[0];
    expect(d.provenance.zoom).toBe(19);
    expect(d.dims).not.toBeNull();
    expect(d.dims!.lengthM / d.dims!.widthM).toBeGreaterThan(1.5);
    // Probe tiles are not fetched twice.
    const tileCalls = calls.filter((c) => c.includes('/tile/'));
    expect(new Set(tileCalls).size).toBe(tileCalls.length);
  });

  it('scans the DGT at 512 px on a z18 grid and dates it from the lot table', async () => {
    const t = lonLatToTile(-8.42, 41.55, 18);
    const braga = overTiles(18, t.x, t.y, 1, 1);
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: tilePng(512, { x: 300, y: 300, w: 60, h: 30 }) }));
    const result = await runScan(braga, args(), { fetch, wait: noWait });
    expect(result.parts[0].provenance.providerId).toBe('dgt-ortos2025');
    expect(result.parts[0].provenance.zoom).toBe(18);
    expect(result.parts[0].provenance.date).toBe('2025-03-31/2025-07-26');
    expect(calls.every((c) => c.includes('WIDTH=512&HEIGHT=512'))).toBe(true);
    expect(result.detections).toHaveLength(1);
    // 60 x 30 px at about 0.22 m/px.
    expect(result.detections[0].dims!.lengthM).toBeGreaterThan(11);
    expect(result.detections[0].dims!.lengthM).toBeLessThan(15);
  });

  it('moves a part to the next source when the probe finds no imagery', async () => {
    const t = lonLatToTile(-8.42, 41.55, 18);
    const braga = overTiles(18, t.x, t.y, 1, 1);
    const white = new Uint8ClampedArray(512 * 512 * 4).fill(255);
    const { fetch, calls } = fakeFetch((url) =>
      url.includes('dgterritorio') ? { status: 200, body: new Uint8Array(encodePng(white, 512, 512)) } : { status: 200, body: tilePng(256, null) },
    );
    const logs: string[] = [];
    const result = await runScan(braga, args({ dates: false }), { fetch, wait: noWait, warn: (l) => logs.push(l) });
    expect(result.parts[0].provenance.providerId).toBe('esri-world-imagery');
    expect(logs.join('\n')).toMatch(/DGT Ortos2025 answered 1 of 1 sample tiles and has no imagery here; using Esri World Imagery/);
    expect(calls.some((c) => c.includes('ortosat2023'))).toBe(false);
  });

  it('blocks areas over the limit unless asked', async () => {
    const big = parseBBox('33.55,-111.97,33.62,-111.89');
    const { fetch, calls } = fakeFetch(() => ({ status: 500, body: '' }));
    await expect(runScan(big, args(), { fetch, wait: noWait })).rejects.toThrow(/10 000 limit/);
    expect(calls).toHaveLength(0);
  });

  it('writes outputs without any request URL', async () => {
    const { fetch } = fakeFetch((url) => ({ status: 200, body: url.includes('query') ? '{}' : tilePng(256, { x: 100, y: 80, w: 30, h: 16 }) }));
    const result = await runScan(scottsdale, args(), { fetch, wait: noWait });
    const out = join(mkdtempSync(join(tmpdir(), 'mp-out-')), 'scan');
    const files = await writeOutputs(result, out);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(/arcgisonline|\{z\}|access_token|api_key/);
    }
    expect(JSON.parse(readFileSync(files[0], 'utf8')).attribution[0]).toContain('Powered by Esri');
  });
});

describe('command line', () => {
  it('routes options with no command to scan and rejects a bad rate', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['--bbox', '33.59,-111.93,33.6,-111.92', '--rate', 'abc'])).toBe(2);
    expect(String(err.mock.calls[0][0])).toMatch(/--rate must be a number/);
  });

  it('prints help and knows its commands', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await main(['--help'])).toBe(0);
    expect(String(out.mock.calls[0][0])).toBe(HELP);
    expect(HELP).toContain('candidates');
    expect(HELP).toContain('--source');
    expect(await main(['nope'])).toBe(2);
    expect(await main(['candidates'])).toBe(2);
    expect(await main(['scan', '--help'])).toBe(0);
  });
});
