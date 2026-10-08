/**
 * Shift between two imagery sources over the same ground, by phase
 * correlation of their gradient images. Used to move hand labels drawn on one
 * source onto another (labelShiftM in the registry).
 */
import { latToWorldY, lonToWorldX, metersPerPixel, type LonLat } from '@marco-polo/core';
import type { TileSource } from './imagery.js';

/** In-place radix-2 FFT of complex arrays of length n (a power of two). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  const r = new Float64Array(n), i2 = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n));
    i2.set(im.subarray(y * n, y * n + n));
    fft(r, i2, inverse);
    re.set(r, y * n);
    im.set(i2, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x];
      i2[y] = im[y * n + x];
    }
    fft(r, i2, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y];
      im[y * n + x] = i2[y];
    }
  }
}

/** Gradient magnitude of the grey image, windowed (Hann) to calm the edges. */
function gradient(rgba: ArrayLike<number>, n: number): Float64Array {
  const g = new Float64Array(n * n);
  const grey = (x: number, y: number) => {
    const i = (y * n + x) * 4;
    return rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  };
  for (let y = 1; y < n - 1; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (n - 1));
    for (let x = 1; x < n - 1; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (n - 1));
      g[y * n + x] = Math.hypot(grey(x + 1, y) - grey(x - 1, y), grey(x, y + 1) - grey(x, y - 1)) * wx * wy;
    }
  }
  return g;
}

/**
 * Pixel shift (dx, dy) that moves image b onto image a, with the height of the
 * correlation peak as a confidence (1 for identical images, near 0 for no match).
 */
export function phaseCorrelate(a: ArrayLike<number>, b: ArrayLike<number>, n: number): { dx: number; dy: number; peak: number } {
  const ar = gradient(a, n), ai = new Float64Array(n * n);
  const br = gradient(b, n), bi = new Float64Array(n * n);
  fft2(ar, ai, n);
  fft2(br, bi, n);
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) {
    const r = ar[k] * br[k] + ai[k] * bi[k];
    const i = ai[k] * br[k] - ar[k] * bi[k];
    const m = Math.hypot(r, i) || 1;
    re[k] = r / m;
    im[k] = i / m;
  }
  fft2(re, im, n, true);
  let best = 0, bx = 0, by = 0, sum = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = re[y * n + x];
      sum += Math.abs(v);
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  // Sub-pixel by a parabola through the neighbours.
  const at = (x: number, y: number) => re[((y + n) % n) * n + ((x + n) % n)];
  const sub = (l: number, c: number, r: number) => (l - 2 * c + r !== 0 ? (0.5 * (l - r)) / (l - 2 * c + r) : 0);
  let dx = bx + sub(at(bx - 1, by), best, at(bx + 1, by));
  let dy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > n / 2) dx -= n;
  if (dy > n / 2) dy -= n;
  void sum;
  return { dx, dy, peak: best };
}

/** Shift in metres [east, north] to apply to labels drawn on `from` so they sit on `to`. */
export async function sourceShiftM(from: TileSource, to: TileSource, center: LonLat, n = 1024): Promise<{ m: [number, number]; peak: number }> {
  const z = 19;
  const x0 = Math.round(lonToWorldX(center.lon, z) - n / 2), y0 = Math.round(latToWorldY(center.lat, z) - n / 2);
  const a = await to.crop(z, x0, y0, n, n);
  const b = await from.crop(z, x0, y0, n, n);
  const r = phaseCorrelate(a, b, n);
  const mpp = metersPerPixel(center.lat, z);
  return { m: [Math.round(r.dx * mpp * 10) / 10, Math.round(-r.dy * mpp * 10) / 10], peak: r.peak };
}
