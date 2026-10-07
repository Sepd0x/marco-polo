/** Minimal RGBA raster for galleries: lines, polygons, resampled blits, a tiny bitmap font. */
export type RGB = [number, number, number];

export class Raster {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
    fill: RGB = [16, 16, 16],
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = fill[0];
      this.data[i * 4 + 1] = fill[1];
      this.data[i * 4 + 2] = fill[2];
      this.data[i * 4 + 3] = 255;
    }
  }

  set(x: number, y: number, c: RGB): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }

  /** Bresenham with optional thickness and dash period (0 = solid). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 1, dash = 0): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = (thick - 1) / 2;
    for (let i = 0; i <= n; i++) {
      if (dash && Math.floor(i / dash) % 2 === 1) continue;
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let dy = -Math.floor(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) this.set(x + dx, y + dy, c);
      }
    }
  }

  ring(pts: Array<[number, number]>, c: RGB, thick = 1, dash = 0): void {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.line(a[0], a[1], b[0], b[1], c, thick, dash);
    }
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 1, dash = 0): void {
    this.ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c, thick, dash);
  }

  fillRect(x0: number, y0: number, w: number, h: number, c: RGB): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }

  /** Bilinear blit of an RGBA source into a rectangle of this raster. */
  blit(src: Uint8ClampedArray, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
      const y0 = Math.floor(sy), y1 = Math.min(sh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
        const x0 = Math.floor(sx), x1 = Math.min(sw - 1, x0 + 1), fx = sx - x0;
        const tx = dx + x, ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const o = (ty * this.width + tx) * 4;
        for (let k = 0; k < 3; k++) {
          const a = src[(y0 * sw + x0) * 4 + k] * (1 - fx) + src[(y0 * sw + x1) * 4 + k] * fx;
          const b = src[(y1 * sw + x0) * 4 + k] * (1 - fx) + src[(y1 * sw + x1) * 4 + k] * fx;
          this.data[o + k] = a * (1 - fy) + b * fy;
        }
      }
    }
  }

  /** Text in a 3×5 pixel font, scaled, on a dark plate. */
  text(x: number, y: number, s: string, c: RGB = [255, 255, 255], scale = 2): void {
    const w = s.length * 4 * scale + scale;
    this.fillRect(x, y, w, 7 * scale, [0, 0, 0]);
    let cx = x + scale;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch];
      if (g) {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 3; col++) {
            if (g[row][col] === '#') this.fillRect(cx + col * scale, y + scale + row * scale, scale, scale, c);
          }
        }
      }
      cx += 4 * scale;
    }
  }
}

const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['...', '...', '...', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  ' ': ['...', '...', '...', '...', '...'],
  A: ['###', '#.#', '###', '#.#', '#.#'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
};
