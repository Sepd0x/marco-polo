/**
 * The v2 benchmark report: DEV scored out of fold, DEV-2 and GOLD with the
 * shipped model, GOLD also on the whole mosaic (P8).
 *
 *   npx tsx tools/train/report.ts --rows <calibration rows.json> --uncal <uncalibrated model.json> --out <dir>
 *       [--zones dev,dev-2,gold] [--model <calibrated model.json>] [--python <exe>] [--cache <dir>] [--offline]
 *
 * Every DEV zone is scored with the calibration and thresholds fitted on the
 * other calibration zones (calibrate.py --exclude), so no DEV number comes
 * from a calibration that saw that zone. DEV-2 and GOLD use the calibrated
 * model (default packages/core/models/pool-v2.json); Pozuelo is the PNOA
 * calibration zone, so its GOLD line is in sample.
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultThreshold, sourceFamily, type PoolModel } from '@marco-polo/core';
import { BOOT } from '../../packages/eval/src/bootstrap.js';
import { v2Detector, v2MosaicDetector } from '../../packages/eval/src/detectors.js';
import { evaluateZone, type ZoneResult } from '../../packages/eval/src/evaluate.js';
import { checkFrozen, labelsHash } from '../../packages/eval/src/freeze.js';
import { detectorHash } from '../../packages/eval/src/gate.js';
import { TileSource } from '../../packages/eval/src/imagery.js';
import { LABELS_DIR, loadLabels } from '../../packages/eval/src/labels.js';
import { aggregate, groups, markdownReport, type RunMeta } from '../../packages/eval/src/report.js';
import { SOURCES, type SourceId } from '../../packages/eval/src/sources.js';
import { selectZones, shiftsFor, sourceFor } from '../../packages/eval/src/zones.js';
import type { CalibrationRows } from './calibrate.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

async function main() {
  const rowsPath = resolve(arg('rows'));
  const uncal = resolve(arg('uncal'));
  const out = resolve(arg('out'));
  const modelPath = resolve(arg('model', join(ROOT, 'packages/core/models/pool-v2.json')));
  const python = arg('python', process.env.PYTHON ?? 'python');
  const cache = arg('cache', 'C:/dev/mp-cache/tiles');
  const offline = process.argv.includes('--offline');
  const zones = selectZones(arg('zones', 'dev,dev-2,gold'));
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8')) as CalibrationRows;
  const shipped = JSON.parse(readFileSync(modelPath, 'utf8')) as PoolModel;
  const problems = checkFrozen(LABELS_DIR, zones.map((z) => z.id));
  if (problems.length) throw new Error(`labels differ from labels.sha256: ${problems.map((p) => `${p.zone}/${p.file}`).join(', ')}`);
  mkdirSync(join(out, 'oof'), { recursive: true });

  const sources = new Map<SourceId, TileSource>();
  const results: ZoneResult[] = [];
  const goldMosaicRecall: Record<string, number> = {};
  const oof: Record<string, { family: string; threshold: number; calibrationZones: string[] }> = {};
  for (const z of zones) {
    const sid = sourceFor(z, 'auto');
    const src = sources.get(sid) ?? new TileSource({ provider: SOURCES[sid], cacheDir: cache, ratePerSec: 4, offline });
    sources.set(sid, src);
    const shifts = shiftsFor(z, sid);
    if (!shifts) throw new Error(`${z.id}: no label shift for ${sid}`);
    const lab = await loadLabels(z.id, { source: sid, osmShiftM: shifts.osm, visualShiftM: shifts.visual });
    const info = { visual: lab.visual, overrides: lab.overrides, absent: lab.absent };
    let model = shipped;
    let modelName = 'pool-v2.json';
    if (z.role === 'DEV') {
      if (!rows.zones.includes(z.id)) throw new Error(`${z.id} is a DEV zone but not a calibration zone`);
      const file = join(out, 'oof', `${z.id}.json`);
      execFileSync(python, ['-I', join(HERE, 'calibrate.py'), '--rows', rowsPath, '--model', uncal, '--out', file, '--exclude', z.id], { stdio: 'pipe' });
      model = JSON.parse(readFileSync(file, 'utf8')) as PoolModel;
      modelName = `calibrated without ${z.id}`;
      oof[z.id] = { family: sourceFamily(src.provider.id), threshold: defaultThreshold(model, src.provider.id), calibrationZones: rows.zones.filter((id) => id !== z.id) };
    }
    const run = await evaluateZone(z, lab.labels, info, v2Detector({ model, modelName }), src, 0.5);
    results.push(run.result);
    const r = run.result;
    const p = (x: number | null) => (x === null ? ' n/a' : (100 * x).toFixed(1));
    let line = `${z.role.padEnd(5)} ${z.id.padEnd(18)} ${sid.padEnd(4)} thr ${r.threshold.toFixed(3)} labels ${r.counts.labels} dets ${r.counts.dets} P ${p(r.scores.precision)} R ${p(r.scores.recall)} F1 ${p(r.scores.f1)} area ${p(r.area.medianAbsRel)}`;
    if (z.role === 'GOLD' && !sid.startsWith('dgt')) {
      const m = await evaluateZone(z, lab.labels, info, v2MosaicDetector({ model: shipped }), src, 0.5);
      goldMosaicRecall[z.id] = m.result.scores.recall ?? 0;
      line += ` | mosaic R ${p(m.result.scores.recall)}`;
    }
    console.log(line);
  }
  const manifest = [...sources.values()].flatMap((s) => [...s.manifest]).sort((a, b) => a[0].localeCompare(b[0]));
  const meta: RunMeta = {
    name: 'v2 at the calibrated threshold of each source, --source auto (DEV calibrated out of fold)',
    detector: 'v2',
    detectorDescription: `packages/core detectWindow + DetectionMerger, model packages/core/models/pool-v2.json (sha256 ${sha256(readFileSync(modelPath)).slice(0, 12)})`,
    detectorHash: detectorHash(ROOT),
    source: 'auto',
    threshold: 0,
    matchRule: 'v2',
    labelsHash: labelsHash(LABELS_DIR, zones.map((z) => z.id)),
    tilesHash: sha256(manifest.map(([u, h]) => `${h} ${u}`).join('\n')),
    tilesRead: manifest.length,
    bootstrap: BOOT,
    date: new Date().toISOString().slice(0, 10),
    commit: execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
  };
  const g = groups(results);
  const json = {
    meta,
    groups: Object.fromEntries(Object.entries(g).map(([k, rs]) => [k, aggregate(rs)])),
    zones: results,
    goldMosaicRecall,
    model: { sha256: sha256(readFileSync(modelPath)), seed: shipped.meta.seed, thresholds: shipped.thresholds },
    outOfFold: oof,
  };
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `${(100 * x).toFixed(1)}%`);
  const md = [
    markdownReport(meta, results, null).replace(/- confidence threshold: 0\n/, '- confidence threshold: the calibrated threshold of each source (per zone below)\n'),
    '',
    '## Calibration',
    '',
    'DEV zones are scored with the isotonic calibration and threshold fitted on the other calibration zones (out of fold). A family with no other calibration zone (Esri: Scottsdale only) falls back to the calibration pooled over all families. DEV-2 and GOLD use the shipped model, calibrated on every calibration zone; Pozuelo is the PNOA calibration zone, so its GOLD line is in sample.',
    '',
    '| DEV zone | family | threshold |',
    '|---|---|--:|',
    ...Object.entries(oof).map(([id, o]) => `| ${id} | ${o.family} | ${o.threshold.toFixed(3)} |`),
    '',
    `Shipped thresholds: ${Object.entries(shipped.thresholds).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}.`,
    '',
    ...(Object.keys(goldMosaicRecall).length
      ? ['## Product path against the whole mosaic (P8)', '', '| GOLD zone | recall, product path | recall, mosaic | difference |', '|---|--:|--:|--:|',
        ...results.filter((r) => r.zone in goldMosaicRecall).map((r) => `| ${r.zone} | ${pct(r.scores.recall)} | ${pct(goldMosaicRecall[r.zone])} | ${r.scores.recall === null ? 'n/a' : `${(100 * (r.scores.recall - goldMosaicRecall[r.zone])).toFixed(1)} pp`} |`), '']
      : []),
  ].join('\n');
  writeFileSync(join(out, 'report.json'), JSON.stringify(json, null, 1));
  writeFileSync(join(out, 'report.md'), md);
  writeFileSync(join(out, 'tiles.manifest'), manifest.map(([u, h]) => `${h} ${u}`).join('\n') + '\n');
  for (const [k, s] of Object.entries(json.groups)) {
    console.log(`${k}: P ${pct(s.scores.precision)} R ${pct(s.scores.recall)} F1 ${pct(s.scores.f1)} [${pct(s.ci.f1.lo)}, ${pct(s.ci.f1.hi)}] (TP ${s.counts.tpLabels}, FP ${s.counts.fp}, FN ${s.counts.fn})`);
  }
}

await main();
