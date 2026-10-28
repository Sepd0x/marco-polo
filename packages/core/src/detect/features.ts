import { DEFAULT_THRESHOLDS, isStrictPoolPixel } from './color.js';
import type { Component } from './mask.js';

/**
 * Per-candidate features for the learned scorer. Pure arithmetic on the
 * window pixels, so the browser, the CLI and the training tools compute the
 * same numbers from the same bytes.
 *
 * Three regions per candidate: the shape itself, an inner ring 1 to 3 px
 * around it (coping, deck) and an outer ring 4 to 10 px (garden, roof, road).
 * Pixels without imagery (alpha below 200, a missing neighbour tile) are left
 * out of every statistic.
 */
export const FEATURE_NAMES = [
  'level', 'in_h', 'in_s', 'in_v', 'in_hsd', 'in_ssd', 'in_vsd', 'in_r', 'in_g', 'in_b', 'in_br', 'in_gr', 'in_bg',
  'in_strict', 'in_gate', 'in_tex', 'in_texfrac', 'log_area', 'fill', 'aspect', 'compact', 'extent_m', 'edge_grad', 'touches',
  'a_v', 'a_s', 'a_vsd', 'a_r', 'a_g', 'a_b', 'a_perm', 'a_green', 'a_deck', 'a_dark', 'a_tex',
  'b_v', 'b_s', 'b_vsd', 'b_perm', 'b_green', 'b_deck', 'b_dark', 'b_tex',
  'contrast_a', 'contrast_b', 'tile_v', 'tile_s',
  'obb_fill', 'obb_len_m', 'obb_wid_m', 'obb_aspect', 'court_dev', 'hole_frac', 'in_line', 'a_deck_min', 'b_vasym',
] as const;

export const FEATURE_COUNT = FEATURE_NAMES.length;

const MAX_RING = 10;
const INNER_RING = 3;

// Cosine and sine of 0, 5, ..., 85 degrees as literals: Math.cos may differ
// in the last bit between engines, and the features must not.
const OBB_COS = [1.0, 0.996194698091746, 0.984807753012208, 0.965925826289068, 0.939692620785908, 0.90630778703665, 0.866025403784439, 0.819152044288992, 0.766044443118978, 0.707106781186548, 0.642787609686539, 0.573576436351046, 0.5, 0.422618261740699, 0.342020143325669, 0.258819045102521, 0.17364817766693, 0.087155742747658];
const OBB_SIN = [0.0, 0.087155742747658, 0.17364817766693, 0.258819045102521, 0.342020143325669, 0.422618261740699, 0.5, 0.573576436351046, 0.642787609686539, 0.707106781186547, 0.766044443118978, 0.819152044288992, 0.866025403784439, 0.90630778703665, 0.939692620785908, 0.965925826289068, 0.984807753012208, 0.996194698091746];

/** Playing surfaces of padel and tennis (doubles, singles), metres. Painted courts pass the blue and green gates. */
const COURTS: readonly [number, number][] = [[20, 10], [23.77, 10.97], [23.77, 8.23]];

/** Everything a feature needs that is shared by all candidates of one window. */
export interface FeatureContext {
  pixels: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  hue: Float32Array;
  sat: Float32Array;
  val: Float32Array;
  /** Strictest colour gate (the v1 gate), before morphology. */
  strictGate: Uint8Array;
  /** Most permissive colour gate, before morphology. */
  permissiveGate: Uint8Array;
  /** Mean brightness and saturation of the central tile. */
  contextV: number;
  contextS: number;
}

// Per-ring accumulators, ACC_STRIDE numbers each, in one Float64Array.
const K_N = 0, K_H = 1, K_H2 = 2, K_S = 3, K_S2 = 4, K_V = 5, K_V2 = 6, K_R = 7, K_G = 8, K_B = 9, K_BR = 10, K_GR = 11, K_BG = 12;
const K_STRICT = 13, K_GATE = 14, K_PERM = 15, K_GREEN = 16, K_DECK = 17, K_DARK = 18, K_TEX = 19, K_TEXN = 20;
const ACC_STRIDE = 21;
const mean = (a: Float64Array, o: number, k: number) => (a[o + K_N] ? a[o + k] / a[o + K_N] : 0);
const sd = (a: Float64Array, o: number, k: number, k2: number) => (a[o + K_N] ? Math.sqrt(Math.max(0, a[o + k2] / a[o + K_N] - (a[o + k] / a[o + K_N]) ** 2)) : 0);

/** Distance grid of the window around a candidate, kept between calls. */
let distScratch = new Uint8Array(0);

/**
 * Write the features of component `c` (labelled `c.label` in `labels`) into
 * `out` from `offset`. `mPerPx` is the ground size of a pixel at the shape.
 */
export function componentFeatures(
  ctx: FeatureContext,
  labels: Int32Array,
  c: Component,
  level: number,
  mPerPx: number,
  out: Float64Array,
  offset = 0,
): void {
  const { pixels, width: W, height: H, hue, sat, val } = ctx;
  const bwC = c.maxX - c.minX + 1;
  const bhC = c.maxY - c.minY + 1;
  const wx0 = Math.max(0, c.minX - MAX_RING);
  const wy0 = Math.max(0, c.minY - MAX_RING);
  const wx1 = Math.min(W - 1, c.maxX + MAX_RING);
  const wy1 = Math.min(H - 1, c.maxY + MAX_RING);
  const ww = wx1 - wx0 + 1;
  const wh = wy1 - wy0 + 1;

  // Chessboard distance to the shape, up to MAX_RING (255 beyond): two raster
  // passes, exact for the chessboard metric, the same grid a breadth-first
  // growth from the shape gives.
  if (distScratch.length < ww * wh) distScratch = new Uint8Array(ww * wh * 2);
  const d = distScratch.subarray(0, ww * wh);
  d.fill(254);
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      if (labels[y * W + x] === c.label) d[(y - wy0) * ww + (x - wx0)] = 0;
    }
  }
  for (let ky = 0; ky < wh; ky++) {
    const row = ky * ww;
    for (let kx = 0; kx < ww; kx++) {
      const k = row + kx;
      let m = d[k];
      if (m === 0) continue;
      if (kx > 0 && d[k - 1] + 1 < m) m = d[k - 1] + 1;
      if (ky > 0) {
        const u = k - ww;
        if (d[u] + 1 < m) m = d[u] + 1;
        if (kx > 0 && d[u - 1] + 1 < m) m = d[u - 1] + 1;
        if (kx + 1 < ww && d[u + 1] + 1 < m) m = d[u + 1] + 1;
      }
      d[k] = m;
    }
  }
  for (let ky = wh - 1; ky >= 0; ky--) {
    const row = ky * ww;
    for (let kx = ww - 1; kx >= 0; kx--) {
      const k = row + kx;
      let m = d[k];
      if (m === 0) continue;
      if (kx + 1 < ww && d[k + 1] + 1 < m) m = d[k + 1] + 1;
      if (ky + 1 < wh) {
        const u = k + ww;
        if (d[u] + 1 < m) m = d[u] + 1;
        if (kx + 1 < ww && d[u + 1] + 1 < m) m = d[u + 1] + 1;
        if (kx > 0 && d[u - 1] + 1 < m) m = d[u - 1] + 1;
      }
      d[k] = m > MAX_RING ? 255 : m;
    }
  }

  const acc = new Float64Array(3 * ACC_STRIDE);
  // Per side of the shape (east, west, south, north of the centroid): deck share of the inner ring, brightness of the outer ring.
  const cxs = c.sumX / c.pixelCount;
  const cys = c.sumY / c.pixelCount;
  const sideDeck = [0, 0, 0, 0], sideDeckN = [0, 0, 0, 0];
  const sideV = [0, 0, 0, 0], sideVN = [0, 0, 0, 0];
  let perim = 0;
  let edgeGrad = 0;
  let edgeN = 0;
  for (let ky = 0; ky < wh; ky++) {
    for (let kx = 0; kx < ww; kx++) {
      const dd = d[ky * ww + kx];
      if (dd > MAX_RING) continue;
      const x = kx + wx0;
      const y = ky + wy0;
      const i = y * W + x;
      if (pixels[i * 4 + 3] < 200) continue;
      const ring = dd === 0 ? 0 : dd <= INNER_RING ? 1 : 2;
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const h = hue[i], s = sat[i], v = val[i];
      const o = ring * ACC_STRIDE;
      acc[o + K_N]++;
      acc[o + K_H] += h;
      acc[o + K_H2] += h * h;
      acc[o + K_S] += s;
      acc[o + K_S2] += s * s;
      acc[o + K_V] += v;
      acc[o + K_V2] += v * v;
      acc[o + K_R] += r;
      acc[o + K_G] += g;
      acc[o + K_B] += b;
      acc[o + K_BR] += b - r;
      acc[o + K_GR] += g - r;
      acc[o + K_BG] += b - g;
      if (isStrictPoolPixel(h, s, DEFAULT_THRESHOLDS)) acc[o + K_STRICT]++;
      if (ctx.strictGate[i]) acc[o + K_GATE]++;
      if (ctx.permissiveGate[i]) acc[o + K_PERM]++;
      if (g > r && g >= b && h > 60 && h < 160 && s > 0.12) acc[o + K_GREEN]++;
      if (v > 0.62 && s < 0.18) acc[o + K_DECK]++;
      if (v < 0.22) acc[o + K_DARK]++;
      if (ring > 0) {
        const dx = x - cxs, dy = y - cys;
        const side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 1) : dy >= 0 ? 2 : 3;
        if (ring === 1) {
          sideDeckN[side]++;
          if (v > 0.62 && s < 0.18) sideDeck[side]++;
        } else {
          sideVN[side]++;
          sideV[side] += v;
        }
      }
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
        // Forward differences, sampled only where both neighbours belong to the same region.
        let same: boolean;
        if (ring === 0) {
          same = labels[i + 1] === c.label && labels[i + W] === c.label && labels[i - 1] === c.label && labels[i - W] === c.label;
        } else {
          const right = kx + 1 < ww ? d[ky * ww + kx + 1] : 255;
          const down = ky + 1 < wh ? d[(ky + 1) * ww + kx] : 255;
          same = right > 0 && right <= MAX_RING && down > 0 && down <= MAX_RING;
        }
        if (same) {
          acc[o + K_TEX] += Math.abs(val[i + 1] - v) + Math.abs(val[i + W] - v);
          acc[o + K_TEXN]++;
        }
      }
      if (ring === 0) {
        let border = false;
        if (kx + 1 >= ww || d[ky * ww + kx + 1] !== 0) { perim++; border = true; }
        if (kx - 1 < 0 || d[ky * ww + kx - 1] !== 0) { perim++; border = true; }
        if (ky + 1 >= wh || d[(ky + 1) * ww + kx] !== 0) { perim++; border = true; }
        if (ky - 1 < 0 || d[(ky - 1) * ww + kx] !== 0) { perim++; border = true; }
        if (border && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
          edgeGrad += Math.abs(val[i + 1] - val[i - 1]) + Math.abs(val[i + W] - val[i - W]);
          edgeN++;
        }
      }
    }
  }

  const I = 0, A = ACC_STRIDE, Bo = 2 * ACC_STRIDE;
  const areaM2 = c.pixelCount * mPerPx * mPerPx;
  const touches = c.minX === 0 || c.minY === 0 || c.maxX === W - 1 || c.maxY === H - 1 ? 1 : 0;
  const f = out;
  let o = offset;
  f[o++] = level;
  f[o++] = mean(acc, I, K_H);
  f[o++] = mean(acc, I, K_S);
  f[o++] = mean(acc, I, K_V);
  f[o++] = sd(acc, I, K_H, K_H2);
  f[o++] = sd(acc, I, K_S, K_S2);
  f[o++] = sd(acc, I, K_V, K_V2);
  f[o++] = mean(acc, I, K_R) / 255;
  f[o++] = mean(acc, I, K_G) / 255;
  f[o++] = mean(acc, I, K_B) / 255;
  f[o++] = mean(acc, I, K_BR) / 255;
  f[o++] = mean(acc, I, K_GR) / 255;
  f[o++] = mean(acc, I, K_BG) / 255;
  f[o++] = mean(acc, I, K_STRICT);
  f[o++] = mean(acc, I, K_GATE);
  f[o++] = acc[I + K_TEXN] ? acc[I + K_TEX] / acc[I + K_TEXN] : -1;
  f[o++] = acc[I + K_N] ? acc[I + K_TEXN] / acc[I + K_N] : 0;
  f[o++] = Math.log(areaM2);
  f[o++] = c.pixelCount / (bwC * bhC);
  f[o++] = Math.max(bwC, bhC) / Math.min(bwC, bhC);
  f[o++] = (perim * perim) / (4 * Math.PI * c.pixelCount);
  f[o++] = Math.max(bwC, bhC) * mPerPx;
  f[o++] = edgeN ? edgeGrad / edgeN : 0;
  f[o++] = touches;
  f[o++] = mean(acc, A, K_V);
  f[o++] = mean(acc, A, K_S);
  f[o++] = sd(acc, A, K_V, K_V2);
  f[o++] = mean(acc, A, K_R) / 255;
  f[o++] = mean(acc, A, K_G) / 255;
  f[o++] = mean(acc, A, K_B) / 255;
  f[o++] = mean(acc, A, K_PERM);
  f[o++] = mean(acc, A, K_GREEN);
  f[o++] = mean(acc, A, K_DECK);
  f[o++] = mean(acc, A, K_DARK);
  f[o++] = acc[A + K_TEXN] ? acc[A + K_TEX] / acc[A + K_TEXN] : 0;
  f[o++] = mean(acc, Bo, K_V);
  f[o++] = mean(acc, Bo, K_S);
  f[o++] = sd(acc, Bo, K_V, K_V2);
  f[o++] = mean(acc, Bo, K_PERM);
  f[o++] = mean(acc, Bo, K_GREEN);
  f[o++] = mean(acc, Bo, K_DECK);
  f[o++] = mean(acc, Bo, K_DARK);
  f[o++] = acc[Bo + K_TEXN] ? acc[Bo + K_TEX] / acc[Bo + K_TEXN] : 0;
  f[o++] = mean(acc, A, K_V) - mean(acc, I, K_V);
  f[o++] = mean(acc, Bo, K_V) - mean(acc, I, K_V);
  f[o++] = ctx.contextV;
  f[o++] = ctx.contextS;

  const obb = orientedBox(labels, W, c);
  const len = obb.long * mPerPx, wid = obb.short * mPerPx;
  let court = Infinity;
  for (const [cl, cw] of COURTS) court = Math.min(court, Math.max(Math.abs(len / cl - 1), Math.abs(wid / cw - 1)));
  const holes = enclosedHoles(labels, W, c, val, sat);
  let deckMin = 1;
  for (let k = 0; k < 4; k++) deckMin = Math.min(deckMin, sideDeckN[k] ? sideDeck[k] / sideDeckN[k] : 0);
  let vMin = Infinity, vMax = -Infinity;
  for (let k = 0; k < 4; k++) {
    if (!sideVN[k]) continue;
    const m = sideV[k] / sideVN[k];
    vMin = Math.min(vMin, m);
    vMax = Math.max(vMax, m);
  }
  f[o++] = c.pixelCount / obb.area;
  f[o++] = len;
  f[o++] = wid;
  f[o++] = obb.long / obb.short;
  f[o++] = court;
  f[o++] = holes.count / (holes.count + c.pixelCount);
  f[o++] = (holes.bright + holes.brightInside) / (holes.count + c.pixelCount);
  f[o++] = deckMin;
  f[o++] = vMax >= vMin ? vMax - vMin : 0;
}

/**
 * Smallest rectangle around the shape among 18 orientations 5 degrees apart,
 * from the corners of its border pixels. Sides in px.
 */
export function orientedBox(labels: Int32Array, W: number, c: Component): { long: number; short: number; area: number } {
  const lo = new Float64Array(36).fill(Infinity);
  const hi = new Float64Array(36).fill(-Infinity);
  // Every cosine and sine here is >= 0, so on one row of corners u grows and
  // v shrinks with x: the extremes over a row are at its first and last
  // corner, which belong to the first and last pixel of the shape on the two
  // pixel rows that share it (both border pixels). Same values, same extremes.
  const rows = c.maxY - c.minY + 1;
  const first = new Int32Array(rows).fill(-1);
  const last = new Int32Array(rows).fill(-1);
  for (let y = c.minY; y <= c.maxY; y++) {
    const row = y * W;
    let x = c.minX;
    while (x <= c.maxX && labels[row + x] !== c.label) x++;
    if (x > c.maxX) continue;
    first[y - c.minY] = x;
    let x1 = c.maxX;
    while (labels[row + x1] !== c.label) x1--;
    last[y - c.minY] = x1;
  }
  for (let cy = c.minY; cy <= c.maxY + 1; cy++) {
    let a = Infinity, b = -Infinity;
    for (let y = cy - 1; y <= cy; y++) {
      if (y < c.minY || y > c.maxY || first[y - c.minY] < 0) continue;
      if (first[y - c.minY] < a) a = first[y - c.minY];
      if (last[y - c.minY] + 1 > b) b = last[y - c.minY] + 1;
    }
    if (a === Infinity) continue;
    for (let k = 0; k < 18; k++) {
      const ua = a * OBB_COS[k] + cy * OBB_SIN[k];
      const ub = b * OBB_COS[k] + cy * OBB_SIN[k];
      const va = cy * OBB_COS[k] - a * OBB_SIN[k];
      const vb = cy * OBB_COS[k] - b * OBB_SIN[k];
      if (ua < lo[2 * k]) lo[2 * k] = ua;
      if (ub > hi[2 * k]) hi[2 * k] = ub;
      if (vb < lo[2 * k + 1]) lo[2 * k + 1] = vb;
      if (va > hi[2 * k + 1]) hi[2 * k + 1] = va;
    }
  }
  let best = { long: 1, short: 1, area: Infinity };
  for (let k = 0; k < 18; k++) {
    const a = hi[2 * k] - lo[2 * k], b = hi[2 * k + 1] - lo[2 * k + 1];
    if (a * b < best.area) best = { long: Math.max(a, b), short: Math.min(a, b), area: a * b };
  }
  return best;
}

/**
 * Pixels inside the shape's box that the shape encloses (not reachable from
 * the box border without crossing it), how many of them are bright and grey,
 * and how many bright grey pixels the shape itself holds. The painted lines
 * of a court are bright and grey; the mask clean-up often closes them into
 * the shape. Pool water has few such pixels.
 */
export function enclosedHoles(labels: Int32Array, W: number, c: Component, val: Float32Array, sat: Float32Array): { count: number; bright: number; brightInside: number } {
  const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
  const seen = new Uint8Array(bw * bh);
  // Each box pixel is pushed at most once.
  const stack = new Int32Array(bw * bh);
  let sp = 0;
  const label = c.label;
  const base = c.minY * W + c.minX;
  for (let lx = 0; lx < bw; lx++) {
    for (const ly of bh > 1 ? [0, bh - 1] : [0]) {
      const k = ly * bw + lx;
      if (!seen[k] && labels[base + ly * W + lx] !== label) { seen[k] = 1; stack[sp++] = k; }
    }
  }
  for (let ly = 0; ly < bh; ly++) {
    for (const lx of bw > 1 ? [0, bw - 1] : [0]) {
      const k = ly * bw + lx;
      if (!seen[k] && labels[base + ly * W + lx] !== label) { seen[k] = 1; stack[sp++] = k; }
    }
  }
  while (sp) {
    const k = stack[--sp];
    const ly = (k / bw) | 0;
    const lx = k - ly * bw;
    const i = base + ly * W + lx;
    if (lx > 0 && !seen[k - 1] && labels[i - 1] !== label) { seen[k - 1] = 1; stack[sp++] = k - 1; }
    if (lx < bw - 1 && !seen[k + 1] && labels[i + 1] !== label) { seen[k + 1] = 1; stack[sp++] = k + 1; }
    if (ly > 0 && !seen[k - bw] && labels[i - W] !== label) { seen[k - bw] = 1; stack[sp++] = k - bw; }
    if (ly < bh - 1 && !seen[k + bw] && labels[i + W] !== label) { seen[k + bw] = 1; stack[sp++] = k + bw; }
  }
  let count = 0, bright = 0, brightInside = 0;
  for (let ly = 0; ly < bh; ly++) {
    for (let lx = 0; lx < bw; lx++) {
      const k = ly * bw + lx;
      const i = (ly + c.minY) * W + lx + c.minX;
      if (seen[k]) continue;
      const grey = val[i] > 0.62 && sat[i] < 0.25;
      if (labels[i] === c.label) {
        if (grey) brightInside++;
        continue;
      }
      count++;
      if (grey) bright++;
    }
  }
  return { count, bright, brightInside };
}
