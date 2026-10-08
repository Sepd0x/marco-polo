/**
 * Training data, step 1: labels and candidates for every training window.
 *
 *   npx tsx tools/train/prepare.ts [--recipe tools/train/recipe.json] [--work <dir>] [--cache <dir>]
 *
 * A training window is one of the 10 windows of a zone reviewed blind for
 * the OSM recall check (packages/eval/labels/review/<zone>/recall.json).
 * Inside them the labels are complete: hand boxes, with the OSM outline when
 * OSM has the pool. OSM pools nobody boxed, and boxes marked unsure, become
 * "ignore". Candidates and features come from the CLI's candidates code, the
 * same code the product runs; nothing is recomputed in Python.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_NAMES, worldXToLon, worldYToLat, type BBox } from '@marco-polo/core';
import { parseCandidatesArgs, runCandidates } from '../../packages/cli/src/commands/candidates.js';
import { dedupeBoxes, passToGeo, sameObject, Z, zoneWindows, type PassFile } from '../../packages/eval/src/blind.js';
import { featureToLabel, shiftFeature } from '../../packages/eval/src/labels.js';
import { recallWindows } from '../../packages/eval/src/osmrecall.js';
import type { LabelFeature } from '../../packages/eval/src/overpass.js';
import { zoneById } from '../../packages/eval/src/zones.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
const REVIEW = join(ROOT, 'packages/eval/labels/review');

interface RecipeZone {
  id: string;
  /** Source the windows are read from: dgt (Ortos2025), dgt2018, pnoa or ign. */
  source: string;
  /** sha256 of recall.json and osm.geojson, so the recipe pins its labels. */
  labelsSha256: string;
}

export interface Recipe {
  zones: RecipeZone[];
  halo: number;
  /** Copies per window: copy 0 is the imagery as served, the others are augmented. */
  copies: number;
  augmentSeed: number;
  augment: Record<string, unknown>;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function labelsSha256(zone: string): string {
  const h = createHash('sha256');
  for (const f of ['recall.json', 'osm.geojson']) h.update(readFileSync(join(REVIEW, zone, f)).toString('utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex');
}

const ring = (b: BBox): number[][] => [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];

/** Complete labels inside the reviewed windows of a zone. */
export function trainingLabels(zoneId: string): { features: LabelFeature[]; windows: { id: string; bbox: BBox }[]; counts: Record<string, number> } {
  const zone = zoneById(zoneId);
  const all = zoneWindows(zone);
  const ids = recallWindows(zone.id, all.map((w) => w.id));
  const windows = all.filter((w) => ids.includes(w.id));
  const pass = JSON.parse(readFileSync(join(REVIEW, zone.id, 'recall.json'), 'utf8')) as PassFile;
  const recall = JSON.parse(readFileSync(join(REVIEW, zone.id, 'osm-recall.json'), 'utf8')) as { osmShiftM: [number, number] };
  const boxes = dedupeBoxes(passToGeo(pass, windows));
  const osm = (JSON.parse(readFileSync(join(REVIEW, zone.id, 'osm.geojson'), 'utf8')) as { features: LabelFeature[] }).features.map((f) => shiftFeature(f, recall.osmShiftM));
  const bboxOf = (w: (typeof windows)[number]): BBox => ({
    west: worldXToLon(w.x0, Z),
    east: worldXToLon(w.x0 + w.size, Z),
    north: worldYToLat(w.y0, Z),
    south: worldYToLat(w.y0 + w.size, Z),
  });
  const wins = windows.map((w) => ({ id: w.id, bbox: bboxOf(w) }));
  const inWins = (lon: number, lat: number) => wins.some((w) => lon >= w.bbox.west && lon < w.bbox.east && lat <= w.bbox.north && lat > w.bbox.south);

  const features: LabelFeature[] = [];
  const used = new Set<string>();
  const counts = { handPool: 0, handPoolWithOsm: 0, unsure: 0, osmOnly: 0, osmIgnore: 0 };
  for (const b of boxes) {
    if (b.kind === 'u') {
      counts.unsure++;
      features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring(b.bbox)]] }, properties: { id: `hand/${zone.id}/${b.window}/${features.length}`, source: 'visual', role: 'ignore', reason: 'unsure in the blind review' } });
      continue;
    }
    counts.handPool++;
    const match = osm.find((f) => f.properties.role === 'pool' && !used.has(f.properties.id) && f.geometry.type !== 'Point' && sameObject(featureToLabel(f).bbox, b.bbox));
    if (match) {
      used.add(match.properties.id);
      counts.handPoolWithOsm++;
      features.push(match);
    } else {
      features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring(b.bbox)]] }, properties: { id: `hand/${zone.id}/${b.window}/${features.length}`, source: 'visual', role: 'pool' } });
    }
  }
  for (const f of osm) {
    if (used.has(f.properties.id)) continue;
    const c = featureToLabel(f).centroid;
    if (!inWins(c.lon, c.lat)) continue;
    // In the windows but not boxed: the reviewer missed it, or OSM is out of date. Neither way a target.
    if (f.properties.role === 'pool') counts.osmOnly++;
    else counts.osmIgnore++;
    features.push({ ...f, properties: { ...f.properties, role: 'ignore', reason: f.properties.role === 'pool' ? 'OSM pool not boxed in the blind review' : f.properties.reason } });
  }
  return { features, windows: wins, counts };
}

async function main() {
  const recipePath = resolve(arg('recipe', join(HERE, 'recipe.json')));
  const work = resolve(arg('work', 'C:/dev/mp-research/detect-v2/train-work'));
  const cache = arg('cache', 'C:/dev/mp-cache/train');
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8')) as Recipe;
  mkdirSync(work, { recursive: true });
  const augmentFile = join(work, 'augment.json');
  writeFileSync(augmentFile, JSON.stringify(recipe.augment, null, 1));
  const manifest: Record<string, unknown>[] = [];
  for (const z of recipe.zones) {
    const sha = labelsSha256(z.id);
    if (sha !== z.labelsSha256) throw new Error(`${z.id}: labels changed (sha256 ${sha}); update the recipe on purpose`);
    const { features, windows, counts } = trainingLabels(z.id);
    const zdir = join(work, z.id);
    mkdirSync(zdir, { recursive: true });
    const labelsFile = join(zdir, 'labels.geojson');
    writeFileSync(labelsFile, JSON.stringify({ type: 'FeatureCollection', attribution: '© OpenStreetMap contributors, ODbL 1.0', features }));
    writeFileSync(join(zdir, 'windows.json'), JSON.stringify({ zone: z.id, source: z.source, windows }, null, 1));
    console.log(`${z.id}: ${windows.length} windows, labels ${JSON.stringify(counts)}`);
    for (const w of windows) {
      for (let copy = 0; copy < recipe.copies; copy++) {
        const out = join(zdir, `${w.id}-c${copy}`);
        if (existsSync(`${out}.meta.json`)) {
          const meta = JSON.parse(readFileSync(`${out}.meta.json`, 'utf8')) as { rows: number };
          manifest.push({ zone: z.id, window: w.id, copy, rows: meta.rows });
          continue;
        }
        const b = w.bbox;
        const argv = ['--bbox', `${b.south},${b.west},${b.north},${b.east}`, '--source', z.source, '--out', out, '--labels', labelsFile, '--halo', String(recipe.halo), '--cache-dir', cache, '--quiet'];
        if (copy > 0) argv.push('--augment', augmentFile, '--copy', String(copy), '--seed', String(recipe.augmentSeed));
        const args = parseCandidatesArgs(argv);
        if (args === 'help') throw new Error('unexpected help');
        const { rows, features: f } = await runCandidates(args);
        writeFileSync(`${out}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
        writeFileSync(`${out}.f64`, Buffer.from(f.buffer, f.byteOffset, f.byteLength));
        writeFileSync(`${out}.meta.json`, JSON.stringify({ zone: z.id, window: w.id, copy, bbox: w.bbox, rows: rows.length }));
        manifest.push({ zone: z.id, window: w.id, copy, rows: rows.length });
        process.stdout.write(`  ${w.id} copy ${copy}: ${rows.length} candidates\n`);
      }
    }
  }
  writeFileSync(join(work, 'prepared.json'), JSON.stringify({ recipe: recipePath, recipeSha256: createHash('sha256').update(readFileSync(recipePath)).digest('hex'), features: FEATURE_NAMES, files: manifest }, null, 1));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('prepare.ts')) {
  await main();
}
