import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { decodeImage } from '../../packages/cli/src/tiles.ts';
import { DEFAULT_LEARNED_OPTIONS, detectWindow, metersPerPixelOfBitmap, type PoolModel, type TileCoord } from '../../packages/core/src/index.ts';

/*
 * Target (plan B3, fixed before measuring): per candidate, the score from
 * the two decodes differs by at most 0.01, and at least 99% of candidates
 * match. The scorer is v2 with the shipped model, every candidate kept.
 */
const MAX_SCORE_DIFF = 0.01;
const MIN_MATCHED = 0.99;

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();

/** `<source>-<place>-<z>-<x>-<y>.jpg` to the tile it shows. */
function tileOf(name: string): TileCoord {
  const m = /-(\d+)-(\d+)-(\d+)\.jpg$/.exec(name)!;
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/** The decoder the CLI, the benchmark and the training tools use. */
function nodeDecode(buf: Buffer) {
  return decodeImage(buf);
}

const browserSha = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/cli/test/jpeg-browser-sha256.json', import.meta.url)), 'utf8')) as { files: Record<string, string> };

const model = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/core/models/pool-v2.json', import.meta.url)), 'utf8')) as PoolModel;

/** v2 on a decoded image: the whole image is the window; `-halo<N>-` in the name gives its halo. */
function candidates(name: string, tile: TileCoord, rgba: Uint8ClampedArray, size: number) {
  const halo = Number(/-halo(\d+)-/.exec(name)?.[1] ?? 0);
  const tilePx = size - 2 * halo;
  const w = { tile, tilePx, halo, width: size, height: size, pixels: rgba, mPerPx: metersPerPixelOfBitmap(tile, tilePx) };
  return detectWindow(w, { providerId: name.split('-')[0] }, model, { ...DEFAULT_LEARNED_OPTIONS, floor: 0 }).map((d) => ({ center: d.center, confidence: d.score ?? 0 }));
}

test('browser and Node decodes give the same candidates', async ({ page, browserName }, info) => {
  await page.setContent('<!doctype html><title>parity</title>');
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  let matched = 0;
  let worst = 0;
  for (const name of files) {
    const buf = readFileSync(join(dir, name));
    const mine = nodeDecode(buf);
    const theirs = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
        colorSpaceConversion: 'none',
        premultiplyAlpha: 'none',
      });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let s = '';
      for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { width: bmp.width, height: bmp.height, b64: btoa(s) };
    }, buf.toString('base64'));
    expect(theirs.width).toBe(mine.width);
    const rgba = new Uint8ClampedArray(Buffer.from(theirs.b64, 'base64'));

    let maxDiff = 0;
    let sum = 0;
    let over2 = 0;
    for (let i = 0; i < rgba.length; i++) {
      if ((i & 3) === 3) continue;
      const d = Math.abs(rgba[i] - mine.rgba[i]);
      sum += d;
      if (d > maxDiff) maxDiff = d;
      if (d > 2) over2++;
    }
    const channels = (rgba.length / 4) * 3;

    const sha = createHash('sha256').update(rgba).digest('hex');
    expect(sha, `${name}: browser pixels differ from the recorded ones`).toBe(browserSha.files[`tests/parity/fixtures/${name}`]);
    expect(maxDiff, `${name}: Node and browser pixels differ`).toBe(0);

    const tile = tileOf(name);
    const a = candidates(name, tile, mine.rgba, mine.width);
    const b = candidates(name, tile, rgba, theirs.width);
    // Pair candidates by position: the same shape lands within a metre.
    let fileMatched = 0;
    let fileWorst = 0;
    for (const d of a) {
      const near = b.find((e) => Math.abs(e.center.lat - d.center.lat) < 1e-5 && Math.abs(e.center.lon - d.center.lon) < 1e-5);
      if (!near) continue;
      const diff = Math.abs(near.confidence - d.confidence);
      fileWorst = Math.max(fileWorst, diff);
      if (diff <= MAX_SCORE_DIFF) fileMatched++;
    }
    const pool = Math.max(a.length, b.length);
    total += pool;
    matched += fileMatched;
    worst = Math.max(worst, fileWorst);
    rows.push({
      file: name,
      pixelMaxDiff: maxDiff,
      pixelMeanDiff: Number((sum / channels).toFixed(4)),
      pixelsOver2: Number((over2 / channels).toFixed(5)),
      candidatesNode: a.length,
      candidatesBrowser: b.length,
      matched: fileMatched,
      worstScoreDiff: Number(fileWorst.toFixed(4)),
      browserRgbaSha256: sha.slice(0, 16),
    });
  }
  const report = { browser: browserName, files: files.length, candidates: total, matched, matchedShare: total ? matched / total : 1, worstScoreDiff: worst, rows };
  writeFileSync(info.outputPath(`parity-${browserName}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ browser: browserName, candidates: total, matched, worstScoreDiff: worst }));
  console.table(rows);
  expect(files.length).toBeGreaterThan(0);
  expect(report.matchedShare).toBeGreaterThanOrEqual(MIN_MATCHED);
});
