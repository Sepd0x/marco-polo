/**
 * Symmetric adjudication (plan A7). After a TEST run, every unmatched
 * detection of both versions is pooled, duplicates across versions merged,
 * shuffled with a fixed seed and shown on clean imagery with the same neutral
 * frame, so the reviewer cannot tell which version found it. Verdicts:
 * "pool", "not" or "unsure". Confirmed pools form an adjudicated label set
 * with its own sha256, valid for both versions.
 *
 *   prepare  <dir>/sheet-NN.png, <dir>/verdicts.json (to fill), <dir>/key.json (do not open while judging)
 *   apply    labels/adjudicated/<zone>.geojson and labels/adjudicated/adjudicated.sha256
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { latToWorldY, lonToWorldX, type BBox } from '@marco-polo/core';
import { encodePng } from '../../cli/src/tiles.js';
import { boxFeature, sameObject } from './blind.js';
import { rng } from './bootstrap.js';
import type { SourceId } from './candidates.js';
import { Raster } from './draw.js';
import type { UnmatchedRecord } from './evaluate.js';
import { readFreeze, sha256, writeFreeze } from './freeze.js';
import type { ReportFile } from './gate.js';
import type { TileSource } from './imagery.js';
import { SOURCES } from './sources.js';

export const ADJ_SEED = 7102026;

export interface AdjItem {
  n: number;
  zone: string;
  source: string;
  bbox: BBox;
  /** Which run found it: kept in key.json only. */
  found: Array<{ run: 'a' | 'b'; id: string }>;
}

const union = (a: BBox, b: BBox): BBox => ({ west: Math.min(a.west, b.west), south: Math.min(a.south, b.south), east: Math.max(a.east, b.east), north: Math.max(a.north, b.north) });

/** Pool the unmatched, non-duplicate detections of two runs, merge the same object, shuffle. */
export function poolUnmatched(a: ReportFile, b: ReportFile, roles: string[] = ['TEST']): AdjItem[] {
  const items: AdjItem[] = [];
  for (const za of a.zones.filter((z) => roles.includes(z.role))) {
    const zb = b.zones.find((z) => z.zone === za.zone);
    if (!zb) continue;
    const add = (run: 'a' | 'b', d: UnmatchedRecord, source: string) => {
      if (d.duplicate) return;
      const same = items.find((it) => it.zone === za.zone && sameObject(it.bbox, d.bbox));
      if (same) {
        same.bbox = union(same.bbox, d.bbox);
        same.found.push({ run, id: d.id });
      } else items.push({ n: 0, zone: za.zone, source, bbox: d.bbox, found: [{ run, id: d.id }] });
    };
    for (const d of za.unmatched) add('a', d, za.source);
    for (const d of zb.unmatched) add('b', d, zb.source);
  }
  const r = rng(ADJ_SEED);
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  items.forEach((it, i) => (it.n = i + 1));
  return items;
}

const sourceIdOf = (providerId: string): SourceId => {
  const hit = (Object.keys(SOURCES) as SourceId[]).find((k) => SOURCES[k].id === providerId);
  if (!hit) throw new Error(`unknown source ${providerId}`);
  return hit;
};

export async function adjudicatePrepare(a: ReportFile, b: ReportFile, dir: string, src: (s: SourceId) => TileSource): Promise<void> {
  if (a.meta.labelsHash !== b.meta.labelsHash) throw new Error('the two runs used different labels');
  const items = poolUnmatched(a, b);
  await mkdir(dir, { recursive: true });
  const Z = 19, CROP = 112, SCALE = 2, CELL = CROP * SCALE, COLS = 4, ROWS = 4, GAP = 6;
  for (let s = 0; s * COLS * ROWS < items.length; s++) {
    const r = new Raster(COLS * (CELL + GAP), ROWS * (CELL + GAP + 20), [20, 20, 20]);
    for (let k = 0; k < COLS * ROWS; k++) {
      const it = items[s * COLS * ROWS + k];
      if (!it) break;
      const ts = src(sourceIdOf(it.source));
      const cx = lonToWorldX((it.bbox.west + it.bbox.east) / 2, Z), cy = latToWorldY((it.bbox.south + it.bbox.north) / 2, Z);
      const x0 = Math.round(cx - CROP / 2), y0 = Math.round(cy - CROP / 2);
      const ox = (k % COLS) * (CELL + GAP), oy = Math.floor(k / COLS) * (CELL + GAP + 20);
      r.blit(await ts.crop(Z, x0, y0, CROP, CROP), CROP, CROP, ox, oy + 20, CELL, CELL);
      // Same neutral frame for every item, a few pixels outside the box.
      const px = (lon: number) => ox + (lonToWorldX(lon, Z) - x0) * SCALE;
      const py = (lat: number) => oy + 20 + (latToWorldY(lat, Z) - y0) * SCALE;
      r.rect(px(it.bbox.west) - 6, py(it.bbox.north) - 6, px(it.bbox.east) + 6, py(it.bbox.south) + 6, [255, 255, 255], 1, 3);
      r.text(ox + 2, oy + 2, `${it.n}`, [255, 255, 255], 2);
    }
    await writeFile(join(dir, `sheet-${String(s + 1).padStart(2, '0')}.png`), encodePng(r.data, r.width, r.height));
  }
  await writeFile(join(dir, 'verdicts.json'), JSON.stringify(Object.fromEntries(items.map((it) => [String(it.n), ''])), null, 1) + '\n', 'utf8');
  await writeFile(join(dir, 'key.json'), JSON.stringify({ a: a.meta.name, b: b.meta.name, labelsHash: a.meta.labelsHash, items }, null, 1), 'utf8');
  await writeFile(
    join(dir, 'INSTRUCTIONS.txt'),
    'Each numbered crop shows a place a detector marked, inside a dashed white frame. Write in verdicts.json, for every number: "pool" if there is a swimming pool in the frame, "not" if there is none, "unsure" if you cannot tell. Do not open key.json.\n',
    'utf8',
  );
  console.log(`${items.length} items to judge -> ${dir}`);
}

export async function adjudicateApply(dir: string, labelsDir: string): Promise<void> {
  const key = JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8')) as { items: AdjItem[] };
  const verdicts = JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8')) as Record<string, string>;
  const open = key.items.filter((it) => !['pool', 'not', 'unsure'].includes(verdicts[String(it.n)]));
  if (open.length) throw new Error(`${open.length} items without a verdict (pool, not or unsure)`);
  const out = join(labelsDir, 'adjudicated');
  await mkdir(out, { recursive: true });
  const byZone = new Map<string, AdjItem[]>();
  for (const it of key.items) if (verdicts[String(it.n)] !== 'not') byZone.set(it.zone, [...(byZone.get(it.zone) ?? []), it]);
  const frozen = readFreeze(out, 'adjudicated.sha256');
  for (const [zone, its] of byZone) {
    const path = join(out, `${zone}.geojson`);
    if (existsSync(path)) throw new Error(`${path} exists: adjudicated sets only grow through a new file per run`);
    const features = its.map((it) =>
      boxFeature(it.bbox, `adjudicated/${zone}/${it.n}`, verdicts[String(it.n)] === 'pool' ? 'pool' : 'ignore', { method: 'symmetric adjudication, blind to the version' }),
    );
    const body = JSON.stringify({ type: 'FeatureCollection', zone, labelsHash: (key as unknown as { labelsHash: string }).labelsHash, features }, null, 1) + '\n';
    await writeFile(path, body, 'utf8');
    frozen.set(`${zone}.geojson`, sha256(body));
  }
  writeFreeze(out, frozen, 'adjudicated.sha256');
  console.log(`adjudicated: ${[...byZone.values()].flat().length} items in ${byZone.size} zones -> ${out}`);
}
