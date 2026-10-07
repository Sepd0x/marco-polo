/**
 * Hand-labelling support.
 *
 * `review` cuts an area into 1024 px windows at z19 and draws on each: the
 * existing labels (green = pool, yellow = ignored), and numbered magenta boxes
 * for every unlabelled candidate a deliberately loose colour detector finds.
 * A person looks at every window and writes a review file:
 *
 *   {
 *     "accept": [3, 17],                       // candidates that are pools
 *     "boxes": [{ "window": "w-02-03", "box": [410, 220, 455, 300], "note": "green pool" }],
 *     "ignore": [{ "id": "way/123", "reason": "covered in imagery" }],
 *     "drop": [{ "id": "way/456", "reason": "not a pool in imagery" }]
 *   }
 *
 * `extra` turns it into labels/<area>.extra.geojson (source = visual).
 * Boxes catch the pools no colour rule sees (dark, green, shaded), so the
 * hand-made labels are not limited to what a detector can find.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  buildScanPlan,
  DEFAULT_THRESHOLDS,
  DetectionMerger,
  detectTile,
  latToWorldY,
  lonToWorldX,
  metersPerPixel,
  worldXToLon,
  worldYToLat,
  type Ring,
} from '@marco-polo/core';
import { encodePng } from '../../cli/src/tiles.js';
import { Raster, type RGB } from './draw.js';
import { closeRing } from './geom.js';
import type { TileSource } from './imagery.js';
import { LABELS_DIR, loadLabels } from './labels.js';
import { hits } from './match.js';
import type { LabelFeature } from './overpass.js';
import type { EvalDetection } from './types.js';
import { zoneById } from './zones.js';

const Z = 19;
const WIN = 1100;

/** A loose colour gate: over-generates on purpose, a person filters. */
const LOOSE = {
  ...DEFAULT_THRESHOLDS,
  hueMin: 140,
  hueMax: 228,
  satMin: 0.14,
  satStrong: 0.24,
  valBright: 0.42,
  valMin: 0.22,
  blueOverRed: 4,
  greenOverRed: -16,
  blueOverGreenMin: -16,
  blueOverGreenMax: 90,
};

/** Second pass for deep-blue liners (hue above the water band), which the first gate never sees. */
const BLUE = {
  ...DEFAULT_THRESHOLDS,
  hueMin: 200,
  hueMax: 250,
  satMin: 0.3,
  satStrong: 0.3,
  valBright: 0.3,
  valMin: 0.2,
  blueOverRed: 25,
  greenOverRed: -60,
  blueOverGreenMin: 0,
  blueOverGreenMax: 200,
};

interface Candidate {
  n: number;
  window: string;
  center: { lon: number; lat: number };
  bbox: EvalDetection['bbox'];
  outline: Ring[];
  areaM2: number;
  confidence: number;
}

interface WindowInfo {
  id: string;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export async function renderReview(zoneId: string, src: TileSource, outRoot: string, gate: 'loose' | 'blue' = 'loose'): Promise<void> {
  const zone = zoneById(zoneId);
  const out = join(outRoot, zone.id);
  await mkdir(out, { recursive: true });
  const { labels } = await loadLabels(zone.id, { osmShiftM: zone.osmShiftM?.esri ?? [0, 0] });

  const ring: Ring = [
    [zone.bbox.west, zone.bbox.south],
    [zone.bbox.east, zone.bbox.south],
    [zone.bbox.east, zone.bbox.north],
    [zone.bbox.west, zone.bbox.north],
  ];
  const plan = buildScanPlan(ring, Z);
  const merger = new DetectionMerger({ minAreaM2: 2.5, maxAreaM2: 3000 }, plan.tiles.map((t) => t.tile));
  for (const st of plan.tiles) {
    const img = await src.get(st.tile);
    merger.addTileDetections(st.tile, img ? detectTile(img.rgba, img.width, img.height, st.tile, { thresholds: gate === 'blue' ? BLUE : LOOSE, maxTexture: 0.22, minAreaM2: 2.5, minPixels: 30, maxAspect: 10 }) : []);
  }
  merger.finalize();
  const loose = merger.getAll();

  const X0 = Math.floor(lonToWorldX(zone.bbox.west, Z)), X1 = Math.ceil(lonToWorldX(zone.bbox.east, Z));
  const Y0 = Math.floor(latToWorldY(zone.bbox.north, Z)), Y1 = Math.ceil(latToWorldY(zone.bbox.south, Z));
  // Equal windows no larger than WIN px, so none is a thin leftover strip.
  const nx = Math.ceil((X1 - X0) / WIN), ny = Math.ceil((Y1 - Y0) / WIN);
  const ww = Math.ceil((X1 - X0) / nx), wh = Math.ceil((Y1 - Y0) / ny);
  const windows: WindowInfo[] = [];
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const x0 = X0 + c * ww, y0 = Y0 + r * wh;
      windows.push({ id: `w-${String(r + 1).padStart(2, '0')}-${String(c + 1).padStart(2, '0')}`, x0, y0, w: Math.min(ww, X1 - x0), h: Math.min(wh, Y1 - y0) });
    }
  }

  const candidates: Candidate[] = [];
  const unlabelled = loose
    .map((d) => ({ d, ev: { id: d.id, center: d.center, bbox: d.bbox, outline: d.outline.map((r) => [r]), areaM2: d.areaM2, confidence: d.confidence } as EvalDetection }))
    .filter(({ ev }) => !labels.some((l) => hits(ev, l).ok))
    .sort((a, b) => b.d.center.lat - a.d.center.lat || a.d.center.lon - b.d.center.lon);
  for (const { d } of unlabelled) {
    const px = lonToWorldX(d.center.lon, Z), py = latToWorldY(d.center.lat, Z);
    const win = windows.find((w) => px >= w.x0 && px < w.x0 + w.w && py >= w.y0 && py < w.y0 + w.h);
    if (!win) continue;
    candidates.push({ n: candidates.length + 1, window: win.id, center: d.center, bbox: d.bbox, outline: d.outline, areaM2: d.areaM2, confidence: d.confidence });
  }

  const GREEN: RGB = [0, 255, 0], YELLOW: RGB = [255, 230, 0], MAGENTA: RGB = [255, 40, 255], WHITE: RGB = [255, 255, 255];
  for (const w of windows) {
    const rgba = await src.crop(Z, w.x0, w.y0, w.w, w.h);
    const r = new Raster(w.w, w.h);
    r.data.set(rgba);
    const P = (lon: number, lat: number): [number, number] => [lonToWorldX(lon, Z) - w.x0, latToWorldY(lat, Z) - w.y0];
    for (const l of labels) {
      const c = l.role === 'pool' ? GREEN : YELLOW;
      if (l.point) {
        const [x, y] = P(l.point.lon, l.point.lat);
        const rad = (l.radiusM ?? 5) / metersPerPixel(l.point.lat, Z);
        r.rect(x - rad, y - rad, x + rad, y + rad, c, 1, 3);
        continue;
      }
      for (const poly of l.polygons) for (const ring of poly) r.ring(ring.map(([a, b]) => P(a, b)), c, 2, l.role === 'pool' ? 0 : 4);
    }
    for (const c of candidates.filter((c) => c.window === w.id)) {
      const [x0, y0] = P(c.bbox.west, c.bbox.north);
      const [x1, y1] = P(c.bbox.east, c.bbox.south);
      r.rect(x0 - 3, y0 - 3, x1 + 3, y1 + 3, MAGENTA, 1);
      r.text(Math.round(x1 + 4), Math.round(y0 - 4), String(c.n), MAGENTA, 2);
    }
    for (let t = 0; t <= Math.max(w.w, w.h); t += 128) {
      r.line(t, 0, t, 8, WHITE, 1);
      r.line(0, t, 8, t, WHITE, 1);
      if (t > 0 && t < w.w) r.text(t + 2, 0, String(t), WHITE, 1);
      if (t > 0 && t < w.h) r.text(0, t + 2, String(t), WHITE, 1);
    }
    r.text(w.w - 60, w.h - 16, w.id.slice(2), WHITE, 2);
    await writeFile(join(out, `${w.id}.png`), encodePng(r.data, w.w, w.h));
  }
  await writeFile(join(out, 'candidates.json'), JSON.stringify(candidates, null, 1), 'utf8');
  await writeFile(join(out, 'windows.json'), JSON.stringify(windows, null, 1), 'utf8');
  console.log(`${zone.id}: ${windows.length} windows, ${candidates.length} unlabelled candidates → ${out}`);
}

interface ReviewFile {
  accept?: number[];
  /** Candidates that might be pools: stored as ignore regions, never scored. */
  unsure?: number[];
  unsureBoxes?: Array<{ window: string; box: [number, number, number, number]; note?: string }>;
  boxes?: Array<{ window: string; box: [number, number, number, number]; note?: string }>;
  /** Real pools found in a run's false-positive gallery: labelled with that detection's box. */
  fromGallery?: Array<{ items: string; fp: number[]; role?: 'pool' | 'ignore' }>;
  /** Candidates from another review pass (e.g. the blue-liner gate), by file. */
  fromCandidates?: Array<{ file: string; n: number[]; role?: 'pool' | 'ignore' }>;
  ignore?: Array<{ id: string; reason: string }>;
  drop?: Array<{ id: string; reason: string }>;
}

export async function buildExtra(zoneId: string, reviewPath: string): Promise<void> {
  const zone = zoneById(zoneId);
  const dir = dirname(reviewPath);
  const review = JSON.parse(await readFile(reviewPath, 'utf8')) as ReviewFile;
  const candidates = JSON.parse(await readFile(join(dir, 'candidates.json'), 'utf8')) as Candidate[];
  const windows = JSON.parse(await readFile(join(dir, 'windows.json'), 'utf8')) as WindowInfo[];
  const osm = JSON.parse(await readFile(join(LABELS_DIR, `${zone.id}.geojson`), 'utf8')) as { features: LabelFeature[] };

  const features: LabelFeature[] = [];
  for (const n of review.accept ?? []) {
    const c = candidates.find((x) => x.n === n);
    if (!c) throw new Error(`candidate ${n} not in candidates.json`);
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: c.outline.map((r) => [closeRing(r)]) },
      properties: { id: `visual/${zone.id}/c${n}`, source: 'visual', role: 'pool', method: 'candidate outline, confirmed by eye' },
    });
  }
  for (const n of review.unsure ?? []) {
    const c = candidates.find((x) => x.n === n);
    if (!c) throw new Error(`candidate ${n} not in candidates.json`);
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: c.outline.map((r) => [closeRing(r)]) },
      properties: { id: `visual/${zone.id}/u${n}`, source: 'visual', role: 'ignore', reason: 'unsure by eye', method: 'candidate outline' },
    });
  }
  const boxFeature = (b: { window: string; box: [number, number, number, number]; note?: string }, id: string, role: 'pool' | 'ignore'): LabelFeature => {
    const w = windows.find((x) => x.id === b.window);
    if (!w) throw new Error(`window ${b.window} not in windows.json`);
    const [x0, y0, x1, y1] = b.box;
    const lon0 = worldXToLon(w.x0 + x0, Z), lon1 = worldXToLon(w.x0 + x1, Z);
    const lat0 = worldYToLat(w.y0 + y0, Z), lat1 = worldYToLat(w.y0 + y1, Z);
    return {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [[closeRing([[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1]])]] },
      properties: { id, source: 'visual', role, reason: role === 'ignore' ? 'unsure by eye' : undefined, method: 'box drawn by eye', note: b.note },
    };
  };
  for (const g of review.fromCandidates ?? []) {
    const list = JSON.parse(await readFile(g.file, 'utf8')) as Candidate[];
    for (const n of g.n) {
      const c = list.find((x) => x.n === n);
      if (!c) throw new Error(`candidate ${n} not in ${g.file}`);
      features.push({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: c.outline.map((r) => [closeRing(r)]) },
        properties: {
          id: `visual/${zone.id}/x-${basename(g.file).split('.')[0]}-${n}`,
          source: 'visual',
          role: g.role ?? 'pool',
          reason: g.role === 'ignore' ? 'unsure by eye' : undefined,
          method: 'second-pass candidate outline, checked by eye',
        },
      });
    }
  }
  for (const g of review.fromGallery ?? []) {
    const items = JSON.parse(await readFile(g.items, 'utf8')) as Array<{ n: number; kind: string; bbox: { west: number; east: number; south: number; north: number } }>;
    for (const n of g.fp) {
      const it = items.find((x) => x.kind === 'fp' && x.n === n);
      if (!it) throw new Error(`fp ${n} not in ${g.items}`);
      const b = it.bbox;
      features.push({
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[closeRing([[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]])]] },
        properties: {
          id: `visual/${zone.id}/g-${basename(g.items).split('.')[0]}-${n}`,
          source: 'visual',
          role: g.role ?? 'pool',
          reason: g.role === 'ignore' ? 'unsure by eye' : undefined,
          method: 'detection box, checked by eye in the FP gallery',
        },
      });
    }
  }
  (review.boxes ?? []).forEach((b, i) => features.push(boxFeature(b, `visual/${zone.id}/b${i + 1}`, 'pool')));
  (review.unsureBoxes ?? []).forEach((b, i) => features.push(boxFeature(b, `visual/${zone.id}/ub${i + 1}`, 'ignore')));
  for (const [list, role] of [[review.ignore ?? [], 'ignore'], [review.drop ?? [], 'drop']] as const) {
    for (const o of list) {
      // A hand-made label can be demoted too (it is already in `features`).
      const own = features.find((x) => x.properties.id === o.id);
      if (own) {
        own.properties = { ...own.properties, role: 'ignore', reason: `hand: ${o.reason}` };
        continue;
      }
      const f = osm.features.find((x) => x.properties.id === o.id);
      if (!f) throw new Error(`${o.id} not in OSM labels or this review`);
      // "drop" (not a pool at all) is stored as ignore with the reason: the
      // detector is then neither rewarded nor punished there.
      features.push({ ...f, properties: { ...f.properties, role: 'ignore', reason: `${role === 'drop' ? 'not a pool in imagery' : 'hand'}: ${o.reason}` } });
    }
  }
  const file = {
    type: 'FeatureCollection',
    zone: zone.id,
    note: 'Hand-checked supplement to the OSM labels, drawn by eye on Esri World Imagery z19. Features with an OSM id override that OSM feature.',
    created: new Date().toISOString().slice(0, 10),
    features,
  };
  await writeFile(join(LABELS_DIR, `${zone.id}.extra.geojson`), JSON.stringify(file, null, 1) + '\n', 'utf8');
  console.log(`${zone.id}: ${features.length} hand features written`);
}
