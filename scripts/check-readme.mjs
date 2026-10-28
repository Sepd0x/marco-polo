// The detection numbers in README.md come from committed files: the benchmark
// reports in packages/eval/results, the large-pool runs, and the figure
// counts in docs/media/<zone>-figure.json (written by
// packages/eval/src/figure.ts). This script rebuilds every generated block
// and fails when the README differs or runs past 650 words; `--write` puts
// the fresh blocks in place.
//
//   node scripts/check-readme.mjs [--write]
//
// When a new model is frozen and scored, point CURRENT at its report, the v1
// report of the same round, its TEST run, the number of targets that run
// missed (from `eval gate`) and its large-pool run; move the old one to
// PREVIOUS; draw the figure again. Every block follows.
import { readFileSync, writeFileSync } from 'node:fs';

const MAX_WORDS = 650;
const R = 'packages/eval/results';
const CURRENT = { name: 'v3', report: `${R}/v3/report.json`, v1: `${R}/v3/v1/report.json`, testRun: `${R}/TEST_RUN_2.md`, missed: 2, large: `${R}/v3/large/v3.json` };
const PREVIOUS = { name: 'v2', report: `${R}/v2/report.json`, testRun: `${R}/TEST_RUN_1.md`, large: `${R}/v3/large/v2-model.json` };
const V1_LARGE = `${R}/v3/large/v1.json`;
const FIGURE = 'docs/media/marbella-figure.json';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const v1 = read(CURRENT.v1);
const v1esri = read(`${R}/v1/esri/report.json`);
const cur = read(CURRENT.report);
const prev = read(PREVIOUS.report);
const fig = read(FIGURE);
const targets = read('packages/eval/targets.json').targets;
const NOW = CURRENT.name, PREV = PREVIOUS.name;

const pct = (x) => (x === null || x === undefined ? 'n/a' : (100 * x).toFixed(1));
const whole = (x) => pct(x).replace(/\.0$/, '');
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
const negativeOf = (r) => groupBy(r, (k) => k.startsWith('TEST negative'));
const hardOf = (r) => groupBy(r, (k) => k.startsWith('TEST hard'));
const testZones = cur.groups.TEST.zones.map((id) => zone(cur, id)).sort((a, b) => b.scores.f1 - a.scores.f1);
const biggest = testZones.reduce((a, b) => (b.counts.labels > a.counts.labels ? b : a));
const hard = hardOf(cur), hardV1 = hardOf(v1);
const hardZone = hard && zone(cur, hard.zones[0]);
const large = (p) => {
  const s = Object.values(read(p).bySource);
  return { found: s.reduce((n, x) => n + x.hits, 0), of: s.reduce((n, x) => n + x.labels, 0) };
};
const L = { v1: large(V1_LARGE), prev: large(PREVIOUS.large), cur: large(CURRENT.large) };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => WORDS[n] ?? String(n);
const date = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function headlineBlock() {
  const t = cur.groups.TEST;
  return `On ${count(t.zones.length)} places drawn by lot and labelled blind, ${NOW} scores F1 ${f1(t)} against ${pct(v1.groups.TEST.scores.f1)}% for v1. It misses ${count(CURRENT.missed)} of the ${count(Object.keys(targets).length)} targets fixed before the first run; see [Limits](#limits).`;
}

// F1 of a figure panel from its counts, to say whether the crop flatters.
const cropF1 = (p) => (2 * p.hits) / (2 * p.hits + p.falseDetections + p.missed);
const gapWord = (crop, all) => (all < crop - 0.02 ? 'narrower' : all > crop + 0.02 ? 'wider' : 'about the same');

function figureBlock() {
  const a = fig.panels.v1, b = fig.panels[NOW];
  if (!b) throw new Error(`${FIGURE} has no ${NOW} panel: draw it with --name ${NOW}`);
  const z1 = zone(v1, fig.zone), z2 = zone(cur, fig.zone);
  const cell = (p) => `${p.hits} found, ${p.falseDetections} wrong, ${p.missed} missed`;
  const src = fig.sourceName.split(' ')[0];
  const role = { 'DEV-2': 'a held-out zone', DEV: 'a tuning zone, so it flatters' }[fig.role] ?? fig.role;
  return [
    `${place(z2)}, ${src} aerial photo, ${fig.sizeM} m across, ${role}.`,
    '',
    `| v1 | ${NOW}, current |`,
    '|:-:|:-:|',
    `| <img src="docs/media/${fig.zone}-v1.jpg" width="440" alt="v1 on the ${src} photo: half the pools have no outline"> | <img src="docs/media/${fig.zone}-${NOW}.jpg" width="440" alt="${NOW} on the ${src} photo: outlines on most pools"> |`,
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
  const rows = [`| zones | pools | v1 F1 | ${NOW} F1 |`, '|---|--:|--:|--:|'];
  for (const [key, label] of sets) {
    const a = v1.groups[key], b = cur.groups[key];
    if (!a && !b) continue;
    rows.push(`| ${label} (${key}) | ${(b ?? a).counts.labels} | ${f1(a)} | ${f1(b)} |`);
  }
  const neg = negativeOf(cur), negV1 = negativeOf(v1);
  if (neg && negV1) {
    rows.push(`| Test, no pools: false detections per km² | 0 | ${negV1.fpPerKm2.toFixed(1)} | ${neg.fpPerKm2.toFixed(1)} |`);
  }
  const when = v1.meta.date === cur.meta.date ? `both run on ${date(cur.meta.date)}` : `v1 run on ${date(v1.meta.date)}, ${NOW} on ${date(cur.meta.date)}`;
  const note = `F1 with its 95% interval; same labels and imagery for both, ${when} ([method](packages/eval/README.md), [TEST run](${CURRENT.testRun})).`;
  return [rows.join('\n'), '', note].join('\n');
}

function notesBlock() {
  const t = cur.groups.TEST, p = prev.groups.TEST;
  const d = v1esri.groups;
  const why = t.scores.f1 > cur.groups.DEV.scores.f1 ? `TEST beats tuning because F1 is counted over pools and ${place(biggest)} holds ${biggest.counts.labels} of the ${t.counts.labels}.` : `F1 is counted over pools, and ${place(biggest)} holds ${biggest.counts.labels} of the ${t.counts.labels} TEST pools.`;
  const lo = testZones[testZones.length - 1];
  const lines = [`${why} Per place it runs from ${pct(lo.scores.f1)}% (${place(lo)}) to ${pct(testZones[0].scores.f1)}% (${place(testZones[0])}), mean ${pct(t.macroF1)}%.`];
  // Against the model before: F1 counts as unchanged when each lies inside the other's interval.
  const sameF1 = t.scores.f1 >= p.ci.f1.lo && t.scores.f1 <= p.ci.f1.hi && p.scores.f1 >= t.ci.f1.lo && p.scores.f1 <= t.ci.f1.hi;
  const neg = negativeOf(cur), negPrev = negativeOf(prev);
  lines.push('', `Against ${PREV}, the [previous model](${PREVIOUS.testRun}), ${NOW} ${sameF1 ? 'gives up no F1' : `moves F1`} (${pct(p.scores.f1)}% to ${pct(t.scores.f1)}%) for better areas (median error ${pct(p.medianAreaAbsRel)}% to ${pct(t.medianAreaAbsRel)}%) and large pools (${L.prev.found} to ${L.cur.found} of ${L.cur.of} pools of 400 m² or more${L.v1.found > L.cur.found ? `, where v1 still finds ${L.v1.found}` : ''}), with ${neg.fpPerKm2 > negPrev.fpPerKm2 ? 'more' : 'fewer'} false detections in the zone with no pools (${negPrev.fpPerKm2.toFixed(0)} to ${neg.fpPerKm2.toFixed(0)} per km²).`);
  if (hardZone) {
    lines.push('', `Reported apart: ${place(hardZone)}, winter Esri imagery in the Alps, where ${NOW} finds ${hard.counts.tpLabels} of ${hard.counts.labels} pools${hardV1.scores.f1 > hard.scores.f1 ? ' and v1 does better' : ''}.`);
  }
  lines.push('', `v1 was built for Esri: ${pct(d.DEV.scores.f1)}% on tuning and ${pct(d['DEV-2'].scores.f1)}% held out there (older labels). On the open photos tree canopy passes its colour rules.`);
  return lines.join('\n');
}

function limitsBlock() {
  const t = cur.groups.TEST;
  const neg = negativeOf(cur), negV1 = negativeOf(v1);
  const absMet = t.medianAreaAbsRel <= targets.P5;
  return [
    `- ${t.medianAreaSignedRel < 0 ? 'Areas still come out small' : 'Areas'}: signed median error ${signed(t.medianAreaSignedRel)} on TEST, target within ${whole(targets.P6)}%. The median error (${pct(t.medianAreaAbsRel)}%, ${t.areaPairs} outlines) ${absMet ? 'meets' : 'misses'} its ${whole(targets.P5)}% target.`,
    neg && negV1 ? `- The test zone with no pools is a port: ${neg.fpPerKm2.toFixed(0)} false detections per km², against ${negV1.fpPerKm2.toFixed(0)} for v1.` : null,
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
