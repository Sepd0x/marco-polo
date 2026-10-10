import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  captureLookup,
  createV1Detector,
  DetectionMerger,
  estimatePlan,
  fallbackPart,
  IMAGERY_PROVIDERS,
  metersPerPixelOfBitmap,
  noDataReason,
  partCentre,
  partSummary,
  provenanceOf,
  rankDetections,
  sampleTiles,
  splitPlanBySource,
  staticCaptureInfo,
  tileRequest,
  toCSV,
  toGeoJSON,
  toResultDetection,
  type Detection,
  type Detector,
  type ImagerySetting,
  type PlanPart,
  type Provenance,
  type ResultDetection,
  type Ring,
  type ScanPartSummary,
  type ScanResult,
  type TileCoord,
  type TileDetection,
} from '@marco-polo/core';
import { parseFlags, UsageError, type FlagSpec } from '../args.js';
import { Pacer, TileFetcher, type DecodedTile, type FetchedTile, type FetchLike } from '../tiles.js';

/** Short names accepted by --source, next to the full ids. */
export const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  dgt: 'dgt-ortos2025',
  pnoa: 'pnoa',
  ign: 'ign-orthophotos',
  esri: 'esri-world-imagery',
};

const SCANNABLE = IMAGERY_PROVIDERS.filter((p) => p.scanAllowed).map((p) => p.id);
const SOURCE_CHOICES = ['auto', ...Object.keys(SOURCE_ALIASES), ...SCANNABLE.filter((id) => !(id in SOURCE_ALIASES))];

const SPEC: Record<string, FlagSpec> = {
  bbox: { kind: 'string' },
  area: { kind: 'string' },
  source: { kind: 'string', choices: SOURCE_CHOICES },
  out: { kind: 'string' },
  rate: { kind: 'number', min: 1, max: 10 },
  order: { kind: 'string', choices: ['serpentine', 'spiral'] },
  threshold: { kind: 'number', min: 0, max: 1 },
  'cache-dir': { kind: 'string' },
  'allow-large': { kind: 'flag' },
  'no-dates': { kind: 'flag' },
  quiet: { kind: 'flag' },
};

const REMOVED: Record<string, string> = {
  zoom: 'each source scans at its own resolution (DGT 25 cm at 512 px, the others at z19)',
  template: 'free imagery templates are gone; pick a source with --source',
};

export interface ScanArgs {
  bbox?: string;
  area?: string;
  setting: ImagerySetting;
  out: string;
  /** Requests per second asked for; each source is also held to its own ceiling. */
  rate: number;
  order: 'serpentine' | 'spiral';
  threshold: number;
  cacheDir: string;
  allowLarge: boolean;
  dates: boolean;
  quiet: boolean;
}

export const SCAN_HELP = `marco-polo scan: find and measure swimming pools in an area (headless)

The CLI still runs the v1 detector; the web app runs v2, which finds more
pools and far fewer false ones (packages/eval/results).

usage:
  npm run scan -- --bbox "<south,west,north,east>" [options]
  npm run scan -- --area <polygon.geojson> [options]

options:
  --bbox <s,w,n,e>     area as a bounding box in decimal degrees
  --area <file>        area as a GeoJSON Polygon, MultiPolygon (first polygon) or Feature
  --source <name>      imagery: auto (default), dgt, pnoa, ign or esri. auto picks
                       per place (DGT in mainland Portugal, PNOA in Spain, IGN in
                       France, Esri elsewhere) and splits an area that crosses a border
  --out <path>         output basename (default ./scans/scan, writes .geojson and .csv)
  --rate <n>           tile requests per second, 1 to 10 (default 5); never above
                       the source's own ceiling
  --order <o>          serpentine or spiral (default serpentine)
  --threshold <c>      lowest confidence listed, 0 to 1 (default 0.55)
  --cache-dir <dir>    disk cache for open-licence sources (default .tile-cache);
                       Esri tiles are never written to disk
  --allow-large        scan areas above 10 000 z19 tiles
  --no-dates           skip the capture date lookups
  --quiet              no live progress
  -h, --help           this text
`;

export function parseScanArgs(argv: string[]): ScanArgs | 'help' {
  const { values, help } = parseFlags(argv, SPEC, REMOVED);
  if (help) return 'help';
  if (values.bbox === undefined && values.area === undefined) throw new UsageError('provide --bbox or --area (see --help)');
  if (values.bbox !== undefined && values.area !== undefined) throw new UsageError('use --bbox or --area, not both');
  const source = (values.source as string | undefined) ?? 'auto';
  const id = SOURCE_ALIASES[source] ?? source;
  return {
    bbox: values.bbox as string | undefined,
    area: values.area as string | undefined,
    setting: id === 'auto' ? { mode: 'auto' } : { mode: 'fixed', providerId: id },
    out: (values.out as string | undefined) ?? './scans/scan',
    rate: (values.rate as number | undefined) ?? 5,
    order: ((values.order as string | undefined) ?? 'serpentine') as ScanArgs['order'],
    threshold: (values.threshold as number | undefined) ?? 0.55,
    cacheDir: (values['cache-dir'] as string | undefined) ?? '.tile-cache',
    allowLarge: values['allow-large'] === true,
    dates: values['no-dates'] !== true,
    quiet: values.quiet === true,
  };
}

/** "south,west,north,east" to a ring, with the order and ranges checked. */
export function parseBBox(text: string): Ring {
  const parts = text.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new UsageError('--bbox must be "south,west,north,east" in decimal degrees');
  }
  const [s, w, n, e] = parts;
  if (s < -85 || n > 85 || w < -180 || e > 180) throw new UsageError('--bbox is outside the map');
  if (s >= n || w >= e) throw new UsageError('--bbox needs south < north and west < east');
  return [[w, s], [e, s], [e, n], [w, n]];
}

export function ringFromGeoJSON(raw: unknown): Ring {
  const obj = raw as { type?: string; geometry?: unknown; features?: { geometry?: unknown }[] };
  const geom = (obj?.type === 'Feature' ? obj.geometry : obj?.type === 'FeatureCollection' ? obj.features?.[0]?.geometry : obj) as
    | { type?: string; coordinates?: unknown }
    | undefined;
  if (geom?.type === 'Polygon') return (geom.coordinates as Ring[])[0];
  if (geom?.type === 'MultiPolygon') return (geom.coordinates as Ring[][])[0][0];
  throw new UsageError('--area file must contain a Polygon or MultiPolygon');
}

export async function resolveArea(args: ScanArgs): Promise<Ring> {
  if (args.bbox !== undefined) return parseBBox(args.bbox);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(args.area!, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read --area ${args.area}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return ringFromGeoJSON(raw);
}

/** Pieces a decoded tile is handed to the detector in. */
interface DetectorTile {
  tile: TileCoord;
  pixels: Uint8ClampedArray;
}

/**
 * The v1 detector reads bare 256 px tiles. A 512 px tile of a WMS source is
 * cut into its four z+1 children, which cover exactly the same ground.
 */
export function splitForV1(tile: TileCoord, image: DecodedTile): DetectorTile[] {
  if (image.width === 256 && image.height === 256) return [{ tile, pixels: image.rgba }];
  if (image.width !== 512 || image.height !== 512) {
    throw new Error(`cannot hand a ${image.width}x${image.height} tile to the v1 detector`);
  }
  const out: DetectorTile[] = [];
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const px = new Uint8ClampedArray(256 * 256 * 4);
      for (let y = 0; y < 256; y++) {
        const from = ((qy * 256 + y) * 512 + qx * 256) * 4;
        px.set(image.rgba.subarray(from, from + 256 * 4), y * 256 * 4);
      }
      out.push({ tile: { z: tile.z + 1, x: tile.x * 2 + qx, y: tile.y * 2 + qy }, pixels: px });
    }
  }
  return out;
}

function childTiles(tiles: TileCoord[], factor: number): TileCoord[] {
  if (factor === 1) return tiles;
  const out: TileCoord[] = [];
  for (const t of tiles) {
    for (let qy = 0; qy < factor; qy++) {
      for (let qx = 0; qx < factor; qx++) out.push({ z: t.z + 1, x: t.x * factor + qx, y: t.y * factor + qy });
    }
  }
  return out;
}

export interface ScanDeps {
  fetch?: FetchLike;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  progress?: (line: string) => void;
  detector?: Detector;
}

/** Number of probe tiles asked of a part's source before scanning it. */
export const PROBE_TILES = 5;

export async function runScan(area: Ring, args: ScanArgs, deps: ScanDeps = {}): Promise<ScanResult> {
  const log = deps.log ?? (() => {});
  const progress = deps.progress ?? (() => {});
  const detector = deps.detector ?? createV1Detector();
  if (detector.id !== 'v1') throw new Error(`the CLI does not know detector ${detector.id} yet`);

  const estimate = estimatePlan(area, args.setting);
  if (estimate.level === 'block' && !args.allowLarge) {
    throw new UsageError(
      `area is about ${estimate.z19Tiles} z19 tiles (${estimate.areaKm2.toFixed(2)} km2), above the 10 000 limit; ` +
        'draw a smaller area or pass --allow-large',
    );
  }
  if (estimate.level === 'warn') log(`large area: about ${estimate.z19Tiles} z19 tiles, ${Math.round(estimate.seconds / 60)} min`);

  const split = splitPlanBySource(area, args.setting, args.order);
  const summaries: ScanPartSummary[] = [];
  const found: { d: Detection; provenance: Provenance }[] = [];

  for (let part of split.parts) {
    const fetcherFor = (p: PlanPart) =>
      new TileFetcher({
        pacer: new Pacer(Math.min(args.rate, p.provider.rate.maxPerSec), deps.now, deps.wait),
        cachePolicy: p.provider.cachePolicy,
        cacheDir: args.cacheDir,
        fetch: deps.fetch,
        wait: deps.wait,
      });
    let fetcher = fetcherFor(part);

    // Probe: if none of the sample tiles has imagery, the whole part moves on
    // (auto only; a fixed choice is kept and its empty tiles are reported).
    const probed = new Map<string, FetchedTile>();
    for (;;) {
      probed.clear();
      let withData = 0;
      for (const t of sampleTiles(part, PROBE_TILES)) {
        const req = tileRequest(part.provider, t);
        const url = req.url;
        try {
          const r = await fetcher.get(url, req.mirrorUrl);
          probed.set(url, r);
          if (r.image && !noDataReason(asResponse(r))) withData++;
        } catch {
          // A failed probe counts as no data.
        }
      }
      if (withData > 0 || args.setting.mode === 'fixed') break;
      const next = fallbackPart(part, area, args.order);
      if (!next) break;
      log(`${part.provider.name} has no imagery in part ${part.id}; using ${next.provider.name}`);
      part = next;
      fetcher = fetcherFor(part);
    }

    const date = await partDate(part, fetcher, args.dates);
    const provenance = provenanceOf(part.provider, part.id, part.plan.zoom, date);
    log(`part ${part.id}: ${part.provider.name}, ${part.plan.tiles.length} tiles at z${part.plan.zoom}, captured ${date ?? 'date not measured'}`);

    const factor = part.provider.requestPx / 256;
    const merger = new DetectionMerger({}, childTiles(part.plan.tiles.map((t) => t.tile), factor));
    let noCoverage = 0;
    let failed = 0;
    let firstError = '';
    let done = 0;
    for (const { tile } of part.plan.tiles) {
      try {
        const req = tileRequest(part.provider, tile);
        const url = req.url;
        const r = probed.get(url) ?? (await fetcher.get(url, req.mirrorUrl));
        if (noDataReason(asResponse(r))) noCoverage++;
        else if (!r.image) {
          failed++;
          firstError ||= `HTTP ${r.status}, not an image`;
        }
        else {
          for (const piece of splitForV1(tile, r.image)) {
            const dets: TileDetection[] = detector.detectTile(
              {
                tile: piece.tile,
                tilePx: 256,
                halo: 0,
                width: 256,
                height: 256,
                pixels: piece.pixels,
                mPerPx: metersPerPixelOfBitmap(piece.tile, 256),
              },
              { providerId: part.provider.id },
            );
            merger.addTileDetections(piece.tile, dets);
          }
        }
      } catch (err) {
        failed++;
        firstError ||= err instanceof Error ? err.message : String(err);
      }
      done++;
      progress(`part ${part.id} tile ${done}/${part.plan.tiles.length}, ${merger.getAll().length} found`);
    }
    merger.finalize();
    for (const d of merger.getAll()) found.push({ d, provenance });
    summaries.push(partSummary(part.id, provenance, part.plan.tiles.length, noCoverage, part.areaM2));
    if (failed) log(`part ${part.id}: ${failed} tiles failed (first: ${firstError})`);
  }

  // Merger ids restart in every part, so they get the part id in front.
  const kept = found
    .filter((f) => f.d.confidence >= args.threshold)
    .map((f) => ({ d: { ...f.d, id: `${f.provenance.partId}-${f.d.id}` }, provenance: f.provenance }));
  const provenanceById = new Map(kept.map((f) => [f.d.id, f.provenance]));
  const detections: ResultDetection[] = rankDetections(kept.map((f) => f.d)).map((d) =>
    toResultDetection(d, provenanceById.get(d.id)!),
  );
  return {
    formatVersion: 2,
    createdAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    area,
    threshold: args.threshold,
    parts: summaries,
    detections,
    belowThreshold: found.length - kept.length,
  };
}

function asResponse(r: FetchedTile) {
  return { status: r.status, bytes: r.bytes, pixels: r.image?.rgba, width: r.image?.width, height: r.image?.height };
}

async function partDate(part: PlanPart, fetcher: TileFetcher, lookup: boolean): Promise<string | null> {
  const centre = partCentre(part);
  const fixed = staticCaptureInfo(part.provider, centre);
  if (fixed) return fixed.date;
  if (!lookup) return null;
  const q = captureLookup(part.provider, centre, part.plan.zoom);
  if (!q) return null;
  for (const url of q.urls) {
    try {
      const r = await fetcher.get(url);
      if (r.status !== 200) continue;
      const info = q.parse(new TextDecoder().decode(r.bytes));
      if (info?.date) return info.date;
    } catch {
      // Not measured.
    }
  }
  return null;
}

export async function writeOutputs(result: ScanResult, out: string): Promise<string[]> {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}.geojson`, toGeoJSON(result), 'utf8');
  await writeFile(`${out}.csv`, toCSV(result), 'utf8');
  return [`${out}.geojson`, `${out}.csv`];
}

export async function scanCommand(argv: string[], deps: ScanDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.log(l));
  let args: ScanArgs | 'help';
  try {
    args = parseScanArgs(argv);
    if (args === 'help') {
      log(SCAN_HELP);
      return 0;
    }
    const area = await resolveArea(args);
    const tty = !args.quiet && process.stdout.isTTY;
    const result = await runScan(area, args, {
      ...deps,
      log: args.quiet ? () => {} : log,
      progress: tty ? (l) => process.stdout.write(`\r\x1b[2K  ${l}`) : deps.progress,
    });
    if (tty) process.stdout.write('\r\x1b[2K');
    const written = await writeOutputs(result, args.out);
    if (!args.quiet) {
      log(`${result.detections.length} detections at or above ${args.threshold}, ${result.belowThreshold} below`);
      for (const p of result.parts) {
        log(`  ${p.id} ${p.provenance.providerName}: ${p.tiles} tiles, ${p.tilesNoCoverage} without imagery`);
      }
      for (const f of written) log(`wrote ${f}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
