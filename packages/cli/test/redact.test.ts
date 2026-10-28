import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lonLatToTile, tileBBox, type Detector, type Ring } from '@marco-polo/core';
import { runScan, scanCommand, writeOutputs, type ScanArgs } from '../src/commands/scan.js';
import { errorText, redact } from '../src/redact.js';
import { Pacer, TileFetcher, type FetchLike } from '../src/tiles.js';

/** An obvious fake: no real key is ever used in tests. */
const KEY = 'TESTKEY123';

const noWait = async () => {};

afterEach(() => vi.restoreAllMocks());

function args(over: Partial<ScanArgs> = {}): ScanArgs {
  return {
    setting: { mode: 'auto' },
    out: './scans/test',
    rate: 10,
    order: 'serpentine',
    threshold: null,
    detector: 'v2',
    cacheDir: mkdtempSync(join(tmpdir(), 'mp-cache-')),
    allowLarge: false,
    dates: true,
    quiet: false,
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

/** A network that fails the way fetch can: with the request URL, key included, in the message. */
const leakyFetch: FetchLike = async (url) => {
  const withKey = `${url}${url.includes('?') ? '&' : '?'}key=${KEY}`;
  const cause = new Error(`connect ECONNREFUSED ${withKey}`);
  throw new Error(`request to ${withKey} failed, reason: socket hang up`, { cause });
};

describe('redact', () => {
  it('blanks credentials in query strings, headers and URLs', () => {
    expect(redact(`GET https://t.test/a/1/2?key=${KEY}&x=1`)).toBe('GET https://t.test/a/1/2?key=[redacted]&x=1');
    expect(redact(`https://t.test/a?access_token=${KEY}`)).toBe('https://t.test/a?access_token=[redacted]');
    expect(redact(`https://t.test/a?x=1&api_key=${KEY}`)).toBe('https://t.test/a?x=1&api_key=[redacted]');
    expect(redact(`https://t.test/a?apikey=${KEY}`)).toBe('https://t.test/a?apikey=[redacted]');
    expect(redact(`Authorization: Bearer ${KEY}abcdef`)).toBe('Authorization: Bearer [redacted]');
    expect(redact(`https://user:${KEY}@t.test/a`)).toBe('https://[redacted]@t.test/a');
    expect(redact('HTTP 503, no key here')).toBe('HTTP 503, no key here');
  });

  it('reads the whole chain of causes', () => {
    const err = new Error('outer', { cause: new Error(`inner https://t.test/?token=${KEY}`) });
    const text = errorText(err);
    expect(text).toContain('outer: inner');
    expect(text).not.toContain(KEY);
  });
});

describe('a key in a request URL', () => {
  it('is not in the error of a failed tile request', async () => {
    const f = new TileFetcher({ pacer: new Pacer(100, Date.now, noWait), cachePolicy: 'http', fetch: leakyFetch, wait: noWait, retries: 1 });
    const err = await f.get('https://t.test/tile/1/2/3').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/failed after 2 attempts/);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('never reaches the log, the output files, the cache folder or stderr of a scan', async () => {
    const t = lonLatToTile(-8.42, 41.55, 18);
    const area = overTiles(18, t.x, t.y, 1, 1);
    const out = join(mkdtempSync(join(tmpdir(), 'mp-leak-')), 'scan');
    const cacheDir = mkdtempSync(join(tmpdir(), 'mp-leak-cache-'));
    const lines: string[] = [];
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const code = await scanCommand(['--bbox', '41.5505,-8.4195,41.5510,-8.4190', '--out', out, '--cache-dir', cacheDir, '--no-dates'], {
      fetch: leakyFetch,
      wait: noWait,
      log: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    // The tiles failed, and the log says so without the key.
    expect([...lines, ...written].join('\n')).toMatch(/tiles failed/);
    for (const f of [`${out}.geojson`, `${out}.csv`]) expect(readFileSync(f, 'utf8')).not.toContain(KEY);
    expect(readdirSync(cacheDir).join(' ')).not.toContain(KEY);
    expect([...lines, ...written].join('\n')).not.toContain(KEY);

    // The same through runScan and its result.
    const logs: string[] = [];
    const result = await runScan(area, args({ quiet: true }), { fetch: leakyFetch, wait: noWait, log: (l) => logs.push(l) });
    const files = await writeOutputs(result, join(mkdtempSync(join(tmpdir(), 'mp-leak2-')), 'scan'));
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('is not in an error that ends the command', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const detector = {
      get id(): string {
        throw new Error(`could not start https://t.test/?access_token=${KEY}`, { cause: new Error(`inner key=${KEY}`) });
      },
      version: 'x',
      detectTile: () => [],
    } as unknown as Detector;
    const code = await scanCommand(['--bbox', '41.5505,-8.4195,41.5510,-8.4190', '--quiet'], { detector });
    expect(code).toBe(1);
    expect(written.join('')).toMatch(/could not start/);
    expect(written.join('')).not.toContain(KEY);
  });

  it('is not in a usage error that repeats what was typed', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    expect(await scanCommand(['--area', `https://t.test/area.json?key=${KEY}`])).toBe(2);
    expect(written.join('')).toMatch(/cannot read --area/);
    expect(written.join('')).not.toContain(KEY);
  });
});
