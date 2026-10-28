import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  buildTileWindow,
  captureLookup,
  DEFAULT_HALO_PX,
  DetectionMerger,
  estimatePlan,
  fallbackPart,
  IMAGERY_PROVIDERS,
  lonLatToTile,
  metersPerPixelOfBitmap,
  NEIGHBOUR_OFFSETS,
  neighbourTile,
  noDataReason,
  partCentre,
  partSummary,
  pointInRing,
  provenanceOf,
  rankDetections,
  sampleTiles,
  splitPlanBySource,
  staticCaptureInfo,
  tileRequest,
  toCSV,
  toGeoJSON,
  toResultDetection,
  windowFromBitmap,
  type Detection,
  type Detector,
  type ImageryProvider,
  type ImagerySetting,
  type PlanPart,
  type Provenance,
  type ResultDetection,
  type Ring,
  type ScanPartSummary,
  type ScanResult,
  type TileCoord,
  type TileDetection,
  type TileRequest,
  type TileWindow,
} from '@marco-polo/core';
import { parseFlags, UsageError, type FlagSpec } from '../args.js';
import { makeDetector, type DetectorChoice } from '../detector.js';
import { errorText, redact } from '../redact.js';
import { recommendedFor } from '../threshold.js';
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

/** Requests per second when --rate is not given, and the highest value --rate takes. */
export const DEFAULT_RATE = 5;
export const MAX_RATE = 10;

/** Lowest score listed by the v1 detector when --threshold is not given. */
export const V1_THRESHOLD = 0.55;

const SPEC: Record<string, FlagSpec> = {
  bbox: { kind: 'string' },
  area: { kind: 'string' },
  source: { kind: 'string', choices: SOURCE_CHOICES },
  out: { kind: 'string' },
  rate: { kind: 'number', min: 1, max: MAX_RATE },
  order: { kind: 'string', choices: ['serpentine', 'spiral'] },
  threshold: { kind: 'number', min: 0, max: 1 },
  detector: { kind: 'string', choices: ['v2', 'v1'] },
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
  /** One cutoff for every source; null uses the one the detector was calibrated to on each source. */
  threshold: number | null;
  /** v2 unless v1 is asked for. */
  detector?: DetectorChoice;
  cacheDir: string;
  allowLarge: boolean;
  dates: boolean;
  quiet: boolean;
}

/** "dgt 4, pnoa 5, ..." from the sources' own ceilings, so the help cannot drift from them. */
function ceilings(): string {
  return Object.entries(SOURCE_ALIASES)
    .map(([alias, id]) => `${alias} ${IMAGERY_PROVIDERS.find((p) => p.id === id)?.rate.maxPerSec}`)
    .join(', ');
}

export const SCAN_HELP = `marco-polo scan: find and measure swimming pools in an area (headless)

Runs the same detector (v2), windows, sources and merger as the web app, so a
scan of an area here and in the app list the same pools.

usage:
  npm run scan -- --bbox "<south,west,north,east>" [options]
  npm run scan -- --area <polygon.geojson> [options]

options:
  --bbox <s,w,n,e>     area as a bounding box in decimal degrees
  --area <file>        area as a GeoJSON Polygon, MultiPolygon (first polygon) or Feature
  --source <name>      imagery: auto (default), dgt, pnoa, ign or esri. auto picks
                       per place (DGT in mainland Portugal, PNOA in Spain, IGN in
                       France, Esri elsewhere) and splits an area that crosses a border.
                       With auto, a part moves to the next source only when its
                       first source answers every sample tile and has no imagery
                       there; a notice on stderr says when and why. A source that
                       does not answer (timeout, HTTP 5xx or 429, any other error
                       status) is never replaced: its tiles are retried with
                       backoff, then listed on stderr as failed
  --out <path>         output basename (default ./scans/scan, writes .geojson and .csv)
  --rate <n>           tile requests per second, 1 to ${MAX_RATE} (default ${DEFAULT_RATE}). Each source
                       also has its own ceiling, and the lower of the two applies
                       (${ceilings()}). Retries and the neighbour tiles read
                       for the halo of 256 px sources count as requests
  --order <o>          serpentine or spiral (default serpentine)
  --threshold <c>      lowest confidence listed, 0 to 1, the same for every source.
                       Default: the value the model was calibrated to on each
                       source (${V1_THRESHOLD} with --detector v1)
  --detector <v>       v2 (default) or v1, the first detector, kept for comparisons
  --cache-dir <dir>    disk cache for open-licence sources (default .tile-cache);
                       Esri tiles are never written to disk
  --allow-large        scan areas above 10 000 z19 tiles
  --no-dates           skip the capture date lookups
  --quiet              no live progress (notices on stderr about a change of
                       source or failed tiles are still printed)
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
    rate: (values.rate as number | undefined) ?? DEFAULT_RATE,
    order: ((values.order as string | undefined) ?? 'serpentine') as ScanArgs['order'],
    threshold: (values.threshold as number | undefined) ?? null,
    detector: ((values.detector as string | undefined) ?? 'v2') as DetectorChoice,
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

/** Tiles the merger of a part sees for one scan tile: the tile itself, or for v1 its z+1 children. */
function mergerTiles(tiles: TileCoord[], factor: number): TileCoord[] {
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
  /** Notices that must not be lost: a change of source and tiles that failed. Stderr by default; --quiet does not silence it. */
  warn?: (line: string) => void;
  progress?: (line: string) => void;
  /** Replaces the detector chosen by `args.detector`. Any id but 'v1' is read with the v2 halo. */
  detector?: Detector;
}

/** Number of probe tiles asked of a part's source before scanning it. */
export const PROBE_TILES = 5;

/** Halo the detector reads, px of a 256 px tile; a 512 px WMS request gets twice that. v1 reads none. */
export function haloFor(detectorId: string): number {
  return detectorId === 'v1' ? 0 : DEFAULT_HALO_PX;
}

/** Neighbour tiles still needed by an XYZ scan, counted so each is requested once and dropped after its last use. */
type Shared = Map<string, { tile: Promise<FetchedTile> | null; uses: number }>;

/** Pixels of the neighbours that are there, by offset from the centre tile. */
type Neighbours = Map<string, Uint8ClampedArray>;

const offsetKey = (dx: number, dy: number) => `${dx},${dy}`;

/**
 * What the detector is handed for one scan tile. v1 reads bare 256 px pieces.
 * v2 reads one window: the tile plus its halo, taken from the same bitmap
 * (WMS, which asked for it) or assembled from the eight neighbours (XYZ).
 */
function windowsOf(tile: TileCoord, image: DecodedTile, req: TileRequest, halo: number, neighbours: Neighbours | null): TileWindow[] {
  if (neighbours === null) {
    return splitForV1(tile, image).map((p) => ({
      tile: p.tile,
      tilePx: 256,
      halo: 0,
      width: 256,
      height: 256,
      pixels: p.pixels,
      mPerPx: metersPerPixelOfBitmap(p.tile, 256),
    }));
  }
  if (req.halo > 0) return [windowFromBitmap(tile, image.rgba, image.width, image.height, req.halo)];
  const tilePx = image.width;
  const at = (dx: number, dy: number) => (dx === 0 && dy === 0 ? image.rgba : (neighbours.get(offsetKey(dx, dy)) ?? null));
  return [buildTileWindow(tile, tilePx, halo, at)];
}

export async function runScan(area: Ring, args: ScanArgs, deps: ScanDeps = {}): Promise<ScanResult> {
  const sink = deps.log ?? (() => {});
  const log = (line: string) => sink(redact(line));
  const warnSink = deps.warn ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const warn = (line: string) => warnSink(redact(line));
  const progress = deps.progress ?? (() => {});
  const detector = deps.detector ?? makeDetector(args.detector ?? 'v2');
  const v1 = detector.id === 'v1';
  const halo = haloFor(detector.id);
  const cutoffFor = (p: ImageryProvider) => args.threshold ?? (v1 ? V1_THRESHOLD : recommendedFor(p.id));

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
  const found: { d: Detection; provenance: Provenance; cutoff: number }[] = [];
  const cutoffs: number[] = [];

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
    /** Halo inside one WMS request, px of the bitmap it asks for; XYZ sources assemble theirs from neighbours. */
    const wmsHalo = (p: ImageryProvider) => (p.kind === 'wms' ? (halo * p.requestPx) / 256 : 0);

    // Probe: the source is asked for a few sample tiles. Only when it answered
    // for all of them and none has imagery (auto only; a fixed choice is kept
    // and its empty tiles are reported) does the whole part move on. A tile
    // that did not get a proper answer (timeout, 5xx, 429 or another error
    // status, after the retries) says nothing about coverage: the source is
    // kept and the tiles that fail are reported.
    const probed = new Map<string, FetchedTile>();
    for (;;) {
      probed.clear();
      const samples = sampleTiles(part, PROBE_TILES);
      let withData = 0;
      let noImagery = 0;
      let failedProbes = 0;
      let firstProbeError = '';
      for (const t of samples) {
        const req = tileRequest(part.provider, t, wmsHalo(part.provider));
        try {
          const r = await fetcher.get(req.url, req.mirrorUrl);
          if (noDataReason(asResponse(r))) noImagery++;
          else if (r.image) withData++;
          else {
            failedProbes++;
            firstProbeError ||= `HTTP ${r.status}, not an image`;
          }
          probed.set(req.url, r);
        } catch (err) {
          failedProbes++;
          firstProbeError ||= errorText(err);
        }
      }
      if (samples.length === 0) break;
      if (withData > 0 || args.setting.mode === 'fixed') {
        if (failedProbes > 0 && withData === 0) {
          warn(`part ${part.id}: ${part.provider.name} did not answer properly for ${failedProbes} of ${samples.length} sample tiles (first: ${firstProbeError}); keeping it`);
        }
        break;
      }
      if (failedProbes > 0) {
        warn(
          `part ${part.id}: ${part.provider.name} did not answer properly for ${failedProbes} of ${samples.length} sample tiles ` +
            `(first: ${firstProbeError}); not switching source, its tiles will be retried and any that fail listed. Run the scan again when it is back`,
        );
        break;
      }
      const next = fallbackPart(part, area, args.order);
      if (!next) break;
      warn(
        `part ${part.id}: ${part.provider.name} answered ${noImagery} of ${samples.length} sample tiles and has no imagery here; ` +
          `using ${next.provider.name} instead`,
      );
      part = next;
      fetcher = fetcherFor(part);
    }

    const provider = part.provider;
    const date = await partDate(part, fetcher, args.dates);
    const provenance = provenanceOf(provider, part.id, part.plan.zoom, date);
    log(`part ${part.id}: ${provider.name}, ${part.plan.tiles.length} tiles at z${part.plan.zoom}, captured ${date ?? 'date not measured'}`);

    const factor = v1 ? provider.requestPx / 256 : 1;
    const merger = new DetectionMerger({}, mergerTiles(part.plan.tiles.map((t) => t.tile), factor));
    const shared: Shared = new Map();
    if (halo > 0 && provider.kind === 'xyz') {
      const count = (t: TileCoord) => {
        const url = tileRequest(provider, t).url;
        const e = shared.get(url);
        if (e) e.uses++;
        else shared.set(url, { tile: null, uses: 1 });
      };
      for (const { tile } of part.plan.tiles) {
        count(tile);
        for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
          const n = neighbourTile(tile, dx, dy);
          if (n) count(n);
        }
      }
    }
    /** A tile through the shared table when the part has one. */
    const use = (req: TileRequest, have?: FetchedTile): Promise<FetchedTile> => {
      const e = shared.get(req.url);
      if (!e) return have ? Promise.resolve(have) : fetcher.get(req.url, req.mirrorUrl);
      e.tile ??= have ? Promise.resolve(have) : fetcher.get(req.url, req.mirrorUrl);
      const got = e.tile;
      if (--e.uses <= 0) shared.delete(req.url);
      return got;
    };
    const neighboursOf = async (tile: TileCoord): Promise<Neighbours> => {
      const got: Neighbours = new Map();
      if (halo === 0 || provider.kind !== 'xyz') return got;
      await Promise.all(
        NEIGHBOUR_OFFSETS.map(async ([dx, dy]) => {
          const n = neighbourTile(tile, dx, dy);
          if (!n) return;
          try {
            const r = await use(tileRequest(provider, n));
            const img = r.status === 200 ? r.image : null;
            if (img && img.width === provider.requestPx && img.height === provider.requestPx) got.set(offsetKey(dx, dy), img.rgba);
          } catch {
            // A missing neighbour leaves its part of the halo empty.
          }
        }),
      );
      return got;
    };

    let noCoverage = 0;
    let failed = 0;
    let firstError = '';
    const failedTiles: TileCoord[] = [];
    let done = 0;
    for (const { tile } of part.plan.tiles) {
      try {
        const req = tileRequest(provider, tile, wmsHalo(provider));
        const pre = probed.get(req.url);
        probed.delete(req.url);
        const r = await use(req, pre);
        const expected = provider.requestPx + 2 * req.halo;
        if (noDataReason(asResponse(r))) noCoverage++;
        else if (!r.image) {
          failed++;
          failedTiles.push(tile);
          firstError ||= `HTTP ${r.status}, not an image`;
        } else if (r.image.width !== expected || r.image.height !== expected) {
          failed++;
          failedTiles.push(tile);
          firstError ||= `tile decoded at ${r.image.width}x${r.image.height}, expected ${expected}x${expected}`;
        } else {
          for (const w of windowsOf(tile, r.image, req, halo, v1 ? null : await neighboursOf(tile))) {
            const dets: TileDetection[] = detector.detectTile(w, { providerId: provider.id });
            merger.addTileDetections(w.tile, dets);
          }
        }
      } catch (err) {
        failed++;
        failedTiles.push(tile);
        firstError ||= errorText(err);
      }
      done++;
      progress(`part ${part.id} tile ${done}/${part.plan.tiles.length}, ${merger.getAll().length} found`);
    }
    merger.finalize();

    // Scan tiles stick out of the area, and the tiles of two parts overlap along
    // their border: a pool counts for the part that holds its centre, inside the area.
    const cells = new Set(part.cells.map((t) => `${t.x},${t.y}`));
    const owns = (lon: number, lat: number): boolean => {
      if (!pointInRing(lon, lat, area)) return false;
      if (split.parts.length === 1) return true;
      const c = lonLatToTile(lon, lat, part.cellZoom);
      return cells.has(`${c.x},${c.y}`);
    };
    const cutoff = cutoffFor(provider);
    cutoffs.push(cutoff);
    for (const d of merger.getAll()) {
      if (owns(d.center.lon, d.center.lat)) found.push({ d, provenance, cutoff });
    }
    summaries.push(partSummary(part.id, provenance, part.plan.tiles.length, noCoverage, part.areaM2));
    if (failed) {
      const shown = failedTiles.slice(0, 10).map((t) => `${t.z}/${t.x}/${t.y}`).join(' ');
      const more = failedTiles.length > 10 ? ` and ${failedTiles.length - 10} more` : '';
      warn(
        `part ${part.id}: ${failed} tiles failed on ${provider.name} (first: ${firstError}); no pools are listed for them: ${shown}${more}. ` +
          'The source was kept; run the scan again to cover them',
      );
    }
  }

  // Merger ids restart in every part, so they get the part id in front.
  const kept = found
    .filter((f) => f.d.confidence >= f.cutoff)
    .map((f) => ({ d: { ...f.d, id: `${f.provenance.partId}-${f.d.id}` }, provenance: f.provenance }));
  const provenanceById = new Map(kept.map((f) => [f.d.id, f.provenance]));
  const detections: ResultDetection[] = rankDetections(kept.map((f) => f.d)).map((d) =>
    toResultDetection(d, provenanceById.get(d.id)!),
  );
  return {
    formatVersion: 2,
    createdAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    area,
    // With one cutoff per source this is the lowest in use, as in the app's archive.
    threshold: cutoffs.length ? Math.min(...cutoffs) : (args.threshold ?? V1_THRESHOLD),
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
  const sink = deps.log ?? ((l: string) => console.log(l));
  const log = (l: string) => sink(redact(l));
  let args: ScanArgs | 'help';
  try {
    args = parseScanArgs(argv);
    if (args === 'help') {
      sink(SCAN_HELP);
      return 0;
    }
    const area = await resolveArea(args);
    const tty = !args.quiet && process.stdout.isTTY;
    const result = await runScan(area, args, {
      ...deps,
      warn:
        deps.warn ??
        ((l) => {
          // Clear the live progress line first so the notice is not glued to it.
          process.stderr.write(`${tty ? '\r\x1b[2K' : ''}${l}\n`);
        }),
      log: args.quiet ? () => {} : log,
      progress: tty ? (l) => process.stdout.write(`\r\x1b[2K  ${redact(l)}`) : deps.progress,
    });
    if (tty) process.stdout.write('\r\x1b[2K');
    const written = await writeOutputs(result, args.out);
    if (!args.quiet) {
      const cut = args.threshold === null ? 'the cutoff of their source' : String(args.threshold);
      log(`${result.detections.length} detections at or above ${cut}, ${result.belowThreshold} below`);
      for (const p of result.parts) {
        log(`  ${p.id} ${p.provenance.providerName}: ${p.tiles} tiles, ${p.tilesNoCoverage} without imagery`);
      }
      for (const f of written) log(`wrote ${f}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${redact(err.message)}\n`);
      return 2;
    }
    process.stderr.write(`error: ${errorText(err)}\n`);
    return 1;
  }
}
