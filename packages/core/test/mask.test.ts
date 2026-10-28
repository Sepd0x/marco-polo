import { describe, expect, it } from 'vitest';
import { cleanMask, dilate, erode, labelComponents } from '../src/detect/mask.js';

function maskFrom(rows: string[]): { mask: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) if (row[x] === '#') mask[y * w + x] = 1;
  });
  return { mask, w, h };
}

describe('morphology and labelling', () => {
  it('erode strips a 1px boundary', () => {
    const { mask, w, h } = maskFrom([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
    const e = erode(mask, w, h);
    expect(Array.from(e).reduce((a, b) => a + b, 0)).toBe(1);
    expect(e[2 * w + 2]).toBe(1);
  });

  it('dilate grows a cross', () => {
    const { mask, w, h } = maskFrom([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]);
    const d = dilate(mask, w, h);
    expect(Array.from(d).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('cleanMask removes isolated speckle', () => {
    const { mask, w, h } = maskFrom([
      '#.........',
      '..........',
      '...#####..',
      '...#####..',
      '...#####..',
      '...#####..',
      '...#####..',
      '..........',
      '.......#..',
      '..........',
    ]);
    const cleaned = cleanMask(mask, w, h);
    expect(cleaned[0]).toBe(0); // speckle gone
    expect(cleaned[8 * w + 7]).toBe(0);
    expect(cleaned[4 * w + 5]).toBe(1); // blob core survives
  });

  it('labels separate components with stats', () => {
    const { mask, w, h } = maskFrom([
      '##....',
      '##....',
      '......',
      '....##',
      '....##',
    ]);
    const { components } = labelComponents(mask, w, h);
    expect(components).toHaveLength(2);
    const [a, b] = components;
    expect(a.pixelCount).toBe(4);
    expect(a.minX).toBe(0);
    expect(a.maxX).toBe(1);
    expect(b.pixelCount).toBe(4);
    expect(b.minY).toBe(3);
    expect(b.maxY).toBe(4);
  });

  it('8-connectivity joins diagonal pixels', () => {
    const { mask, w, h } = maskFrom([
      '#.',
      '.#',
    ]);
    const { components } = labelComponents(mask, w, h);
    expect(components).toHaveLength(1);
    expect(components[0].pixelCount).toBe(2);
  });
});

describe('morphology and labelling against the plain per-pixel rules', () => {
  // The rules as first written, one pixel at a time.
  const refErode = (m: Uint8Array, w: number, h: number) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        if ((y > 0 ? m[i - w] : 1) && (y < h - 1 ? m[i + w] : 1) && (x > 0 ? m[i - 1] : 1) && (x < w - 1 ? m[i + 1] : 1)) out[i] = 1;
      }
    }
    return out;
  };
  const refDilate = (m: Uint8Array, w: number, h: number) => {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        out[i] = 1;
        if (y > 0) out[i - w] = 1;
        if (y < h - 1) out[i + w] = 1;
        if (x > 0) out[i - 1] = 1;
        if (x < w - 1) out[i + 1] = 1;
      }
    }
    return out;
  };
  const refLabels = (m: Uint8Array, w: number, h: number) => {
    const labels = new Int32Array(m.length);
    const comps: number[][] = [];
    let next = 0;
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || labels[s]) continue;
      next++;
      const st = [s];
      labels[s] = next;
      let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      while (st.length) {
        const i = st.pop()!;
        const y = Math.floor(i / w), x = i - y * w;
        n++; sx += x; sy += y;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx] && !labels[ny * w + nx]) {
              labels[ny * w + nx] = next;
              st.push(ny * w + nx);
            }
          }
        }
      }
      comps.push([next, n, x0, y0, x1, y1, sx, sy]);
    }
    return { labels, comps };
  };

  it('gives the same masks and labels on random masks of many sizes and densities', () => {
    let seed = 5;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let t = 0; t < 300; t++) {
      const w = 1 + Math.floor(rand() * 40), h = 1 + Math.floor(rand() * 40);
      const density = rand();
      const m = new Uint8Array(w * h);
      // Some masks hold other non-zero values than 1: they count as set.
      const value = rand() < 0.2 ? 1 + Math.floor(rand() * 255) : 1;
      for (let i = 0; i < m.length; i++) if (rand() < density) m[i] = value;
      expect(erode(m, w, h)).toEqual(refErode(m, w, h));
      expect(dilate(m, w, h)).toEqual(refDilate(m, w, h));
      const clean = refErode(refDilate(refDilate(refErode(m, w, h), w, h), w, h), w, h);
      expect(cleanMask(m, w, h)).toEqual(clean);
      const got = labelComponents(clean, w, h);
      const want = refLabels(clean, w, h);
      expect(got.labels).toEqual(want.labels);
      expect(got.components.map((c) => [c.label, c.pixelCount, c.minX, c.minY, c.maxX, c.maxY, c.sumX, c.sumY])).toEqual(want.comps);
    }
  });
});
