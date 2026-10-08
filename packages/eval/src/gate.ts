/**
 * The release gate. It reads committed reports, never runs a detector:
 *
 *  1. the report was made by the detector code and model of this checkout;
 *  2. the labels it used are the frozen ones;
 *  3. targets.json has not changed since the first TEST run;
 *  4. the floors of the plan (P1 to P9) and the final targets hold.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { comparePaired, type Paired } from './compare.js';
import type { ZoneResult } from './evaluate.js';
import { aggregate } from './report.js';
import type { RunMeta } from './report.js';

export interface ReportFile {
  meta: RunMeta;
  zones: ZoneResult[];
  /** Recall of the same detector run on the whole gold mosaic, per gold zone (P8). Written by the detection work. */
  goldMosaicRecall?: Record<string, number>;
}

/** Folders whose code and model make up "the detector". */
export const DETECTOR_PATHS = ['packages/core/src/detect', 'packages/core/src/merge', 'packages/core/src/rank', 'packages/core/models'];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** sha256 over the detector files (path and content, line endings normalised), in path order. */
export function detectorHash(repoRoot: string, paths: string[] = DETECTOR_PATHS): string {
  const h = createHash('sha256');
  const files = paths.flatMap((p) => walk(join(repoRoot, p))).map((f) => relative(repoRoot, f).replace(/\\/g, '/')).sort();
  for (const f of files) {
    const body = readFileSync(join(repoRoot, f)).toString('binary').replace(/\r\n/g, '\n');
    h.update(`${f}\n${body.length}\n`);
    h.update(body, 'binary');
  }
  return h.digest('hex');
}

export type Cmp = 'min' | 'max';

/** A floor fixed in the plan (3.2) before any v2 number existed. */
export interface Floor {
  id: string;
  what: string;
  cmp: Cmp;
  value: number;
}

export const FLOORS: Floor[] = [
  { id: 'P1', what: 'TEST F1 (micro, strata reported apart excluded), v2 minus v1; and the lower end of its interval above 0', cmp: 'min', value: 0.1 },
  { id: 'P2', what: 'TEST errors (FP + FN), v2 divided by v1; and the upper end of its interval below 1', cmp: 'max', value: 0.6 },
  { id: 'P3', what: 'TEST F1 per stratum, v2 minus v1: upper end of the interval at or above 0', cmp: 'min', value: 0 },
  { id: 'P4', what: 'TEST negative stratum, FP per km², v2 minus v1', cmp: 'max', value: 0 },
  { id: 'P5', what: 'TEST median area error on the labels both versions hit', cmp: 'max', value: 0.15 },
  { id: 'P6', what: 'TEST median signed area error, absolute value', cmp: 'max', value: 0.05 },
  { id: 'P7', what: 'False positives in Odemira (DEV)', cmp: 'max', value: 1 },
  { id: 'P8', what: 'GOLD recall, product path minus whole mosaic', cmp: 'min', value: -0.02 },
  { id: 'P9', what: 'Every DEV and DEV-2 zone, F1 v2 minus v1: upper end of the interval at or above 0', cmp: 'min', value: 0 },
];

export interface TargetsFile {
  about: string;
  fixedAt: string;
  commit: string;
  /** Final target per floor id; equal to the floor where no DEV interval tightens it. */
  targets: Record<string, number>;
  basis: Record<string, string>;
}

const stricter = (cmp: Cmp, a: number, b: number | null) => (b === null ? a : cmp === 'min' ? Math.max(a, b) : Math.min(a, b));

/**
 * Final targets from a DEV + DEV-2 comparison: each is the stricter of the
 * floor and the pessimistic end of v2's interval there (plan 3.2).
 */
export function computeTargets(dev: Paired, commit: string, date: string): TargetsFile {
  const t: Record<string, number> = {};
  const basis: Record<string, string> = {};
  for (const f of FLOORS) {
    let bound: number | null = null;
    if (f.id === 'P1') bound = dev.f1DiffCI.lo;
    if (f.id === 'P2') bound = dev.errorsRatioCI.hi;
    if (f.id === 'P5') bound = dev.pairedAreaAbsBCI.hi;
    t[f.id] = stricter(f.cmp, f.value, bound);
    basis[f.id] = bound === null ? 'floor' : `stricter of floor ${f.value} and DEV+DEV-2 bound ${bound.toFixed(4)}`;
  }
  return {
    about: 'Final targets, fixed before the first TEST run (plan 3.2). The gate fails if this file changes after a TEST run is logged in results/TEST_RUNS.md.',
    fixedAt: date,
    commit,
    targets: t,
    basis,
  };
}

/** Rows of results/TEST_RUNS.md: `| n | date | commit | detector | detector hash | targets sha256 | why |`. */
export interface TestRun {
  n: number;
  date: string;
  commit: string;
  detector: string;
  detectorHash: string;
  targetsSha: string;
  why: string;
}

export const MAX_TEST_RUNS = 3;

export function readTestRuns(path: string): TestRun[] {
  if (!existsSync(path)) return [];
  const out: TestRun[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*(.*)\|\s*$/.exec(line);
    if (!m) continue;
    out.push({ n: Number(m[1]), date: m[2].trim(), commit: m[3].trim(), detector: m[4].trim(), detectorHash: m[5].trim(), targetsSha: m[6].trim(), why: m[7].trim() });
  }
  return out;
}

const TEST_RUNS_HEAD =
  '# TEST runs\n\nEvery run of a detector other than v1 on the TEST zones, logged before it starts (`--confirm-test`). At most 3. Never edit past rows.\n\n| # | date | commit | detector | detector hash | targets sha256 | why |\n|--:|---|---|---|---|---|---|\n';

/** Log a TEST run, or refuse: no targets.json, or the budget is spent. */
export function logTestRun(path: string, targetsPath: string, run: Omit<TestRun, 'n' | 'targetsSha'>): TestRun {
  if (!existsSync(targetsPath)) throw new Error('no targets.json: fix the targets on DEV and DEV-2 (eval targets) and commit them before any TEST run');
  if (!run.why.trim()) throw new Error('--confirm-test needs a reason');
  const runs = readTestRuns(path);
  if (runs.length >= MAX_TEST_RUNS) throw new Error(`TEST already ran ${runs.length} times (maximum ${MAX_TEST_RUNS}); draw new TEST zones by the same rule`);
  const targetsSha = createHash('sha256').update(readFileSync(targetsPath)).digest('hex');
  const row: TestRun = { ...run, n: runs.length + 1, targetsSha };
  const text = existsSync(path) ? readFileSync(path, 'utf8') : TEST_RUNS_HEAD;
  const line = `| ${row.n} | ${row.date} | ${row.commit} | ${row.detector} | ${row.detectorHash.slice(0, 16)} | ${targetsSha} | ${row.why.replace(/\|/g, '/')} |\n`;
  writeFileSync(path, text + line, 'utf8');
  return row;
}

export interface GateCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface GateInput {
  v2: ReportFile;
  v1: ReportFile;
  currentDetectorHash: string;
  currentLabelsHash: (zones: string[]) => string;
  targets: TargetsFile | null;
  targetsSha: string | null;
  testRuns: TestRun[];
}

const f = (x: number | null, d = 3) => (x === null ? 'n/a' : x.toFixed(d));

export function runGate(g: GateInput): GateCheck[] {
  const out: GateCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => out.push({ id, ok, detail });

  add('fresh', g.v2.meta.detectorHash === g.currentDetectorHash, `report detector ${g.v2.meta.detectorHash.slice(0, 12)}, checkout ${g.currentDetectorHash.slice(0, 12)}`);
  const zones = g.v2.zones.map((z) => z.zone);
  const labels = g.currentLabelsHash(zones);
  add('labels', g.v2.meta.labelsHash === labels, `report labels ${g.v2.meta.labelsHash.slice(0, 12)}, frozen ${labels.slice(0, 12)}`);
  add('same labels', g.v1.meta.labelsHash === g.v2.meta.labelsHash, 'v1 and v2 reports on the same frozen labels');
  add('same source', g.v1.meta.source === g.v2.meta.source, `v1 --source ${g.v1.meta.source}, v2 --source ${g.v2.meta.source}`);
  add('targets', !!g.targets, g.targets ? `fixed ${g.targets.fixedAt} at ${g.targets.commit}` : 'targets.json missing');
  if (g.testRuns.length && g.targetsSha) {
    add('targets unchanged', g.testRuns.every((r) => r.targetsSha === g.testRuns[0].targetsSha) && g.targetsSha === g.testRuns[0].targetsSha, 'targets.json identical to the one logged at the first TEST run');
  }
  if (!g.targets) return out;
  const T = g.targets.targets;

  const role = (rs: ZoneResult[], r: string) => rs.filter((z) => z.role === r);
  const testMain = role(g.v2.zones, 'TEST').filter((z) => !z.reportedApart).map((z) => z.zone);
  if (!testMain.length) {
    add('P1-P6', false, 'no TEST zones in the report: not measured');
  } else {
    const p = comparePaired(g.v1.zones, g.v2.zones, testMain);
    add('P1', p.f1Diff !== null && p.f1Diff >= T.P1 && (p.f1DiffCI.lo ?? -1) > 0, `F1 ${f(p.f1A)} -> ${f(p.f1B)}, diff ${f(p.f1Diff)} [${f(p.f1DiffCI.lo)}, ${f(p.f1DiffCI.hi)}], target >= ${T.P1}`);
    add('P2', p.errorsRatio !== null && p.errorsRatio <= T.P2 && (p.errorsRatioCI.hi ?? 2) < 1, `errors ${p.errorsA} -> ${p.errorsB}, ratio ${f(p.errorsRatio)} [${f(p.errorsRatioCI.lo)}, ${f(p.errorsRatioCI.hi)}], target <= ${T.P2}`);
    const strata = [...new Set(role(g.v2.zones, 'TEST').filter((z) => !z.reportedApart).map((z) => z.stratum ?? z.zone))];
    for (const s of strata) {
      const zs = role(g.v2.zones, 'TEST').filter((z) => (z.stratum ?? z.zone) === s).map((z) => z.zone);
      const ps = comparePaired(g.v1.zones, g.v2.zones, zs);
      add(`P3 ${s}`, (ps.f1DiffCI.hi ?? -1) >= T.P3, `F1 diff ${f(ps.f1Diff)} [${f(ps.f1DiffCI.lo)}, ${f(ps.f1DiffCI.hi)}]`);
    }
    add('P5', p.pairedAreaAbsB !== null && p.pairedAreaAbsB <= T.P5, `median area error on ${p.pairedAreaN} labels both hit: v1 ${f(p.pairedAreaAbsA)}, v2 ${f(p.pairedAreaAbsB)}, target <= ${T.P5}`);
    const signedV2 = aggregate(role(g.v2.zones, 'TEST').filter((z) => !z.reportedApart)).medianAreaSignedRel;
    add('P6', signedV2 !== null && Math.abs(signedV2) <= T.P6, `signed median ${f(signedV2)}, target within +-${T.P6}`);
  }
  const neg = role(g.v2.zones, 'TEST').filter((z) => z.stratum === 'negative').map((z) => z.zone);
  if (!neg.length) add('P4', false, 'no negative TEST zone: not measured');
  else {
    const pn = comparePaired(g.v1.zones, g.v2.zones, neg);
    add('P4', pn.fpPerKm2B - pn.fpPerKm2A <= T.P4, `FP/km² ${f(pn.fpPerKm2A, 1)} -> ${f(pn.fpPerKm2B, 1)}`);
  }
  const ode = g.v2.zones.find((z) => z.zone === 'odemira');
  add('P7', !!ode && ode.counts.fp <= T.P7, ode ? `Odemira FP ${ode.counts.fp}` : 'Odemira not in the report: not measured');
  const gold = role(g.v2.zones, 'GOLD');
  if (!gold.length || !g.v2.goldMosaicRecall) add('P8', false, 'GOLD product-path or mosaic recall not in the report: not measured');
  else {
    for (const z of gold) {
      const mosaic = g.v2.goldMosaicRecall[z.zone];
      const prod = z.scores.recall;
      add(`P8 ${z.zone}`, mosaic !== undefined && prod !== null && prod - mosaic >= T.P8, `product ${f(prod)}, mosaic ${f(mosaic ?? null)}`);
    }
  }
  const devs = g.v2.zones.filter((z) => z.role === 'DEV' || z.role === 'DEV-2');
  if (!devs.length) add('P9', false, 'no DEV or DEV-2 zones in the report: not measured');
  for (const z of devs) {
    if (!g.v1.zones.some((y) => y.zone === z.zone)) {
      add(`P9 ${z.zone}`, false, 'zone missing from the v1 report');
      continue;
    }
    if (z.counts.labels === 0) continue;
    const pz = comparePaired(g.v1.zones, g.v2.zones, [z.zone]);
    add(`P9 ${z.zone}`, (pz.f1DiffCI.hi ?? -1) >= T.P9, `F1 ${f(pz.f1A)} -> ${f(pz.f1B)} [${f(pz.f1DiffCI.lo)}, ${f(pz.f1DiffCI.hi)}]`);
  }
  return out;
}
