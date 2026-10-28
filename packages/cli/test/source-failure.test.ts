import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lonLatToTile, tileBBox, type Detector, type Ring } from '@marco-polo/core';
import { runScan, scanCommand, SCAN_HELP, type ScanArgs } from '../src/commands/scan.js';
import { encodePng, type FetchLike } from '../src/tiles.js';

/**
 * A source that does not answer is not a source without imagery. The probe
 * moves a part to the next source only for the second; for the first it keeps
 * the source and reports its tiles as failed.
 */

const noWait = async () => {};
const noDetector: Detector = { id: 'v2', version: 'test', detectTile: () => [] };

function args(over: Partial<ScanArgs> = {}): ScanArgs {
  return {
    setting: { mode: 'auto' },
    out: './scans/test',
    rate: 10,
    order: 'serpentine',
    threshold: null,
    cacheDir: mkdtempSync(join(tmpdir(), 'mp-fail-cache-')),
    allowLarge: false,
    dates: false,
    quiet: true,
    ...over,
  };
}

/** Two by two z18 tiles in northern Portugal, where auto picks the DGT. */
function braga(): Ring {
  const t = lonLatToTile(-8.42, 41.55, 18);
  const nw = tileBBox({ z: 18, x: t.x, y: t.y });
  const se = tileBBox({ z: 18, x: t.x + 1, y: t.y + 1 });
  const ex = (se.east - nw.west) * 1e-3;
  const ey = (nw.north - se.south) * 1e-3;
  return [[nw.west + ex, se.south + ey], [se.east - ex, se.south + ey], [se.east - ex, nw.north - ey], [nw.west + ex, nw.north - ey]];
}

function picture(px: number, fill: 'imagery' | 'white'): Uint8Array {
  const rgba = new Uint8ClampedArray(px * px * 4);
  for (let i = 0; i < px * px; i++) {
    if (fill === 'white') rgba.set([255, 255, 255, 255], i * 4);
    else rgba.set([110 + (i % 5), 108, 105, 255], i * 4);
  }
  return new Uint8Array(encodePng(rgba, px, px));
}

type Answer = { status: number; body?: Uint8Array } | 'throw' | 'timeout';

/** A fake network: `answer` decides per request, from the url and how many times it was asked before. */
function network(answer: (url: string, nth: number) => Answer) {
  const calls: string[] = [];
  const seen = new Map<string, number>();
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const nth = seen.get(url) ?? 0;
    seen.set(url, nth + 1);
    const a = answer(url, nth);
    if (a === 'throw') throw new TypeError('fetch failed');
    if (a === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const body = a.body ?? new Uint8Array();
    return { status: a.status, arrayBuffer: async () => body.slice().buffer };
  };
  return {
    fetch,
    calls,
    onDgt: () => calls.filter((c) => c.includes('dgterritorio')),
    onEsri: () => calls.filter((c) => c.includes('arcgisonline')),
  };
}

const isDgt = (url: string) => url.includes('dgterritorio');
const dgtPicture: Answer = { status: 200, body: picture(704, 'imagery') };
const esriPicture: Answer = { status: 200, body: picture(256, 'imagery') };
const DGT_FIXED: ScanArgs['setting'] = { mode: 'fixed', providerId: 'dgt-ortos2025' };

async function scan(net: ReturnType<typeof network>, over: Partial<ScanArgs> = {}) {
  const warnings: string[] = [];
  const result = await runScan(braga(), args(over), {
    fetch: net.fetch,
    wait: noWait,
    detector: noDetector,
    warn: (l) => warnings.push(l),
  });
  return { result, warnings, ids: result.parts.map((p) => p.provenance.providerId) };
}

describe('a source that does not answer', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['HTTP 503', { status: 503 } as Answer, /HTTP 503/],
    ['HTTP 429', { status: 429 } as Answer, /HTTP 429/],
    ['a timeout', 'timeout' as Answer, /timeout/],
    ['a dropped connection', 'throw' as Answer, /fetch failed/],
  ])('is kept in auto after %s, and its tiles are reported as failed', async (_name, down, why) => {
    const net = network((url) => (isDgt(url) ? down : esriPicture));
    const { result, warnings, ids } = await scan(net);
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(net.onEsri()).toHaveLength(0);
    const text = warnings.join('\n');
    expect(text).toMatch(/did not answer properly for \d of \d sample tiles/);
    expect(text).toMatch(why);
    expect(text).toMatch(/not switching source/);
    expect(text).not.toMatch(/using .* instead/);
    expect(text).toMatch(/4 tiles failed on DGT/);
    expect(text).toMatch(/18\/\d+\/\d+/);
    expect(result.detections).toHaveLength(0);
  });

  it('is retried with backoff, then the tile counts as failed', async () => {
    const waits: number[] = [];
    const net = network((url) => (isDgt(url) ? { status: 503 } : esriPicture));
    const warnings: string[] = [];
    await runScan(braga(), args(), {
      fetch: net.fetch,
      wait: async (ms) => void waits.push(ms),
      detector: noDetector,
      warn: (l) => warnings.push(l),
    });
    // Four attempts for each request (3 retries), with the backoff between them.
    const perUrl = new Map<string, number>();
    for (const c of net.onDgt()) perUrl.set(c, (perUrl.get(c) ?? 0) + 1);
    expect([...perUrl.values()].every((n) => n >= 4)).toBe(true);
    expect(waits).toEqual(expect.arrayContaining([500, 1000, 2000]));
    expect(warnings.join('\n')).toMatch(/4 tiles failed/);
  });

  it('is kept when some sample tiles say no imagery and others did not answer', async () => {
    const order: string[] = [];
    const net = network((url) => {
      if (!isDgt(url)) return esriPicture;
      if (!order.includes(url)) order.push(url);
      return order.indexOf(url) % 2 === 0 ? { status: 404 } : { status: 503 };
    });
    const { ids, warnings } = await scan(net);
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(net.onEsri()).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/not switching source/);
  });

  it('is kept when it refuses with an error status other than 404 or 204', async () => {
    const net = network((url) => (isDgt(url) ? { status: 403, body: new TextEncoder().encode('denied') } : esriPicture));
    const { ids, warnings } = await scan(net);
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(net.onEsri()).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/HTTP 403, not an image/);
  });

  it('recovers: a request that answers on the third try is used and nothing is reported', async () => {
    const net = network((url, nth) => (isDgt(url) ? (nth < 2 ? { status: 503 } : dgtPicture) : esriPicture));
    const { ids, warnings } = await scan(net);
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(warnings).toEqual([]);
  });

  it('is kept with a fixed source too, and still reported', async () => {
    const net = network((url) => (isDgt(url) ? 'timeout' : esriPicture));
    const { ids, warnings } = await scan(net, { setting: DGT_FIXED });
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(net.onEsri()).toHaveLength(0);
    expect(warnings.join('\n')).toMatch(/tiles failed on DGT/);
  });
});

describe('a source with no imagery here', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['a 404', { status: 404 } as Answer],
    ['a 204', { status: 204 } as Answer],
    ['a blank picture', { status: 200, body: picture(704, 'white') } as Answer],
  ])('hands the part to the next source after %s, and says when and why', async (_name, none) => {
    const net = network((url) => (isDgt(url) ? none : esriPicture));
    const { ids, warnings } = await scan(net);
    expect(ids).toEqual(['esri-world-imagery']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^part p1: DGT Ortos2025 answered \d of \d sample tiles and has no imagery here; using Esri World Imagery instead$/);
    expect(net.onEsri().length).toBeGreaterThan(0);
  });

  it('does not move a fixed choice', async () => {
    const net = network((url) => (isDgt(url) ? { status: 404 } : esriPicture));
    const { result, ids, warnings } = await scan(net, { setting: DGT_FIXED });
    expect(ids).toEqual(['dgt-ortos2025']);
    expect(result.parts[0].tilesNoCoverage).toBe(4);
    expect(net.onEsri()).toHaveLength(0);
    expect(warnings).toEqual([]);
  });
});

describe('the notices on stderr', () => {
  afterEach(() => vi.restoreAllMocks());

  async function run(net: ReturnType<typeof network>, extra: string[] = []) {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const logged: string[] = [];
    const out = join(mkdtempSync(join(tmpdir(), 'mp-fail-out-')), 'scan');
    const cacheDir = mkdtempSync(join(tmpdir(), 'mp-fail-c-'));
    const code = await scanCommand(
      ['--bbox', '41.5505,-8.4195,41.5510,-8.4190', '--no-dates', '--out', out, '--cache-dir', cacheDir, ...extra],
      { fetch: net.fetch, wait: noWait, detector: noDetector, log: (l) => logged.push(l) },
    );
    return { code, stderr: written.join(''), logged: logged.join('\n'), out };
  }

  it('say that a fallback happened and why, also with --quiet', async () => {
    const answer = (url: string): Answer => (isDgt(url) ? { status: 404 } : esriPicture);
    const loud = await run(network(answer));
    expect(loud.code).toBe(0);
    expect(loud.stderr).toMatch(/DGT Ortos2025 answered \d of \d sample tiles and has no imagery here; using Esri World Imagery instead\n/);
    const quiet = await run(network(answer), ['--quiet']);
    expect(quiet.logged).toBe('');
    expect(quiet.stderr).toMatch(/has no imagery here; using Esri World Imagery instead/);
  });

  it('say that a source did not answer and was kept, also with --quiet', async () => {
    const net = network((url) => (isDgt(url) ? { status: 503 } : esriPicture));
    const { code, stderr, out } = await run(net, ['--quiet']);
    expect(code).toBe(0);
    expect(stderr).toMatch(/DGT Ortos2025 did not answer properly for \d of \d sample tiles \(first: .*HTTP 503.*\); not switching source/);
    expect(stderr).toMatch(/tiles failed on DGT Ortos2025/);
    expect(net.onEsri()).toHaveLength(0);
    expect(JSON.parse(readFileSync(`${out}.geojson`, 'utf8')).features).toBeDefined();
  });
});

describe('--help', () => {
  it('says when a source is replaced, that one that does not answer never is, and that notices survive --quiet', () => {
    expect(SCAN_HELP).toMatch(/moves to the next source only when its\s+first source answers every sample tile and has no imagery/);
    expect(SCAN_HELP).toMatch(/does not answer \(timeout, HTTP 5xx or 429, any other error\s+status\) is never replaced/);
    expect(SCAN_HELP).toMatch(/notices on stderr about a change of\s+source or failed tiles are still printed/);
  });
});
