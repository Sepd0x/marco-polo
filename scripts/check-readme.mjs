// The detection numbers in README.md come from committed files: the benchmark
// reports in packages/eval/results and the figure counts in
// docs/media/<zone>-figure.json (written by packages/eval/src/figure.ts).
// This script rebuilds every generated block and fails when the README
// differs or runs past 650 words; `--write` puts the fresh blocks in place.
//
//   node scripts/check-readme.mjs [--write]
//
// When a new model is frozen and scored, point CURRENT at its report, its
// TEST run and the number of targets that run missed (from `eval gate`), and
// FIGURE at the figure drawn with it; every block follows.
import { readFileSync, writeFileSync } from 'node:fs';

const MAX_WORDS = 650;
const CURRENT = { name: 'v2', report: 'packages/eval/results/v2/report.json', testRun: 'packages/eval/results/TEST_RUN_1.md', missed: 3 };
const FIGURE = 'docs/media/marbella-figure.json';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const v1 = read('packages/eval/results/v1/report.json');
const v1esri = read('packages/eval/results/v1/esri/report.json');
const cur = read(CURRENT.report);
const fig = read(FIGURE);
const targets = read('packages/eval/targets.json').targets;
const NOW = CURRENT.name;

const pct = (x) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(1));
const ci = (g) => `[${pct(g.ci.f1.lo)}, ${pct(g.ci.f1.hi)}]`;
const f1 = (g) => (g ? `${pct(g.scores.f1)}% ${ci(g)}` : 'not measured');
const signed = (x) => `${x < 0 ? '-' : '+'}${pct(Math.abs(x))}%`;
const zone = (r, id) => r.zones.find((z) => z.zone === id);
const SHORT = { 'la Nucia': 'La Nucía', 'Santa Fe Springs city': 'Santa Fe Springs', 'Brixen - Bressanone': 'Brixen' };
const place = (z) => {
  const first = z.name.split(',')[0];
  return SHORT[first] ?? first;
};
const groupBy = (r, pred) => Object.entries(r.groups).find(([k]) => pred(k))?.[1];
const testZones = cur.groups.TEST.zones.map((id) => zone(cur, id)).sort((a, b) => b.scores.f1 - a.scores.f1);
const biggest = testZones.reduce((a, b) => (b.counts.labels > a.counts.labels ? b : a));
const negative = groupBy(cur, (k) => k.startsWith('TEST negative'));
const negativeV1 = groupBy(v1, (k) => k.startsWith('TEST negative'));
const hard = groupBy(cur, (k) => k.startsWith('TEST hard'));
const hardV1 = groupBy(v1, (k) => k.startsWith('TEST hard'));
const hardZone = hard && zone(cur, hard.zones[0]);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => WORDS[n] ?? String(n);
const date = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function headlineBlock() {
  const t = cur.groups.TEST;
  return `On ${count(t.zones.length)} places drawn by lot and labelled blind, ${NOW} scores F1 ${f1(t)} against ${pct(v1.groups.TEST.scores.f1)}% for v1. It misses ${count(CURRENT.missed)} of the ${count(Object.keys(targets).length)} targets fixed before [that run](${CURRENT.testRun}); see [Limits](#limits).`;
}

// F1 of a figure panel from its counts, to say whether the crop flatters.
const cropF1 = (p) => (2 * p.hits) / (2 * p.hits + p.falseDetections + p.missed);
const gapWord = (crop, whole) => (whole < crop - 0.02 ? 'narrower' : whole > crop + 0.02 ? 'wider' : 'about the same');

function figureBlock() {
  const a = fig.panels.v1, b = fig.panels.v2;
  const z1 = zone(v1, fig.zone), z2 = zone(cur, fig.zone);
  const cell = (p) => `${p.hits} found, ${p.falseDetections} wrong, ${p.missed} missed`;
  const src = fig.sourceName.split(' ')[0];
  const role = { 'DEV-2': 'a held-out zone, never used to tune', DEV: 'a tuning zone, so it flatters' }[fig.role] ?? fig.role;
  return [
    `${place(z2)}, ${src} aerial photo, ${fig.sizeM} m across: ${role}.`,
    '',
    `| v1 | ${NOW} |`,
    '|:-:|:-:|',
    `| <img src="docs/media/${fig.zone}-v1.jpg" width="440" alt="v1 on the ${src} photo: half the pools have no outline"> | <img src="docs/media/${fig.zone}-v2.jpg" width="440" alt="${NOW} on the ${src} photo: outlines on most pools"> |`,
    `| ${cell(a)} | ${cell(b)} |`,
    '',
    `Over the whole zone the gap is ${gapWord(cropF1(b) - cropF1(a), z2.scores.f1 - z1.scores.f1)}: v1 ${pct(z1.scores.f1)}%, ${NOW} ${pct(z2.scores.f1)}%.`,
  ].join('\n');
}

function resultsBlock() {
  const sets = [
    ['DEV', 'Tuning'],
    ['DEV-2', 'Held out'],
    ['GOLD', 'Reviewed'],
    ['TEST', 'Test'],
  ];
  const rows = [`| zones | n | pools | v1 F1 | ${NOW} F1 |`, '|---|--:|--:|--:|--:|'];
  for (const [key, label] of sets) {
    const a = v1.groups[key], b = cur.groups[key];
    if (!a && !b) continue;
    rows.push(`| ${label} (${key}) | ${(b ?? a).zones.length} | ${(b ?? a).counts.labels} | ${f1(a)} | ${f1(b)} |`);
  }
  if (negative && negativeV1) {
    rows.push(`| Test, no pools: false detections per km² | ${negative.zones.length} | 0 | ${negativeV1.fpPerKm2.toFixed(1)} | ${negative.fpPerKm2.toFixed(1)} |`);
  }
  const when = v1.meta.commit === cur.meta.commit ? `both run at ${cur.meta.commit} on ${date(cur.meta.date)}` : `v1 run at ${v1.meta.commit}, ${NOW} at ${cur.meta.commit} on ${date(cur.meta.date)}`;
  const note = `F1 with its 95% interval; same labels and imagery for both, ${when}.`;
  return [rows.join('\n'), '', note].join('\n');
}

function notesBlock() {
  const t = cur.groups.TEST;
  const per = testZones.map((z) => `${place(z)} ${pct(z.scores.f1)}%`).join(', ');
  const d = v1esri.groups;
  const why = t.scores.f1 > cur.groups.DEV.scores.f1 ? `TEST beats tuning because F1 is counted over pools and ${place(biggest)} holds ${biggest.counts.labels} of the ${t.counts.labels}.` : `F1 is counted over pools, and ${place(biggest)} holds ${biggest.counts.labels} of the ${t.counts.labels} TEST pools.`;
  const lines = [`${why} Per place: ${per}; mean ${pct(t.macroF1)}%.`];
  if (hardZone) {
    lines.push('', `Reported apart: ${place(hardZone)}, winter Esri imagery in the Alps, where ${NOW} finds ${hard.counts.tpLabels} of ${hard.counts.labels} pools and v1 does better.`);
  }
  lines.push('', `v1 was built for Esri, where it scored ${pct(d.DEV.scores.f1)}% on tuning and ${pct(d['DEV-2'].scores.f1)}% held out (older labels). On the open photos tree canopy passes its colour rules; ${NOW} is what made them usable.`);
  return lines.join('\n');
}

function limitsBlock() {
  const t = cur.groups.TEST;
  const fr = testZones.reduce((a, b) => (b.scores.recall < a.scores.recall ? b : a));
  return [
    `- ${t.medianAreaSignedRel < 0 ? 'Areas come out small' : 'Areas'}: median error ${pct(t.medianAreaAbsRel)}% on TEST over ${t.areaPairs} outlines (target ${pct(targets.P5).replace(/\.0$/, '')}%), signed ${signed(t.medianAreaSignedRel)} (target within ${pct(targets.P6).replace(/\.0$/, '')}%).`,
    negative && negativeV1 ? `- In the test zone with no pools, a port, ${negative.fpPerKm2.toFixed(0)} false detections per km² (v1: ${negativeV1.fpPerKm2.toFixed(0)}).` : null,
    `- Recall is uneven: ${pct(fr.scores.recall).replace(/\.0$/, '')}% in ${place(fr)}.`,
  ].filter(Boolean).join('\n');
}

const BLOCKS = { headline: headlineBlock(), figure: figureBlock(), results: resultsBlock(), notes: notesBlock(), limits: limitsBlock() };

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

// Words a reader sees: markup, link targets and comments left out.
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
