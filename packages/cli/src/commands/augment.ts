/**
 * Training-time changes to window pixels, so a model trained on aerial
 * orthophotos also meets softer satellite imagery: colour jitter, resampling
 * to a coarser ground size and back, unsharp masking, sensor noise and JPEG
 * re-encoding. Everything is driven by a seeded generator, so one recipe,
 * seed and window always give the same pixels. Geometry never changes, so
 * labels stay valid. Transparent pixels (no imagery) are left alone.
 */
import jpeg from 'jpeg-js';
import { decodeJpeg } from '../jpeg.js';

export interface AugmentRecipe {
  /** Probability and ranges of each step; a step with p 0 never runs. */
  colour: { p: number; gain: [number, number]; gamma: [number, number]; saturation: [number, number]; offset: [number, number] };
  /** Ground size to resample to, metres per pixel. */
  resample: { p: number; metres: [number, number] };
  unsharp: { p: number; amount: [number, number]; radius: [number, number] };
  noise: { p: number; sigma: [number, number] };
  jpeg: { p: number; quality: [number, number] };
}

/** mulberry32: small, fast, good enough for picking augmentation parameters. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a of a string, to seed one window of one copy. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const uniform = (r: () => number, [lo, hi]: [number, number]) => lo + (hi - lo) * r();
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export interface AppliedAugment {
  steps: string[];
}

/**
 * Augment `pixels` (RGBA, `width` x `height`) in place. `mPerPx` is the
 * ground size of the window's pixels, for the resampling step.
 */
export function augmentPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mPerPx: number,
  recipe: AugmentRecipe,
  random: () => number,
): AppliedAugment {
  const steps: string[] = [];
  // Draw every decision up front so turning one step off does not shift the others.
  const doColour = random() < recipe.colour.p;
  const gains = [0, 1, 2].map(() => uniform(random, recipe.colour.gain));
  const gamma = uniform(random, recipe.colour.gamma);
  const satK = uniform(random, recipe.colour.saturation);
  const offset = uniform(random, recipe.colour.offset);
  const doResample = random() < recipe.resample.p;
  const metres = uniform(random, recipe.resample.metres);
  const doUnsharp = random() < recipe.unsharp.p;
  const amount = uniform(random, recipe.unsharp.amount);
  const radius = uniform(random, recipe.unsharp.radius);
  const doNoise = random() < recipe.noise.p;
  const sigma = uniform(random, recipe.noise.sigma);
  const doJpeg = random() < recipe.jpeg.p;
  const quality = Math.round(uniform(random, recipe.jpeg.quality));

  if (doColour) {
    colourJitter(pixels, gains, gamma, satK, offset);
    steps.push(`colour g${gains.map((g) => g.toFixed(2)).join('/')} y${gamma.toFixed(2)} s${satK.toFixed(2)} o${offset.toFixed(1)}`);
  }
  if (doResample && metres > mPerPx * 1.05) {
    resampleThrough(pixels, width, height, mPerPx / metres);
    steps.push(`resample ${metres.toFixed(2)} m`);
  }
  if (doUnsharp) {
    unsharp(pixels, width, height, amount, radius);
    steps.push(`unsharp ${amount.toFixed(2)} r${radius.toFixed(2)}`);
  }
  if (doNoise) {
    gaussianNoise(pixels, sigma, random);
    steps.push(`noise ${sigma.toFixed(1)}`);
  }
  if (doJpeg) {
    jpegRoundTrip(pixels, width, height, quality);
    steps.push(`jpeg ${quality}`);
  }
  return { steps };
}

function colourJitter(px: Uint8ClampedArray, gains: number[], gamma: number, satK: number, offset: number): void {
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] < 200) continue;
    const c = [0, 1, 2].map((k) => 255 * Math.pow(Math.min(1, Math.max(0, (px[o + k] * gains[k] + offset) / 255)), gamma));
    const m = (c[0] + c[1] + c[2]) / 3;
    for (let k = 0; k < 3; k++) px[o + k] = clamp(m + (c[k] - m) * satK);
  }
}

/** Box-average down by `scale` (< 1), then bilinear back up: detail finer than the new ground size is lost. */
function resampleThrough(px: Uint8ClampedArray, width: number, height: number, scale: number): void {
  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const small = new Float64Array(w * h * 3);
  const count = new Float64Array(w * h);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (px[o + 3] < 200) continue;
      const sx = Math.min(w - 1, Math.floor((x * w) / width));
      const k = sy * w + sx;
      small[k * 3] += px[o];
      small[k * 3 + 1] += px[o + 1];
      small[k * 3 + 2] += px[o + 2];
      count[k]++;
    }
  }
  for (let k = 0; k < w * h; k++) if (count[k]) for (let c = 0; c < 3; c++) small[k * 3 + c] /= count[k];
  for (let y = 0; y < height; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / height - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (px[o + 3] < 200) continue;
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / width - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = small[(y0 * w + x0) * 3 + c] * (1 - tx) + small[(y0 * w + x1) * 3 + c] * tx;
        const b = small[(y1 * w + x0) * 3 + c] * (1 - tx) + small[(y1 * w + x1) * 3 + c] * tx;
        px[o + c] = clamp(a * (1 - ty) + b * ty);
      }
    }
  }
}

function gaussianBlur(src: Float64Array, width: number, height: number, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let i = -r; i <= r; i++) s += k[i + r] * src[(y * width + Math.min(width - 1, Math.max(0, x + i))) * 3 + c];
        tmp[(y * width + x) * 3 + c] = s;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let i = -r; i <= r; i++) s += k[i + r] * tmp[(Math.min(height - 1, Math.max(0, y + i)) * width + x) * 3 + c];
        out[(y * width + x) * 3 + c] = s;
      }
    }
  }
  return out;
}

function unsharp(px: Uint8ClampedArray, width: number, height: number, amount: number, radius: number): void {
  const n = width * height;
  const src = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) src[i * 3 + c] = px[i * 4 + c];
  const blur = gaussianBlur(src, width, height, radius);
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 200) continue;
    for (let c = 0; c < 3; c++) px[i * 4 + c] = clamp(src[i * 3 + c] + amount * (src[i * 3 + c] - blur[i * 3 + c]));
  }
}

function gaussianNoise(px: Uint8ClampedArray, sigma: number, random: () => number): void {
  for (let o = 0; o < px.length; o += 4) {
    if (px[o + 3] < 200) continue;
    for (let c = 0; c < 3; c++) {
      // Box-Muller from two uniforms.
      const u = Math.max(1e-12, random()), v = random();
      px[o + c] = clamp(px[o + c] + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
  }
}

/**
 * Halve the chroma resolution the way a 4:2:0 encoder does (the jpeg-js
 * encoder keeps full chroma): average Cb and Cr over 2 x 2 blocks, then
 * spread them back bilinearly.
 */
function chroma420(px: Uint8ClampedArray, width: number, height: number): void {
  const w = Math.ceil(width / 2), h = Math.ceil(height / 2);
  const cb = new Float64Array(w * h), cr = new Float64Array(w * h), n = new Float64Array(w * h);
  const y = new Float64Array(width * height);
  for (let yy = 0; yy < height; yy++) {
    for (let x = 0; x < width; x++) {
      const i = yy * width + x, o = i * 4;
      const r = px[o], g = px[o + 1], b = px[o + 2];
      y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = (yy >> 1) * w + (x >> 1);
      cb[k] += -0.168736 * r - 0.331264 * g + 0.5 * b;
      cr[k] += 0.5 * r - 0.418688 * g - 0.081312 * b;
      n[k]++;
    }
  }
  for (let k = 0; k < w * h; k++) {
    cb[k] /= n[k];
    cr[k] /= n[k];
  }
  for (let yy = 0; yy < height; yy++) {
    const fy = Math.min(h - 1, Math.max(0, (yy + 0.5) / 2 - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const o = (yy * width + x) * 4;
      if (px[o + 3] < 200) continue;
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const lerp = (a: Float64Array) =>
        (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
      const Y = y[yy * width + x], Cb = lerp(cb), Cr = lerp(cr);
      px[o] = clamp(Y + 1.402 * Cr);
      px[o + 1] = clamp(Y - 0.344136 * Cb - 0.714136 * Cr);
      px[o + 2] = clamp(Y + 1.772 * Cb);
    }
  }
}

function jpegRoundTrip(px: Uint8ClampedArray, width: number, height: number, quality: number): void {
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  chroma420(px, width, height);
  const encoded = jpeg.encode({ data: Buffer.from(px.buffer, px.byteOffset, px.byteLength), width, height }, quality).data;
  const back = decodeJpeg(encoded).rgba;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < 200) continue;
    px[i * 4] = back[i * 4];
    px[i * 4 + 1] = back[i * 4 + 1];
    px[i * 4 + 2] = back[i * 4 + 2];
  }
}
