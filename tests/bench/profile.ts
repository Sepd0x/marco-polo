/*
 * Where the detection time goes, in Node, on the bench fixtures. Decodes
 * once with the CLI decoder (same pixels as the browser, see tests/parity),
 * then runs the product detector ROUNDS times per tile. With --cpu-prof the
 * profile can be summarised by tests/bench/summarise-profile.mjs.
 *
 *   npx tsx tests/bench/profile.ts [rounds]
 *   node --cpu-prof --cpu-prof-dir=<dir> --import tsx tests/bench/profile.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeImage } from '../../packages/cli/src/tiles.ts';
import { createV2Detector, noDataReason, windowFromBitmap, type PoolModel } from '../../packages/core/src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const model = JSON.parse(readFileSync(join(root, 'packages/core/models/pool-v2.json'), 'utf8')) as PoolModel;
const detector = createV2Detector(model);
const rounds = Number(process.argv[2] ?? 10);

interface Tile { name: string; tilePx: number; halo: number; providerId: string; z: number; x: number; y: number; bytes: Uint8Array }
const tiles: Tile[] = [];
const parity = join(root, 'tests/parity/fixtures');
for (const f of readdirSync(parity).filter((n) => n.endsWith('.jpg'))) {
  const m = /^(.*)-(\d+)-(\d+)-(\d+)\.jpg$/.exec(f)!;
  const providerId = f.startsWith('dgt-') ? 'dgt-ortos2025' : f.startsWith('ign-') ? 'ign-orthophotos' : 'pnoa';
  tiles.push({ name: f, tilePx: f.startsWith('dgt-') ? 512 : 256, halo: Number(/halo(\d+)/.exec(f)?.[1] ?? 0), providerId, z: +m[2], x: +m[3], y: +m[4], bytes: readFileSync(join(parity, f)) });
}
const open = join(root, 'packages/eval/fixtures/open/tiles');
for (const src of readdirSync(open)) {
  for (const f of readdirSync(join(open, src))) {
    const [z, x, y] = f.replace('.jpg', '').split('-').map(Number);
    const providerId = src === 'dgt' ? 'dgt-ortos2025' : src === 'ign' ? 'ign-orthophotos' : 'pnoa';
    tiles.push({ name: `${src}/${f}`, tilePx: 256, halo: 0, providerId, z, x, y, bytes: readFileSync(join(open, src, f)) });
  }
}
const decoded = tiles.map((t) => ({ t, img: decodeImage(t.bytes) }));

const times: Record<number, number[]> = { 512: [], 256: [] };
const noDataMs: number[] = [];
for (let r = 0; r < rounds; r++) {
  for (const { t, img } of decoded) {
    const t0 = performance.now();
    const nd = noDataReason({ status: 200, bytes: t.bytes, pixels: img.rgba, width: img.width, height: img.height });
    const t1 = performance.now();
    noDataMs.push(t1 - t0);
    if (nd) continue;
    const w = windowFromBitmap({ z: t.z, x: t.x, y: t.y }, img.rgba, img.width, img.height, t.halo);
    detector.detectTile(w, { providerId: t.providerId });
    times[t.tilePx].push(performance.now() - t1);
  }
}
const pct = (v: number[], p: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
for (const px of [512, 256]) {
  const v = times[px];
  console.log(`${px} px detect: n=${v.length} p50=${pct(v, 50).toFixed(1)} p95=${pct(v, 95).toFixed(1)} ms`);
}
console.log(`no-data check: p50=${pct(noDataMs, 50).toFixed(2)} p95=${pct(noDataMs, 95).toFixed(2)} ms`);
