/**
 * marco-polo eval: benchmark the pool detector against labelled areas.
 *
 *   npm run eval                                  # run v1 on every area (cached imagery)
 *   npm run eval -- run --zones dev --min-conf 0.5
 *   npm run eval -- labels --zone vilamoura       # refresh OSM labels (Overpass)
 *   npm run eval -- review --zone vilamoura       # render review windows for hand-labelling
 *   npm run eval -- extra --zone vilamoura --review <file.json>
 */
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildScanPlan, ESRI_WORLD_IMAGERY, expandBBoxMeters } from '@marco-polo/core';
import { DETECTORS } from './detectors.js';
import { evaluateZone, type ZoneResult } from './evaluate.js';
import { writeGallery } from './gallery.js';
import { TileSource } from './imagery.js';
import { LABELS_DIR, loadLabels } from './labels.js';
import { buildingQuery, overpass, poolQuery, toLabelFeatures } from './overpass.js';
import { measureOffset } from './offset.js';
import { diagnoseMisses } from './diagnose.js';
import { aggregate, markdownReport, type Taxonomy } from './report.js';
import { buildExtra, renderReview } from './review.js';
import { sleep } from '../../cli/src/tiles.js';
import { selectZones, ZONES } from './zones.js';

interface Opts {
  cmd: string;
  zones: string;
  zone?: string;
  detector: string;
  minConf: number;
  template: string;
  cache: string;
  rate: number;
  out: string;
  gallery: string | null;
  taxonomy: string | null;
  name: string;
  offline: boolean;
  review?: string;
}

function parse(argv: string[]): Opts {
  const o: Opts = {
    cmd: 'run',
    zones: 'all',
    detector: 'v1',
    minConf: 0.55,
    template: ESRI_WORLD_IMAGERY.template,
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
  for (; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    switch (a) {
      case '--zones': o.zones = v(); break;
      case '--zone': o.zone = v(); o.zones = o.zone; break;
      case '--detector': o.detector = v(); break;
      case '--min-conf': o.minConf = Number(v()); break;
      case '--template': o.template = v(); break;
      case '--cache': o.cache = v(); break;
      case '--rate': o.rate = Math.min(8, Math.max(0.5, Number(v()))); break;
      case '--out': o.out = resolve(v()); break;
      case '--gallery': o.gallery = resolve(v()); break;
      case '--taxonomy': o.taxonomy = resolve(v()); break;
      case '--name': o.name = v(); break;
      case '--offline': o.offline = true; break;
      case '--review': o.review = resolve(v()); break;
      case '-h':
      case '--help':
        help();
        process.exit(0);
      default:
        throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  if (!/^https:\/\/.*\{z\}.*/.test(o.template) || !o.template.includes('{x}') || !o.template.includes('{y}')) {
    throw new Error('--template must be an https:// XYZ template with {z}, {x} and {y}');
  }
  return o;
}

function help() {
  console.log(`marco-polo eval

commands:
  run      (default) detect on every area, match against labels, write report
  fetch    warm the tile cache for the areas (slow, polite)
  offset   measure how far OSM labels sit from the imagery, per area
  labels   fetch OSM labels for the areas from Overpass into packages/eval/labels/
  review   render numbered review windows of one area (for hand-labelling)
  extra    turn a review file into labels/<area>.extra.geojson
  zones    list the areas

options:
  --zones <all|dev|test|id,id>   areas to use (default all)
  --zone <id>                    one area
  --detector <id>                detector under test (${Object.keys(DETECTORS).join(', ')}; default v1)
  --min-conf <x>                 confidence threshold (default 0.55, the web app default)
  --template <url>               imagery XYZ template (default Esri World Imagery)
  --cache <dir>                  tile cache (default $MARCO_POLO_CACHE or ~/.cache/marco-polo/tiles)
  --rate <n>                     network tiles per second (default 4, max 8)
  --offline                      never touch the network; fail on a cache miss
  --out <dir>                    report directory (default ./eval-out)
  --gallery <dir>                write FP/FN contact sheets per area here
  --taxonomy <dir>               hand categories (<area>.json) to fold into the report
  --name <s>                     run name for the report title
`);
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
    await writeFile(join(LABELS_DIR, `${z.id}.geojson`), JSON.stringify(file, null, 1) + '\n', 'utf8');
    const pool = features.filter((f) => f.properties.role === 'pool').length;
    console.log(`  ${features.length} features (${pool} pool, ${features.length - pool} ignore), ${buildings.length} buildings checked`);
  }
}

async function cmdRun(o: Opts) {
  const detector = DETECTORS[o.detector];
  if (!detector) throw new Error(`unknown detector ${o.detector}`);
  const src = new TileSource({ template: o.template, cacheDir: o.cache, ratePerSec: o.rate, offline: o.offline });
  const zones = selectZones(o.zones);
  const results: ZoneResult[] = [];
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
  for (const z of zones) {
    const { labels, visual, overrides } = await loadLabels(z.id, undefined, z.osmShiftM);
    const t0 = Date.now();
    const run = await evaluateZone(z, labels, { visual, overrides }, detector, src, o.minConf);
    const r = run.result;
    if (o.detector === 'v1') {
      // Mechanical miss diagnosis is defined for the core pipeline only.
      const missed = r.items.filter((i) => i.kind === 'fn' && i.auto === 'not-detected');
      const byId = new Map(labels.map((l) => [l.id, l]));
      const stages = await diagnoseMisses(z, missed.map((i) => byId.get(i.id)!), src, o.minConf);
      for (const i of missed) i.stage = stages.get(i.id);
    }
    results.push(r);
    const f = (x: number | null) => (x === null ? ' n/a ' : (x * 100).toFixed(1).padStart(5));
    console.log(
      `${z.split.padEnd(4)} ${z.id.padEnd(16)} labels ${String(r.counts.labels).padStart(4)}  dets ${String(r.counts.dets).padStart(4)}  ` +
        `P ${f(r.scores.precision)}  R ${f(r.scores.recall)}  F1 ${f(r.scores.f1)}  area ${f(r.area.medianAbsRel)}  ` +
        `${r.msPerKm2.toFixed(0)} ms/km²  (${((Date.now() - t0) / 1000).toFixed(0)}s, net ${src.fetched})`,
    );
    if (o.gallery) await writeGallery(join(o.gallery, z.id), src, r.items, { labels, shown: run.shown, faint: run.faint });
  }
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // not a checkout
  }
  const meta = {
    name: o.name || `${o.detector} @ ${o.minConf}`,
    detector: o.detector,
    detectorDescription: detector.description,
    imagery: o.template,
    threshold: o.minConf,
    date: new Date().toISOString().slice(0, 10),
    commit,
  };
  await mkdir(o.out, { recursive: true });
  const md = markdownReport(meta, results, tax);
  const json = {
    meta,
    dev: summary(results.filter((r) => r.split === 'dev')),
    test: summary(results.filter((r) => r.split === 'test')),
    zones: results,
  };
  await writeFile(join(o.out, 'report.md'), md, 'utf8');
  await writeFile(join(o.out, 'report.json'), JSON.stringify(json, null, 1), 'utf8');
  for (const split of ['dev', 'test'] as const) {
    const s = json[split];
    if (!s) continue;
    const f = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    console.log(`${split.toUpperCase()}: P ${f(s.scores.precision)}  R ${f(s.scores.recall)}  F1 ${f(s.scores.f1)}  (TP ${s.counts.tpLabels}, FP ${s.counts.fp}, FN ${s.counts.fn})`);
  }
  console.log(`report: ${join(o.out, 'report.md')}`);
  console.log(`tiles: ${src.cacheHits} from cache, ${src.fetched} fetched, ${src.failures} failed`);
}

function summary(rs: ZoneResult[]) {
  if (!rs.length) return null;
  const a = aggregate(rs);
  return { zones: rs.map((r) => r.zone), ...a };
}

async function main() {
  const o = parse(process.argv.slice(2));
  switch (o.cmd) {
    case 'run':
      return cmdRun(o);
    case 'labels':
      return cmdLabels(o);
    case 'fetch': {
      // Warm the tile cache for the areas (scan plan plus a gallery margin).
      const src = new TileSource({ template: o.template, cacheDir: o.cache, ratePerSec: o.rate });
      for (const z of selectZones(o.zones)) {
        const b = expandBBoxMeters(z.bbox, 90);
        const plan = buildScanPlan([[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]], 19);
        for (const t of plan.tiles) await src.get(t.tile);
        console.log(`${z.id}: ${plan.tiles.length} tiles (fetched so far ${src.fetched}, failed ${src.failures})`);
      }
      return;
    }
    case 'offset': {
      const src = new TileSource({ template: o.template, cacheDir: o.cache, ratePerSec: o.rate, offline: o.offline });
      for (const z of selectZones(o.zones)) {
        const r = await measureOffset(z, src);
        console.log(`${z.id.padEnd(12)} east ${r.east.toFixed(1)} m  north ${r.north.toFixed(1)} m  (n=${r.n}, median residual ${r.spread.toFixed(1)} m; in use: [${z.osmShiftM.join(', ')}])`);
      }
      return;
    }
    case 'zones':
      for (const z of ZONES) console.log(`${z.split.padEnd(4)} ${z.id.padEnd(16)} ${z.areaKm2.toFixed(2)} km²  ${z.name}`);
      return;
    case 'review': {
      if (!o.zone) throw new Error('review needs --zone');
      const src = new TileSource({ template: o.template, cacheDir: o.cache, ratePerSec: o.rate, offline: o.offline });
      return renderReview(o.zone, src, o.out, process.env.REVIEW_GATE === 'blue' ? 'blue' : 'loose');
    }
    case 'extra': {
      if (!o.zone || !o.review) throw new Error('extra needs --zone and --review');
      return buildExtra(o.zone, o.review);
    }
    default:
      throw new Error(`unknown command ${o.cmd} (see --help)`);
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
