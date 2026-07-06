/**
 * Detector tuning harness.
 *
 * Fetches a grid of real satellite tiles around a coordinate, runs the pool
 * detector on each, and writes a single annotated mosaic PNG:
 *   · water-mask pixels tinted
 *   · detection outlines drawn (green = high confidence → red = low)
 *   · tile boundaries as thin grey lines
 * Plus a stdout table of every detection. Used to validate and tune thresholds
 * against ground truth by eye.
 *
 * Usage: tsx src/dev/annotate.ts <lat> <lon> [gridSize] [zoom] [outPath]
 */
import { writeFile } from 'node:fs/promises';
import {
  buildWaterMask,
  cleanMask,
  detectTile,
  DetectionMerger,
  lonLatToTile,
  metersPerPixel,
  rankDetections,
  ESRI_WORLD_IMAGERY,
  type TileCoord,
  type TileDetection,
} from '@marco-polo/core';
import { encodePng, fetchTile, sleep } from '../tiles.js';

const [latArg, lonArg, gridArg, zoomArg, outArg] = process.argv.slice(2);
if (!latArg || !lonArg) {
  console.error('usage: tsx src/dev/annotate.ts <lat> <lon> [gridSize] [zoom] [outPath]');
  process.exit(1);
}
const lat = Number(latArg);
const lon = Number(lonArg);
const grid = Number(gridArg ?? 3);
const zoom = Number(zoomArg ?? 19);
const out = outArg ?? `annotated-${lat.toFixed(4)}_${lon.toFixed(4)}-z${zoom}.png`;

const TS = 256;
const center = lonLatToTile(lon, lat, zoom);
const half = Math.floor(grid / 2);
const mosaic = new Uint8ClampedArray(grid * TS * grid * TS * 4);

function blit(rgba: Uint8ClampedArray, gx: number, gy: number) {
  const W = grid * TS;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const src = (y * TS + x) * 4;
      const dst = ((gy * TS + y) * W + gx * TS + x) * 4;
      mosaic[dst] = rgba[src];
      mosaic[dst + 1] = rgba[src + 1];
      mosaic[dst + 2] = rgba[src + 2];
      mosaic[dst + 3] = 255;
    }
  }
}

function tint(gx: number, gy: number, x: number, y: number, rgb: [number, number, number], alpha: number) {
  const W = grid * TS;
  const i = ((gy * TS + y) * W + gx * TS + x) * 4;
  mosaic[i] = mosaic[i] * (1 - alpha) + rgb[0] * alpha;
  mosaic[i + 1] = mosaic[i + 1] * (1 - alpha) + rgb[1] * alpha;
  mosaic[i + 2] = mosaic[i + 2] * (1 - alpha) + rgb[2] * alpha;
}

function drawRect(gx: number, gy: number, minX: number, minY: number, maxX: number, maxY: number, rgb: [number, number, number]) {
  for (let x = Math.max(0, minX - 1); x <= Math.min(TS - 1, maxX + 1); x++) {
    tint(gx, gy, x, Math.max(0, minY - 1), rgb, 1);
    tint(gx, gy, x, Math.min(TS - 1, maxY + 1), rgb, 1);
  }
  for (let y = Math.max(0, minY - 1); y <= Math.min(TS - 1, maxY + 1); y++) {
    tint(gx, gy, Math.max(0, minX - 1), y, rgb, 1);
    tint(gx, gy, Math.min(TS - 1, maxX + 1), y, rgb, 1);
  }
}

const tiles: TileCoord[] = [];
for (let dy = -half; dy < grid - half; dy++) {
  for (let dx = -half; dx < grid - half; dx++) {
    tiles.push({ z: zoom, x: center.x + dx, y: center.y + dy });
  }
}

const merger = new DetectionMerger({}, tiles);
const perTile = new Map<string, TileDetection[]>();

console.log(`center tile z${zoom} (${center.x},${center.y}) — m/px ≈ ${metersPerPixel(lat, zoom).toFixed(3)}`);

for (const tile of tiles) {
  const gx = tile.x - (center.x - half);
  const gy = tile.y - (center.y - half);
  const { rgba, width, height } = await fetchTile(ESRI_WORLD_IMAGERY.urlTemplate, tile, {
    cacheDir: '.tile-cache',
  });
  blit(rgba, gx, gy);

  // Tint the raw and cleaned water masks so threshold behaviour is visible.
  const { mask } = buildWaterMask(rgba, width, height);
  const cleaned = cleanMask(mask, width, height);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const i = y * TS + x;
      if (cleaned[i]) tint(gx, gy, x, y, [255, 0, 255], 0.35);
      else if (mask[i]) tint(gx, gy, x, y, [255, 160, 0], 0.3);
    }
  }

  const dets = detectTile(rgba, width, height, tile);
  perTile.set(`${gx},${gy}`, dets);
  merger.addTileDetections(tile, dets);
  await sleep(150);
}
merger.finalize();

// Draw per-tile detection bboxes coloured by confidence.
for (const [key, dets] of perTile) {
  const [gx, gy] = key.split(',').map(Number);
  for (const d of dets) {
    const conf = d.strictRatio; // fragment-level proxy
    const rgb: [number, number, number] = conf > 0.5 ? [0, 255, 60] : conf > 0.25 ? [255, 220, 0] : [255, 60, 60];
    drawRect(gx, gy, d.bboxPx.minX, d.bboxPx.minY, d.bboxPx.maxX, d.bboxPx.maxY, rgb);
  }
}

// Tile boundary lines.
const W = grid * TS;
for (let g = 1; g < grid; g++) {
  for (let p = 0; p < W; p++) {
    const i1 = (g * TS * W + p) * 4;
    const i2 = (p * W + g * TS) * 4;
    mosaic[i1] = mosaic[i1 + 1] = mosaic[i1 + 2] = 90;
    mosaic[i2] = mosaic[i2 + 1] = mosaic[i2 + 2] = 90;
  }
}

await writeFile(out, encodePng(mosaic, W, W));

const ranked = rankDetections(merger.getAll());
console.log(`\n${ranked.length} merged detections:`);
for (const d of ranked.slice(0, 40)) {
  console.log(
    `#${String(d.rank).padStart(2)} ${d.kind.padEnd(7)} ${d.areaM2.toFixed(1).padStart(7)} m²  conf ${d.confidence.toFixed(2)}  hue ${d.meanHue.toFixed(0)}  sat ${d.meanSat.toFixed(2)}  fill ${d.fillRatio.toFixed(2)}  tex ${d.texture.toFixed(3)}  ${d.center.lat.toFixed(6)},${d.center.lon.toFixed(6)}${d.truncated ? '  [truncated]' : ''}`,
  );
}
console.log(`\nwater bodies filtered: ${merger.waterBodiesFiltered}`);
console.log(`wrote ${out}`);
