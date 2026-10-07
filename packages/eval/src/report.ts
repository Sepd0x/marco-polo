import type { ZoneResult } from './evaluate.js';
import { scores, sumCounts, median } from './metrics.js';
import type { ScopedCounts } from './match.js';

export type Taxonomy = Record<string, { fp?: Record<string, string>; fn?: Record<string, string> }>;

export interface RunMeta {
  name: string;
  detector: string;
  detectorDescription: string;
  imagery: string;
  threshold: number;
  date: string;
  commit: string;
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

export function aggregate(results: ZoneResult[]) {
  const counts = sumCounts(results.map((r) => r.counts));
  const s = scores(counts);
  const areaKm2 = results.reduce((a, r) => a + r.areaKm2, 0);
  const ms = results.reduce((a, r) => a + r.computeMs, 0);
  const scanKm2 = results.reduce((a, r) => a + r.computeMs / r.msPerKm2, 0);
  const f1s = results.map((r) => r.scores.f1).filter((x): x is number => x !== null);
  const sweep = results[0]?.sweep.map((row, i) => {
    const c = sumCounts(results.map((r) => r.sweep[i].counts));
    return { threshold: row.threshold, counts: c, scores: scores(c) };
  }) ?? [];
  return {
    counts,
    scores: s,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    areaKm2,
    msPerKm2: scanKm2 > 0 ? ms / scanKm2 : null,
    medianAreaAbsRel: median(results.flatMap((r) => r.areaRel.map(Math.abs))),
    medianAreaSignedRel: median(results.flatMap((r) => r.areaRel)),
    sweep,
  };
}

export function taxonomyCounts(results: ZoneResult[], tax: Taxonomy) {
  const fp: Record<string, number> = {};
  const fn: Record<string, number> = {};
  let unreviewed = 0;
  for (const r of results) {
    const t = tax[r.zone] ?? {};
    for (const it of r.items) {
      // Keyed by item id (stable across label edits); the gallery number is a fallback.
      const book = it.kind === 'fp' ? t.fp : t.fn;
      const visual = book?.[it.id] ?? book?.[String(it.n)];
      const cat = it.auto === 'duplicate' ? 'duplicate (fragment of a matched pool)' : visual ?? null;
      if (!cat) {
        unreviewed++;
        continue;
      }
      const bucket = it.kind === 'fp' ? fp : fn;
      bucket[cat] = (bucket[cat] ?? 0) + 1;
    }
  }
  return { fp, fn, unreviewed };
}

function row(name: string, c: ScopedCounts, s: ReturnType<typeof scores>, extra: string[]) {
  return `| ${name} | ${c.labels} | ${c.dets} | ${c.tpLabels} | ${c.fp} | ${c.fn} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${extra.join(' | ')} |`;
}

export function markdownReport(meta: RunMeta, results: ZoneResult[], tax: Taxonomy | null): string {
  const L: string[] = [];
  L.push(`# Benchmark: ${meta.name}`);
  L.push('');
  L.push(`- detector: \`${meta.detector}\` (${meta.detectorDescription})`);
  L.push(`- confidence threshold: ${meta.threshold}`);
  L.push(`- imagery: \`${meta.imagery}\` at z19`);
  L.push(`- labels: OpenStreetMap \`leisure=swimming_pool\` (ODbL) plus hand-checked additions, see \`packages/eval/README.md\``);
  L.push(`- commit: ${meta.commit}, run ${meta.date}`);
  L.push('');
  L.push('A detection is a hit when its centre falls inside a label or its box overlaps the label box with IoU ≥ 0.3; each label is matched once. Precision is over detections, recall over labels. Area error compares the detected area with the OSM polygon area, over hits on OSM polygons only (points and hand-drawn labels have no trustworthy area); "signed" below zero means the detector under-measures. Time is detector CPU time per km² of scanned area, tiles already decoded.');
  L.push('');
  const head = '| area | labels | detections | TP | FP | FN | precision | recall | F1 | median area error | signed | ms/km² |';
  const sep = '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|';
  for (const split of ['dev', 'test'] as const) {
    const rs = results.filter((r) => r.split === split);
    if (!rs.length) continue;
    L.push(`## ${split.toUpperCase()}${split === 'test' ? ' (held out: never used for tuning)' : ''}`);
    L.push('');
    L.push(head);
    L.push(sep);
    for (const r of rs) {
      L.push(row(`${r.name} (${r.areaKm2.toFixed(2)} km²)`, r.counts, r.scores, [`${pct(r.area.medianAbsRel)} (n=${r.area.n})`, signed(r.area.medianSignedRel), r.msPerKm2.toFixed(0)]));
    }
    const a = aggregate(rs);
    L.push(row(`**all ${split}**`, a.counts, a.scores, [`${pct(a.medianAreaAbsRel)} (n=${rs.reduce((k, r) => k + r.areaRel.length, 0)})`, signed(a.medianAreaSignedRel), a.msPerKm2?.toFixed(0) ?? 'n/a']));
    L.push('');
    L.push(`Macro F1 (mean over areas): ${pct(a.macroF1)}.`);
    L.push('');
  }

  L.push('## Threshold sweep (micro-averaged)');
  L.push('');
  L.push('| threshold | DEV P | DEV R | DEV F1 | TEST P | TEST R | TEST F1 |');
  L.push('|--:|--:|--:|--:|--:|--:|--:|');
  const dev = aggregate(results.filter((r) => r.split === 'dev'));
  const test = aggregate(results.filter((r) => r.split === 'test'));
  for (let i = 0; i < dev.sweep.length; i++) {
    const d = dev.sweep[i], t = test.sweep[i];
    L.push(`| ${d.threshold.toFixed(2)} | ${pct(d.scores.precision)} | ${pct(d.scores.recall)} | ${pct(d.scores.f1)} | ${pct(t?.scores.precision ?? null)} | ${pct(t?.scores.recall ?? null)} | ${pct(t?.scores.f1 ?? null)} |`);
  }
  L.push('');

  L.push('## Labels per area');
  L.push('');
  L.push('"OSM coverage" is the share of pool labels OSM already had. Review "full": every window checked by eye and missed pools boxed by hand. Review "candidates": every unlabelled colour candidate checked plus a sample of windows, so pools no colour rule fires on can still be missing from the labels (recall there is an upper bound).');
  L.push('');
  L.push('| area | split | review | pool labels | OSM points | hand-added | OSM coverage | ignored | tiles |');
  L.push('|---|---|---|--:|--:|--:|--:|--:|--:|');
  for (const r of results) {
    const cov = r.labels.pool ? pct((r.labels.pool - r.labels.visual) / r.labels.pool) : 'n/a';
    L.push(`| ${r.name} | ${r.split} | ${r.review} | ${r.labels.pool} | ${r.labels.points} | ${r.labels.visual} | ${cov} | ${r.labels.ignore} | ${r.tiles}${r.tilesMissing ? ` (${r.tilesMissing} missing)` : ''} |`);
  }
  L.push('');

  L.push('## Errors, automatic split');
  L.push('');
  L.push('| area | FP unlabelled | FP duplicate | FN below threshold | FN partial overlap | FN not detected |');
  L.push('|---|--:|--:|--:|--:|--:|');
  for (const r of results) {
    const c = (k: string, a: string) => r.items.filter((i) => i.kind === k && i.auto === a).length;
    L.push(`| ${r.name} | ${c('fp', 'unlabelled')} | ${c('fp', 'duplicate')} | ${c('fn', 'below-threshold')} | ${c('fn', 'partial-overlap')} | ${c('fn', 'not-detected')} |`);
  }
  L.push('');

  const stageRows = new Map<string, Map<string, number>>();
  for (const r of results) {
    for (const i of r.items) {
      if (!i.stage) continue;
      const key = i.stage.replace(/ \[.*\]$/, '');
      const m = stageRows.get(key) ?? new Map<string, number>();
      m.set(r.split, (m.get(r.split) ?? 0) + 1);
      stageRows.set(key, m);
    }
  }
  if (stageRows.size) {
    L.push('## Where undetected pools were lost (core pipeline)');
    L.push('');
    L.push('For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.');
    L.push('');
    L.push('| stage | DEV | TEST |');
    L.push('|---|--:|--:|');
    for (const [k, m] of [...stageRows].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
      L.push(`| ${k} | ${m.get('dev') ?? 0} | ${m.get('test') ?? 0} |`);
    }
    L.push('');
  }

  if (tax) {
    const t = taxonomyCounts(results, tax);
    L.push('## Error taxonomy (by eye, from the galleries)');
    L.push('');
    const block = (title: string, m: Record<string, number>) => {
      L.push(`**${title}**`);
      L.push('');
      L.push('| category | count |');
      L.push('|---|--:|');
      for (const [k, v] of Object.entries(m).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
      L.push('');
    };
    block('False positives', t.fp);
    block('False negatives', t.fn);
    if (t.unreviewed) L.push(`${t.unreviewed} items not reviewed.`);
    L.push('');
  }
  return L.join('\n');
}
