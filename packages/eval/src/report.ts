import type { ZoneResult } from './evaluate.js';
import { scores, sumCounts, median } from './metrics.js';
import type { ScopedCounts } from './match.js';
import { bootstrapCI, BOOT, METRICS, type Interval } from './bootstrap.js';

export type Taxonomy = Record<string, { fp?: Record<string, string>; fn?: Record<string, string> }>;

export interface RunMeta {
  name: string;
  detector: string;
  detectorDescription: string;
  /** sha256 over the detection code and model (see detectorHash). */
  detectorHash: string;
  /** `--source` as given (`auto` = each zone's product source). */
  source: string;
  threshold: number;
  matchRule: 'v1' | 'v2';
  /** sha256 of the frozen label entries of the zones in this run. */
  labelsHash: string;
  /** sha256 over the sorted tile manifest (every image read, by URL). */
  tilesHash: string;
  tilesRead: number;
  bootstrap: typeof BOOT;
  date: string;
  commit: string;
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const ci = (i: Interval | undefined) => (!i || i.lo === null || i.hi === null ? '' : ` [${(i.lo * 100).toFixed(1)}, ${(i.hi * 100).toFixed(1)}]`);

export interface GroupSummary {
  zones: string[];
  counts: ScopedCounts;
  scores: ReturnType<typeof scores>;
  ci: Record<'precision' | 'recall' | 'f1' | 'errors' | 'medianAreaAbsRel' | 'medianAreaSignedRel', Interval>;
  macroF1: number | null;
  areaKm2: number;
  fpPerKm2: number;
  msPerKm2: number | null;
  medianAreaAbsRel: number | null;
  medianAreaSignedRel: number | null;
  areaPairs: number;
  medianCenterOffsetM: number | null;
  medianLengthErr: number | null;
  medianWidthErr: number | null;
  dimsPairs: number;
  sweep: Array<{ threshold: number; counts: ScopedCounts; scores: ReturnType<typeof scores> }>;
}

export function aggregate(results: ZoneResult[]): GroupSummary {
  const counts = sumCounts(results.map((r) => r.counts));
  const s = scores(counts);
  const areaKm2 = results.reduce((a, r) => a + r.areaKm2, 0);
  const ms = results.reduce((a, r) => a + r.computeMs, 0);
  const scanKm2 = results.reduce((a, r) => a + (r.msPerKm2 > 0 ? r.computeMs / r.msPerKm2 : 0), 0);
  const f1s = results.map((r) => r.scores.f1).filter((x): x is number => x !== null);
  const sweep =
    results[0]?.sweep.map((row, i) => {
      const c = sumCounts(results.map((r) => r.sweep[i].counts));
      return { threshold: row.threshold, counts: c, scores: scores(c) };
    }) ?? [];
  const blocks = results.map((r) => r.blocks);
  const intervals = Object.fromEntries(
    (['precision', 'recall', 'f1', 'errors', 'medianAreaAbsRel', 'medianAreaSignedRel'] as const).map((k) => [k, bootstrapCI(blocks, METRICS[k])]),
  ) as GroupSummary['ci'];
  const pairs = results.flatMap((r) => r.pairs);
  const dims = pairs.filter((p) => p.labelDims && p.detDims);
  return {
    zones: results.map((r) => r.zone),
    counts,
    scores: s,
    ci: intervals,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    areaKm2,
    fpPerKm2: areaKm2 > 0 ? counts.fp / areaKm2 : 0,
    msPerKm2: scanKm2 > 0 ? ms / scanKm2 : null,
    medianAreaAbsRel: median(results.flatMap((r) => r.areaRel.map(Math.abs))),
    medianAreaSignedRel: median(results.flatMap((r) => r.areaRel)),
    areaPairs: results.reduce((k, r) => k + r.areaRel.length, 0),
    medianCenterOffsetM: median(pairs.map((p) => p.centerOffsetM)),
    medianLengthErr: median(dims.map((p) => Math.abs(p.detDims!.lengthM - p.labelDims!.lengthM) / p.labelDims!.lengthM)),
    medianWidthErr: median(dims.map((p) => Math.abs(p.detDims!.widthM - p.labelDims!.widthM) / p.labelDims!.widthM)),
    dimsPairs: dims.length,
    sweep,
  };
}

/**
 * Report groups. Strata reported apart (negative, hard imagery) never enter
 * the role totals; each has its own line.
 */
export function groups(results: ZoneResult[]): Record<string, ZoneResult[]> {
  const out: Record<string, ZoneResult[]> = {};
  const add = (k: string, r: ZoneResult) => (out[k] ??= []).push(r);
  for (const r of results) {
    if (r.reportedApart) add(`${r.role} ${r.stratum ?? r.zone} (apart)`, r);
    else add(r.role, r);
    if (r.role === 'TEST' && r.stratum && !r.reportedApart) add(`TEST ${r.stratum}`, r);
  }
  return out;
}

function row(name: string, c: ScopedCounts, s: ReturnType<typeof scores>, extra: string[]) {
  return `| ${name} | ${c.labels} | ${c.dets} | ${c.tpLabels} | ${c.fp} | ${c.fn} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${extra.join(' | ')} |`;
}

export function markdownReport(meta: RunMeta, results: ZoneResult[], tax: Taxonomy | null): string {
  const L: string[] = [];
  L.push(`# Benchmark: ${meta.name}`);
  L.push('');
  L.push(`- detector: \`${meta.detector}\` (${meta.detectorDescription}), hash \`${meta.detectorHash.slice(0, 12)}\``);
  L.push(`- confidence threshold: ${meta.threshold}`);
  L.push(`- imagery: \`--source ${meta.source}\` (per zone below), z19 grid; ${meta.tilesRead} images read, manifest \`${meta.tilesHash.slice(0, 12)}\``);
  L.push(`- labels: frozen set \`${meta.labelsHash.slice(0, 12)}\`, see \`packages/eval/README.md\`; point rule ${meta.matchRule}`);
  L.push(`- commit: ${meta.commit}, run ${meta.date}`);
  L.push('');
  L.push(
    'A detection hits a polygon label when its centre falls inside it or the two boxes overlap with IoU >= 0.3. ' +
      (meta.matchRule === 'v2'
        ? 'It hits a point label when its centre is within max(3 m, half the long side of its box) of the point and its area is at most max(4 x the median pool label of the zone, 150 m²). '
        : 'It hits a point label when its centre is within 5 m of the point or the point falls inside its outline (phase 0 rule). ') +
      'Each label is matched once. Precision is over detections, recall over labels. ' +
      `Brackets: 95% interval, block bootstrap (${meta.bootstrap.blockTiles} x ${meta.bootstrap.blockTiles} z${meta.bootstrap.zoom} tiles, ${meta.bootstrap.replicates} replicates, seed ${meta.bootstrap.seed}). ` +
      'Area error compares the detected area with the OSM polygon, over hits on OSM polygons only; "signed" below zero means the detector under-measures. Time is detector CPU time per km², tiles already decoded.',
  );
  L.push('');
  const head = '| area | labels | detections | TP | FP | FN | precision | recall | F1 | source | median area error | signed | ms/km² |';
  const sep = '|---|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|';
  const g = groups(results);
  for (const [name, rs] of Object.entries(g)) {
    if (name.startsWith('TEST ') && !name.includes('(apart)')) continue;
    L.push(`## ${name}${name === 'TEST' ? ' (held out: never used for tuning)' : ''}`);
    L.push('');
    L.push(head);
    L.push(sep);
    for (const r of rs) {
      L.push(row(`${r.name} (${r.areaKm2.toFixed(2)} km²)`, r.counts, r.scores, [r.source, `${pct(r.area.medianAbsRel)} (n=${r.area.n})`, signed(r.area.medianSignedRel), r.msPerKm2.toFixed(0)]));
    }
    const a = aggregate(rs);
    L.push(row(`**all ${name}**`, a.counts, a.scores, ['', `${pct(a.medianAreaAbsRel)} (n=${a.areaPairs})`, signed(a.medianAreaSignedRel), a.msPerKm2?.toFixed(0) ?? 'n/a']));
    L.push('');
    L.push(
      `Precision ${pct(a.scores.precision)}${ci(a.ci.precision)}, recall ${pct(a.scores.recall)}${ci(a.ci.recall)}, F1 ${pct(a.scores.f1)}${ci(a.ci.f1)}. ` +
        `Errors (FP + FN) ${a.counts.fp + a.counts.fn} [${a.ci.errors.lo ?? 'n/a'}, ${a.ci.errors.hi ?? 'n/a'}]. ` +
        `FP per km² ${a.fpPerKm2.toFixed(1)}. Macro F1 ${pct(a.macroF1)}.`,
    );
    L.push('');
    L.push(
      `Median area error ${pct(a.medianAreaAbsRel)}${ci(a.ci.medianAreaAbsRel)}, signed ${signed(a.medianAreaSignedRel)}${ci(a.ci.medianAreaSignedRel)} (n=${a.areaPairs}). ` +
        `Centre offset median ${a.medianCenterOffsetM === null ? 'n/a' : `${a.medianCenterOffsetM.toFixed(2)} m`}. ` +
        `Length and width error (minimum-area rectangle of the outline against the OSM outline): ${pct(a.medianLengthErr)} and ${pct(a.medianWidthErr)} (n=${a.dimsPairs}).`,
    );
    L.push('');
  }

  const testStrata = Object.entries(g).filter(([k]) => k.startsWith('TEST ') && !k.includes('(apart)'));
  if (testStrata.length) {
    L.push('## TEST by stratum');
    L.push('');
    L.push('| stratum | labels | TP | FP | FN | precision | recall | F1 |');
    L.push('|---|--:|--:|--:|--:|--:|--:|--:|');
    for (const [k, rs] of testStrata) {
      const a = aggregate(rs);
      L.push(`| ${k.slice(5)} | ${a.counts.labels} | ${a.counts.tpLabels} | ${a.counts.fp} | ${a.counts.fn} | ${pct(a.scores.precision)} | ${pct(a.scores.recall)} | ${pct(a.scores.f1)}${ci(a.ci.f1)} |`);
    }
    L.push('');
  }

  const main = Object.entries(g).filter(([k]) => !k.startsWith('TEST ') && !k.includes('(apart)'));
  if (main.length) {
    L.push('## Threshold sweep (micro-averaged)');
    L.push('');
    L.push(`| threshold | ${main.map(([k]) => `${k} P | ${k} R | ${k} F1`).join(' | ')} |`);
    L.push(`|--:|${main.map(() => '--:|--:|--:').join('|')}|`);
    const sums = main.map(([, rs]) => aggregate(rs));
    for (let i = 0; i < (sums[0]?.sweep.length ?? 0); i++) {
      L.push(`| ${sums[0].sweep[i].threshold.toFixed(2)} | ${sums.map((a) => `${pct(a.sweep[i].scores.precision)} | ${pct(a.sweep[i].scores.recall)} | ${pct(a.sweep[i].scores.f1)}`).join(' | ')} |`);
    }
    L.push('');
  }

  L.push('## Labels per area');
  L.push('');
  L.push(
    'Review "full": every window checked by eye and missed pools boxed by hand. "candidates": every unlabelled colour candidate checked plus a sample of windows, so recall there is an upper bound. "blind": every window checked on clean imagery with nothing drawn, OSM merged afterwards. "gold-union": phase 0 gold, the union of what the methods proposed, checked by eye. "absent" are labels whose pool is not in this source\'s imagery, ignored here.',
  );
  L.push('');
  L.push('| area | role | review | pool labels | points | hand-added | ignored | absent | tiles |');
  L.push('|---|---|---|--:|--:|--:|--:|--:|--:|');
  for (const r of results) {
    L.push(`| ${r.name} | ${r.role} | ${r.review} | ${r.labels.pool} | ${r.labels.points} | ${r.labels.visual} | ${r.labels.ignore} | ${r.labels.absent} | ${r.tiles}${r.tilesMissing ? ` (${r.tilesMissing} without imagery)` : ''} |`);
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
      m.set(r.role, (m.get(r.role) ?? 0) + 1);
      stageRows.set(key, m);
    }
  }
  if (stageRows.size) {
    const roles = [...new Set(results.map((r) => r.role))];
    L.push('## Where undetected pools were lost (core pipeline)');
    L.push('');
    L.push('For every missed label with no detection on it, the first pipeline stage that drops it: rerun with that stage relaxed, see whether the pool appears.');
    L.push('');
    L.push(`| stage | ${roles.join(' | ')} |`);
    L.push(`|---|${roles.map(() => '--:').join('|')}|`);
    for (const [k, m] of [...stageRows].sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0))) {
      L.push(`| ${k} | ${roles.map((ro) => m.get(ro) ?? 0).join(' | ')} |`);
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
