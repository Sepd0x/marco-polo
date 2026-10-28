// The numbers in README.md come from committed files: the results table from
// the benchmark reports, the before and after table with its counts from
// docs/media/braga-figure.json (written by packages/eval/src/figure.ts). This
// script rebuilds both blocks and fails when the README differs or runs past
// 650 words; `--write` puts the fresh blocks in place.
//
//   node scripts/check-readme.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';

const MAX_WORDS = 650;
const v1 = JSON.parse(readFileSync('packages/eval/results/v1/report.json', 'utf8'));
const v2 = JSON.parse(readFileSync('packages/eval/results/v2/report.json', 'utf8'));
const fig = JSON.parse(readFileSync('docs/media/braga-figure.json', 'utf8'));

const pct = (x) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(1));
const f1 = (g) => (g ? `${pct(g.scores.f1)}% [${pct(g.ci.f1.lo)}, ${pct(g.ci.f1.hi)}]` : 'not measured');

function resultsBlock() {
  const sets = [
    ['DEV', 'tuning zones, scored out of fold'],
    ['DEV-2', 'held out from tuning'],
    ['GOLD', 'proposed by earlier methods, reviewed one by one'],
    ['TEST', 'drawn by lot, labelled blind'],
  ];
  const rows = ['| zones | what they are | pools | v1 F1 | v2 F1 |', '|---|---|--:|--:|--:|'];
  const n = (g) => `${g.zones.length} ${g.zones.length === 1 ? 'zone' : 'zones'}`;
  for (const [key, what] of sets) {
    const a = v1.groups[key], b = v2.groups[key];
    if (!a && !b) continue;
    rows.push(`| ${key}, ${n(b ?? a)} | ${what} | ${(b ?? a).counts.labels} | ${f1(a)} | ${f1(b)} |`);
  }
  const neg = Object.keys(v2.groups).find((k) => k.startsWith('TEST negative'));
  if (neg && v1.groups[neg]) {
    rows.push(`| TEST, ${n(v2.groups[neg])} with no pools | false detections per km² | 0 | ${v1.groups[neg].fpPerKm2.toFixed(1)} | ${v2.groups[neg].fpPerKm2.toFixed(1)} |`);
  }
  const note = `F1 with its 95% interval (block bootstrap). Both versions on the same frozen labels (\`${v2.meta.labelsHash.slice(0, 12)}\`) and the product imagery of each zone; ${v1.meta.commit === v2.meta.commit ? `both run at ${v2.meta.commit}` : `v1 run at ${v1.meta.commit}, v2 at ${v2.meta.commit}`}, ${v2.meta.date}.`;
  return [rows.join('\n'), '', note].join('\n');
}

// The before and after table: one column per panel of braga-figure.json.
const PANELS = [
  { key: 'v1-esri', title: 'v1 on Esri, as it shipped', img: 'docs/media/braga-v1-esri.png', alt: 'v1 on Esri: one outline, on no pool' },
  { key: 'v1', title: 'v1 on DGT', img: 'docs/media/braga-v1.png', alt: 'v1 on DGT: most outlines on trees' },
  { key: 'v2', title: 'v2 on DGT', img: 'docs/media/braga-v2.png', alt: 'v2 on DGT: outlines on the pools' },
];

function figureBlock() {
  const cell = (p) => `${p.hits} found, ${p.falseDetections} wrong, ${p.missed} missed`;
  const row = (cells) => `| ${cells.join(' | ')} |`;
  return [
    row(PANELS.map((c) => c.title)),
    `|${PANELS.map(() => ':-:').join('|')}|`,
    row(PANELS.map((c) => `<img src="${c.img}" width="270" alt="${c.alt}">`)),
    row(PANELS.map((c) => cell(fig.panels[c.key]))),
  ].join('\n');
}

const BLOCKS = { results: resultsBlock(), figure: figureBlock() };

let readme = readFileSync('README.md', 'utf8');
let fresh = readme;
for (const [name, body] of Object.entries(BLOCKS)) {
  const re = new RegExp(`(<!-- ${name}: written by scripts/check-readme.mjs -->)[\\s\\S]*?(<!-- /${name} -->)`);
  if (!re.test(fresh)) {
    console.log(`README.md has no ${name} block`);
    process.exit(1);
  }
  fresh = fresh.replace(re, (_, a, b) => `${a}\n\n${body}\n\n${b}`);
}

// Words a reader sees: markup, links targets and comments left out.
const visible = fresh
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\]\([^)]*\)/g, ']')
  .replace(/^```.*$/gm, ' ');
const words = visible.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

if (process.argv.includes('--write')) {
  writeFileSync('README.md', fresh);
  console.log(`README.md blocks written (${words} words)`);
} else if (fresh !== readme) {
  console.log('README.md numbers differ from the committed files: run node scripts/check-readme.mjs --write');
  process.exit(1);
} else {
  console.log(`README.md numbers match the committed files (${words} words)`);
}
if (words > MAX_WORDS) {
  console.log(`README.md has ${words} words, the limit is ${MAX_WORDS}`);
  process.exit(1);
}
