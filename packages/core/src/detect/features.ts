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
const OBB_SIN = [0.0, 0.087155742747658, 0.17364817766693, 0.258819045102521, 0.342020143325669, 0.422618261740699, 0.5, 0.573576436351046, 0.642787609686539, 0.707106781186548, 0.766044443118978, 0.819152044288992, 0.866025403784439, 0.90630778703665, 0.939692620785908, 0.965925826289068, 0.984807753012208, 0.996194698091746];

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

interface Acc {
  n: number;
  h: number;
  h2: number;
  s: number;
  s2: number;
  v: number;
  v2: number;
  r: number;
  g: number;
  b: number;
  br: number;
  gr: number;
  bg: number;
  strict: number;
  gate: number;
  perm: number;
  green: number;
  deck: number;
  dark: number;
  tex: number;
  texN: number;
}

const acc = (): Acc => ({ n: 0, h: 0, h2: 0, s: 0, s2: 0, v: 0, v2: 0, r: 0, g: 0, b: 0, br: 0, gr: 0, bg: 0, strict: 0, gate: 0, perm: 0, green: 0, deck: 0, dark: 0, tex: 0, texN: 0 });
const mean = (a: Acc, k: number) => (a.n ? k / a.n : 0);
const sd = (a: Acc, k: number, k2: number) => (a.n ? Math.sqrt(Math.max(0, k2 / a.n - (k / a.n) ** 2)) : 0);

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

  // Chessboard distance to the shape, up to MAX_RING, by breadth-first growth.
  const d = new Uint8Array(ww * wh).fill(255);
  let frontier: number[] = [];
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      if (labels[y * W + x] === c.label) {
        const k = (y - wy0) * ww + (x - wx0);
        d[k] = 0;
        frontier.push(k);
      }
    }
  }
  for (let step = 1; step <= MAX_RING && frontier.length; step++) {
    const next: number[] = [];
    for (const k of frontier) {
      const kx = k % ww;
      const ky = (k / ww) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = ky + dy;
        if (ny < 0 || ny >= wh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = kx + dx;
          if (nx < 0 || nx >= ww) continue;
          const nk = ny * ww + nx;
          if (d[nk] > step) {
            d[nk] = step;
            next.push(nk);
          }
        }
      }
    }
    frontier = next;
  }

  const rings = [acc(), acc(), acc()];
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
      const a = rings[ring];
      a.n++;
      a.h += h;
      a.h2 += h * h;
      a.s += s;
      a.s2 += s * s;
      a.v += v;
      a.v2 += v * v;
      a.r += r;
      a.g += g;
      a.b += b;
      a.br += b - r;
      a.gr += g - r;
      a.bg += b - g;
      if (isStrictPoolPixel(h, s, DEFAULT_THRESHOLDS)) a.strict++;
      if (ctx.strictGate[i]) a.gate++;
      if (ctx.permissiveGate[i]) a.perm++;
      if (g > r && g >= b && h > 60 && h < 160 && s > 0.12) a.green++;
      if (v > 0.62 && s < 0.18) a.deck++;
      if (v < 0.22) a.dark++;
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
          a.tex += Math.abs(val[i + 1] - v) + Math.abs(val[i + W] - v);
          a.texN++;
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

  const [I, A, B] = rings;
  const areaM2 = c.pixelCount * mPerPx * mPerPx;
  const touches = c.minX === 0 || c.minY === 0 || c.maxX === W - 1 || c.maxY === H - 1 ? 1 : 0;
  const f = out;
  let o = offset;
  f[o++] = level;
  f[o++] = mean(I, I.h);
  f[o++] = mean(I, I.s);
  f[o++] = mean(I, I.v);
  f[o++] = sd(I, I.h, I.h2);
  f[o++] = sd(I, I.s, I.s2);
  f[o++] = sd(I, I.v, I.v2);
  f[o++] = mean(I, I.r) / 255;
  f[o++] = mean(I, I.g) / 255;
  f[o++] = mean(I, I.b) / 255;
  f[o++] = mean(I, I.br) / 255;
  f[o++] = mean(I, I.gr) / 255;
  f[o++] = mean(I, I.bg) / 255;
  f[o++] = mean(I, I.strict);
  f[o++] = mean(I, I.gate);
  f[o++] = I.texN ? I.tex / I.texN : -1;
  f[o++] = I.n ? I.texN / I.n : 0;
  f[o++] = Math.log(areaM2);
  f[o++] = c.pixelCount / (bwC * bhC);
  f[o++] = Math.max(bwC, bhC) / Math.min(bwC, bhC);
  f[o++] = (perim * perim) / (4 * Math.PI * c.pixelCount);
  f[o++] = Math.max(bwC, bhC) * mPerPx;
  f[o++] = edgeN ? edgeGrad / edgeN : 0;
  f[o++] = touches;
  f[o++] = mean(A, A.v);
  f[o++] = mean(A, A.s);
  f[o++] = sd(A, A.v, A.v2);
  f[o++] = mean(A, A.r) / 255;
  f[o++] = mean(A, A.g) / 255;
  f[o++] = mean(A, A.b) / 255;
  f[o++] = mean(A, A.perm);
  f[o++] = mean(A, A.green);
  f[o++] = mean(A, A.deck);
  f[o++] = mean(A, A.dark);
  f[o++] = A.texN ? A.tex / A.texN : 0;
  f[o++] = mean(B, B.v);
  f[o++] = mean(B, B.s);
  f[o++] = sd(B, B.v, B.v2);
  f[o++] = mean(B, B.perm);
  f[o++] = mean(B, B.green);
  f[o++] = mean(B, B.deck);
  f[o++] = mean(B, B.dark);
  f[o++] = B.texN ? B.tex / B.texN : 0;
  f[o++] = mean(A, A.v) - mean(I, I.v);
  f[o++] = mean(B, B.v) - mean(I, I.v);
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
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      const i = y * W + x;
      if (labels[i] !== c.label) continue;
      const border = x === c.minX || x === c.maxX || y === c.minY || y === c.maxY || labels[i - 1] !== c.label || labels[i + 1] !== c.label || labels[i - W] !== c.label || labels[i + W] !== c.label;
      if (!border) continue;
      for (let cy = y; cy <= y + 1; cy++) {
        for (let cx = x; cx <= x + 1; cx++) {
          for (let k = 0; k < 18; k++) {
            const u = cx * OBB_COS[k] + cy * OBB_SIN[k];
            const v = cy * OBB_COS[k] - cx * OBB_SIN[k];
            if (u < lo[2 * k]) lo[2 * k] = u;
            if (u > hi[2 * k]) hi[2 * k] = u;
            if (v < lo[2 * k + 1]) lo[2 * k + 1] = v;
            if (v > hi[2 * k + 1]) hi[2 * k + 1] = v;
          }
        }
      }
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
  const stack: number[] = [];
  const push = (lx: number, ly: number) => {
    const k = ly * bw + lx;
    if (seen[k] || labels[(ly + c.minY) * W + lx + c.minX] === c.label) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let lx = 0; lx < bw; lx++) { push(lx, 0); push(lx, bh - 1); }
  for (let ly = 0; ly < bh; ly++) { push(0, ly); push(bw - 1, ly); }
  while (stack.length) {
    const k = stack.pop()!;
    const lx = k % bw, ly = (k / bw) | 0;
    if (lx > 0) push(lx - 1, ly);
    if (lx < bw - 1) push(lx + 1, ly);
    if (ly > 0) push(lx, ly - 1);
    if (ly < bh - 1) push(lx, ly + 1);
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
