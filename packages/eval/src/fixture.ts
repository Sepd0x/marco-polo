/**
 * The open fixture for CI, e2e and the JPEG parity test: a few blocks of z19
 * tiles from sources whose licence allows redistribution (DGT Ortos2025 CC BY
 * 4.0, PNOA CC BY 4.0, IGN Licence Ouverte 2.0), with their labels.
 *
 *   fixtures/open/manifest.json         every tile: source, z/x/y, URL, EPSG:3857 box, sha256
 *   fixtures/open/tiles/<source>/19-<x>-<y>.jpg   the bytes the source served
 *   fixtures/open/labels.geojson        pools inside the fixture blocks, on each block's source
 *   fixtures/open/ATTRIBUTION.md
 *
 * Esri tiles never go in: its terms only allow viewing.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tileBBox, type BBox } from '@marco-polo/core';
import type { SourceId } from './candidates.js';
import { featureToLabel } from './labels.js';
import type { LabelFeature } from './overpass.js';
import { redistributable, SOURCES, tileBounds3857 } from './sources.js';
import type { TileSource } from './imagery.js';
import { boxFeature, boxToBBox, type Box } from './blind.js';

export interface FixtureBlock {
  id: string;
  source: SourceId;
  /** Zone the block sits in (its frozen labels are used when `labels` is "zone"). */
  zone: string;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

export const FIXTURE_MAX_BYTES = 1.5 * 1024 * 1024;

export function blockBBox(b: FixtureBlock): BBox {
  const nw = tileBBox({ z: 19, x: b.x0, y: b.y0 });
  const se = tileBBox({ z: 19, x: b.x0 + b.cols - 1, y: b.y0 + b.rows - 1 });
  return { west: nw.west, north: nw.north, east: se.east, south: se.south };
}

/** Raw bytes of a tile through the source's cache (fetching if needed). */
async function rawBytes(src: TileSource, x: number, y: number): Promise<{ url: string; buf: Buffer }> {
  await src.get({ z: 19, x, y });
  const url = src.urlFor({ z: 19, x, y });
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 24);
  const path = join(src.opts.cacheDir, `19-${x}-${y}-${hash}.bin`);
  if (!existsSync(path)) throw new Error(`tile not cached: ${url}`);
  return { url, buf: readFileSync(path) };
}

export async function buildFixture(blocks: FixtureBlock[], labels: Map<string, LabelFeature[]>, out: string, src: (s: SourceId) => TileSource): Promise<number> {
  const tiles: Array<{ block: string; source: string; provider: string; z: number; x: number; y: number; url: string; bbox3857: number[]; file: string; sha256: string; bytes: number }> = [];
  let total = 0;
  for (const b of blocks) {
    if (!redistributable(b.source)) throw new Error(`${b.source} tiles cannot go in the repo`);
    const s = src(b.source);
    await mkdir(join(out, 'tiles', b.source), { recursive: true });
    for (let y = b.y0; y < b.y0 + b.rows; y++) {
      for (let x = b.x0; x < b.x0 + b.cols; x++) {
        const { url, buf } = await rawBytes(s, x, y);
        const file = `tiles/${b.source}/19-${x}-${y}.jpg`;
        await writeFile(join(out, file), buf);
        total += buf.length;
        tiles.push({ block: b.id, source: b.source, provider: SOURCES[b.source].id, z: 19, x, y, url, bbox3857: tileBounds3857({ z: 19, x, y }).map((v) => Math.round(v * 1000) / 1000), file, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length });
      }
    }
  }
  const features: LabelFeature[] = [];
  for (const b of blocks) {
    const box = blockBBox(b);
    for (const f of labels.get(b.id) ?? []) {
      const c = featureToLabel(f).centroid;
      if (c.lon >= box.west && c.lon <= box.east && c.lat >= box.south && c.lat <= box.north) {
        features.push({ ...f, properties: { ...f.properties, id: `${b.id}/${f.properties.id}` } });
      }
    }
  }
  const manifest = {
    about: 'Open imagery for CI and e2e tests. Bytes exactly as each source served them; see ATTRIBUTION.md.',
    blocks: blocks.map((b) => ({ ...b, bbox: blockBBox(b), attribution: SOURCES[b.source].attribution, licence: SOURCES[b.source].licence, licenceUrl: SOURCES[b.source].licenceUrl })),
    tiles,
    totalBytes: total,
  };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  await writeFile(
    join(out, 'labels.geojson'),
    JSON.stringify({ type: 'FeatureCollection', attribution: 'Hand labels and OSM features (c) OpenStreetMap contributors, ODbL 1.0', features }, null, 1) + '\n',
    'utf8',
  );
  const attr = [
    '# Fixture imagery: attribution and licences',
    '',
    ...[...new Set(blocks.map((b) => b.source))].map((s) => `- \`tiles/${s}/\`: ${SOURCES[s].attribution}. Licence: ${SOURCES[s].licence}, ${SOURCES[s].licenceUrl}. Unmodified tiles as served by the source.`),
    '- `labels.geojson`: hand labels made for this benchmark and OpenStreetMap features. (c) OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright',
    '',
  ].join('\n');
  await writeFile(join(out, 'ATTRIBUTION.md'), attr, 'utf8');
  if (total > FIXTURE_MAX_BYTES) throw new Error(`fixture is ${total} bytes, over ${FIXTURE_MAX_BYTES}`);
  return total;
}

export interface FixtureSpec {
  blocks: Array<FixtureBlock & { labels: 'zone' | 'hand' }>;
  hand: Record<string, Box[]>;
}

/** Labels of each block: the zone's frozen label file (blind zones), or the hand boxes of the spec. */
export function specLabels(spec: FixtureSpec, labelsDir: string): Map<string, LabelFeature[]> {
  const out = new Map<string, LabelFeature[]>();
  for (const b of spec.blocks) {
    if (b.labels === 'zone') {
      out.set(b.id, (JSON.parse(readFileSync(join(labelsDir, `${b.zone}.geojson`), 'utf8')) as { features: LabelFeature[] }).features);
    } else {
      const w = { id: b.id, x0: b.x0 * 256, y0: b.y0 * 256, size: 1024 };
      out.set(b.id, (spec.hand[b.id] ?? []).map((bx, i) => boxFeature(boxToBBox(w, bx), `visual/fixture/${b.id}/b${i + 1}`, bx[4] === 'p' ? 'pool' : 'ignore', { method: 'fixture box, reviewed on this source' })));
    }
  }
  return out;
}
