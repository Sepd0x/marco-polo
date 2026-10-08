/**
 * marco-polo eval: benchmark the pool detector against labelled areas.
 *
 *   npm run eval                                  # v1 on DEV and DEV-2, Esri, frozen labels
 *   npm run eval -- run --zones dev --source auto --min-conf 0.5
 *   npm run eval -- zones check                   # registry rules (50 km, roles)
 *   npm run eval -- gate                          # committed reports against targets.json
 *   npm run eval -- --help
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScanPlan, expandBBoxMeters } from '@marco-polo/core';
import { sleep } from '../../cli/src/tiles.js';
import { adjudicateApply, adjudicatePrepare } from './adjudicate.js';
import { blindCommand } from './blindcli.js';
import { BOOT } from './bootstrap.js';
import { writeCandidates, type SourceId } from './candidates.js';
import { comparePaired } from './compare.js';
import { DETECTORS } from './detectors.js';
import { drawStatus, drawStratum, rejectAfterReview } from './drawzones.js';
import { diagnoseMisses } from './diagnose.js';
import { evaluateZone, type ZoneResult } from './evaluate.js';
import { checkFrozen, fileSha256, labelsHash, readFreeze, relabel, sha256, writeFreeze, zoneLabelFiles } from './freeze.js';
import { writeGallery } from './gallery.js';
import { computeTargets, detectorHash, logTestRun, readTestRuns, runGate, type ReportFile, type TargetsFile } from './gate.js';
import { TileSource } from './imagery.js';
import { LABELS_DIR, loadLabels } from './labels.js';
import { measureOffset } from './offset.js';
import { buildFixture, specLabels, type FixtureSpec } from './fixture.js';
import { sourceShiftM } from './imgshift.js';
import { osmRecallCommand } from './osmrecall.js';
import { buildingQuery, overpass, poolQuery, toLabelFeatures } from './overpass.js';
import { checkRegistry, loadRegistry } from './registry.js';
import { aggregate, groups, markdownReport, type RunMeta, type Taxonomy } from './report.js';
import { buildExtra, renderReview } from './review.js';
import { isSourceId, SOURCES } from './sources.js';
import { allZones, selectZones, shiftsFor, sourceFor, type Zone } from './zones.js';

export const EVAL_DIR = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = resolve(EVAL_DIR, '../..');
const RESULTS = join(EVAL_DIR, 'results');
const TARGETS = join(EVAL_DIR, 'targets.json');
const TEST_RUNS = join(RESULTS, 'TEST_RUNS.md');

interface Opts {
  cmd: string;
  sub: string[];
  zones: string;
  zone?: string;
  detector: string;
  minConf: number;
  source: SourceId | 'auto';
  match: 'v1' | 'v2';
  cache: string;
  rate: number;
  out: string;
  gallery: string | null;
  taxonomy: string | null;
  name: string;
  offline: boolean;
  review?: string;
  relabel?: string;
  confirmTest?: string;
  report?: string;
  baseline?: string;
  stratum?: string;
  pools?: number;
  dir?: string;
  write?: boolean;
}

function parse(argv: string[]): Opts {
  const o: Opts = {
    cmd: 'run',
    sub: [],
    zones: 'default',
    detector: 'v1',
    minConf: 0.55,
    source: 'esri',
    match: 'v2',
    cache: process.env.MARCO_POLO_CACHE ?? join(homedir(), '.cache', 'marco-polo', 'tiles'),
    rate: 4,
    out: resolve(process.env.INIT_CWD ?? process.cwd(), 'eval-out'),
    gallery: null,
    taxonomy: null,
    name: '',
    offline: false,
  };
  let i = 0;
  if (argv[0] && !argv[0].startsWith('-')) o.cmd = argv[i++];
  while (argv[i] && !argv[i].startsWith('-')) o.sub.push(argv[i++]);
  for (; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} needs a value`);
      return x;
    };
    switch (a) {
      case '--zones': o.zones = v(); break;
      case '--zone': o.zone = v(); o.zones = o.zone; break;
      case '--detector': o.detector = v(); break;
      case '--min-conf': o.minConf = Number(v()); break;
      case '--source': {
        const s = v();
        if (s !== 'auto' && !isSourceId(s)) throw new Error(`--source must be esri, dgt, pnoa, ign or auto (got ${s})`);
        o.source = s;
        break;
      }
      case '--match': {
        const m = v();
        if (m !== 'v1' && m !== 'v2') throw new Error('--match must be v1 or v2');
        o.match = m;
        break;
      }
      case '--cache': o.cache = v(); break;
      case '--rate': {
        const r = Number(v());
        if (!Number.isFinite(r) || r <= 0) throw new Error('--rate must be a positive number');
        o.rate = Math.min(8, Math.max(0.5, r));
        break;
      }
      case '--out': o.out = resolve(v()); break;
      case '--gallery': o.gallery = resolve(v()); break;
      case '--taxonomy': o.taxonomy = resolve(v()); break;
      case '--name': o.name = v(); break;
      case '--offline': o.offline = true; break;
      case '--review': o.review = resolve(v()); break;
      case '--relabel': o.relabel = v(); break;
      case '--confirm-test': o.confirmTest = v(); break;
      case '--report': o.report = resolve(v()); break;
      case '--baseline': o.baseline = resolve(v()); break;
      case '--stratum': o.stratum = v(); break;
      case '--pools': o.pools = Number(v()); break;
      case '--dir': o.dir = resolve(v()); break;
      case '--write': o.write = true; break;
      case '-h':
      case '--help':
        help();
        process.exit(0);
      default:
        throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  if (!Number.isFinite(o.minConf) || o.minConf < 0 || o.minConf > 1) throw new Error('--min-conf must be between 0 and 1');
  return o;
}

function help() {
  console.log(`marco-polo eval

commands:
  run          (default) detect on the areas, match against the frozen labels, write report.md and report.json
  fetch        warm the tile cache for the areas (slow, polite)
  offset       measure how far OSM labels sit from the imagery of --source, per area
  labels       fetch OSM labels for the areas from Overpass into packages/eval/labels/
  review       render numbered review windows of one area with candidates (phase 0 method)
  extra        turn a review file into labels/<area>.extra.geojson
  freeze       write labels.sha256 for zones that have never been frozen
  zones        list | check | draw --stratum <id> | reject --stratum <id> --pools <n> | candidates (rebuild the list, audit only)
  blind        render | second | merge | agree | osm-sheet: blind review of a zone (see src/blind.ts)
  osm-recall   render 10 blind windows of a zone and score OSM against a hand count (training zones)
  adjudicate   prepare | apply: symmetric, blind adjudication of unmatched detections of two runs
  fixture      rebuild fixtures/open (open tiles and labels for CI and e2e) from fixtures/open/spec.json
  compare      paired comparison of two report.json files (--baseline a --report b)
  targets      fix targets.json from a DEV + DEV-2 comparison (--baseline v1 --report v2)
  gate         check the committed v2 report against the frozen labels, the detector and targets.json

options:
  --zones <spec>                 roles (dev, dev-2, gold, test), ids, or both, comma separated; default dev,dev-2
  --zone <id>                    one area
  --source <esri|dgt|pnoa|ign|auto>  imagery (default esri; auto = the product source of each zone)
  --detector <id>                detector under test (${Object.keys(DETECTORS).join(', ')}; default v1)
  --min-conf <x>                 confidence threshold (default 0.55, the web app default)
  --match <v1|v2>                point-label rule (default v2; v1 reproduces the phase 0 report)
  --confirm-test "<why>"         needed to run a detector other than v1 on TEST zones; logs the run in results/TEST_RUNS.md (max 3)
  --relabel "<why>"              accept changed labels: re-freeze them and log why in labels/RELABEL_LOG.md
  --cache <dir>                  tile cache (default $MARCO_POLO_CACHE or ~/.cache/marco-polo/tiles)
  --rate <n>                     network requests per second (default 4, max 8)
  --offline                      never touch the network; fail on a cache miss
  --out <dir>                    output directory (default ./eval-out)
  --gallery <dir>                write FP/FN contact sheets per area here (refused on TEST zones)
  --taxonomy <dir>               hand categories (<area>.json) to fold into the report
  --name <s>                     run name for the report title
  --report, --baseline <file>    report.json files for compare, targets and gate
`);
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: REPO_ROOT }).trim();
  } catch {
    return 'unknown';
  }
}

function tileSource(o: Opts, source: SourceId): TileSource {
  return new TileSource({ provider: SOURCES[source], cacheDir: o.cache, ratePerSec: o.rate, offline: o.offline });
}

async function cmdLabels(o: Opts) {
  for (const z of selectZones(o.zones)) {
    const fetchBox = expandBBoxMeters(z.bbox, 120);
    console.log(`${z.id}: querying Overpass`);
    const pools = await overpass(poolQuery(fetchBox));
    await sleep(5000);
    const buildings = await overpass(buildingQuery(fetchBox));
    await sleep(5000);
    const features = toLabelFeatures(pools, buildings, 5);
    const file = {
      type: 'FeatureCollection',
      zone: z.id,
      attribution: '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
      fetched: new Date().toISOString(),
      bbox: [fetchBox.west, fetchBox.south, fetchBox.east, fetchBox.north],
      buildingsChecked: buildings.length,
      features,
    };
    const dest = z.review === 'blind' ? join(LABELS_DIR, 'review', z.id, 'osm.geojson') : join(LABELS_DIR, `${z.id}.geojson`);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, JSON.stringify(file, null, 1) + '\n', 'utf8');
    const pool = features.filter((f) => f.properties.role === 'pool').length;
    console.log(`  ${features.length} features (${pool} pool, ${features.length - pool} ignore), ${buildings.length} buildings checked -> ${dest}`);
  }
}

/** Refuse changed labels unless --relabel; returns the labels hash of the run. */
function ensureFrozen(o: Opts, zones: Zone[]): string {
  const ids = zones.map((z) => z.id);
  const problems = checkFrozen(LABELS_DIR, ids);
  if (problems.length) {
    if (!o.relabel) {
      throw new Error(
        `labels differ from labels/labels.sha256:\n${problems.map((p) => `  ${p.zone}: ${p.file} ${p.problem}`).join('\n')}\n` +
          'run with --relabel "<why>" to accept and log the change',
      );
    }
    const changed = relabel(LABELS_DIR, ids, o.relabel, gitCommit());
    console.log(`relabel: ${changed.length} files re-frozen, logged in labels/RELABEL_LOG.md`);
  }
  return labelsHash(LABELS_DIR, ids);
}

async function cmdRun(o: Opts) {
  const detector = DETECTORS[o.detector];
  if (!detector) throw new Error(`unknown detector ${o.detector}`);
  const zones = selectZones(o.zones);
  const test = zones.filter((z) => z.role === 'TEST');
  if (test.length && o.gallery) throw new Error('galleries are never written for TEST zones');
  if (test.length && o.detector !== 'v1') {
    if (!o.confirmTest) throw new Error('TEST zones selected: pass --confirm-test "<why>" (logged in results/TEST_RUNS.md, at most 3 runs)');
    const row = logTestRun(TEST_RUNS, TARGETS, { date: new Date().toISOString().slice(0, 10), commit: gitCommit(), detector: o.detector, detectorHash: detectorHash(REPO_ROOT), why: o.confirmTest });
    console.log(`TEST run ${row.n} of 3 logged`);
  }
  const labelsSha = ensureFrozen(o, zones);

  let tax: Taxonomy | null = null;
  if (o.taxonomy) {
    tax = {};
    for (const z of zones) {
      try {
        tax[z.id] = JSON.parse(await readFile(join(o.taxonomy, `${z.id}.json`), 'utf8'));
      } catch {
        // not reviewed yet
      }
    }
  }
  const sources = new Map<SourceId, TileSource>();
  const results: ZoneResult[] = [];
  for (const z of zones) {
    const sid = sourceFor(z, o.source);
    const shifts = shiftsFor(z, sid);
    if (!shifts) throw new Error(`${z.id}: labels have no measured shift onto ${sid} (eval offset --source ${sid} --zone ${z.id})`);
    const src = sources.get(sid) ?? tileSource(o, sid);
    sources.set(sid, src);
    const { labels, visual, overrides, absent } = await loadLabels(z.id, { source: sid, osmShiftM: shifts.osm, visualShiftM: shifts.visual });
    const t0 = Date.now();
    const run = await evaluateZone(z, labels, { visual, overrides, absent }, detector, src, o.minConf, o.match);
    const r = run.result;
    if (o.detector === 'v1' && z.role !== 'TEST') {
      // Mechanical miss diagnosis is defined for the core pipeline only.
      const missed = r.items.filter((i) => i.kind === 'fn' && i.auto === 'not-detected');
      const byId = new Map(labels.map((l) => [l.id, l]));
      const stages = await diagnoseMisses(z, missed.map((i) => byId.get(i.id)!), src, o.minConf);
      for (const i of missed) i.stage = stages.get(i.id);
    }
    results.push(r);
    const f = (x: number | null) => (x === null ? ' n/a ' : (x * 100).toFixed(1).padStart(5));
    console.log(
      `${z.role.padEnd(5)} ${z.id.padEnd(22)} ${sid.padEnd(4)} labels ${String(r.counts.labels).padStart(4)}  dets ${String(r.counts.dets).padStart(4)}  ` +
        `P ${f(r.scores.precision)}  R ${f(r.scores.recall)}  F1 ${f(r.scores.f1)}  area ${f(r.area.medianAbsRel)}  ` +
        `${r.msPerKm2.toFixed(0)} ms/km²  (${((Date.now() - t0) / 1000).toFixed(0)}s, net ${src.fetched})`,
    );
    if (o.gallery) await writeGallery(join(o.gallery, z.id), src, r.items, { labels, shown: run.shown, faint: run.faint });
  }
  const manifest = [...sources.values()].flatMap((s) => [...s.manifest]).sort((a, b) => a[0].localeCompare(b[0]));
  const meta: RunMeta = {
    name: o.name || `${o.detector} @ ${o.minConf}, --source ${o.source}`,
    detector: o.detector,
    detectorDescription: detector.description,
    detectorHash: detectorHash(REPO_ROOT),
    source: o.source,
    threshold: o.minConf,
    matchRule: o.match,
    labelsHash: labelsSha,
    tilesHash: sha256(manifest.map(([u, h]) => `${h} ${u}`).join('\n')),
    tilesRead: manifest.length,
    bootstrap: BOOT,
    date: new Date().toISOString().slice(0, 10),
    commit: gitCommit(),
  };
  await mkdir(o.out, { recursive: true });
  const g = groups(results);
  const json = { meta, groups: Object.fromEntries(Object.entries(g).map(([k, rs]) => [k, aggregate(rs)])), zones: results };
  await writeFile(join(o.out, 'report.md'), markdownReport(meta, results, tax), 'utf8');
  await writeFile(join(o.out, 'report.json'), JSON.stringify(json, null, 1), 'utf8');
  await writeFile(join(o.out, 'tiles.manifest'), manifest.map(([u, h]) => `${h} ${u}`).join('\n') + '\n', 'utf8');
  for (const [k, s] of Object.entries(json.groups)) {
    const f = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    const ci = s.ci.f1.lo === null ? '' : ` [${f(s.ci.f1.lo)}, ${f(s.ci.f1.hi)}]`;
    console.log(`${k}: P ${f(s.scores.precision)}  R ${f(s.scores.recall)}  F1 ${f(s.scores.f1)}${ci}  (TP ${s.counts.tpLabels}, FP ${s.counts.fp}, FN ${s.counts.fn})`);
  }
  console.log(`report: ${join(o.out, 'report.md')}`);
  console.log(`tiles: ${[...sources.values()].reduce((k, s) => k + s.cacheHits, 0)} from cache, ${[...sources.values()].reduce((k, s) => k + s.fetched, 0)} fetched, ${[...sources.values()].reduce((k, s) => k + s.failures, 0)} failed`);
}

function readReport(path: string | undefined, what: string): ReportFile {
  if (!path) throw new Error(`${what}: pass the report.json path`);
  return JSON.parse(readFileSync(path, 'utf8')) as ReportFile;
}

function cmdZones(o: Opts) {
  const sub = o.sub[0] ?? 'list';
  if (sub === 'list') {
    for (const z of allZones()) console.log(`${z.role.padEnd(5)} ${z.id.padEnd(24)} ${z.productSource.padEnd(4)} ${z.areaKm2.toFixed(2)} km²  ${z.name}`);
    return;
  }
  if (sub === 'check') {
    const issues = checkRegistry(loadRegistry());
    for (const i of issues) console.log(`FAIL ${i.zone}: ${i.problem}`);
    if (issues.length) process.exit(1);
    console.log('zones check: ok');
    return;
  }
  throw new Error(`unknown zones subcommand ${sub}`);
}

async function main() {
  const o = parse(process.argv.slice(2));
  switch (o.cmd) {
    case 'run':
      return cmdRun(o);
    case 'labels':
      return cmdLabels(o);
    case 'fetch': {
      for (const z of selectZones(o.zones)) {
        const src = tileSource(o, sourceFor(z, o.source));
        const b = expandBBoxMeters(z.bbox, 90);
        const plan = buildScanPlan([[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]], 19);
        for (const t of plan.tiles) await src.get(t.tile);
        console.log(`${z.id}: ${plan.tiles.length} tiles on ${src.provider.id} (fetched ${src.fetched}, failed ${src.failures}, without imagery ${src.noData})`);
      }
      return;
    }
    case 'offset': {
      // OSM onto the source (from confident detections) and hand labels onto the source
      // (phase correlation against the source they were drawn on). --write stores both.
      const reg = loadRegistry();
      for (const z of selectZones(o.zones)) {
        const sid = sourceFor(z, o.source);
        const src = tileSource(o, sid);
        const def = reg.zones.find((x) => x.id === z.id)!;
        let line = `${z.id.padEnd(22)} ${sid.padEnd(4)}`;
        if (z.review !== 'blind') {
          const r = await measureOffset(z, src);
          line += ` OSM east ${r.east.toFixed(1)} m north ${r.north.toFixed(1)} m (n=${r.n}, residual ${r.spread.toFixed(1)} m)`;
          if (o.write && r.n >= 5) (def.osmShiftM ??= {})[sid] = [Math.round(r.east * 10) / 10, Math.round(r.north * 10) / 10];
        }
        if (sid !== z.labelSource) {
          const c = { lon: (z.bbox.west + z.bbox.east) / 2, lat: (z.bbox.south + z.bbox.north) / 2 };
          const s = await sourceShiftM(tileSource(o, z.labelSource), src, c);
          line += `; labels from ${z.labelSource}: east ${s.m[0]} m north ${s.m[1]} m (peak ${s.peak.toFixed(3)})`;
          if (o.write && s.peak >= 0.03) (def.labelShiftM ??= {})[sid] = s.m;
        }
        console.log(line);
      }
      if (o.write) writeFileSync(join(EVAL_DIR, 'zones', 'registry.json'), JSON.stringify(reg, null, 1) + '\n', 'utf8');
      return;
    }
    case 'zones':
      if (o.sub[0] === 'draw') {
        if (!o.stratum) throw new Error('zones draw needs --stratum');
        const sd = await drawStratum(REPO_ROOT, o.stratum, o.dir ?? 'C:/dev/mp-research/draw-osm');
        console.log(`${o.stratum}: ${sd.zone ?? 'nothing drawn'} after ${sd.attempts.length} attempts`);
        return;
      }
      if (o.sub[0] === 'candidates') {
        // Rebuilds the pre-registration from administrative data. Only for audit: the committed file is the one that counts.
        await writeCandidates(o.out.endsWith('.json') ? o.out : join(o.out, 'test-candidates.json'), o.dir);
        return;
      }
      if (o.sub[0] === 'status') {
        const md = drawStatus();
        writeFileSync(join(RESULTS, 'TEST_ZONES.md'), md, 'utf8');
        console.log(md);
        return;
      }
      if (o.sub[0] === 'reject') {
        if (!o.stratum || o.pools === undefined) throw new Error('zones reject needs --stratum and --pools');
        rejectAfterReview(o.stratum, o.pools, 40);
        return;
      }
      return cmdZones(o);
    case 'freeze': {
      const frozen = readFreeze(LABELS_DIR);
      for (const z of selectZones(o.zones)) {
        const files = zoneLabelFiles(LABELS_DIR, z.id);
        if (!files.length) continue;
        if (files.some((f) => frozen.has(f))) {
          const p = checkFrozen(LABELS_DIR, [z.id]);
          if (p.length) throw new Error(`${z.id} is already frozen and changed; use run --relabel "<why>"`);
          continue;
        }
        for (const f of files) frozen.set(f, fileSha256(join(LABELS_DIR, f)));
        console.log(`${z.id}: froze ${files.join(', ')}`);
      }
      writeFreeze(LABELS_DIR, frozen);
      return;
    }
    case 'review': {
      if (!o.zone) throw new Error('review needs --zone');
      return renderReview(o.zone, tileSource(o, 'esri'), o.out, process.env.REVIEW_GATE === 'blue' ? 'blue' : 'loose');
    }
    case 'extra': {
      if (!o.zone || !o.review) throw new Error('extra needs --zone and --review');
      return buildExtra(o.zone, o.review);
    }
    case 'blind':
      return blindCommand(o.sub, { zone: o.zone, source: o.source, dir: o.dir, src: (s) => tileSource(o, s) });
    case 'osm-recall':
      return osmRecallCommand(o.sub, { zone: o.zone, source: o.source, dir: o.dir, src: (s) => tileSource(o, s) });
    case 'adjudicate': {
      const sub = o.sub[0];
      if (sub === 'prepare') return adjudicatePrepare(readReport(o.baseline, '--baseline'), readReport(o.report, '--report'), o.dir ?? join(o.out, 'adjudicate'), (s) => tileSource(o, s));
      if (sub === 'apply') return adjudicateApply(o.dir ?? join(o.out, 'adjudicate'), LABELS_DIR);
      throw new Error('adjudicate prepare | apply');
    }
    case 'fixture': {
      const dir = join(EVAL_DIR, 'fixtures', 'open');
      const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8')) as FixtureSpec;
      const bytes = await buildFixture(spec.blocks, specLabels(spec, LABELS_DIR), dir, (s) => tileSource(o, s));
      console.log(`fixture: ${bytes} bytes of imagery -> ${dir}`);
      return;
    }
    case 'compare': {
      const a = readReport(o.baseline, '--baseline'), b = readReport(o.report, '--report');
      const zones = b.zones.filter((z) => a.zones.some((y) => y.zone === z.zone));
      const sets: Record<string, string[]> = {};
      for (const z of zones) (sets[z.reportedApart ? `${z.role} ${z.stratum} (apart)` : z.role] ??= []).push(z.zone);
      for (const [k, ids] of Object.entries(sets)) {
        const p = comparePaired(a.zones, b.zones, ids);
        const f = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3));
        console.log(`${k}: F1 ${f(p.f1A)} -> ${f(p.f1B)} (diff ${f(p.f1Diff)} [${f(p.f1DiffCI.lo)}, ${f(p.f1DiffCI.hi)}]), errors ${p.errorsA} -> ${p.errorsB} (ratio ${f(p.errorsRatio)} [${f(p.errorsRatioCI.lo)}, ${f(p.errorsRatioCI.hi)}]), area on ${p.pairedAreaN} shared hits ${f(p.pairedAreaAbsA)} -> ${f(p.pairedAreaAbsB)}`);
      }
      return;
    }
    case 'targets': {
      if (existsSync(TARGETS) && readTestRuns(TEST_RUNS).length) throw new Error('TEST has run: targets.json is fixed');
      const a = readReport(o.baseline, '--baseline'), b = readReport(o.report, '--report');
      const ids = b.zones.filter((z) => z.role === 'DEV' || z.role === 'DEV-2').map((z) => z.zone);
      if (!ids.length) throw new Error('targets need DEV and DEV-2 zones in both reports');
      const t: TargetsFile = computeTargets(comparePaired(a.zones, b.zones, ids), gitCommit(), new Date().toISOString().slice(0, 10));
      writeFileSync(TARGETS, JSON.stringify(t, null, 1) + '\n', 'utf8');
      console.log(`targets.json written: ${JSON.stringify(t.targets)}`);
      return;
    }
    case 'gate': {
      const v2 = readReport(o.report ?? join(RESULTS, 'v2', 'report.json'), '--report');
      const v1 = readReport(o.baseline ?? join(RESULTS, 'v1', 'report.json'), '--baseline');
      const targets = existsSync(TARGETS) ? (JSON.parse(readFileSync(TARGETS, 'utf8')) as TargetsFile) : null;
      const checks = runGate({
        v2,
        v1,
        currentDetectorHash: detectorHash(REPO_ROOT),
        currentLabelsHash: (ids) => labelsHash(LABELS_DIR, ids),
        targets,
        targetsSha: existsSync(TARGETS) ? createHash('sha256').update(readFileSync(TARGETS)).digest('hex') : null,
        testRuns: readTestRuns(TEST_RUNS),
      });
      for (const c of checks) console.log(`${c.ok ? 'pass' : 'FAIL'} ${c.id}: ${c.detail}`);
      if (checks.some((c) => !c.ok)) process.exit(1);
      return;
    }
    default:
      throw new Error(`unknown command ${o.cmd} (see --help)`);
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
