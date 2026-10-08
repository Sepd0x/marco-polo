import { cpus } from 'node:os';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/*
 * Targets fixed before measuring (plan 3.3): at 5 requests per second a
 * worker has 200 ms per request, so p95 per 512 px request with halo
 * <= 150 ms and per 256 px tile with halo <= 50 ms, timed inside the worker
 * (decode, no-data check, detection, thumbnails). On CI, another machine,
 * the run fails only above twice the target.
 */
const TARGET_MS = { 512: 150, 256: 50 } as const;
const SLACK = process.env.CI ? 2 : 1;
const ROUNDS = 10;

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = join(root, 'apps/web/dist/assets');
const workerFile = readdirSync(assets).find((f) => /^detect\.worker-.*\.js$/.test(f));

interface Sample {
  name: string;
  tile: { z: number; x: number; y: number };
  tilePx: number;
  providerId: string;
  b64: string;
}

function samples(): Sample[] {
  const out: Sample[] = [];
  // Real 512 px DGT requests (z18 grid) and 256 px tiles of the three open sources.
  const parity = join(root, 'tests/parity/fixtures');
  for (const f of readdirSync(parity).filter((n) => n.endsWith('.jpg'))) {
    const m = /^(.*)-(\d+)-(\d+)-(\d+)\.jpg$/.exec(f)!;
    const tilePx = f.startsWith('dgt-') ? 512 : 256;
    const providerId = f.startsWith('dgt-') ? 'dgt-ortos2025' : f.startsWith('ign-') ? 'ign-orthophotos' : 'pnoa';
    out.push({ name: f, tile: { z: +m[2], x: +m[3], y: +m[4] }, tilePx, providerId, b64: readFileSync(join(parity, f)).toString('base64') });
  }
  const open = join(root, 'packages/eval/fixtures/open/tiles');
  for (const src of readdirSync(open)) {
    for (const f of readdirSync(join(open, src))) {
      const [z, x, y] = f.replace('.jpg', '').split('-').map(Number);
      const providerId = src === 'dgt' ? 'dgt-ortos2025' : src === 'ign' ? 'ign-orthophotos' : 'pnoa';
      out.push({ name: `${src}/${f}`, tile: { z, x, y }, tilePx: 256, providerId, b64: readFileSync(join(open, src, f)).toString('base64') });
    }
  }
  return out;
}

function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

test('detection worker time per tile', async ({ page, browserName }, info) => {
  expect(workerFile, 'build the app first: VITE_BASE=/marco-polo/ npm run build').toBeTruthy();
  // A same-origin document without the map, so nothing is fetched from the internet.
  const workerUrl = new URL(`assets/${workerFile}`, info.project.use.baseURL).href;
  await page.goto(workerUrl);
  const list = samples();
  const result = await page.evaluate(
    async ({ url, list, rounds }) => {
      const worker = new Worker(url, { type: 'module' });
      let seq = 0;
      const run = (s: (typeof list)[number]) =>
        new Promise<{ ms: number; rtt: number; error?: string; noData: unknown; pieces: number }>((resolve) => {
          const bytes = Uint8Array.from(atob(s.b64), (c) => c.charCodeAt(0));
          const id = ++seq;
          const t0 = performance.now();
          worker.onmessage = (e) => {
            const r = e.data;
            resolve({ ms: r.ms, rtt: performance.now() - t0, error: r.error, noData: r.noData, pieces: r.pieces.length });
          };
          worker.postMessage(
            { id, scanId: 'bench', providerId: s.providerId, tile: s.tile, tilePx: s.tilePx, halo: 0, bytes: bytes.buffer, thumbs: true },
            [bytes.buffer],
          );
        });
      // Warm-up: module load and first decode.
      for (const s of list.slice(0, 3)) await run(s);
      const rows: { name: string; tilePx: number; ms: number; rtt: number; error?: string }[] = [];
      for (let r = 0; r < rounds; r++) {
        for (const s of list) {
          const x = await run(s);
          rows.push({ name: s.name, tilePx: s.tilePx, ms: x.ms, rtt: x.rtt, error: x.error });
        }
      }
      worker.terminate();
      return { rows, ua: navigator.userAgent };
    },
    { url: workerUrl, list, rounds: ROUNDS },
  );

  const errors = result.rows.filter((r) => r.error);
  expect(errors, JSON.stringify(errors.slice(0, 3))).toHaveLength(0);
  const report: Record<string, unknown> = { browser: browserName, userAgent: result.ua, cpu: cpus()[0]?.model, rounds: ROUNDS, ci: !!process.env.CI };
  for (const px of [512, 256] as const) {
    const ms = result.rows.filter((r) => r.tilePx === px).map((r) => r.ms);
    const rtt = result.rows.filter((r) => r.tilePx === px).map((r) => r.rtt);
    report[`px${px}`] = {
      samples: ms.length,
      p50: +pct(ms, 50).toFixed(1),
      p95: +pct(ms, 95).toFixed(1),
      max: +Math.max(...ms).toFixed(1),
      roundTripP95: +pct(rtt, 95).toFixed(1),
      targetP95: TARGET_MS[px] * SLACK,
    };
  }
  writeFileSync(info.outputPath(`bench-${browserName}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  for (const px of [512, 256] as const) {
    const r = report[`px${px}`] as { p95: number; targetP95: number };
    expect(r.p95, `${browserName} p95 at ${px} px`).toBeLessThanOrEqual(r.targetP95);
  }
});
