import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_COUNT, tileBBox } from '@marco-polo/core';
import { augmentPixels, hashSeed, rng, type AugmentRecipe } from '../src/commands/augment.js';
import { candidatesCommand, parseCandidatesArgs, runCandidates } from '../src/commands/candidates.js';
import { Pacer, TileFetcher, type FetchLike } from '../src/tiles.js';

const FIXTURE = new URL('../../eval/fixtures/open/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', FIXTURE), 'utf8')) as {
  tiles: Array<{ source: string; x: number; y: number; z: number; file: string }>;
};
const pnoa = manifest.tiles.filter((t) => t.source === 'pnoa');

/** Serves the open fixture's PNOA tiles by their WMTS row and column; anything else is a 404. */
function fixtureFetcher(): TileFetcher {
  const fetch: FetchLike = async (url) => {
    const col = Number(/tilecol=(\d+)/.exec(url)?.[1]);
    const row = Number(/tilerow=(\d+)/.exec(url)?.[1]);
    const t = pnoa.find((p) => p.x === col && p.y === row);
    const body = t ? new Uint8Array(readFileSync(new URL(t.file, FIXTURE))) : new Uint8Array(0);
    return { status: t ? 200 : 404, arrayBuffer: async () => body.slice().buffer };
  };
  return new TileFetcher({ pacer: new Pacer(1000, () => 0, async () => {}), cachePolicy: 'http', fetch, wait: async () => {} });
}

/** The inner 2 x 2 tiles of the 4 x 4 PNOA block, so each has its full halo. */
function innerBBox(): string {
  const xs = pnoa.map((t) => t.x), ys = pnoa.map((t) => t.y);
  const x0 = Math.min(...xs) + 1, y0 = Math.min(...ys) + 1;
  const nw = tileBBox({ z: 19, x: x0, y: y0 }), se = tileBBox({ z: 19, x: x0 + 1, y: y0 + 1 });
  const e = 1e-7;
  return `${se.south + e},${nw.west + e},${nw.north - e},${se.east - e}`;
}

const RECIPE: AugmentRecipe = {
  colour: { p: 1, gain: [0.85, 1.15], gamma: [0.75, 1.3], saturation: [0.65, 1.35], offset: [-12, 12] },
  resample: { p: 1, metres: [0.3, 0.5] },
  unsharp: { p: 1, amount: [0.3, 1], radius: [0.8, 1.6] },
  noise: { p: 1, sigma: [2, 6] },
  jpeg: { p: 1, quality: [50, 85] },
};

describe('candidates command', () => {
  it('validates its options and refuses Esri', async () => {
    expect(await candidatesCommand([])).toBe(2);
    expect(await candidatesCommand(['--help'])).toBe(0);
    expect(() => parseCandidatesArgs(['--bbox', '1,2,3,4', '--source', 'esri', '--out', 'x'])).toThrow(/never used for training/);
    expect(() => parseCandidatesArgs(['--bbox', '1,2,3,4', '--source', 'mapbox', '--out', 'x'])).toThrow(/--source/);
    expect(parseCandidatesArgs(['--bbox', '1,2,3,4', '--source', 'dgt2018', '--out', 'x'])).toMatchObject({ halo: 48, copy: 0 });
  });

  it('writes the same candidates and features on every run', async () => {
    const args = parseCandidatesArgs(['--bbox', innerBBox(), '--source', 'pnoa', '--out', 'unused', '--quiet']);
    if (args === 'help') throw new Error('help');
    const a = await runCandidates(args, fixtureFetcher());
    const b = await runCandidates(args, fixtureFetcher());
    expect(a.tiles).toBe(4);
    expect(a.missing).toBe(0);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.features.length).toBe(a.rows.length * FEATURE_COUNT);
    expect(Array.from(b.features)).toEqual(Array.from(a.features));
    // Without labels every candidate is left out of training.
    expect(a.rows.every((r) => r.y === -1)).toBe(true);
  });

  it('marks candidates against labels', async () => {
    const args = parseCandidatesArgs(['--bbox', innerBBox(), '--source', 'pnoa', '--out', 'unused', '--quiet']);
    if (args === 'help') throw new Error('help');
    const { rows } = await runCandidates(args, fixtureFetcher());
    const big = rows.reduce((m, r) => (r.px > m.px ? r : m));
    const [w, s, e, n] = big.bbox;
    const pad = (e - w) * 0.2;
    const labels = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]]] }, properties: { id: 't/1', role: 'pool' } }] };
    const file = new URL('../../../.cache/candidates-test-labels.json', import.meta.url);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(new URL('.', file), { recursive: true });
    writeFileSync(file, JSON.stringify(labels));
    const labelled = parseCandidatesArgs(['--bbox', innerBBox(), '--source', 'pnoa', '--out', 'unused', '--labels', file.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--quiet']);
    if (labelled === 'help') throw new Error('help');
    const out = await runCandidates(labelled, fixtureFetcher());
    const same = out.rows.find((r) => r.px === big.px && r.level === big.level && r.lon === big.lon);
    expect(same?.y).toBe(1);
    expect(same?.gid).toBe('t/1');
    expect(out.rows.filter((r) => r.y === 0).length).toBeGreaterThan(0);
  });

  it('augments a copy the same way every time, and the original never', async () => {
    const base = parseCandidatesArgs(['--bbox', innerBBox(), '--source', 'pnoa', '--out', 'unused', '--quiet']);
    if (base === 'help') throw new Error('help');
    const original = await runCandidates(base, fixtureFetcher());
    const recipeFile = new URL('../../../.cache/candidates-test-recipe.json', import.meta.url);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(new URL('.', recipeFile), { recursive: true });
    writeFileSync(recipeFile, JSON.stringify({ augment: RECIPE }));
    const path = recipeFile.pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const aug = (copy: number) => {
      const a = parseCandidatesArgs(['--bbox', innerBBox(), '--source', 'pnoa', '--out', 'unused', '--augment', path, '--copy', String(copy), '--quiet']);
      if (a === 'help') throw new Error('help');
      return runCandidates(a, fixtureFetcher());
    };
    const c1 = await aug(1), again = await aug(1), c2 = await aug(2);
    expect(Array.from(again.features)).toEqual(Array.from(c1.features));
    expect(Array.from(c1.features)).not.toEqual(Array.from(original.features));
    expect(Array.from(c2.features)).not.toEqual(Array.from(c1.features));
  });
});

describe('augmentation', () => {
  function picture(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const x = i % 64, y = (i / 64) | 0;
      px.set([(x * 4) & 255, ((x ^ y) * 8) & 255, 200 - y, x < 8 ? 0 : 255], i * 4);
    }
    return px;
  }

  it('is a function of the seed and leaves missing pixels alone', () => {
    const a = picture(), b = picture();
    augmentPixels(a, 64, 64, 0.22, RECIPE, rng(hashSeed('s')));
    augmentPixels(b, 64, 64, 0.22, RECIPE, rng(hashSeed('s')));
    expect(Array.from(a)).toEqual(Array.from(b));
    const orig = picture();
    for (let i = 0; i < 64 * 64; i++) {
      if (orig[i * 4 + 3] === 0) expect([a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]]).toEqual([orig[i * 4], orig[i * 4 + 1], orig[i * 4 + 2], 0]);
    }
  });

  it('does nothing when every step has probability 0', () => {
    const off = Object.fromEntries(Object.entries(RECIPE).map(([k, v]) => [k, { ...v, p: 0 }])) as unknown as AugmentRecipe;
    const a = picture();
    const r = augmentPixels(a, 64, 64, 0.22, off, rng(1));
    expect(r.steps).toEqual([]);
    expect(Array.from(a)).toEqual(Array.from(picture()));
  });

  it('softens detail when resampling to a coarser ground size', () => {
    const only = { ...RECIPE, colour: { ...RECIPE.colour, p: 0 }, unsharp: { ...RECIPE.unsharp, p: 0 }, noise: { ...RECIPE.noise, p: 0 }, jpeg: { ...RECIPE.jpeg, p: 0 } };
    const a = picture();
    const energy = (px: Uint8ClampedArray) => {
      let e = 0;
      for (let y = 0; y < 64; y++) for (let x = 9; x < 63; x++) e += Math.abs(px[(y * 64 + x + 1) * 4 + 1] - px[(y * 64 + x) * 4 + 1]);
      return e;
    };
    const before = energy(a);
    const r = augmentPixels(a, 64, 64, 0.22, only, rng(3));
    expect(r.steps[0]).toMatch(/^resample/);
    expect(energy(a)).toBeLessThan(before * 0.8);
  });
});
