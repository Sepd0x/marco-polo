import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HALO_PX, lonLatToTile, tileBBox, type Detector, type Ring, type TileWindow } from '@marco-polo/core';
import { DEFAULT_RATE, haloFor, MAX_RATE, parseScanArgs, runScan, SCAN_HELP, type ScanArgs } from '../src/commands/scan.js';
import { encodePng, type FetchLike } from '../src/tiles.js';

const noWait = async () => {};

function args(over: Partial<ScanArgs> = {}): ScanArgs {
  return {
    setting: { mode: 'auto' },
    out: './scans/test',
    rate: 10,
    order: 'serpentine',
    threshold: null,
    cacheDir: mkdtempSync(join(tmpdir(), 'mp-cache-')),
    allowLarge: false,
    dates: false,
    quiet: true,
    ...over,
  };
}

function overTiles(z: number, x0: number, y0: number, cols: number, rows: number): Ring {
  const nw = tileBBox({ z, x: x0, y: y0 });
  const se = tileBBox({ z, x: x0 + cols - 1, y: y0 + rows - 1 });
  const ex = (se.east - nw.west) * 1e-3;
  const ey = (nw.north - se.south) * 1e-3;
  return [[nw.west + ex, se.south + ey], [se.east - ex, se.south + ey], [se.east - ex, nw.north - ey], [nw.west + ex, nw.north - ey]];
}

/** A flat, slightly noisy picture: imagery as far as the no-data check goes. */
function picture(px: number): Uint8Array {
  const rgba = new Uint8ClampedArray(px * px * 4);
  for (let i = 0; i < px * px; i++) rgba.set([110 + (i % 5), 108, 105, 255], i * 4);
  return new Uint8Array(encodePng(rgba, px, px));
}

function net(size: (url: string) => number) {
  const calls: string[] = [];
  const bodies = new Map<number, Uint8Array>();
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const px = size(url);
    if (!bodies.has(px)) bodies.set(px, picture(px));
    return { status: 200, arrayBuffer: async () => bodies.get(px)!.slice().buffer };
  };
  return { fetch, calls };
}

/** A detector that records the windows it is handed. */
function recorder(id = 'v2'): { detector: Detector; windows: TileWindow[] } {
  const windows: TileWindow[] = [];
  return {
    windows,
    detector: {
      id,
      version: 'test',
      detectTile(w) {
        windows.push(w);
        return [];
      },
    },
  };
}

describe('scan arguments for v2', () => {
  it('runs v2 with calibrated thresholds unless told otherwise', () => {
    const a = parseScanArgs(['--bbox', '41.5,-8.5,41.6,-8.4']);
    expect(a !== 'help' && a.detector).toBe('v2');
    expect(a !== 'help' && a.threshold).toBeNull();
    expect(a !== 'help' && a.rate).toBe(DEFAULT_RATE);
    const b = parseScanArgs(['--bbox', '41.5,-8.5,41.6,-8.4', '--detector', 'v1', '--threshold', '0.7']);
    expect(b !== 'help' && b.detector).toBe('v1');
    expect(b !== 'help' && b.threshold).toBe(0.7);
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--detector', 'v3'])).toThrow(/must be one of: v2, v1/);
  });

  it('says what it runs, the rate default and ceilings, and no longer says v1', () => {
    expect(SCAN_HELP).not.toMatch(/still runs the v1/);
    expect(SCAN_HELP).toMatch(/same detector \(v2\)/);
    expect(SCAN_HELP).toMatch(new RegExp(`1 to ${MAX_RATE} \\(default ${DEFAULT_RATE}\\)`));
    expect(SCAN_HELP).toMatch(/dgt 4, pnoa 5, ign 5, esri 5/);
    expect(SCAN_HELP).toMatch(/neighbour tiles/);
    expect(DEFAULT_RATE).toBe(5);
    expect(MAX_RATE).toBe(10);
    expect(() => parseScanArgs(['--bbox', '1,1,2,2', '--rate', '11'])).toThrow(/between 1 and 10/);
  });
});

describe('v2 windows', () => {
  it('reads a 256 px XYZ tile with a halo built from its neighbours, each tile asked once', async () => {
    const t = lonLatToTile(-3.8253, 40.4375, 19);
    const area = overTiles(19, t.x, t.y, 2, 2);
    const { fetch, calls } = net(() => 256);
    const r = recorder();
    const result = await runScan(area, args(), { fetch, wait: noWait, detector: r.detector });
    expect(result.parts[0].provenance.providerId).toBe('pnoa');
    expect(r.windows).toHaveLength(4);
    for (const w of r.windows) {
      expect(w.tilePx).toBe(256);
      expect(w.halo).toBe(DEFAULT_HALO_PX);
      expect(w.width).toBe(256 + 2 * DEFAULT_HALO_PX);
      // Every neighbour answered, so no part of the window is left empty.
      expect(w.pixels[3]).toBe(255);
      expect(w.pixels[(w.width * w.height - 1) * 4 + 3]).toBe(255);
    }
    // The 2 x 2 area plus its ring of neighbours: 16 tiles, each requested once.
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls).toHaveLength(16);
  });

  it('asks the DGT for 512 px plus the halo in one request', async () => {
    const t = lonLatToTile(-8.42, 41.55, 18);
    const area = overTiles(18, t.x, t.y, 1, 1);
    const halo = (DEFAULT_HALO_PX * 512) / 256;
    const size = 512 + 2 * halo;
    const { fetch, calls } = net(() => size);
    const r = recorder();
    const result = await runScan(area, args(), { fetch, wait: noWait, detector: r.detector });
    expect(result.parts[0].provenance.providerId).toBe('dgt-ortos2025');
    expect(calls.every((c) => c.includes(`WIDTH=${size}&HEIGHT=${size}`))).toBe(true);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ tilePx: 512, halo, width: size, height: size });
    expect(r.windows[0].tile).toEqual({ z: 18, x: t.x, y: t.y });
  });

  it('fails a tile that comes back at the wrong size and says so', async () => {
    const t = lonLatToTile(-8.42, 41.55, 18);
    const { fetch } = net(() => 512);
    const lines: string[] = [];
    const result = await runScan(overTiles(18, t.x, t.y, 1, 1), args(), { fetch, wait: noWait, detector: recorder().detector, warn: (l) => lines.push(l) });
    expect(result.detections).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/1 tiles failed on DGT Ortos2025 \(first: tile decoded at 512x512, expected 704x704\); no pools are listed for them: 18\/\d+\/\d+/);
  });

  it('gives v1 bare pieces and no halo', async () => {
    expect(haloFor('v1')).toBe(0);
    expect(haloFor('v2')).toBe(DEFAULT_HALO_PX);
    const t = lonLatToTile(-8.42, 41.55, 18);
    const { fetch } = net(() => 512);
    const r = recorder('v1');
    await runScan(overTiles(18, t.x, t.y, 1, 1), args({ detector: 'v1' }), { fetch, wait: noWait, detector: r.detector });
    expect(r.windows).toHaveLength(4);
    for (const w of r.windows) expect(w).toMatchObject({ tilePx: 256, halo: 0, width: 256, height: 256 });
  });
});
