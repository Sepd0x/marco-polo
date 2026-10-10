/**
 * Calibration data: raw scores of the detector on the calibration zones,
 * each marked as a hit or a false positive by the benchmark's own matching.
 *
 *   MARCO_POLO_MODEL=<uncalibrated model.json> npx tsx tools/train/calibrate.ts --out <rows.json> [--cache <dir>]
 *
 * Calibration zones (plan B6): the DEV zones of each source family. There is
 * no DEV zone on PNOA, so PNOA uses the Pozuelo gold zone (a DEV-type zone).
 * DEV-2, the other GOLD zones and TEST are never read here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_LEARNED_OPTIONS, sourceFamily, type PoolModel } from '@marco-polo/core';
import { MODEL_PATH, v2Detector } from '../../packages/eval/src/detectors.js';
import { evaluateZone } from '../../packages/eval/src/evaluate.js';
import { TileSource } from '../../packages/eval/src/imagery.js';
import { loadLabels } from '../../packages/eval/src/labels.js';
import type { SourceId } from '../../packages/eval/src/candidates.js';
import { SOURCES } from '../../packages/eval/src/sources.js';
import { shiftsFor, sourceFor, zoneById } from '../../packages/eval/src/zones.js';

export const CALIBRATION_ZONES = ['vilamoura', 'odemira', 'braga', 'aix', 'balma', 'scottsdale', 'gold-pozuelo'];

/** Lowest score kept: the calibration has to see the low end too. */
export const CALIBRATION_FLOOR = 0.02;

export interface CalibrationRows {
  model: string;
  zones: string[];
  /** Pool labels in scope, per zone. */
  labelsByZone: Record<string, number>;
  familyByZone: Record<string, string>;
  rows: { zone: string; family: string; score: number; y: number }[];
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

async function main() {
  const out = arg('out');
  const cache = arg('cache', 'C:/dev/mp-cache/tiles');
  const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as PoolModel;
  if (Object.keys(model.calibration).length) throw new Error('give the uncalibrated model: calibration must be empty');
  const det = v2Detector({ learned: { ...DEFAULT_LEARNED_OPTIONS, floor: CALIBRATION_FLOOR } });
  const data: CalibrationRows = { model: MODEL_PATH, zones: CALIBRATION_ZONES, labelsByZone: {}, familyByZone: {}, rows: [] };
  for (const id of CALIBRATION_ZONES) {
    const z = zoneById(id);
    const sid = sourceFor(z, 'auto');
    const src = new TileSource({ provider: SOURCES[sid], cacheDir: cache, ratePerSec: 4 });
    const shifts = shiftsFor(z, sid);
    if (!shifts) throw new Error(`${id}: no label shift for ${sid}`);
    const lab = await loadLabels(z.id, { source: sid, osmShiftM: shifts.osm, visualShiftM: shifts.visual, visualShiftFor: (on) => shiftsFor(z, on as SourceId)?.visual });
    const run = await evaluateZone(z, lab.labels, { visual: lab.visual, overrides: lab.overrides, absent: lab.absent }, { ...det, thresholdFor: undefined }, src, 0);
    const fam = sourceFamily(src.provider.id);
    const conf = new Map(run.shown.map((d) => [d.id, d.confidence]));
    for (const p of run.result.pairs) data.rows.push({ zone: id, family: fam, score: conf.get(p.det)!, y: 1 });
    for (const u of run.result.unmatched) data.rows.push({ zone: id, family: fam, score: u.confidence, y: 0 });
    data.labelsByZone[id] = run.result.counts.labels;
    data.familyByZone[id] = fam;
    console.log(`${id} (${fam}): ${run.result.pairs.length} hits, ${run.result.unmatched.length} false positives, ${run.result.counts.labels} labels`);
  }
  writeFileSync(out, JSON.stringify(data));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/train/calibrate.ts')) await main();
