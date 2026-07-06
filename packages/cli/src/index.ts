/**
 * marco-polo CLI — headless satellite pool scanner.
 *
 * Scans a bounding box or GeoJSON polygon for swimming pools and writes
 * ranked GeoJSON + CSV. Same engine as the web app, no browser required.
 *
 *   npm run scan -- --bbox "37.070,-8.125,37.079,-8.106"
 *   npm run scan -- --area ./area.geojson --zoom 19 --out ./scans/vilamoura
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildScanPlan,
  DetectionMerger,
  ESRI_WORLD_IMAGERY,
  detectTile,
  rankDetections,
  tileUrl,
  type RankedDetection,
  type Ring,
} from '@marco-polo/core';
import { fetchTile, sleep } from './tiles.js';

interface Args {
  bbox?: string;
  area?: string;
  zoom: number;
  out: string;
  rate: number;
  order: 'serpentine' | 'spiral';
  template: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    zoom: 19,
    out: './scans/scan',
    rate: 5,
    order: 'serpentine',
    template: ESRI_WORLD_IMAGERY.urlTemplate,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--bbox': args.bbox = next(); break;
      case '--area': args.area = next(); break;
      case '--zoom': args.zoom = Number(next()); break;
      case '--out': args.out = next(); break;
      case '--rate': args.rate = Math.min(10, Math.max(1, Number(next()))); break;
      case '--order': args.order = next() as Args['order']; break;
      case '--template': args.template = next(); break;
      case '--quiet': args.quiet = true; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`marco-polo — satellite pool scanner (headless)

usage:
  npm run scan -- --bbox "<south,west,north,east>" [options]
  npm run scan -- --area <polygon.geojson> [options]

options:
  --bbox <s,w,n,e>    bounding box in decimal degrees
  --area <file>       GeoJSON file (Polygon / MultiPolygon / Feature)
  --zoom <n>          scan zoom level, 18–19 (default 19, ~0.3 m/px)
  --out <path>        output basename (default ./scans/scan → .geojson + .csv)
  --rate <n>          max tile requests per second, 1–10 (default 5)
  --order <o>         serpentine | spiral (default serpentine)
  --template <url>    custom XYZ imagery template with {z}/{x}/{y}
  --quiet             suppress live progress
`);
}

async function resolveRing(args: Args): Promise<Ring> {
  if (args.bbox) {
    const parts = args.bbox.split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
      throw new Error('--bbox must be "south,west,north,east" in decimal degrees');
    }
    const [s, w, n, e] = parts;
    return [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ];
  }
  if (args.area) {
    const raw = JSON.parse(await readFile(args.area, 'utf8'));
    const geom = raw.type === 'Feature' ? raw.geometry : raw.type === 'FeatureCollection' ? raw.features[0]?.geometry : raw;
    if (geom?.type === 'Polygon') return geom.coordinates[0] as Ring;
    if (geom?.type === 'MultiPolygon') return geom.coordinates[0][0] as Ring;
    throw new Error('--area file must contain a Polygon or MultiPolygon');
  }
  throw new Error('provide --bbox or --area (see --help)');
}

const args = parseArgs(process.argv.slice(2));

let ring: Ring;
try {
  ring = await resolveRing(args);
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const plan = buildScanPlan(ring, args.zoom, args.order);
if (plan.tiles.length === 0) {
  console.error('error: the area covers no tiles at this zoom');
  process.exit(1);
}

const merger = new DetectionMerger({}, plan.tiles.map((t) => t.tile));
const started = Date.now();
let done = 0;
let failed = 0;

if (!args.quiet) {
  console.log(`marco polo — scanning ${plan.tiles.length} tiles @ z${args.zoom} (${(plan.areaM2 / 1e6).toFixed(2)} km²)`);
  console.log(`imagery: ${args.template === ESRI_WORLD_IMAGERY.urlTemplate ? ESRI_WORLD_IMAGERY.name : args.template}`);
  console.log('');
}

const interval = 1000 / args.rate;
for (const scanTile of plan.tiles) {
  const t0 = Date.now();
  try {
    const { rgba, width, height } = await fetchTile(args.template, scanTile.tile, {
      cacheDir: '.tile-cache',
    });
    const dets = detectTile(rgba, width, height, scanTile.tile);
    const events = merger.addTileDetections(scanTile.tile, dets);
    if (!args.quiet) {
      for (const e of events) {
        if (e.type === 'add') {
          const d = e.detection;
          process.stdout.write(
            `\r\x1b[2K  POLO  ${d.kind === 'hot_tub' ? 'hot tub' : 'pool   '} ${d.areaM2.toFixed(1).padStart(7)} m²  conf ${d.confidence.toFixed(2)}  ${d.center.lat.toFixed(6)}, ${d.center.lon.toFixed(6)}\n`,
          );
        }
      }
    }
  } catch {
    failed++;
  }
  done++;
  if (!args.quiet) {
    const pct = ((done / plan.tiles.length) * 100).toFixed(1);
    const found = merger.getAll().length;
    const elapsed = (Date.now() - started) / 1000;
    const eta = done > 3 ? ((elapsed / done) * (plan.tiles.length - done)).toFixed(0) : '…';
    process.stdout.write(
      `\r\x1b[2K  marco? tile ${done}/${plan.tiles.length} (${pct}%) · ${found} found · eta ${eta}s`,
    );
  }
  const dt = Date.now() - t0;
  if (dt < interval) await sleep(interval - dt);
}

merger.finalize();
const ranked = rankDetections(merger.getAll());
const elapsedS = ((Date.now() - started) / 1000).toFixed(1);

if (!args.quiet) {
  process.stdout.write('\r\x1b[2K');
  console.log(`\ndone in ${elapsedS}s — ${ranked.length} detections, ${failed} tile failures, ${merger.waterBodiesFiltered} open-water bodies skipped\n`);
  for (const d of ranked.slice(0, 25)) {
    console.log(
      `  #${String(d.rank).padStart(3)}  ${d.areaM2.toFixed(1).padStart(8)} m²  conf ${d.confidence.toFixed(2)}  ${d.kind.padEnd(7)}  ${d.center.lat.toFixed(6)}, ${d.center.lon.toFixed(6)}${d.truncated ? '  [truncated]' : ''}`,
    );
  }
  if (ranked.length > 25) console.log(`  … and ${ranked.length - 25} more`);
}

// ── outputs ──────────────────────────────────────────────────────
const outDir = join(args.out, '..');
await mkdir(outDir, { recursive: true });

await writeFile(`${args.out}.geojson`, geojson(ranked), 'utf8');
await writeFile(`${args.out}.csv`, csv(ranked), 'utf8');
console.log(`\nwrote ${args.out}.geojson`);
console.log(`wrote ${args.out}.csv`);

function geojson(list: RankedDetection[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      generator: 'marco-polo',
      scannedAt: new Date().toISOString(),
      zoom: args.zoom,
      imagery: args.template,
      features: list.map((d) => ({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: d.outline.map((r) => [r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r]),
        },
        properties: {
          id: d.id,
          rank: d.rank,
          kind: d.kind,
          area_m2: Number(d.areaM2.toFixed(1)),
          confidence: d.confidence,
          lat: Number(d.center.lat.toFixed(6)),
          lon: Number(d.center.lon.toFixed(6)),
          truncated: d.truncated,
        },
      })),
    },
    null,
    2,
  );
}

function csv(list: RankedDetection[]): string {
  const rows = list.map((d) =>
    [
      d.rank,
      d.id,
      d.kind,
      d.center.lat.toFixed(6),
      d.center.lon.toFixed(6),
      d.areaM2.toFixed(1),
      d.confidence,
      d.truncated,
      `"https://www.google.com/maps/search/?api=1&query=${d.center.lat.toFixed(6)}%2C${d.center.lon.toFixed(6)}"`,
    ].join(','),
  );
  return ['rank,id,kind,lat,lon,area_m2,confidence,truncated,google_maps', ...rows].join('\n');
}
