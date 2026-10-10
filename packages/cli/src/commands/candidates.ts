/**
 * `marco-polo candidates`: every candidate the v2 detector would score in an
 * area, with its features and, given labels, whether it is a pool. The
 * training tools read these files and never compute candidates or features
 * themselves, so a model is trained on exactly what the product computes.
 *
 * Writes `<out>.jsonl` (one candidate per line), `<out>.f64` (the features,
 * float64, row-major) and `<out>.meta.json`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  buildScanPlan,
  buildTileWindow,
  DEFAULT_HALO_PX,
  DEFAULT_LEARNED_OPTIONS,
  FEATURE_COUNT,
  FEATURE_NAMES,
  findAnyProvider,
  imageCandidates,
  latToWorldY,
  lonToWorldX,
  noDataReason,
  scanZoomFor,
  tileRequest,
  TILE_SIZE,
  windowFrame,
  windowFromBitmap,
  worldXToLon,
  worldYToLat,
  type Candidate,
  type ImageryProvider,
  type TileCoord,
  type TileWindow,
} from '@marco-polo/core';
import { parseFlags, UsageError, type FlagSpec } from '../args.js';
import { Pacer, TileFetcher, type DecodedTile } from '../tiles.js';
import { augmentPixels, hashSeed, rng, type AugmentRecipe } from './augment.js';
import { parseBBox } from './scan.js';

const ALIASES: Record<string, string> = { dgt: 'dgt-ortos2025', dgt2018: 'dgt-ortos2018', pnoa: 'pnoa', ign: 'ign-orthophotos' };

const SPEC: Record<string, FlagSpec> = {
  bbox: { kind: 'string' },
  source: { kind: 'string' },
  labels: { kind: 'string' },
  out: { kind: 'string' },
  halo: { kind: 'number', min: 0, max: 256, integer: true },
  augment: { kind: 'string' },
  copy: { kind: 'number', min: 0, max: 1000, integer: true },
  seed: { kind: 'number', min: 0, max: 2 ** 31, integer: true },
  rate: { kind: 'number', min: 1, max: 10 },
  'cache-dir': { kind: 'string' },
  quiet: { kind: 'flag' },
};

export const CANDIDATES_HELP = `marco-polo candidates: write the candidates and features of an area, for training

usage:
  marco-polo candidates --bbox "<s,w,n,e>" --source <name> --out <prefix> [options]

options:
  --bbox <s,w,n,e>     area in decimal degrees
  --source <name>      dgt (Ortos2025), dgt2018, pnoa or ign; Esri is refused
                       (its terms do not allow training on it)
  --out <prefix>       writes <prefix>.jsonl, <prefix>.f64 and <prefix>.meta.json
  --labels <file>      GeoJSON labels (role pool or ignore) to mark each candidate
  --halo <px>          halo around each 256 px tile (default ${DEFAULT_HALO_PX}; doubled for 512 px WMS tiles)
  --augment <file>     JSON recipe of training augmentations (the "augment" key
                       of tools/train/recipe.json, or the object itself)
  --copy <k>           which augmented copy (with --augment), default 0
  --seed <n>           augmentation seed, default 0
  --rate <n>           tile requests per second (default 4)
  --cache-dir <dir>    tile cache (default .tile-cache; open sources only)
  --quiet              no progress
  -h, --help           this text
`;

/** A label rasterised into window pixels. */
export interface PxLabel {
  id: string;
  role: 'pool' | 'ignore';
  rings: [number, number][][];
  point: [number, number] | null;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  areaPx: number;
}

export interface LabelFeature {
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] } | { type: 'Point'; coordinates: number[] } | { type: 'Polygon'; coordinates: number[][][] };
  properties: { id: string; role: 'pool' | 'ignore' };
}

function ringArea(r: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a) / 2;
}

function inRing(x: number, y: number, r: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Window pixel of a lon/lat. */
function toWindowPx(win: TileWindow, lon: number, lat: number): [number, number] {
  const k = win.tilePx / TILE_SIZE;
  return [lonToWorldX(lon, win.tile.z) * k - (win.tile.x * win.tilePx - win.halo), latToWorldY(lat, win.tile.z) * k - (win.tile.y * win.tilePx - win.halo)];
}

export function labelsInWindow(win: TileWindow, labels: LabelFeature[]): PxLabel[] {
  const out: PxLabel[] = [];
  for (const f of labels) {
    const g = f.geometry;
    let polys: number[][][][] = [];
    let point: [number, number] | null = null;
    if (g.type === 'Point') point = toWindowPx(win, g.coordinates[0], g.coordinates[1]);
    else polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const rings: [number, number][][] = [];
    for (const poly of polys) for (const ring of poly.slice(0, 1)) rings.push(ring.map(([lon, lat]) => toWindowPx(win, lon, lat)));
    const pts = point ? [point] : rings.flat();
    if (!pts.length) continue;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const l: PxLabel = {
      id: f.properties.id,
      role: f.properties.role,
      rings,
      point,
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
      areaPx: rings.reduce((a, r) => a + ringArea(r), 0),
    };
    if (l.maxX < -20 || l.maxY < -20 || l.minX > win.width + 20 || l.minY > win.height + 20) continue;
    out.push(l);
  }
  return out;
}

export interface CandidateLabel {
  /** 1 pool, 0 not a pool, -1 left out of training (ambiguous). */
  y: number;
  /** Share of the candidate's pixels inside its best label. */
  frac: number;
  /** Share of that label's area the candidate covers. */
  cover: number;
  /** Labels the candidate covers at least 30% of. */
  multi: number;
  gid: string | null;
}

/**
 * The training target of a candidate against polygon and point labels:
 * a pool when half of it lies in one pool label or it covers half of one,
 * unless it spans two pools; not a pool when under a tenth of it touches a
 * label; ambiguous otherwise. Point labels (no outline) make a small
 * candidate holding the point a pool and a large one ambiguous.
 */
export function labelCandidate(c: Candidate, width: number, labels: PxLabel[], maxPointAreaM2 = 150): CandidateLabel {
  const comp = c.component;
  const near = labels.filter((l) => l.maxX >= comp.minX - 1 && l.minX <= comp.maxX + 1 && l.maxY >= comp.minY - 1 && l.minY <= comp.maxY + 1);
  if (!near.length) return { y: 0, frac: 0, cover: 0, multi: 0, gid: null };
  const inside = new Map<PxLabel, number>();
  let ignorePx = 0;
  const W = width;
  for (let y = comp.minY; y <= comp.maxY; y++) {
    for (let x = comp.minX; x <= comp.maxX; x++) {
      if (c.labels[y * W + x] !== comp.label) continue;
      const px = x + 0.5, py = y + 0.5;
      let ign = false;
      for (const l of near) {
        if (!l.rings.length || px < l.minX || px > l.maxX || py < l.minY || py > l.maxY) continue;
        if (!l.rings.some((r) => inRing(px, py, r))) continue;
        if (l.role === 'ignore') ign = true;
        else inside.set(l, (inside.get(l) ?? 0) + 1);
      }
      if (ign) ignorePx++;
    }
  }
  let best: PxLabel | null = null;
  let bestN = 0;
  let multi = 0;
  for (const [l, n] of inside) {
    if (n > bestN) {
      best = l;
      bestN = n;
    }
    if (l.areaPx > 0 && n >= 0.3 * l.areaPx) multi++;
  }
  const frac = bestN / comp.pixelCount;
  const cover = best && best.areaPx > 0 ? bestN / best.areaPx : 0;
  let y = multi >= 2 ? 0 : frac >= 0.5 || cover >= 0.5 ? 1 : frac < 0.1 && ignorePx / comp.pixelCount < 0.25 ? 0 : -1;
  let gid = best && (frac >= 0.25 || cover >= 0.5) ? best.id : null;
  // Point labels: OSM nodes have no outline.
  for (const l of near) {
    if (!l.point) continue;
    const [px, py] = l.point;
    const xi = Math.floor(px), yi = Math.floor(py);
    const holds = xi >= comp.minX && xi <= comp.maxX && yi >= comp.minY && yi <= comp.maxY && hasNear(c, W, xi, yi, 2);
    if (!holds) continue;
    if (l.role === 'ignore') {
      if (y === 0) y = -1;
    } else if (c.areaM2 <= maxPointAreaM2 && y !== 1) {
      y = multi >= 2 ? 0 : 1;
      gid = l.id;
    } else if (y === 0) {
      y = -1;
    }
  }
  return { y, frac: round(frac), cover: round(cover), multi, gid };
}

function hasNear(c: Candidate, W: number, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W) continue;
      if (c.labels[yy * W + xx] === c.component.label) return true;
    }
  }
  return false;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export interface CandidatesArgs {
  bbox: string;
  provider: ImageryProvider;
  out: string;
  labels?: string;
  halo: number;
  augment?: string;
  copy: number;
  seed: number;
  rate: number;
  cacheDir: string;
  quiet: boolean;
}

export function parseCandidatesArgs(argv: string[]): CandidatesArgs | 'help' {
  const { values, help } = parseFlags(argv, SPEC);
  if (help) return 'help';
  for (const k of ['bbox', 'source', 'out']) if (values[k] === undefined) throw new UsageError(`--${k} is required (see --help)`);
  const name = values.source as string;
  if (/esri/i.test(name)) throw new UsageError('Esri imagery is never used for training (its terms forbid it); pick dgt, dgt2018, pnoa or ign');
  const provider = findAnyProvider(ALIASES[name] ?? name);
  if (!provider) throw new UsageError(`--source must be dgt, dgt2018, pnoa or ign (got "${name}")`);
  if (provider.cachePolicy !== 'persistent') throw new UsageError(`${provider.id} has no open licence for training`);
  return {
    bbox: values.bbox as string,
    provider,
    out: values.out as string,
    labels: values.labels as string | undefined,
    halo: (values.halo as number | undefined) ?? DEFAULT_HALO_PX,
    augment: values.augment as string | undefined,
    copy: (values.copy as number | undefined) ?? 0,
    seed: (values.seed as number | undefined) ?? 0,
    rate: (values.rate as number | undefined) ?? 4,
    cacheDir: (values['cache-dir'] as string | undefined) ?? '.tile-cache',
    quiet: values.quiet === true,
  };
}

export interface CandidateRow {
  tile: [number, number, number];
  level: number;
  px: number;
  areaM2: number;
  lon: number;
  lat: number;
  bbox: [number, number, number, number];
  touches: number;
  y: number;
  frac: number;
  cover: number;
  multi: number;
  gid: string | null;
}

export async function runCandidates(args: CandidatesArgs, fetcher?: TileFetcher): Promise<{ rows: CandidateRow[]; features: Float64Array; tiles: number; missing: number }> {
  const p = args.provider;
  const zoom = scanZoomFor(p);
  const ring = parseBBox(args.bbox);
  const plan = buildScanPlan(ring, zoom);
  const recipe: AugmentRecipe | null = args.augment ? readRecipe(JSON.parse(await readFile(args.augment, 'utf8'))) : null;
  const labels: LabelFeature[] = args.labels ? (JSON.parse(await readFile(args.labels, 'utf8')) as { features: LabelFeature[] }).features : [];
  const f = fetcher ?? new TileFetcher({ pacer: new Pacer(Math.min(args.rate, p.rate.maxPerSec)), cachePolicy: p.cachePolicy, cacheDir: args.cacheDir });
  const halo = p.kind === 'wms' ? args.halo * (p.requestPx / TILE_SIZE) : args.halo;

  const tileCache = new Map<string, DecodedTile | null>();
  const getTile = async (t: TileCoord): Promise<DecodedTile | null> => {
    const key = `${t.x}/${t.y}`;
    if (tileCache.has(key)) return tileCache.get(key)!;
    const req = tileRequest(p, t);
    const r = await f.get(req.url, req.mirrorUrl);
    const img = r.image && !noDataReason({ status: r.status, bytes: r.bytes, pixels: r.image.rgba, width: r.image.width, height: r.image.height }) ? r.image : null;
    if (tileCache.size > 512) tileCache.delete(tileCache.keys().next().value!);
    tileCache.set(key, img);
    return img;
  };

  const rows: CandidateRow[] = [];
  const feats: number[] = [];
  let missing = 0;
  for (const st of plan.tiles) {
    const t = st.tile;
    let win: TileWindow | null = null;
    if (p.kind === 'wms') {
      const req = tileRequest(p, t, halo);
      const r = await f.get(req.url, req.mirrorUrl);
      if (r.image && r.image.width === req.width && !noDataReason({ status: r.status, bytes: r.bytes, pixels: r.image.rgba, width: r.image.width, height: r.image.height })) {
        win = windowFromBitmap(t, new Uint8ClampedArray(r.image.rgba), r.image.width, r.image.height, halo);
      }
    } else {
      const centre = await getTile(t);
      if (centre) {
        const around = new Map<string, DecodedTile | null>();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around.set(`${dx},${dy}`, dx || dy ? (halo ? await getTile({ z: t.z, x: t.x + dx, y: t.y + dy }) : null) : centre);
        win = buildTileWindow(t, TILE_SIZE, halo, (dx, dy) => around.get(`${dx},${dy}`)?.rgba ?? null);
      }
    }
    if (!win) {
      missing++;
      continue;
    }
    if (recipe) {
      const random = rng(hashSeed(`${args.seed}:${args.copy}:${p.id}:${t.z}/${t.x}/${t.y}`));
      augmentPixels(win.pixels as Uint8ClampedArray, win.width, win.height, win.mPerPx, recipe, random);
    }
    const { frame, central } = windowFrame(win);
    const analysis = imageCandidates(win.pixels, win.width, win.height, frame, central, DEFAULT_LEARNED_OPTIONS);
    const pxLabels = labels.length ? labelsInWindow(win, labels) : [];
    for (const c of analysis.candidates) {
      const lab = labels.length ? labelCandidate(c, win.width, pxLabels) : { y: -1, frac: 0, cover: 0, multi: 0, gid: null };
      const k = win.tilePx / TILE_SIZE;
      const wx = (x: number) => worldXToLon((x + win!.tile.x * win!.tilePx - win!.halo) / k, win!.tile.z);
      const wy = (y: number) => worldYToLat((y + win!.tile.y * win!.tilePx - win!.halo) / k, win!.tile.z);
      const comp = c.component;
      rows.push({
        tile: [t.z, t.x, t.y],
        level: c.level,
        px: comp.pixelCount,
        areaM2: round(c.areaM2),
        lon: wx(c.cx + 0.5),
        lat: wy(c.cy + 0.5),
        bbox: [wx(comp.minX), wy(comp.maxY + 1), wx(comp.maxX + 1), wy(comp.minY)],
        touches: c.touchesBorder ? 1 : 0,
        ...lab,
      });
      for (let j = 0; j < FEATURE_COUNT; j++) feats.push(c.features[j]);
    }
    if (!args.quiet && st.index % 25 === 0) process.stderr.write(`\r${st.index + 1}/${plan.tiles.length} tiles, ${rows.length} candidates`);
  }
  if (!args.quiet) process.stderr.write(`\r${plan.tiles.length}/${plan.tiles.length} tiles, ${rows.length} candidates\n`);
  return { rows, features: Float64Array.from(feats), tiles: plan.tiles.length, missing };
}

function readRecipe(raw: Record<string, unknown>): AugmentRecipe {
  const r = (raw.augment ?? raw) as AugmentRecipe;
  for (const k of ['colour', 'resample', 'unsharp', 'noise', 'jpeg'] as const) {
    if (!r[k] || typeof r[k].p !== 'number') throw new UsageError(`augment recipe: "${k}" needs a probability p`);
  }
  return r;
}

export async function candidatesCommand(argv: string[]): Promise<number> {
  let args: CandidatesArgs | 'help';
  try {
    args = parseCandidatesArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  if (args === 'help') {
    console.log(CANDIDATES_HELP);
    return 0;
  }
  const { rows, features, tiles, missing } = await runCandidates(args);
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(`${args.out}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
  const bytes = Buffer.from(features.buffer, features.byteOffset, features.byteLength);
  await writeFile(`${args.out}.f64`, bytes);
  const meta = {
    format: 'marco-polo-candidates/1',
    source: args.provider.id,
    attribution: args.provider.attribution,
    bbox: args.bbox,
    halo: args.halo,
    augment: args.augment ? { file: args.augment, copy: args.copy, seed: args.seed } : null,
    features: FEATURE_NAMES,
    rows: rows.length,
    tiles,
    tilesWithoutImagery: missing,
    featuresSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  await writeFile(`${args.out}.meta.json`, JSON.stringify(meta, null, 1) + '\n', 'utf8');
  console.log(`${rows.length} candidates from ${tiles} tiles (${missing} without imagery) -> ${args.out}.jsonl`);
  return 0;
}
