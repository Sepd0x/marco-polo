/**
 * The before and after pictures of the README: one crop of a zone, drawn on
 * the open imagery, with what v1 and v2 found there.
 *
 *   npx tsx src/figure.ts --zone marbella --out ../../docs/media [--panels v1,v2]
 *     [--name v2] [--size 1000] [--px 880] [--cache <dir>] [--offline]
 *
 * Panels, all drawn on the product imagery of the zone (DGT in Portugal,
 * PNOA in Spain, IGN in France):
 *   v1-esri  v1 as it shipped, on Esri; its outlines are moved onto the open
 *            imagery by the measured label shift, so no Esri pixel is written
 *   v1       v1 on the open imagery
 *   v2       the shipped model on the open imagery, at its calibrated
 *            threshold (MARCO_POLO_MODEL picks another model file; --name is
 *            the title it gets, and the file is still <zone>-v2.jpg)
 * The README figure is v1 and v2 on a DEV-2 zone (never used to tune).
 * Accent outline: hit a label. Orange: no label there. White dashed: a
 * labelled pool nothing found. The crop is the window with the most labels
 * unless --center "lat,lon" is given. Counts per panel go to figure.json.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildScanPlan, latToWorldY, lonToWorldX, worldXToLon, worldYToLat, type BBox, type Ring } from '@marco-polo/core';
import jpeg from 'jpeg-js';
import { v1Detector, v2Detector, type Detector, type WindowAccess } from './detectors.js';
import { Raster, type RGB } from './draw.js';
import { TileSource } from './imagery.js';
import { loadLabels } from './labels.js';
import { DEFAULT_MATCH, matchDetections, pointAreaCap } from './match.js';
import type { SourceId } from './candidates.js';
import { SOURCES } from './sources.js';
import type { EvalDetection, Label } from './types.js';
import { shiftsFor, zoneById } from './zones.js';

const Z = 19;
const ACCENT: RGB = [255, 82, 255];
const CASING: RGB = [20, 8, 20];
const ORANGE: RGB = [255, 150, 0];
const WHITE: RGB = [255, 255, 255];

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

const wx = (lon: number) => lonToWorldX(lon, Z);
const wy = (lat: number) => latToWorldY(lat, Z);

function shiftDet(d: EvalDetection, [e, n]: [number, number]): EvalDetection {
  if (!e && !n) return d;
  const mv = (lon: number, lat: number): [number, number] => [lon + e / (111320 * Math.cos((lat * Math.PI) / 180)), lat + n / 110540];
  const [cl, ct] = mv(d.center.lon, d.center.lat);
  const [w, s] = mv(d.bbox.west, d.bbox.south);
  const [ea, no] = mv(d.bbox.east, d.bbox.north);
  return { ...d, center: { lon: cl, lat: ct }, bbox: { west: w, south: s, east: ea, north: no }, outline: d.outline.map((p) => p.map((r) => r.map(([lon, lat]) => mv(lon, lat)))) };
}

async function detect(det: Detector, src: TileSource, scan: BBox): Promise<EvalDetection[]> {
  const ring: Ring = [[scan.west, scan.south], [scan.east, scan.south], [scan.east, scan.north], [scan.west, scan.north]];
  const plan = buildScanPlan(ring, Z);
  const windows: WindowAccess = { providerId: src.provider.id, window: (t, halo, tilePx) => src.window(t.tile, halo, tilePx) };
  const run = await det.run(plan.tiles, (t) => src.get(t.tile), windows);
  const thr = det.thresholdFor?.(src.provider.id) ?? 0.55;
  return run.detections.filter((d) => d.confidence >= thr);
}

/** Origin (world px at z19) of the size x size window holding the most label centroids. */
function densest(labels: Label[], zone: BBox, size: number): [number, number] {
  const x0 = wx(zone.west), x1 = wx(zone.east) - size, y0 = wy(zone.north), y1 = wy(zone.south) - size;
  const pts = labels.filter((l) => l.role === 'pool').map((l) => [wx(l.centroid.lon), wy(l.centroid.lat)]);
  let best: [number, number] = [x0, y0], most = -1;
  for (let y = y0; y <= y1; y += 50) {
    for (let x = x0; x <= x1; x += 50) {
      const n = pts.filter(([px, py]) => px >= x && px < x + size && py >= y && py < y + size).length;
      if (n > most) [most, best] = [n, [x, y]];
    }
  }
  return [Math.round(best[0]), Math.round(best[1])];
}

async function main() {
  const zone = zoneById(arg('zone', 'marbella'));
  if (zone.role === 'TEST') throw new Error(`${zone.id} is a TEST zone: its imagery is not drawn outside a logged run`);
  const out = resolve(arg('out'));
  const size = Number(arg('size', '1000'));
  const px = Number(arg('px', '880'));
  const cache = arg('cache', '.tile-cache');
  const offline = process.argv.includes('--offline');
  const wanted = arg('panels', 'v1,v2').split(',');
  const name = arg('name', 'v2');
  const open = zone.productSource as SourceId;
  const src = (id: SourceId) => new TileSource({ provider: SOURCES[id], cacheDir: cache, ratePerSec: 4, offline });
  const openSrc = src(open);
  const esriSrc = src('esri');

  const lab = async (sid: SourceId) => {
    const s = shiftsFor(zone, sid);
    if (!s) throw new Error(`${zone.id}: no label shift for ${sid}`);
    return (await loadLabels(zone.id, { source: sid, osmShiftM: s.osm, visualShiftM: s.visual, visualShiftFor: (on) => shiftsFor(zone, on as SourceId)?.visual })).labels;
  };
  const openLabels = await lab(open);
  const esriLabels = wanted.includes('v1-esri') ? await lab('esri') : [];
  // Moves a detection on Esri onto the open imagery: the inverse of the label shift between the two.
  const toOpen = (sh: [number, number]): [number, number] => [-sh[0], -sh[1]];
  const esriToOpen = wanted.includes('v1-esri') ? toOpen(shiftsFor(zone, 'esri')!.visual.map((v, i) => v - shiftsFor(zone, open)!.visual[i]) as [number, number]) : ([0, 0] as [number, number]);

  const c = process.argv.includes('--center') ? arg('center').split(',').map(Number) : null;
  const [ox, oy] = c ? [Math.round(wx(c[1]) - size / 2), Math.round(wy(c[0]) - size / 2)] : densest(openLabels, zone.bbox, size);
  const view: BBox = { west: worldXToLon(ox, Z), east: worldXToLon(ox + size, Z), north: worldYToLat(oy, Z), south: worldYToLat(oy + size, Z) };
  const m = 40 / 111000;
  const scan: BBox = { west: view.west - m, east: view.east + m, south: view.south - m, north: view.north + m };
  const inView = (lon: number, lat: number) => lon >= view.west && lon <= view.east && lat >= view.south && lat <= view.north;

  const base = await openSrc.crop(Z, ox, oy, size, size);
  const all = {
    'v1-esri': async () => ({ title: 'v1 on Esri (as it shipped)', dets: await detect(v1Detector, esriSrc, scan), labels: esriLabels, shift: esriToOpen }),
    v1: async () => ({ title: `v1 on ${SOURCES[open].name}`, dets: await detect(v1Detector, openSrc, scan), labels: openLabels, shift: [0, 0] as [number, number] }),
    v2: async () => ({ title: `${name} on ${SOURCES[open].name}`, dets: await detect(v2Detector(), openSrc, scan), labels: openLabels, shift: [0, 0] as [number, number] }),
  };
  const panels: Array<{ id: string; title: string; dets: EvalDetection[]; labels: Label[]; shift: [number, number] }> = [];
  for (const id of wanted) {
    if (!(id in all)) throw new Error(`--panels: unknown panel ${id}`);
    panels.push({ id, ...(await all[id as keyof typeof all]()) });
  }
  await mkdir(out, { recursive: true });
  const k = px / size;
  const P = ([lon, lat]: number[]): [number, number] => [(wx(lon) - ox) * k, (wy(lat) - oy) * k];
  const summary: Record<string, unknown> = { args: `--zone ${zone.id} --panels ${wanted.join(',')} --name ${name} --size ${size} --px ${px}`, zone: zone.id, role: zone.role, source: open, sourceName: SOURCES[open].name, view, sizeM: null, panels: {} };
  for (const p of panels) {
    const mr = matchDetections(p.dets, p.labels, { ...DEFAULT_MATCH, pointMaxAreaM2: pointAreaCap(p.labels) });
    const hit = new Set(mr.pairs.map((q) => q.det.id));
    const r = new Raster(px, px);
    r.blit(base, size, size, 0, 0, px, px);
    const drawn = p.dets.map((d) => shiftDet(d, p.shift)).filter((d) => inView(d.center.lon, d.center.lat));
    for (const d of drawn) {
      for (const poly of d.outline) {
        const pts = poly[0].map(P);
        r.ring(pts, CASING, 4);
        r.ring(pts, hit.has(d.id) ? ACCENT : ORANGE, 2);
      }
    }
    const missed = mr.unmatchedLabels.filter((l) => inView(l.centroid.lon, l.centroid.lat));
    for (const l of missed) {
      const box = p.id === 'v1-esri' ? shiftDet({ id: l.id, center: l.centroid, bbox: l.bbox, outline: [], areaM2: 0, confidence: 0 }, p.shift).bbox : l.bbox;
      const [x0, y0] = P([box.west, box.north]);
      const [x1, y1] = P([box.east, box.south]);
      const g = 3;
      r.rect(x0 - g, y0 - g, x1 + g, y1 + g, CASING, 3, 0);
      r.rect(x0 - g, y0 - g, x1 + g, y1 + g, WHITE, 1, 4);
    }
    const counts = { hits: drawn.filter((d) => hit.has(d.id)).length, falseDetections: drawn.filter((d) => !hit.has(d.id)).length, missed: missed.length };
    (summary.panels as Record<string, unknown>)[p.id] = { title: p.title, ...counts };
    await writeFile(join(out, `${zone.id}-${p.id}.jpg`), jpeg.encode({ data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), width: px, height: px }, 88).data);
    console.log(`${p.id.padEnd(8)} ${p.title.padEnd(32)} hits ${counts.hits}  false ${counts.falseDetections}  missed ${counts.missed}`);
  }
  summary.sizeM = Math.round((size * 40075016.686 * Math.cos((((view.north + view.south) / 2) * Math.PI) / 180)) / (256 * 2 ** Z));
  await writeFile(join(out, `${zone.id}-figure.json`), JSON.stringify(summary, null, 1) + '\n');
}

await main();
