// Runs every check the project relies on, in order, and stops at the first
// failure. A step whose files do not exist yet is reported as pending and
// fails the run unless --allow-pending is passed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const allowPending = process.argv.includes('--allow-pending');

const steps = [
  { name: 'typecheck', cmd: 'npm run typecheck' },
  { name: 'unit tests', cmd: 'npm test' },
  {
    name: 'production build (/marco-polo/)',
    cmd: 'npm --workspace @marco-polo/web run build',
    env: { VITE_BASE: '/marco-polo/' },
  },
  { name: 'npm audit (production deps)', cmd: 'npm audit --omit=dev --audit-level=high' },
  { name: 'e2e on the production build', cmd: 'npm run e2e', needs: ['tests/e2e/playwright.config.ts'] },
  { name: 'JPEG decode parity', cmd: 'npm run parity', needs: ['tests/parity/playwright.config.ts'] },
  { name: 'worker bench', cmd: 'npm run bench', needs: ['tests/bench/playwright.config.ts'] },
  { name: 'repo text check', cmd: 'node scripts/check-text.mjs', needs: ['scripts/check-text.mjs'] },
  { name: 'README table matches report', cmd: 'node scripts/check-readme.mjs', needs: ['scripts/check-readme.mjs'] },
  { name: 'eval zones check', cmd: 'npm run eval -- zones check', needs: ['packages/eval/zones'] },
  { name: 'eval gate', cmd: 'npm run eval -- gate', needs: ['packages/eval/targets.json'] },
];

let pending = 0;
for (const s of steps) {
  const missing = (s.needs ?? []).filter((p) => !existsSync(p));
  if (missing.length) {
    pending++;
    console.log(`PENDING  ${s.name} (missing ${missing.join(', ')})`);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync(s.cmd, { shell: true, stdio: 'inherit', env: { ...process.env, ...s.env } });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.log(`FAIL     ${s.name} (${secs}s)`);
    process.exit(1);
  }
  console.log(`PASS     ${s.name} (${secs}s)`);
}

if (pending) {
  console.log(`${pending} step(s) pending`);
  if (!allowPending) process.exit(1);
}
