// Self time per function of a .cpuprofile (Node --cpu-prof or Chromium CDP), largest first.
//   node tests/bench/summarise-profile.mjs <file.cpuprofile> [top]
import { readFileSync } from 'node:fs';

const [file, top = '30'] = process.argv.slice(2);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) {
  const n = byId.get(prof.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(top));
for (const [k, us] of rows) console.log(`${((100 * us) / total).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
console.log(`total ${(total / 1000).toFixed(0)} ms`);
