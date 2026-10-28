/*
 * Detection time per stage, in Node, on the bench fixtures (same decode as
 * tests/bench/profile.ts). Replays analyseWindow and detectWindow step by
 * step with the same calls, so the shares add up to the detector time.
 *
 *   npx tsx tests/bench/stages.ts [rounds]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeImage } from '../../packages/cli/src/tiles.ts';
import {
  CANDIDATE_LEVELS,
  calibratedScore,
  cleanMask,
  colourGates,
  componentFeatures,
  DEFAULT_LEARNED_OPTIONS,
  FEATURE_COUNT,
  hsvInto,
  labelComponents,
  noDataReason,
  sourceFamily,
  toTileDetection,
  windowFrame,
  windowFromBitmap,
  imageCandidates,
  selectCandidates,
  type PoolModel,
} from '../../packages/core/src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const model = JSON.parse(readFileSync(join(root, 'packages/core/models/pool-v2.json'), 'utf8')) as PoolModel;
const rounds = Number(process.argv[2] ?? 5);

const tiles: { px: number; halo: number; providerId: string; tile: { z: number; x: number; y: number }; bytes: Uint8Array }[] = [];
const parity = join(root, 'tests/parity/fixtures');
for (const f of readdirSync(parity).filter((n) => n.endsWith('.jpg'))) {
  const m = /^(.*)-(\d+)-(\d+)-(\d+)\.jpg$/.exec(f)!;
  tiles.push({ px: f.startsWith('dgt-') ? 512 : 256, halo: Number(/halo(\d+)/.exec(f)?.[1] ?? 0), providerId: f.split('-')[0], tile: { z: +m[2], x: +m[3], y: +m[4] }, bytes: readFileSync(join(parity, f)) });
}
const open = join(root, 'packages/eval/fixtures/open/tiles');
for (const src of readdirSync(open)) {
  for (const f of readdirSync(join(open, src))) {
    const [z, x, y] = f.replace('.jpg', '').split('-').map(Number);
    tiles.push({ px: 256, halo: 0, providerId: src, tile: { z, x, y }, bytes: readFileSync(join(open, src, f)) });
  }
}
const decoded = tiles.map((t) => ({ t, img: decodeImage(t.bytes) }));

type Acc = Record<string, number>;
const acc: Record<number, Acc> = { 512: {}, 256: {} };
const add = (px: number, k: string, ms: number) => (acc[px][k] = (acc[px][k] ?? 0) + ms);
const count: Record<number, number> = { 512: 0, 256: 0 };

for (let r = 0; r < rounds; r++) {
  for (const { t, img } of decoded) {
    const px = t.px;
    let t0 = performance.now();
    noDataReason({ status: 200, bytes: t.bytes, pixels: img.rgba, width: img.width, height: img.height });
    let t1 = performance.now();
    add(px, 'no-data check', t1 - t0);
    const w = windowFromBitmap(t.tile, img.rgba, img.width, img.height, t.halo);
    const { width, height, pixels } = w;
    const n = width * height;
    t0 = performance.now();
    const hue = new Float32Array(n), sat = new Float32Array(n), val = new Float32Array(n);
    hsvInto(pixels, hue, sat, val);
    t1 = performance.now();
    add(px, 'hsv', t1 - t0);
    const gates = colourGates(pixels, hue, sat, val, CANDIDATE_LEVELS.map((l) => l.gate));
    t0 = performance.now();
    add(px, 'colour gates', t0 - t1);
    const cleaned = gates.map((g) => cleanMask(g, width, height));
    t1 = performance.now();
    add(px, 'morphology', t1 - t0);
    const labelled = cleaned.map((m) => labelComponents(m, width, height));
    t0 = performance.now();
    add(px, 'labelling', t0 - t1);
    // Features for every component with at least 10 px (an upper bound on the candidate stage's work).
    const ctx = { pixels, width, height, hue, sat, val, strictGate: gates[0], permissiveGate: gates[2], contextV: 0.5, contextS: 0.2 };
    const out = new Float64Array(FEATURE_COUNT);
    let nf = 0;
    for (let lv = 0; lv < labelled.length; lv++) {
      for (const c of labelled[lv].components) {
        if (c.pixelCount < 10) continue;
        const cx = c.sumX / c.pixelCount, cy = c.sumY / c.pixelCount;
        if (cx < t.halo || cy < t.halo || cx >= width - t.halo || cy >= height - t.halo) continue;
        componentFeatures(ctx, labelled[lv].labels, c, lv, 0.3, out);
        nf++;
      }
    }
    t1 = performance.now();
    add(px, 'features (all comps >= 10 px)', t1 - t0);
    add(px, 'components featured', nf);
    // The real pipeline, for the total and the scoring and output stages.
    const { frame, central } = windowFrame(w);
    t0 = performance.now();
    const analysis = imageCandidates(pixels, width, height, frame, central, DEFAULT_LEARNED_OPTIONS);
    t1 = performance.now();
    add(px, 'TOTAL candidate stage (analyseWindow)', t1 - t0);
    add(px, 'candidates', analysis.candidates.length);
    const fam = sourceFamily(t.providerId);
    for (const c of analysis.candidates) calibratedScore(model, fam, c.features);
    t0 = performance.now();
    add(px, 'model scoring', t0 - t1);
    const kept = selectCandidates(analysis, fam, model, DEFAULT_LEARNED_OPTIONS);
    for (const s of kept) toTileDetection(s, pixels, width, height, frame, analysis, DEFAULT_LEARNED_OPTIONS);
    t1 = performance.now();
    add(px, 'scoring + nms + outlines', t1 - t0);
    count[px]++;
  }
}
for (const px of [512, 256]) {
  console.log(`\n${px} px, mean per tile over ${count[px]} runs`);
  for (const [k, v] of Object.entries(acc[px])) console.log(`  ${(v / count[px]).toFixed(2).padStart(8)}  ${k}`);
}
