/**
 * Training data, step 1: labels and candidates for every training window.
 *
 *   npx tsx tools/train/prepare.ts [--recipe tools/train/recipe.json] [--work <dir>] [--cache <dir>]
 *       [--shard i/n]   (n processes side by side, then one run without --shard)
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
import { FEATURE_NAMES, latToWorldY, lonToWorldX, worldXToLon, worldYToLat, type BBox } from '@marco-polo/core';
import { parseCandidatesArgs, runCandidates } from '../../packages/cli/src/commands/candidates.js';
import { dedupeBoxes, passToGeo, sameObject, Z, zoneWindows, type PassFile } from '../../packages/eval/src/blind.js';
import { pointInPolygons, polygonsCentroid } from '../../packages/eval/src/geom.js';
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
  /** Sports pitches from OSM inside the training zones: their candidates are hard negatives. */
  courts?: { file: string; sha256: string; windowPx: number; zones: { id: string; source: string }[] };
}

interface CourtFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { id: string; zone: string; sport: string; kind?: 'pitch' | 'pool' };
}

/**
 * Windows around the pitches of one zone that lie outside its reviewed
 * windows, one per pitch unless an earlier window already holds its centre.
 * Inside them only OSM features are labelled: a candidate whose centre falls
 * in a pitch is "not a pool", one in an outdoor OSM pool is a pool (club pools
 * sit next to the courts and look like them), every other one is left out.
 */
export function courtWindows(
  courts: CourtFeature[],
  reviewed: { bbox: BBox }[],
  osmShiftM: [number, number],
  windowPx: number,
): { windows: { id: string; bbox: BBox }[]; courts: CourtFeature[] } {
  const shifted = courts.map((c) => {
    const f = shiftFeature({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [c.geometry.coordinates] }, properties: { id: c.properties.id, role: 'ignore' } } as LabelFeature, osmShiftM);
    return { ...c, geometry: { type: 'Polygon' as const, coordinates: (f.geometry.coordinates as number[][][][])[0] } };
  });
  const inBox = (lon: number, lat: number, b: BBox) => lon >= b.west && lon < b.east && lat <= b.north && lat > b.south;
  const windows: { id: string; bbox: BBox }[] = [];
  const kept: CourtFeature[] = [];
  for (const c of shifted) {
    const ctr = polygonsCentroid([c.geometry.coordinates as [number, number][][]]);
    if (c.properties.kind === 'pool') {
      kept.push(c);
      continue;
    }
    if (reviewed.some((w) => inBox(ctr.lon, ctr.lat, w.bbox))) continue;
    kept.push(c);
    if (windows.some((w) => inBox(ctr.lon, ctr.lat, w.bbox))) continue;
    const x0 = Math.round(lonToWorldX(ctr.lon, Z) - windowPx / 2);
    const y0 = Math.round(latToWorldY(ctr.lat, Z) - windowPx / 2);
    windows.push({
      id: `court-${c.properties.id.replace('/', '-')}`,
      bbox: { west: worldXToLon(x0, Z), east: worldXToLon(x0 + windowPx, Z), north: worldYToLat(y0, Z), south: worldYToLat(y0 + windowPx, Z) },
    });
  }
  return { windows, courts: kept };
}

/** 1 for a candidate whose centre lies in an OSM pool, 0 in a pitch, -1 (left out) anywhere else. */
export function courtTarget(lon: number, lat: number, courts: CourtFeature[]): 1 | 0 | -1 {
  const hit = courts.find((c) => pointInPolygons({ lon, lat }, [c.geometry.coordinates as [number, number][][]]));
  return !hit ? -1 : hit.properties.kind === 'pool' ? 1 : 0;
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
  // --shard i/n: this process computes every n-th window only (several run side by side);
  // a last run without --shard finds every window done and writes prepared.json.
  const [si, sn] = arg('shard', '0/1').split('/').map(Number);
  const mine = (i: number) => i % sn === si;
  mkdirSync(work, { recursive: true });
  const augmentFile = join(work, 'augment.json');
  writeFileSync(augmentFile, JSON.stringify(recipe.augment, null, 1));
  const manifest: Record<string, unknown>[] = [];
  let allCourts: CourtFeature[] = [];
  if (recipe.courts) {
    const raw = readFileSync(resolve(ROOT, recipe.courts.file));
    const sha = createHash('sha256').update(raw.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
    if (sha !== recipe.courts.sha256) throw new Error(`courts: file changed (sha256 ${sha}); update the recipe on purpose`);
    allCourts = (JSON.parse(raw.toString('utf8')) as { features: CourtFeature[] }).features;
  }
  for (const z of [...recipe.zones, ...(recipe.courts?.zones ?? [])]) {
    // Esri's terms forbid using its data to train systems.
    if (z.source.startsWith('esri')) throw new Error(`${z.id}: Esri imagery may not train the scorer`);
  }
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
    for (const [wi, w] of windows.entries()) {
      if (!mine(wi)) continue;
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
    if (!recipe.courts) continue;
    const recall = JSON.parse(readFileSync(join(REVIEW, z.id, 'osm-recall.json'), 'utf8')) as { osmShiftM: [number, number] };
    await courtCandidates(z, zdir, windows, recall.osmShiftM);
  }
  // Zones that only contribute pitches: no reviewed windows, OSM shift not measured (a pitch is far larger than a metre or two).
  for (const z of recipe.courts?.zones ?? []) {
    const zdir = join(work, z.id);
    mkdirSync(zdir, { recursive: true });
    await courtCandidates(z, zdir, [], [0, 0]);
  }

  async function courtCandidates(z: { id: string; source: string }, zdir: string, windows: { bbox: BBox }[], osmShiftM: [number, number]) {
    const cw = courtWindows(allCourts.filter((c) => c.properties.zone === z.id), windows, osmShiftM, recipe.courts!.windowPx);
    writeFileSync(join(zdir, 'courts.json'), JSON.stringify({ zone: z.id, source: z.source, windows: cw.windows, courts: cw.courts.map((c) => c.properties.id) }, null, 1));
    console.log(`${z.id}: ${cw.windows.length} court windows, ${cw.courts.filter((c) => c.properties.kind !== 'pool').length} pitches, ${cw.courts.filter((c) => c.properties.kind === 'pool').length} pools`);
    for (const [wi, w] of cw.windows.entries()) {
      if (!mine(wi)) continue;
      for (let copy = 0; copy < recipe.copies; copy++) {
        const out = join(zdir, `${w.id}-c${copy}`);
        if (existsSync(`${out}.meta.json`)) {
          const meta = JSON.parse(readFileSync(`${out}.meta.json`, 'utf8')) as { rows: number };
          manifest.push({ zone: z.id, window: w.id, copy, rows: meta.rows, court: true });
          continue;
        }
        const b = w.bbox;
        const argv = ['--bbox', `${b.south},${b.west},${b.north},${b.east}`, '--source', z.source, '--out', out, '--halo', String(recipe.halo), '--cache-dir', cache, '--quiet'];
        if (copy > 0) argv.push('--augment', augmentFile, '--copy', String(copy), '--seed', String(recipe.augmentSeed));
        const args = parseCandidatesArgs(argv);
        if (args === 'help') throw new Error('unexpected help');
        const { rows, features: f } = await runCandidates(args);
        const labelled = rows.map((r) => ({ ...r, y: courtTarget(r.lon, r.lat, cw.courts), court: 1 }));
        writeFileSync(`${out}.jsonl`, labelled.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
        writeFileSync(`${out}.f64`, Buffer.from(f.buffer, f.byteOffset, f.byteLength));
        writeFileSync(`${out}.meta.json`, JSON.stringify({ zone: z.id, window: w.id, copy, bbox: w.bbox, rows: rows.length, court: true }));
        manifest.push({ zone: z.id, window: w.id, copy, rows: rows.length, court: true });
        process.stdout.write(`  ${w.id} copy ${copy}: ${rows.length} candidates, ${labelled.filter((r) => r.y === 0).length} on a pitch, ${labelled.filter((r) => r.y === 1).length} on a pool\n`);
      }
    }
  }
  if (sn > 1) return;
  writeFileSync(join(work, 'prepared.json'), JSON.stringify({ recipe: recipePath, recipeSha256: createHash('sha256').update(readFileSync(recipePath)).digest('hex'), features: FEATURE_NAMES, files: manifest }, null, 1));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('prepare.ts')) {
  await main();
}
