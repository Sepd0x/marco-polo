// @vitest-environment node
/*
 * The worker's answer on the real fixture tiles, pinned. Speed work on the
 * detector and the worker must leave every detection, score, polygon,
 * thumbnail crop and candidate feature bit for bit as it was.
 *
 * Records written at e7b2f13 (before the 28 Oct speed work). A change that is
 * meant to move results (a new model, a new feature) rewrites them:
 *   UPDATE_DETECTOR_GOLDEN=1 npx vitest run apps/web/test/scan/detectorGolden.test.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createV1Detector,
  DEFAULT_LEARNED_OPTIONS,
  scoreImage,
  sourceFamily,
  windowFrame,
  windowFromBitmap,
  type PoolModel,
  type TileCoord,
} from '@marco-polo/core';
import model from '@marco-polo/core/models/pool-v2.json';
import { decodeImage } from '../../../../packages/cli/src/tiles.js';
import { productDetector } from '../../src/scan/productDetector.js';
import { runJob, type DecodedImage, type WorkJob } from '../../src/scan/tileWork.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const goldenFile = fileURLToPath(new URL('./fixtures/detector-golden.json', import.meta.url));
const update = !!process.env.UPDATE_DETECTOR_GOLDEN;

interface Fixture { name: string; tile: TileCoord; tilePx: number; halo: number; providerId: string; bytes: Uint8Array; grid?: string }

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  const parity = join(root, 'tests/parity/fixtures');
  for (const f of readdirSync(parity).filter((n) => n.endsWith('.jpg')).sort()) {
    const m = /^(.*)-(\d+)-(\d+)-(\d+)\.jpg$/.exec(f)!;
    const providerId = f.startsWith('dgt-') ? 'dgt-ortos2025' : f.startsWith('ign-') ? 'ign-orthophotos' : 'pnoa';
    out.push({ name: f, tile: { z: +m[2], x: +m[3], y: +m[4] }, tilePx: f.startsWith('dgt-') ? 512 : 256, halo: Number(/halo(\d+)/.exec(f)?.[1] ?? 0), providerId, bytes: readFileSync(join(parity, f)) });
  }
  const open = join(root, 'packages/eval/fixtures/open/tiles');
  for (const src of readdirSync(open).sort()) {
    for (const f of readdirSync(join(open, src)).sort()) {
      const [z, x, y] = f.replace('.jpg', '').split('-').map(Number);
      const providerId = src === 'dgt' ? 'dgt-ortos2025' : src === 'ign' ? 'ign-orthophotos' : 'pnoa';
      out.push({ name: `${src}/${f}`, tile: { z, x, y }, tilePx: 256, halo: 0, providerId, bytes: readFileSync(join(open, src, f)), grid: join(open, src) });
    }
  }
  return out;
}

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const copy = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

const decode = async (bytes: Uint8Array): Promise<DecodedImage> => {
  const d = decodeImage(bytes);
  return { pixels: d.rgba, width: d.width, height: d.height };
};

async function workerRecord(job: WorkJob): Promise<string> {
  const crops: string[] = [];
  const res = await runJob(job, {
    decode,
    detector: productDetector(),
    encodeThumb: async (pixels, w, h) => {
      crops.push(`${w}x${h}:${sha(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength))}`);
      return new Blob([]);
    },
    now: () => 0,
  });
  expect(res.error).toBeUndefined();
  return JSON.stringify({ noData: res.noData, pieces: res.pieces, thumbs: res.thumbs.map((t) => t.key), crops });
}

/** Every candidate of the window, kept or not: level, box, features and score. */
function candidateRecord(f: Fixture): string {
  const d = decodeImage(f.bytes);
  const w = windowFromBitmap(f.tile, d.rgba, d.width, d.height, f.halo);
  const { frame, central } = windowFrame(w);
  const opts = { ...DEFAULT_LEARNED_OPTIONS, floor: 0 };
  const { analysis, kept } = scoreImage(w.pixels, w.width, w.height, frame, central, sourceFamily(f.providerId), model as unknown as PoolModel, opts);
  const h = createHash('sha256');
  for (const c of analysis.candidates) {
    h.update(JSON.stringify([c.level, c.component, c.cx, c.cy, c.mPerPx, c.areaM2, c.touchesBorder]));
    h.update(new Uint8Array(c.features.buffer, c.features.byteOffset, c.features.byteLength));
  }
  h.update(JSON.stringify(kept.map((k) => [analysis.candidates.indexOf(k.candidate), k.score])));
  h.update(new Uint8Array(analysis.hue.buffer));
  h.update(new Uint8Array(analysis.sat.buffer));
  h.update(new Uint8Array(analysis.val.buffer));
  return `${analysis.candidates.length}:${h.digest('hex')}`;
}

describe('detector output on the fixture tiles', () => {
  const golden: Record<string, string> = !update && existsSync(goldenFile) ? JSON.parse(readFileSync(goldenFile, 'utf8')) : {};
  const fresh: Record<string, string> = {};
  const all = fixtures();

  it('matches the records, bit for bit', { timeout: 300_000 }, async () => {
    const v1 = createV1Detector();
    for (const f of all) {
      const base = { scanId: 'golden', providerId: f.providerId, tile: f.tile, tilePx: f.tilePx, thumbs: true };
      // The window as the bench sends it: one bitmap with its halo inside.
      fresh[`worker ${f.name}`] = sha(await workerRecord({ ...base, id: 1, halo: f.halo, bytes: copy(f.bytes) }));
      fresh[`candidates ${f.name}`] = candidateRecord(f);
      if (f.grid) {
        // XYZ as the scan sends it: the centre and its eight neighbours, halo 48.
        const neighbours: (ArrayBuffer | null)[] = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const p = join(f.grid, `${f.tile.z}-${f.tile.x + dx}-${f.tile.y + dy}.jpg`);
            neighbours.push(existsSync(p) ? copy(readFileSync(p)) : null);
          }
        }
        fresh[`worker+halo ${f.name}`] = sha(await workerRecord({ ...base, id: 2, halo: 48, bytes: copy(f.bytes), neighbours }));
        const d = decodeImage(f.bytes);
        fresh[`v1 ${f.name}`] = sha(JSON.stringify(v1.detectTile(windowFromBitmap(f.tile, d.rgba, d.width, d.height, 0), { providerId: f.providerId })));
      }
    }
    if (update) {
      writeFileSync(goldenFile, JSON.stringify(fresh, null, 1) + '\n');
      return;
    }
    expect(Object.keys(golden).length, 'no records: run with UPDATE_DETECTOR_GOLDEN=1').toBeGreaterThan(0);
    const differ = Object.keys(golden).filter((k) => golden[k] !== fresh[k]);
    expect(differ).toEqual([]);
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(golden).sort());
  });
});
